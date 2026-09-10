import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanionReceiver, type ReceiverEvents } from './receiver'
import { resetTvHousehold } from './profiles'
import type { CompanionCloudflareTransport } from '../types'

const STORAGE_KEY = 'izumi.companion.cloudflare'
const CREDENTIAL_KEY = 'izumi.companion.credential'
const transport: CompanionCloudflareTransport = {
  protocol: 1, endpoint: 'https://private.example', pairingId: 'pairing_1234567890',
  tvToken: 'T'.repeat(43), playbackMode: 'cloud-only', wakeWhenClosed: false,
}
const incomingKey = Buffer.alloc(32, 77).toString('base64url')
const savedKey = Buffer.alloc(32, 19).toString('base64url')
const credential = 'ab'.repeat(32)

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
  removeItem(key: string) { this.values.delete(key) }
}

class SmartViewChannel {
  private handlers = new Map<string, (...args: unknown[]) => void>()
  publish = vi.fn()
  disconnect = vi.fn()
  on(event: string, handler: (...args: unknown[]) => void) { this.handlers.set(event, handler) }
  connect(_options: unknown, callback: () => void) { callback() }
  emit(event: string, payload: unknown) { this.handlers.get(event)?.(payload, 'client') }
}

class Request {
  static sent: Array<{ method: string; url: string; headers: Record<string, string>; body: string | null }> = []
  method = ''; url = ''; headers: Record<string, string> = {}
  status = 404; responseText = '{}'; onload?: () => void
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(name: string, value: string) { this.headers[name] = value }
  send(body: string | null) {
    Request.sent.push({ method: this.method, url: this.url, headers: this.headers, body })
    this.onload?.()
  }
}

let storage: MemoryStorage
let channel: SmartViewChannel
let instances: CompanionReceiver[]
function seed(input: unknown = transport, secret = credential) {
  storage.setItem(STORAGE_KEY, JSON.stringify(input))
  storage.setItem(CREDENTIAL_KEY, secret)
}
function receiver() {
  const events: ReceiverEvents = { onConnection: vi.fn(), onPaired: vi.fn(), onPairingInfo: vi.fn(), onSnapshot: vi.fn(),
    onSearchResults: vi.fn(), onLoad: vi.fn(), onControl: vi.fn() }
  const instance = new CompanionReceiver(events)
  instances.push(instance)
  return instance
}
function storedTransport(): CompanionCloudflareTransport {
  return JSON.parse(storage.getItem(STORAGE_KEY) || 'null')
}
function sendTransport(instance: CompanionReceiver, kind: 'pair' | 'transport', input: CompanionCloudflareTransport) {
  channel.emit(`izumi.companion.${kind}`, kind === 'pair'
    ? { protocol: 1, challenge: instance.pairingInfo.challenge, credential, recoveryKey: incomingKey, transport: { cloudflare: input } }
    : { credential, recoveryKey: incomingKey, cloudflare: input })
}

