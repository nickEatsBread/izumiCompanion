import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TvLinkReceiver, type TvLinkInfo } from './tv-link'

class Socket extends EventTarget {
  static OPEN = 1
  static all: Socket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  constructor() { super(); Socket.all.push(this) }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}

let receiver: TvLinkReceiver
let info: TvLinkInfo
let receive: (message: unknown) => Promise<void>

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('WebSocket', Socket)
  Socket.all = []
  receiver = new TvLinkReceiver('ab'.repeat(12), { onInfo: (value) => { info = value }, onSetup: vi.fn() })
  receive = (message) => (receiver as unknown as { receive(raw: string): Promise<void> }).receive(JSON.stringify(message))
  receiver.start()
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1))
  Socket.all[0].open()
})

afterEach(() => { receiver.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function phoneHello() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  await receive({ type: 'browser.hello', protocol: 2, mode: 'manual', sessionId: 'phone_session_1234567890', publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey) })
  expect(info.phase).toBe('confirming')
}

describe('TV Link setup lifecycle', () => {
  it('keeps approved setup past ten minutes but expires it after thirty', async () => {
    await phoneHello()
    expect(receiver.approveSession()).toBe(true)
    const code = info.code
    const approvedExpiry = info.expiresAt
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(info.code).toBe(code)
    expect(info.phase).toBe('approved')
    expect(Socket.all[0].sent).toContainEqual({ type: 'ping' })
    await vi.advanceTimersByTimeAsync(approvedExpiry - Date.now())
    expect(info.expiresAt).toBeGreaterThan(approvedExpiry)
    expect(info.phase).not.toBe('approved')
  })

  it('retains the invitation on a phone disconnect and requires fresh approval', async () => {
    await phoneHello()
    receiver.approveSession()
    const code = info.code
    const linkSecret = info.linkSecret
    const expiresAt = info.expiresAt
    await receive({ type: 'relay.peer', role: 'browser', connected: false })
    expect(info).toMatchObject({ code, linkSecret, phase: 'waiting' })
    expect(info.confirmation).toBeUndefined()
    expect(receiver.approveSession()).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    await phoneHello()
    expect(receiver.approveSession()).toBe(true)
    expect(info.expiresAt).toBe(expiresAt)
  })

  it('still rotates an unused invitation after ten minutes', async () => {
    const expiresAt = info.expiresAt
    await vi.advanceTimersByTimeAsync(expiresAt - Date.now())
    expect(info.expiresAt).toBeGreaterThan(expiresAt)
    expect(info.phase).not.toBe('approved')
  })

  it('reconnects the TV transport without leaving approval active', async () => {
    await phoneHello()
    receiver.approveSession()
    const code = info.code
    Socket.all[0].close()
    expect(receiver.approveSession()).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(Socket.all).toHaveLength(2)
    Socket.all[1].open()
    expect(info).toMatchObject({ code, phase: 'waiting' })
    await phoneHello()
    expect(info.phase).toBe('confirming')
  })
})
