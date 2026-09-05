import { izumiArtifacts } from '../src/generated/izumi-artifacts'
import { TOKEN_PATTERN } from './validation'

const API_ROOT = 'https://api.cloudflare.com/client/v4'
const MAX_REQUEST_BYTES = 1024 * 1024

type ApiMessage = { code?: number; message?: string }
type ApiEnvelope<T> = { success: boolean; result?: T; errors?: ApiMessage[] }

export type PreviewChallenge = {
  challengeToken: string
  seed: string
  k: number
  g: number
}
type PreviewProvisioning = {
  account: { id: string; apiToken: string }
  claim: { url: string; expiresAt: string }
}

type DeploymentTarget = { accountId: string; scriptName: string; databaseId: string }

export type PreviewDeployment = {
  endpoint: string
  claimUrl?: string
  claimExpiresAt?: string
  deployment: DeploymentTarget
}

class CloudflareError extends Error {
  constructor(message: string, readonly status: number, readonly codes: number[]) { super(message) }
}

function operationName(path: string): string {
  if (path === '/provisioning/previews/challenge') return 'security challenge'
  if (path === '/provisioning/previews') return 'temporary account creation'
  if (path.endsWith('/query')) return 'database setup'
  if (path.includes('/d1/database')) return 'database creation'
  if (path.endsWith('/subdomain')) return 'Worker address setup'
  if (path.includes('/workers/scripts/')) return 'Worker upload'
  return 'deployment'
}

function apiError(path: string, status: number, errors: ApiMessage[] = []): Error {
  // Keep the operation and numeric codes outside upstream text redaction. The
  // latter may include credentials or an error identifier that resembles one.
  const codes = errors.map((entry) => entry.code).filter((code) => Number.isSafeInteger(code)).join(', ')
  const detail = errors.map((entry) => {
    // Provisioning code 1017 returns a machine-readable reason. Format that
    // narrow identifier as words without relaxing credential redaction.
    if (path === '/provisioning/previews' && entry.code === 1017 && typeof entry.message === 'string'
      && entry.message.length <= 120 && /^[a-z]+(?:_[a-z]+)+$/.test(entry.message)) return entry.message.replace(/_/g, ' ')
    return entry.message
  }).filter(Boolean).join('; ')
  return new CloudflareError(`Cloudflare ${operationName(path)} failed (HTTP ${status}${codes ? `; code ${codes}` : ''}).${detail ? ` ${detail}` : ''}`, status, errors.flatMap(entry => typeof entry.code === 'number' ? [entry.code] : []))
}

async function apiJson<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  let envelope: ApiEnvelope<T>
  try { envelope = await response.json() as ApiEnvelope<T> } catch { throw new Error(`Cloudflare returned an unreadable response (${response.status}).`) }
  if (!response.ok || !envelope.success || envelope.result == null) throw apiError(path, response.status, envelope.errors)
  return envelope.result
}

async function apiSuccess(path: string, init: RequestInit, token: string): Promise<void> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  let envelope: ApiEnvelope<unknown>
  try { envelope = await response.json() as ApiEnvelope<unknown> } catch { throw new Error(`Cloudflare returned an unreadable response (${response.status}).`) }
  if (!response.ok || !envelope.success) throw apiError(path, response.status, envelope.errors)
}

export async function createPreviewChallenge(): Promise<PreviewChallenge> {
  const challenge = await apiJson<PreviewChallenge>('/provisioning/previews/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!challenge.challengeToken || !challenge.seed || !Number.isInteger(challenge.k) || !Number.isInteger(challenge.g)
    || challenge.k <= 0 || challenge.g <= 0 || challenge.k * challenge.g > 64_000_000 || challenge.k > 20_000) {
    throw new Error('Cloudflare returned an unsupported deployment challenge.')
  }
  return challenge
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, '0')).join('')
}

