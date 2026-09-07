import type { CompanionCloudflareTransport } from '../types'
import { tvProfileReady, tvProfileScope } from './profiles'

export const CLIENT_LINK_REMOTE = 'izumi-client-link-remote'
export const CLIENT_LINK_TTL_MS = 10 * 60_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const UPDATE_MESSAGE = 'Update your private Worker to support linking a phone or desktop, then retry.'

export interface ClientLinkIdentity {
  transport: CompanionCloudflareTransport
  deviceId: string
  credential: string
}

export interface ClientLinkCode {
  code: string
  address: string
  link: string
  expiresAt: number
}

export type ClientLinkState = 'waiting' | 'linked' | 'expired'

export class ClientLinkRequestError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}

export function normalizeClientLinkCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '')
}

export function formatClientLinkCode(code: string): string {
  return normalizeClientLinkCode(code).match(/.{1,4}/g)?.join(' ') ?? ''
}

export function generateClientLinkCode(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function' || !crypto.subtle) {
    throw new Error('Secure linking is unavailable on this TV. Update Companion and retry.')
  }
  // Exactly 32 symbols: each uniformly random low five bits supplies one character.
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => CODE_ALPHABET[byte & 31]).join('')
}

function base64url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const encode = (value: string) => new TextEncoder().encode(value)
const digest = (value: string) => crypto.subtle.digest('SHA-256', encode(value))

export async function clientLinkToken(code: string): Promise<string> {
  return base64url(new Uint8Array(await digest(normalizeClientLinkCode(code))))
}

export function clientLinkUrl(endpoint: string, code: string): string {
  return `izumi://companion/restore?worker=${encodeURIComponent(endpoint.replace(/\/+$/, ''))}#code=${normalizeClientLinkCode(code)}`
}

async function encryptIdentity(identity: ClientLinkIdentity, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', await digest(`izumi-client-link-key-v1:${normalizeClientLinkCode(code)}`), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv,
    additionalData: encode(`izumi-client-link-v1:${identity.transport.endpoint}`),
  }, key, encode(JSON.stringify({ v: 1, ...identity })))
  return JSON.stringify({ v: 1, iv: base64url(iv), data: base64url(new Uint8Array(data)) })
}

function request(transport: CompanionCloudflareTransport, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, transport.endpoint + path, true)
    xhr.timeout = 15_000
    if (path !== '/v1/status') xhr.setRequestHeader('Authorization', `Bearer ${transport.tvToken}`)
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json')
    Object.keys(headers).forEach((name) => xhr.setRequestHeader(name, headers[name]))
    xhr.onload = () => {
      let value: Record<string, unknown> | null = null
      try {
        const parsed: unknown = JSON.parse(xhr.responseText || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>
      } catch { /* Report a controlled error, never a response containing credentials. */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = [404, 405, 501].includes(xhr.status) ? UPDATE_MESSAGE
          : value?.code === 'PROFILE_LOCKED' || value?.code === 'PROFILE_CHANGED' ? 'Choose and unlock your profile, then retry.'
          : xhr.status === 403 ? 'Linking requires the first unrestricted household profile. Unlock it with its PIN, then retry.'
          : xhr.status === 401 ? 'Your private Worker could not authorize this TV. Check its connection setup, then retry.'
          : xhr.status === 429 ? 'Too many linking attempts. Wait a moment, then retry.'
          : xhr.status === 410 ? 'This code has expired. Generate a new code.'
          : `Your private Worker returned an error (${xhr.status}). Please retry.`
        reject(new ClientLinkRequestError(message, xhr.status))
      } else if (!value) reject(new ClientLinkRequestError('Your private Worker returned an invalid response. Please retry.', xhr.status))
      else resolve(value)
    }
    xhr.onerror = () => reject(new ClientLinkRequestError('Your private Worker could not be reached. Check the connection and retry.'))
    xhr.ontimeout = () => reject(new ClientLinkRequestError('Your private Worker did not respond in time. Please retry.'))
    xhr.onabort = () => reject(new ClientLinkRequestError('The linking request was interrupted. Please retry.'))
    xhr.send(body === undefined ? null : JSON.stringify(body))
  })
}

