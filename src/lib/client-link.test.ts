import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_LINK_TTL_MS, ClientLinkRequestError, ClientLinkSession, clientLinkToken, clientLinkUrl, formatClientLinkCode, generateClientLinkCode } from './client-link'
import { tvProfileReady, tvProfileScope } from './profiles'
import type { CompanionCloudflareTransport } from '../types'

vi.mock('./profiles', () => ({ tvProfileReady: vi.fn(() => true), tvProfileScope: vi.fn(() => ({ profileId: 'default' })) }))

const transport: CompanionCloudflareTransport = {
  protocol: 1, endpoint: 'https://worker.example.invalid///', pairingId: 'tv-pairing',
  tvToken: 't'.repeat(43), playbackMode: 'cloud-only', wakeWhenClosed: false,
}
const deviceId = 'tv-device'
const credential = 'c'.repeat(43)
const path = 'https://worker.example.invalid/v1/companion/pairings/tv-pairing/client-links'
const feature = { features: ['companion-client-link-v1'] }

class MockXhr {
  static requests: MockXhr[] = []
  static handle: (xhr: MockXhr) => void
  method = ''; url = ''; body: Record<string, unknown> | null = null
  headers: Record<string, string> = {}
  status = 0; responseText = ''; timeout = 0
  onload = () => {}; onerror = () => {}; ontimeout = () => {}; onabort = () => {}
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(key: string, value: string) { this.headers[key] = value }
  send(body: string | null) {
    this.body = body ? JSON.parse(body) : null
    MockXhr.requests.push(this)
    MockXhr.handle(this)
  }
  respond(status: number, value: unknown = {}) {
    this.status = status; this.responseText = JSON.stringify(value); this.onload()
  }
}