function executableStatements(source: string): string[] {
  return source.split(';').map((statement) => statement.trim()).filter((statement) =>
    statement.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith('--')))
}

async function d1Query(token: string, target: DeploymentTarget, sql: string): Promise<unknown> {
  return apiJson(`/accounts/${target.accountId}/d1/database/${target.databaseId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  }, token)
}

async function applyMigrations(token: string, target: DeploymentTarget): Promise<void> {
  await d1Query(token, target, 'CREATE TABLE IF NOT EXISTS izumi_deploy_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  for (const migration of izumiArtifacts.migrations) {
    // D1 accepts multiple SQL statements. One request per migration also keeps
    // authenticated deployments within the relay's subrequest budget.
    await d1Query(token, target, [...executableStatements(migration.sql), `INSERT OR REPLACE INTO izumi_deploy_migrations (name, applied_at) VALUES ('${migration.name.replace(/'/g, "''")}', unixepoch())`].join(';\n') + ';')
  }
}

async function ensureSubdomain(token: string, accountId: string): Promise<string> {
  try {
    const existing = await apiJson<{ subdomain: string }>(`/accounts/${accountId}/workers/subdomain`, {}, token)
    if (existing.subdomain) return existing.subdomain
  } catch (error) {
    // Never replace an existing account's address after a permission/network error.
    if (!(error instanceof CloudflareError) || error.status !== 404 || !error.codes.includes(10007)) throw error
  }
  for (const candidate of [`izumi-${accountId.slice(0, 12)}`, `izumi-${randomHex(5)}`]) {
    try {
      const created = await apiJson<{ subdomain: string }>(`/accounts/${accountId}/workers/subdomain`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: candidate }),
      }, token)
      if (created.subdomain) return created.subdomain
    } catch { /* Try one collision-safe fallback. */ }
  }
  throw new Error('Cloudflare could not create the private workers.dev address.')
}

async function uploadWorker(token: string, target: DeploymentTarget, bootstrapSecret: string): Promise<void> {
  const metadata = {
    main_module: 'worker.mjs',
    bindings: [
      { type: 'd1', name: 'DB', id: target.databaseId },
      { type: 'secret_text', name: 'BOOTSTRAP_SECRET', text: bootstrapSecret },
    ],
    compatibility_date: izumiArtifacts.compatibilityDate,
    compatibility_flags: ['nodejs_compat'],
    annotations: {
      'workers/message': `Deployed by Izumi TV Link from ${izumiArtifacts.gitCommit.slice(0, 12)}`,
      'workers/tag': 'izumi-private-sync',
    },
  }
  const form = new FormData()
  form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.set('worker.mjs', new Blob([izumiArtifacts.workerBundle], { type: 'application/javascript+module' }), 'worker.mjs')
  await apiSuccess(`/accounts/${target.accountId}/workers/scripts/${target.scriptName}`, { method: 'PUT', body: form }, token)
}

async function enableSubdomain(token: string, target: DeploymentTarget): Promise<void> {
  await apiSuccess(`/accounts/${target.accountId}/workers/scripts/${target.scriptName}/subdomain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  }, token)
}

async function waitForWorker(endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/v1/status`, { headers: { Accept: 'application/json' } })
      const status = response.ok ? await response.json() as { app?: unknown } : null
      if (status?.app === 'izumi-sync') return
    } catch { /* The route may still be propagating. */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The private Worker was uploaded, but its address is not ready yet.')
}

function validSolution(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 64 || value.length > MAX_REQUEST_BYTES) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