/** A single code's lifetime, including cleanup after requests that outlive the screen. */
export class ClientLinkSession {
  private readonly identity: ClientLinkIdentity
  private readonly scope = tvProfileScope()
  private readonly path: string
  private token = ''
  private attemptedCreate = false
  private cancelled = false
  private creation?: Promise<ClientLinkCode>
  private expiresAt = 0
  private state: ClientLinkState = 'waiting'

  constructor(transport: CompanionCloudflareTransport, deviceId: string, credential: string) {
    this.identity = { transport: { ...transport, endpoint: transport.endpoint.replace(/\/+$/, '') }, deviceId, credential }
    this.path = `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/client-links`
  }

  isProfileCurrent(): boolean {
    const current = tvProfileScope()
    return tvProfileReady() && current.profileId === this.scope.profileId && current.profilePin === this.scope.profilePin
  }

  private assertActive(): void {
    if (this.cancelled) throw new Error('Linking was cancelled.')
    if (!this.isProfileCurrent()) throw new Error('Choose and unlock your profile, then retry.')
  }

  private async removePending(): Promise<void> {
    if (!this.attemptedCreate) return
    try { await request(this.identity.transport, 'DELETE', this.path, { token: this.token }) }
    catch { /* Best effort when offline; the Worker also expires the code after ten minutes. */ }
  }

  private async activeRequest(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    try { return await request(this.identity.transport, method, path, body, headers) }
    finally {
      // Do not abort POST: its server-side write may still complete after Back's DELETE.
      if (this.cancelled) await this.removePending()
    }
  }

  start(): Promise<ClientLinkCode> {
    if (!this.creation) this.creation = this.create()
    return this.creation
  }

  private async create(): Promise<ClientLinkCode> {
    try {
      this.assertActive()
      if (!this.identity.deviceId || !this.identity.credential || !this.identity.transport.tvToken) {
        throw new Error('Complete independent TV setup before linking a phone or desktop.')
      }
      const status = await this.activeRequest('GET', '/v1/status')
      this.assertActive()
      if (!Array.isArray(status.features) || !status.features.includes('companion-client-link-v1')) throw new Error(UPDATE_MESSAGE)
      const code = generateClientLinkCode()
      this.token = await clientLinkToken(code)
      const payload = await encryptIdentity(this.identity, code)
      this.assertActive()
      const createdAt = Date.now()
      this.attemptedCreate = true
      const response = await this.activeRequest('POST', this.path, { token: this.token, payload, ...tvProfileScope() })
      this.assertActive()
      if (typeof response.expiresAt !== 'number' || !Number.isFinite(response.expiresAt)) {
        throw new Error('Your private Worker returned an invalid expiry. Please retry.')
      }
      this.expiresAt = Math.min(response.expiresAt, createdAt + CLIENT_LINK_TTL_MS)
      if (this.expiresAt <= Date.now()) throw new Error('This code has expired. Generate a new code.')
      return { code, address: this.identity.transport.endpoint, link: clientLinkUrl(this.identity.transport.endpoint, code), expiresAt: this.expiresAt }
    } catch (error) {
      await this.cancel()
      throw error
    }
  }

  async poll(): Promise<ClientLinkState> {
    try {
      this.assertActive()
      if (!this.expiresAt) throw new Error('Generate a code before checking its status.')
      if (this.state !== 'waiting') return this.state
      if (Date.now() >= this.expiresAt) {
        this.state = 'expired'
        await this.removePending()
        return this.state
      }
      const response = await this.activeRequest('GET', this.path, undefined, { 'X-Izumi-Client-Link': this.token })
      this.assertActive()
      if (!['waiting', 'linked', 'expired'].includes(response.state as string)) throw new Error('Your private Worker returned an invalid link status. Please retry.')
      this.state = response.state as ClientLinkState
      return this.state
    } catch (error) {
      if (!this.cancelled && this.isProfileCurrent() && error instanceof ClientLinkRequestError && error.status === 410) {
        this.state = 'expired'
        return this.state
      }
      await this.cancel()
      throw error
    }
  }

  cancel(): Promise<void> {
    this.cancelled = true
    return this.removePending()
  }
}
