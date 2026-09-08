import { afterEach, describe, expect, it, vi } from 'vitest'
import { deploymentAccounts, deployWithApiToken, deployPreview } from './cloudflare-preview'

afterEach(() => vi.unstubAllGlobals())
const credentials = { apiToken: 't'.repeat(40), accountId: 'a'.repeat(32), bootstrapSecret: 's'.repeat(43), acceptTerms: true }
const db = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('authenticated Cloudflare setup', () => {
  it('validates credentials and returns account names without returning the token', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer ' + credentials.apiToken)
      return Response.json({ success: true, result: [{ id: credentials.accountId, name: 'My account' }] })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(deploymentAccounts({ apiToken: 'invalid' })).rejects.toThrow('API token')
    expect(fetcher).not.toHaveBeenCalled()
    expect(await deploymentAccounts(credentials)).toEqual([{ id: credentials.accountId, name: 'My account' }])
  })
  it('creates only new resources in the selected account, batches migrations and preserves its subdomain', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      if (url.endsWith('/v1/status')) return Response.json({ app: 'izumi-sync' })
      expect(url).toContain(`/accounts/${credentials.accountId}/`)
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer ' + credentials.apiToken)
      if (url.endsWith('/d1/database')) return Response.json({ success: true, result: { uuid: db } })
      if (url.endsWith('/workers/subdomain')) { expect(init.method).toBeUndefined(); return Response.json({ success: true, result: { subdomain: 'existing-account' } }) }
      if (url.endsWith('/schedules') && !init.method) return Response.json({ success: true, result: { schedules: [{ cron: '0 0 * * *' }] } })
      if (url.endsWith('/query')) return Response.json({ success: true, result: [] })
      return Response.json({ success: true, result: null })
    }))
    const result = await deployWithApiToken(credentials)
    expect(result.endpoint).toMatch(/^https:\/\/izumi-sync-[a-f0-9]+\.existing-account\.workers\.dev$/)
    expect(result.claimUrl).toBeUndefined()
    const upload = calls.find(call => call.init.body instanceof FormData)!
    const metadata = JSON.parse(await ((upload.init.body as FormData).get('metadata') as Blob).text())
    const secret = metadata.bindings.find((binding: { name: string }) => binding.name === 'WORKER_UPDATE_AUTH')
    expect(secret.type).toBe('secret_text')
    expect(JSON.parse(secret.text)).toEqual({ apiToken: credentials.apiToken, ...result.deployment })
    expect(metadata.bindings).toContainEqual({ type: 'durable_object_namespace', name: 'TV_RESOLVE_SESSIONS', class_name: 'CompanionResolveSession' })
    expect(metadata.exports).toEqual({ CompanionResolveSession: { type: 'durable-object', storage: 'sqlite' } })
    const schedule = calls.find(call => call.url.endsWith('/schedules') && call.init.method === 'PUT')!
    expect(JSON.parse(schedule.init.body as string)).toEqual([{ cron: '0 0 * * *' }, { cron: '17 */6 * * *' }])
    expect(JSON.stringify(result)).not.toContain(credentials.apiToken)
    expect(calls.some(call => call.url.includes('/provisioning/'))).toBe(false)
    expect(calls.length).toBeLessThan(30)
    expect(calls.filter(call => call.url.endsWith('/query')).some(call => JSON.parse(call.init.body as string).sql.includes(';\n'))).toBe(true)
  })
  it('does not change an account address when its lookup is unauthorized and cleans up newly created resources', async () => {
    const calls: { url: string; method?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method })
      if (url.endsWith('/d1/database')) return Response.json({ success: true, result: { uuid: db } })
      if (url.endsWith('/query')) return Response.json({ success: true, result: [] })
      if (url.endsWith('/workers/subdomain')) return Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 })
      return Response.json({ success: true })
    }))
    await expect(deployWithApiToken(credentials)).rejects.toThrow('403')
    expect(calls.some(call => call.method === 'PUT')).toBe(false)
    expect(calls.some(call => call.method === 'DELETE' && call.url.endsWith('/' + db))).toBe(true)
  })
  it('does not retain temporary account credentials or schedule updates before durable authorization', async () => {
    let metadata: { bindings: { name: string }[] } | undefined
    const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/provisioning/previews')) return Response.json({ success: true, result: {
        account: { id: credentials.accountId, apiToken: credentials.apiToken },
        claim: { url: 'https://dash.cloudflare.com/claim/example', expiresAt: '2026-09-09T00:00:00Z' },
      } })
      if (url.endsWith('/v1/status')) return Response.json({ app: 'izumi-sync' })
      if (url.endsWith('/d1/database')) return Response.json({ success: true, result: { uuid: db } })
      if (url.endsWith('/workers/subdomain')) return Response.json({ success: true, result: { subdomain: 'existing-account' } })
      if (url.endsWith('/query')) return Response.json({ success: true, result: [] })
      if (init.body instanceof FormData) metadata = JSON.parse(await (init.body.get('metadata') as Blob).text())
      return Response.json({ success: true })
    })
    vi.stubGlobal('fetch', fetcher)
    await deployPreview({ ...credentials, challengeToken: 'c'.repeat(32), checkpoints: 'A'.repeat(64) })
    expect(metadata!.bindings.map(binding => binding.name)).toEqual(['DB', 'BOOTSTRAP_SECRET', 'TV_RESOLVE_SESSIONS'])
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/schedules'))).toBe(false)
  })

})