export async function deployPreview(input: unknown): Promise<PreviewDeployment> {
  const value = input as Record<string, unknown> | null
  if (!value || value.acceptTerms !== true) throw new Error('Accept Cloudflare terms before deploying.')
  if (!TOKEN_PATTERN.test(String(value.bootstrapSecret || ''))) throw new Error('The browser setup secret is invalid.')
  if (typeof value.challengeToken !== 'string' || value.challengeToken.length < 16 || value.challengeToken.length > 4096 || !validSolution(value.checkpoints)) {
    throw new Error('The Cloudflare deployment proof is invalid or expired.')
  }

  const preview = await apiJson<PreviewProvisioning>('/provisioning/previews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      termsOfService: 'https://www.cloudflare.com/terms/',
      privacyPolicy: 'https://www.cloudflare.com/privacypolicy/',
      acceptTermsOfService: 'yes',
      challengeToken: value.challengeToken,
      solution: { checkpoints: value.checkpoints },
    }),
  })
  const token = preview.account.apiToken
  const accountId = preview.account.id
  if (!TOKEN_PATTERN.test(token) || !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Cloudflare returned invalid temporary deployment credentials.')
  const result = await deployAuthenticated(token, accountId, String(value.bootstrapSecret))
  return { ...result, claimUrl: preview.claim.url, claimExpiresAt: preview.claim.expiresAt }
}

function apiToken(input: unknown): string {
  if (typeof input !== 'string' || !TOKEN_PATTERN.test(input.trim())) throw new Error('Paste a complete Cloudflare API token. A Global API Key is not supported.')
  return input.trim()
}

export async function deploymentAccounts(input: unknown): Promise<{ id: string; name: string }[]> {
  const token = apiToken((input as Record<string, unknown> | null)?.apiToken)
  const accounts = await apiJson<{ id: string; name: string }[]>('/accounts?per_page=50', {}, token)
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('This token cannot access an account. Check Account Settings Read and the account scope.')
  return accounts.map(({ id, name }) => ({ id, name }))
}

export async function deployWithApiToken(input: unknown): Promise<PreviewDeployment> {
  const value = input as Record<string, unknown> | null
  const token = apiToken(value?.apiToken)
  const accountId = String(value?.accountId || '')
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Choose the Cloudflare account to deploy into.')
  if (!TOKEN_PATTERN.test(String(value?.bootstrapSecret || ''))) throw new Error('The browser setup secret is invalid.')
  if (value?.acceptTerms !== true) throw new Error('Accept Cloudflare terms before deploying.')
  return deployAuthenticated(token, accountId, String(value.bootstrapSecret))
}

async function deployAuthenticated(token: string, accountId: string, bootstrapSecret: string): Promise<PreviewDeployment> {
  const target: DeploymentTarget = { accountId, scriptName: `izumi-sync-${randomHex(4)}`, databaseId: '' }
  let createdDatabase = false
  try {
    const database = await apiJson<{ uuid?: string }>(`/accounts/${accountId}/d1/database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${target.scriptName}-db` }),
    }, token)
    if (!database.uuid || !/^[a-f0-9-]{36}$/i.test(database.uuid)) throw new Error('Cloudflare did not return the private database id.')
    target.databaseId = database.uuid
    createdDatabase = true
    await applyMigrations(token, target)
    const subdomain = await ensureSubdomain(token, accountId)
    await uploadWorker(token, target, bootstrapSecret)
    await enableSubdomain(token, target)
    const endpoint = `https://${target.scriptName}.${subdomain}.workers.dev`
    await waitForWorker(endpoint)
    return { endpoint, deployment: target }
  } catch (error) {
    if (target.scriptName) await apiSuccess(`/accounts/${accountId}/workers/scripts/${target.scriptName}`, { method: 'DELETE' }, token).catch(() => undefined)
    if (createdDatabase) await apiSuccess(`/accounts/${accountId}/d1/database/${target.databaseId}`, { method: 'DELETE' }, token).catch(() => undefined)
    throw error
  }
}

export async function readLimitedJson(request: Request): Promise<unknown> {
  const announced = Number(request.headers.get('Content-Length') || 0)
  if (announced > MAX_REQUEST_BYTES) throw new Error('The deployment request is too large.')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new Error('The deployment request is too large.')
  return JSON.parse(text || '{}')
}
