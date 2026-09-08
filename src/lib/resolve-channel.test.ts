import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWithChannel, ResolveChannelError } from './resolve-channel'
import { fetchTvSourceMetadata } from './tv-source-lookup'

vi.mock('./tv-source-lookup', () => ({
  validTvSourceUrl: (url: unknown) => typeof url === 'string' && url.startsWith('https://source.example/'),
  fetchTvSourceMetadata: vi.fn(async () => []),
}))
const requestId = 'a'.repeat(32)
const endpoint = 'https://worker.example/v1/companion/pairings/' + 'p'.repeat(20)
const admission = { protocol: 1, url: endpoint.replace('https:', 'wss:') + '/resolve-channel?ticket=' + 'b'.repeat(32) }
const result = { ok: true, candidates: [{ id: 'candidate', url: 'https://media.example/movie.mp4' }] }
class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: any; onmessage: any; onclose: any; onerror: any
  messages: any[] = []
  constructor(public url: string) { Socket.instances.push(this) }
  send(data: string) { if (data !== 'izumi:ping') this.messages.push(JSON.parse(data)) }
  close = vi.fn(() => { this.readyState = 3 })
  ready() { this.readyState = 1; this.receive({ type: 'channel.ready' }) }
  receive(message: any) { this.onmessage?.({ data: JSON.stringify({ protocol: 1, requestId, ...message }) }) }
  disconnect() { this.readyState = 3; this.onclose?.() }
}
function fixture() {
  let current = true
  const http = vi.fn(async () => result)
  const bootstrap = vi.fn(async () => admission)
  const onProgress = vi.fn()
  const cancellation: { cancel?: () => void } = {}
  const promise = resolveWithChannel({ requestId, input: { title: 'A movie' }, endpoint, bootstrap, http,
    onProgress, cancellation, isCurrent: () => current })
  return { http, bootstrap, onProgress, cancellation, promise, changeProfile: () => { current = false } }
}
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('TV resolve channel', () => {
  it('shows candidates before completion and cleans up timers and the connection', async () => {
    const f = fixture(); await flush()
    const socket = Socket.instances[0]; socket.ready()
    expect(socket.messages[0]).toMatchObject({ type: 'resolve.start', requestId })
    socket.receive({ type: 'resolve.progress', sequence: 1, result })
    socket.receive({ type: 'resolve.progress', sequence: 1, result })
    expect(f.onProgress).toHaveBeenCalledTimes(1)
    socket.receive({ type: 'resolve.complete', sequence: 2, result })
    expect(await f.promise).toEqual(result)
    expect(f.http).not.toHaveBeenCalled()
    expect(socket.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('falls back to the existing HTTP contract on an older Worker or failed handshake', async () => {
    const http = vi.fn(async () => result)
    const older = resolveWithChannel({ requestId, input: {}, endpoint, http, cancellation: {}, isCurrent: () => true,
      bootstrap: async () => { throw { status: 404 } } })
    expect(await older).toEqual(result)
    expect(http).toHaveBeenCalledTimes(1)
    const f = fixture(); await flush()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await f.promise).toEqual(result)
    expect(f.http).toHaveBeenCalledTimes(1)
  })
  it('resumes after a drop, without sending a second start or HTTP resolve', async () => {
    const f = fixture(); await flush()
    const first = Socket.instances[0]; first.ready()
    first.receive({ type: 'resolve.accepted', sequence: 0 })
    first.disconnect()
    await vi.advanceTimersByTimeAsync(500)
    const second = Socket.instances[1]; second.ready()
    expect(second.messages[0]).toMatchObject({ type: 'resolve.resume', requestId })
    expect(second.messages[0]).not.toHaveProperty('input')
    first.receive({ type: 'resolve.complete', sequence: 99, result: { ok: true, candidates: [] } })
    second.receive({ type: 'resolve.complete', sequence: 1, result })
    expect(await f.promise).toEqual(result)
    expect(f.http).not.toHaveBeenCalled()
  })
  it('keeps usable candidates after an interruption without starting linked or HTTP work', async () => {
    const f = fixture(); await flush()
    const socket = Socket.instances[0]; socket.ready()
    socket.receive({ type: 'resolve.progress', sequence: 1, result })
    socket.receive({ type: 'resolve.error', code: 'RESOLVE_INTERRUPTED' })
    expect(await f.promise).toEqual({ ...result, fallback: null })
    expect(f.http).not.toHaveBeenCalled()
  })
  it('does not fall back after a possibly accepted start even when no acknowledgment arrived', async () => {
    const f = fixture(); const rejected = expect(f.promise).rejects.toBeInstanceOf(ResolveChannelError); await flush()
    const socket = Socket.instances[0]; socket.ready()
    socket.receive({ type: 'resolve.error', code: 'RESOLVE_INTERRUPTED' })
    await rejected
    expect(f.http).not.toHaveBeenCalled()
  })
  it('cancels explicitly and drops data after a profile change', async () => {
    for (const changeProfile of [false, true]) {
      const f = fixture(); const rejected = expect(f.promise).rejects.toBeInstanceOf(ResolveChannelError); await flush()
      const socket = Socket.instances[Socket.instances.length - 1]; socket.ready()
      if (changeProfile) { f.changeProfile(); socket.receive({ type: 'resolve.progress', sequence: 1, result }) }
      else f.cancellation.cancel?.()
      await rejected
      expect(socket.messages[socket.messages.length - 1].type).toBe('resolve.cancel')
      expect(f.onProgress).not.toHaveBeenCalled()
      expect(f.http).not.toHaveBeenCalled()
    }
  })
  it('rejects changed authorization even if partial candidates were received', async () => {
    const f = fixture(); const rejected = expect(f.promise).rejects.toBeInstanceOf(ResolveChannelError); await flush()
    const socket = Socket.instances[0]; socket.ready()
    socket.receive({ type: 'resolve.progress', sequence: 1, result })
    socket.receive({ type: 'resolve.error', code: 'PROFILE_CHANGED' })
    await rejected
    expect(f.http).not.toHaveBeenCalled()
  })
  it('cancels server work when a malformed message ends the channel', async () => {
    const f = fixture(); const rejected = expect(f.promise).rejects.toBeInstanceOf(ResolveChannelError); await flush()
    const socket = Socket.instances[0]; socket.ready()
    socket.onmessage({ data: '{broken' })
    await rejected
    expect(socket.messages[socket.messages.length - 1].type).toBe('resolve.cancel')
    expect(f.http).not.toHaveBeenCalled()
  })
  it('bounds delegated fetch concurrency and returns a cached reply when it is requested again', async () => {
    const completions: ((streams: Record<string, unknown>[]) => void)[] = []
    vi.mocked(fetchTvSourceMetadata).mockImplementation(() => new Promise(resolve => completions.push(resolve)))
    const f = fixture(); await flush()
    const socket = Socket.instances[0]; socket.ready()
    for (let i = 0; i < 3; i++) socket.receive({ type: 'fetch.request', fetchId: String(i).repeat(32), request: { url: `https://source.example/${i}` } })
    expect(fetchTvSourceMetadata).toHaveBeenCalledTimes(2)
    completions[0]([{ infoHash: 'a'.repeat(40) }]); await flush()
    expect(fetchTvSourceMetadata).toHaveBeenCalledTimes(3)
    socket.receive({ type: 'fetch.request', fetchId: '0'.repeat(32), request: { url: 'https://source.example/0' } })
    expect(fetchTvSourceMetadata).toHaveBeenCalledTimes(3)
    expect(socket.messages.filter(m => m.type === 'fetch.result')).toHaveLength(2)
    completions[1]([]); completions[2]([]); await flush()
    socket.receive({ type: 'resolve.complete', sequence: 1, result })
    await f.promise
  })
})