beforeEach(() => {
  vi.useFakeTimers()
  storage = new MemoryStorage()
  channel = new SmartViewChannel()
  instances = []
  Request.sent = []
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('location', { hostname: '127.0.0.1' })
  vi.stubGlobal('XMLHttpRequest', Request)
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, dispatchEvent: vi.fn(),
    msf: { local: (callback: (error: null, service: unknown) => void) => callback(null, { channel: () => channel }) } })
  resetTvHousehold()
  seed()
})
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(0)
  instances.forEach((instance) => instance.disconnect())
  vi.restoreAllMocks()
  resetTvHousehold()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TV-generated recovery identity', () => {
  it('generates 32 cryptographic bytes only when opening reverse linking and persists them across reloads', () => {
    const instance = receiver()
    expect(storedTransport().recoveryKey).toBeUndefined()
    const random = vi.spyOn(webcrypto, 'getRandomValues')
    const identity = instance.clientLinkIdentity!
    const key = identity.transport.recoveryKey!
    expect(random).toHaveBeenCalledOnce()
    expect(random.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(random.mock.calls[0][0]).toHaveLength(32)
    expect(Buffer.from(key, 'base64url')).toHaveLength(32)
    expect(Buffer.from(key, 'base64url').toString('base64url')).toBe(key)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(storedTransport()).toEqual({ ...transport, recoveryKey: key })
    expect(identity.credential).toBe(credential)
    expect(identity.deviceId).toMatch(/^[a-f0-9]{24}$/)
    identity.transport.recoveryKey = 'changed'
    expect(instance.clientLinkIdentity!.transport.recoveryKey).toBe(key)
    expect(random).toHaveBeenCalledOnce()
    expect(receiver().clientLinkIdentity).toEqual({ transport: { ...transport, recoveryKey: key }, deviceId: identity.deviceId, credential })
  })

  it('keeps an existing saved recovery key without generating or rewriting it', () => {
    seed({ ...transport, recoveryKey: savedKey })
    const instance = receiver()
    const random = vi.spyOn(webcrypto, 'getRandomValues')
    const write = vi.spyOn(storage, 'setItem')
    expect(instance.clientLinkIdentity!.transport.recoveryKey).toBe(savedKey)
    expect(random).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('reuses a key saved by another receiver instance for the same route', () => {
    const first = receiver(), second = receiver()
    const random = vi.spyOn(webcrypto, 'getRandomValues')
    const key = first.clientLinkIdentity!.transport.recoveryKey
    expect(second.clientLinkIdentity!.transport.recoveryKey).toBe(key)
    expect(random).toHaveBeenCalledOnce()
  })

  it('replaces an invalid stored value with a securely generated key', () => {
    seed({ ...transport, recoveryKey: 'invalid' })
    const key = receiver().clientLinkIdentity!.transport.recoveryKey!
    expect(Buffer.from(key, 'base64url')).toHaveLength(32)
    expect(storedTransport().recoveryKey).toBe(key)
  })

  it.each([[null, credential], [transport, ''], [transport, 'not-a-credential']])('refuses incomplete pairing without generating a recovery key: %j', (route, secret) => {
    seed(route, secret as string)
    const instance = receiver()
    const random = vi.spyOn(webcrypto, 'getRandomValues')
    expect(instance.clientLinkIdentity).toBeNull()
    expect(random).not.toHaveBeenCalled()
  })

  it.each(['missing', 'unavailable', 'throws'])('returns null with no insecure fallback when secure randomness %s', (failure) => {
    const instance = receiver()
    vi.stubGlobal('crypto', failure === 'missing' ? undefined : failure === 'unavailable' ? {} : {
      getRandomValues: () => { throw new Error('Secure randomness failed') },
    })
    const insecureRandom = vi.spyOn(Math, 'random')
    expect(instance.clientLinkIdentity).toBeNull()
    expect(storedTransport().recoveryKey).toBeUndefined()
    expect(insecureRandom).not.toHaveBeenCalled()
  })

  it('returns null on storage failure and only exports a key after a successful retry', () => {
    const instance = receiver()
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Storage is full') })
    expect(instance.clientLinkIdentity).toBeNull()
    expect(storedTransport().recoveryKey).toBeUndefined()
    write.mockRestore()
    const key = instance.clientLinkIdentity!.transport.recoveryKey
    expect(key).toBe(storedTransport().recoveryKey)
    expect(receiver().clientLinkIdentity!.transport.recoveryKey).toBe(key)
  })

  it('does not expose an ephemeral key when storage silently drops a write', () => {
    const instance = receiver()
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {})
    expect(instance.clientLinkIdentity).toBeNull()
    expect(storedTransport().recoveryKey).toBeUndefined()
    write.mockRestore()
    expect(instance.clientLinkIdentity!.transport.recoveryKey).toBe(storedTransport().recoveryKey)
  })

  it('preserves a successful write if its verification read throws and rendering retries', () => {
    const instance = receiver()
    const random = vi.spyOn(webcrypto, 'getRandomValues')
    const read = storage.getItem.bind(storage), write = storage.setItem.bind(storage)
    let failRead = false
    vi.spyOn(storage, 'getItem').mockImplementation((key) => {
      if (key === STORAGE_KEY && failRead) { failRead = false; throw new Error('Storage read failed') }
      return read(key)
    })
    const writeSpy = vi.spyOn(storage, 'setItem').mockImplementation((key, value) => { write(key, value); failRead = true })
    expect(instance.clientLinkIdentity).toBeNull()
    const persisted = JSON.parse(read(STORAGE_KEY)!).recoveryKey
    writeSpy.mockRestore()
    expect(instance.clientLinkIdentity!.transport.recoveryKey).toBe(persisted)
    expect(random).toHaveBeenCalledOnce()
  })

  it.each(['pair', 'transport'] as const)('ignores an incoming plaintext %s key and never auto-seeds a secret', async (kind) => {
    if (kind === 'pair') seed(null, '')
    const instance = receiver()
    await instance.connect()
    sendTransport(instance, kind, { ...transport, recoveryKey: incomingKey })
    expect(storedTransport().recoveryKey).toBeUndefined()
    expect(storedTransport()).toEqual(transport)
    const key = instance.clientLinkIdentity!.transport.recoveryKey!
    expect(key).not.toBe(incomingKey)
    expect(JSON.stringify(channel.publish.mock.calls)).not.toContain(key)
    expect(JSON.stringify(Request.sent)).not.toContain(key)
  })

  it.each([
    ['pair', undefined], ['pair', incomingKey], ['transport', undefined], ['transport', incomingKey],
  ] as const)('preserves the local key for a same-route plaintext %s refresh (incoming %s)', async (kind, recoveryKey) => {
    const instance = receiver()
    const key = instance.clientLinkIdentity!.transport.recoveryKey!
    await instance.connect()
    sendTransport(instance, kind, { ...transport, endpoint: transport.endpoint + '/', recoveryKey, wakeWhenClosed: true, playbackMode: 'cloud-and-device' })
    expect(storedTransport()).toEqual({ ...transport, recoveryKey: key, wakeWhenClosed: true, playbackMode: 'cloud-and-device' })
    expect(instance.clientLinkIdentity!.transport.recoveryKey).toBe(key)
    expect(receiver().clientLinkIdentity!.transport.recoveryKey).toBe(key)
    expect(Request.sent.some((request) => request.method === 'DELETE')).toBe(false)
    expect(JSON.stringify(channel.publish.mock.calls)).not.toContain(key)
    expect(JSON.stringify(Request.sent)).not.toContain(key)
  })

  it.each([
    ['pair', { endpoint: 'https://another.example' }],
    ['pair', { pairingId: 'another_pairing_123' }],
    ['pair', { tvToken: 'U'.repeat(43) }],
    ['transport', { endpoint: 'https://another.example' }],
    ['transport', { pairingId: 'another_pairing_123' }],
    ['transport', { tvToken: 'U'.repeat(43) }],
  ] as const)('drops the old key when a plaintext %s changes the route: %j', async (kind, change) => {
    const instance = receiver()
    const oldKey = instance.clientLinkIdentity!.transport.recoveryKey
    await instance.connect()
    sendTransport(instance, kind, { ...transport, ...change, recoveryKey: incomingKey })
    expect(storedTransport()).toEqual({ ...transport, ...change })
    const newKey = instance.clientLinkIdentity!.transport.recoveryKey
    expect(newKey).not.toBe(oldKey)
    expect(newKey).not.toBe(incomingKey)
    expect(storedTransport().recoveryKey).toBe(newKey)
    expect(receiver().clientLinkIdentity!.transport.recoveryKey).toBe(newKey)
  })

  it('does not reuse a recovery key after unpairing and pairing again', async () => {
    const instance = receiver()
    const oldKey = instance.clientLinkIdentity!.transport.recoveryKey
    await instance.connect()
    instance.unpair(false)
    expect(instance.clientLinkIdentity).toBeNull()
    sendTransport(instance, 'pair', { ...transport, recoveryKey: incomingKey })
    expect(storedTransport().recoveryKey).toBeUndefined()
    expect(instance.clientLinkIdentity!.transport.recoveryKey).not.toBe(oldKey)
  })
})