const requests = (method: string) => MockXhr.requests.filter((xhr) => xhr.method === method)
const makeSession = () => new ClientLinkSession(transport, deviceId, credential)
function respondNormally(xhr: MockXhr) {
  if (xhr.url.endsWith('/v1/status')) xhr.respond(200, feature)
  else if (xhr.method === 'POST') xhr.respond(200, { expiresAt: Date.now() + CLIENT_LINK_TTL_MS })
  else if (xhr.method === 'DELETE') xhr.respond(204)
  else xhr.respond(200, { state: 'waiting' })
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('XMLHttpRequest', MockXhr)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('XHR is required') }))
  vi.mocked(tvProfileReady).mockReturnValue(true)
  vi.mocked(tvProfileScope).mockReturnValue({ profileId: 'default' })
  MockXhr.requests = []
  MockXhr.handle = respondNormally
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('TV client linking', () => {
  it('uses all 32 symbols uniformly with cryptographic bytes and formats five groups of four', async () => {
    vi.spyOn(webcrypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array
      for (let index = 0; index < bytes.length; index++) bytes[index] = 240 + index
      return array
    })
    const code = generateClientLinkCode()
    expect(code).toBe('STUVWXYZ23456789ABCD')
    expect(formatClientLinkCode(code)).toBe('STUV WXYZ 2345 6789 ABCD')
    expect(await clientLinkToken(' stuv-wxyz 2345 6789 abcd ')).toBe(createHash('sha256').update(code).digest('base64url'))
  })

  it('encrypts the exact identity, including an optional recovery key, and exposes only a one-use code in the deep link', async () => {
    const extendedTransport = { ...transport, recoveryKey: Buffer.alloc(32, 7).toString('base64url') }
    vi.mocked(tvProfileScope).mockReturnValue({ profileId: 'viewer', profilePin: '1234' })
    const session = new ClientLinkSession(extendedTransport, deviceId, credential)
    const code = await session.start()
    expect(code.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$/)
    expect(code.address).toBe('https://worker.example.invalid')
    expect(code.link).toBe(`izumi://companion/restore?worker=https%3A%2F%2Fworker.example.invalid#code=${code.code}`)
    const post = requests('POST')[0]
    expect(post.url).toBe(path)
    expect(post.headers).toEqual({ Authorization: `Bearer ${transport.tvToken}`, 'Content-Type': 'application/json' })
    expect(post.timeout).toBe(15_000)
    expect(post.body).toEqual({ token: await clientLinkToken(code.code), payload: expect.any(String), profileId: 'viewer', profilePin: '1234' })
    const envelope = JSON.parse(post.body!.payload as string)
    expect(envelope).toEqual({ v: 1, iv: expect.stringMatching(/^[\w-]{16}$/), data: expect.stringMatching(/^[\w-]+$/) })
    const key = await webcrypto.subtle.importKey('raw', createHash('sha256').update('izumi-client-link-key-v1:' + code.code).digest(), 'AES-GCM', false, ['decrypt'])
    const algorithm = { name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url'), additionalData: Buffer.from('izumi-client-link-v1:' + code.address) }
    const plain = await webcrypto.subtle.decrypt(algorithm, key, Buffer.from(envelope.data, 'base64url'))
    expect(JSON.parse(Buffer.from(plain).toString())).toEqual({ v: 1, transport: { ...extendedTransport, endpoint: code.address }, deviceId, credential })
    await expect(webcrypto.subtle.decrypt({ ...algorithm, additionalData: Buffer.from('izumi-client-link-v1:https://another.example.invalid') }, key, Buffer.from(envelope.data, 'base64url'))).rejects.toThrow()
    for (const raw of [transport.tvToken, credential, extendedTransport.recoveryKey]) {
      expect(code.link).not.toContain(raw)
      expect(JSON.stringify(post.body)).not.toContain(raw)
    }
    expect(MockXhr.requests[0].headers).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
    await session.cancel()
  })

  it('supports older TV identities without a recovery key and sends the polling token only in a header', async () => {
    const session = makeSession()
    const code = await session.start()
    const token = await clientLinkToken(code.code)
    expect(await session.poll()).toBe('waiting')
    const poll = requests('GET')[1]
    expect(poll.url).toBe(path)
    expect(new URL(poll.url).search).toBe('')
    expect(poll.url).not.toContain(token)
    expect(poll.headers).toEqual({ Authorization: `Bearer ${transport.tvToken}`, 'X-Izumi-Client-Link': token })
    expect(poll.body).toBeNull()
    expect(poll.url).not.toContain(code.code)
    MockXhr.handle = (xhr) => xhr.respond(200, { state: 'linked' })
    expect(await session.poll()).toBe('linked')
    expect(requests('GET').slice(1).every((xhr) => xhr.url === path && xhr.headers['X-Izumi-Client-Link'] === token)).toBe(true)
    const total = MockXhr.requests.length
    expect(await session.poll()).toBe('linked')
    expect(MockXhr.requests).toHaveLength(total)
    await session.cancel()
    expect(requests('DELETE')[0].body).toEqual({ token })
  })

  it('normalizes endpoint slashes and preserves a Worker path in the encoded link', () => {
    expect(clientLinkUrl('https://worker.example.invalid/private/', ' abcd-efgh-jklm-npqr-stuv '))
      .toBe('izumi://companion/restore?worker=https%3A%2F%2Fworker.example.invalid%2Fprivate#code=ABCDEFGHJKLMNPQRSTUV')
  })

  it.each([{}, { features: [] }, { features: 'companion-client-link-v1' }])('gives an older Worker update message before publishing secrets: %j', async (status) => {
    MockXhr.handle = (xhr) => xhr.respond(200, status)
    await expect(makeSession().start()).rejects.toThrow('Update your private Worker')
    expect(requests('POST')).toHaveLength(0)
  })

  it.each([404, 405, 501])('reports unsupported Worker endpoints (%i)', async (status) => {
    MockXhr.handle = (xhr) => xhr.respond(status, { error: credential })
    await expect(makeSession().start()).rejects.toMatchObject({ message: expect.stringContaining('Update your private Worker'), status })
  })

  it.each([401, 403, 429, 500])('retains HTTP status without echoing server response secrets (%i)', async (status) => {
    MockXhr.handle = (xhr) => xhr.respond(status, { error: credential })
    const error = await makeSession().start().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ClientLinkRequestError)
    expect(error).toMatchObject({ status })
    expect((error as Error).message).not.toContain(credential)
  })

  it.each(['onerror', 'ontimeout', 'onabort'] as const)('handles XHR %s with a retry message', async (event) => {
    MockXhr.handle = (xhr) => xhr[event]()
    await expect(makeSession().start()).rejects.toThrow(/retry/i)
  })

  it('requires an unlocked profile before issuing any request', async () => {
    vi.mocked(tvProfileReady).mockReturnValue(false)
    await expect(makeSession().start()).rejects.toThrow('unlock your profile')
    expect(MockXhr.requests).toHaveLength(0)
  })

  it('does not publish a code if the profile changes during preparation', async () => {
    MockXhr.handle = (xhr) => {
      vi.mocked(tvProfileScope).mockReturnValue({ profileId: 'another-viewer' })
      xhr.respond(200, feature)
    }
    await expect(makeSession().start()).rejects.toThrow('unlock your profile')
    expect(requests('POST')).toHaveLength(0)
  })

  it('cancels a published code when its profile locks', async () => {
    const session = makeSession()
    await session.start()
    vi.mocked(tvProfileReady).mockReturnValue(false)
    await expect(session.poll()).rejects.toThrow('unlock your profile')
    expect(requests('DELETE')).toHaveLength(1)
  })

  it('expires locally after ten minutes even if the Worker offers a longer lifetime', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    MockXhr.handle = (xhr) => xhr.method === 'POST'
      ? xhr.respond(200, { expiresAt: now + CLIENT_LINK_TTL_MS * 2 }) : respondNormally(xhr)
    const session = makeSession()
    expect((await session.start()).expiresAt).toBe(now + CLIENT_LINK_TTL_MS)
    now += CLIENT_LINK_TTL_MS
    expect(await session.poll()).toBe('expired')
    expect(requests('GET')).toHaveLength(1)
    expect(requests('DELETE')).toHaveLength(1)
  })

  it.each([{ state: 'expired' }, 410])('accepts server expiry: %j', async (response) => {
    const session = makeSession()
    await session.start()
    MockXhr.handle = (xhr) => typeof response === 'number' ? xhr.respond(response) : xhr.respond(200, response)
    expect(await session.poll()).toBe('expired')
  })

  it.each([{}, { expiresAt: 'tomorrow' }, { expiresAt: 1 }])('deletes a session with an invalid or stale expiry: %j', async (response) => {
    MockXhr.handle = (xhr) => xhr.method === 'POST' ? xhr.respond(200, response) : respondNormally(xhr)
    await expect(makeSession().start()).rejects.toThrow(/expiry|expired/)
    expect(requests('DELETE')).toHaveLength(1)
  })

  it('rejects malformed JSON and unexpected poll states', async () => {
    const session = makeSession()
    await session.start()
    MockXhr.handle = (xhr) => xhr.method === 'GET' ? xhr.respond(200, { state: 'unknown' }) : respondNormally(xhr)
    await expect(session.poll()).rejects.toThrow('invalid link status')
    expect(requests('DELETE')).toHaveLength(1)
    MockXhr.handle = (xhr) => { xhr.status = 200; xhr.responseText = 'not json'; xhr.onload() }
    await expect(makeSession().start()).rejects.toThrow('invalid response')
  })

  it('never substitutes insecure randomness when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', {})
    await expect(makeSession().start()).rejects.toThrow('Secure linking is unavailable')
    expect(requests('POST')).toHaveLength(0)
  })

  it('cancels during feature detection without ever publishing a code', async () => {
    MockXhr.handle = () => {}
    const session = makeSession()
    const outcome = expect(session.start()).rejects.toThrow('cancelled')
    await session.cancel()
    MockXhr.requests[0].respond(200, feature)
    await outcome
    expect(requests('POST')).toHaveLength(0)
  })

  it.each(['success', 'timeout', 'error'] as const)('deletes again after a late create %s following Back/unmount', async (response) => {
    MockXhr.handle = (xhr) => { if (xhr.method !== 'POST') respondNormally(xhr) }
    const session = makeSession()
    const outcome = expect(session.start()).rejects.toThrow()
    await vi.waitFor(() => expect(requests('POST')).toHaveLength(1))
    await session.cancel()
    const cancelledDeletes = requests('DELETE').length
    expect(cancelledDeletes).toBeGreaterThan(0)
    const post = requests('POST')[0]
    if (response === 'success') post.respond(200, { expiresAt: Date.now() + CLIENT_LINK_TTL_MS })
    else if (response === 'timeout') post.ontimeout()
    else post.respond(500)
    await outcome
    expect(requests('DELETE').length).toBeGreaterThan(cancelledDeletes)
    expect(requests('DELETE').every((xhr) => xhr.body!.token === post.body!.token)).toBe(true)
  })

  it('suppresses a late linked poll after cancellation and repeats cleanup', async () => {
    const session = makeSession()
    await session.start()
    MockXhr.handle = (xhr) => { if (xhr.method !== 'GET') respondNormally(xhr) }
    const outcome = expect(session.poll()).rejects.toThrow('cancelled')
    const poll = requests('GET')[1]
    await session.cancel()
    const before = requests('DELETE').length
    poll.respond(200, { state: 'linked' })
    await outcome
    expect(requests('DELETE').length).toBeGreaterThan(before)
  })

  it('generates fresh codes on replacement and cleanup targets only the retired code', async () => {
    const first = makeSession()
    const old = await first.start()
    await first.cancel()
    const second = makeSession()
    const fresh = await second.start()
    expect(fresh.code).not.toBe(old.code)
    expect(requests('DELETE').every((xhr) => xhr.body!.token === requests('POST')[0].body!.token)).toBe(true)
    expect(requests('POST')[1].body!.token).not.toBe(requests('POST')[0].body!.token)
    expect(second.start()).toBe(second.start())
    expect(requests('POST')).toHaveLength(2)
    await second.cancel()
  })
})
