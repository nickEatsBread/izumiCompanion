import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import { CompanionReceiver, type ReceiverEvents } from './receiver'

const credential = 'ab'.repeat(32)
const transport = {
  protocol: 1,
  endpoint: 'https://private-worker.example',
  pairingId: 'private_pairing_1',
  tvToken: 'private_tv_token_12345678901234567890',
  playbackMode: 'cloud-only',
  wakeWhenClosed: false,
}

const media: CompanionMedia = {
  ref: { provider: 'tmdb', type: 'movie', id: '550' },
  resolver: { streamType: 'movie' },
  title: 'Fight Club',
  season: 0,
}

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

interface SentRequest {
  method: string
  url: string
  timeout: number
  headers: Record<string, string>
  body: unknown
}

let encryptedPlaintext = ''
let storage: MemoryStorage

class FakeSmartViewChannel {
  readonly handlers = new Map<string, (...args: unknown[]) => void>()
  readonly publish = vi.fn()
  readonly disconnect = vi.fn()
  on(event: string, callback: (...args: unknown[]) => void) {
    this.handlers.set(event, callback)
  }
  connect(_options: unknown, callback: (error?: unknown) => void) {
    callback()
  }
  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args)
  }
}

class FakeXmlHttpRequest {
  static responder: (request: SentRequest) => { status: number; body: unknown }
  static sent: SentRequest[] = []
  method = ''
  url = ''
  timeout = 0
  status = 0
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  private readonly headers: Record<string, string> = {}

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: string | null) {
    const request = {
      method: this.method,
      url: this.url,
      timeout: this.timeout,
      headers: this.headers,
      body: body ? JSON.parse(body) : null,
    }
    FakeXmlHttpRequest.sent.push(request)
    const response = FakeXmlHttpRequest.responder(request)
    this.status = response.status
    this.responseText = JSON.stringify(response.body)
    queueMicrotask(() => this.onload?.())
  }
}

const events = (): ReceiverEvents => ({
  onConnection: vi.fn(),
  onPaired: vi.fn(),
  onPairingInfo: vi.fn(),
  onSnapshot: vi.fn(),
  onSearchResults: vi.fn(),
  onLoad: vi.fn(),
  onControl: vi.fn(),
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeXmlHttpRequest.sent = []
  encryptedPlaintext = ''
  storage = new MemoryStorage()
  storage.setItem('izumi.companion.credential', credential)
  storage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('location', { hostname: '192.168.1.20' })
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval })
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest)
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint8Array) => {
      values.fill(7)
      return values
    },
    subtle: {
      importKey: vi.fn(async () => ({})),
      encrypt: vi.fn(async (_algorithm: unknown, _key: unknown, data: Uint8Array) => {
        encryptedPlaintext = new TextDecoder().decode(data)
        return new Uint8Array([1, 2, 3]).buffer
      }),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('companion play routing', () => {
  it('only sends catalogue switches while the paired client channel is connected', async () => {
    storage.removeItem('izumi.companion.cloudflare')
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    expect(receiver.requestCatalog('stremio')).toBe(false)

    await receiver.connect()

    expect(receiver.requestCatalog('stremio')).toBe(true)
    expect(channel.publish).toHaveBeenCalledWith('izumi.companion.catalog', {
      screen: 'stremio',
      pairingId: credential.slice(0, 16),
    }, 'broadcast')
    receiver.disconnect()
  })

  it('surfaces an authenticated catalogue load failure from izumi', async () => {
    const channel = new FakeSmartViewChannel()
    const receiverEvents = { ...events(), onCatalogError: vi.fn() }
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(receiverEvents)
    await receiver.connect()

    channel.emit('izumi.companion.catalog-result', {
      pairingId: 'wrong-pairing',
      screen: 'stremio',
      error: 'Wrong sender',
    })
    channel.emit('izumi.companion.catalog-result', {
      pairingId: credential.slice(0, 16),
      screen: 'stremio',
      error: 'Stremio could not load. Check its enabled sources in izumi.',
    })

    expect(receiverEvents.onCatalogError).toHaveBeenCalledTimes(1)
    expect(receiverEvents.onCatalogError).toHaveBeenCalledWith(
      'stremio',
      'Stremio could not load. Check its enabled sources in izumi.',
    )
    receiver.disconnect()
  })

  it('accepts playback from older firmware when Samsung omits the event peer', async () => {
    const channel = new FakeSmartViewChannel()
    const receiverEvents = events()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(receiverEvents)
    await receiver.connect()

    channel.emit('izumi.load', {
      sessionId: 'session-one',
      senderId: 'sender-one',
      url: 'https://media.example/episode.mp4',
      title: 'Episode 2',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
      media,
      trackPreferences: { audio: { language: 'ja-JP', codec: 'aac' } },
      trackHints: { subtitles: [{ language: 'eng', codec: 'ass', label: 'English · Signs & Songs' }] },
      skipSegments: [
        { type: 'op', startTime: 42, endTime: 132, label: 'Opening' },
        { type: 'invalid', startTime: 0, endTime: -1 },
      ],
    })

    expect(receiverEvents.onLoad).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-one',
      media,
      trackPreferences: { audio: { language: 'ja-JP', codec: 'aac', title: undefined }, subtitle: undefined },
      trackHints: { subtitles: [{ language: 'eng', codec: 'ass', title: undefined, label: 'English · Signs & Songs' }] },
      skipSegments: [{ type: 'op', startTime: 42, endTime: 132, label: 'Opening' }],
    }), 'sender-one')
    receiver.disconnect()
  })

  it('requests and receives full episode details from the paired client', async () => {
    storage.removeItem('izumi.companion.cloudflare')
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const request = receiver.requestDetails(media)
    const sent = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.details')?.[1] as {
      requestId: string
      pairingId: string
    }
    expect(sent.pairingId).toBe(credential.slice(0, 16))

    const details = { ...media, episodes: [{ season: 1, episode: 1, image: 'https://img.example/1.jpg' }] }
    channel.emit('izumi.companion.details-result', { credential, requestId: sent.requestId, media: details })
    await expect(request).resolves.toEqual(details)
    receiver.disconnect()
  })

  it('keeps a TMDB logo request alive beyond the paired client rating timeout', async () => {
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const request = receiver.requestDetails(media, true)
    const sent = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.details')?.[1] as { requestId: string; presentationOnly: boolean }
    expect(sent.presentationOnly).toBe(true)

    await vi.advanceTimersByTimeAsync(8_500)
    const details = { ...media, logoImage: 'https://image.tmdb.org/t/p/w500/fight-club-logo.png' }
    channel.emit('izumi.companion.details-result', { credential, requestId: sent.requestId, media: details })

    await expect(request).resolves.toEqual(details)
    receiver.disconnect()
  })

  it('only returns physical-TV title diagnostics to an authenticated peer', async () => {
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    vi.stubGlobal('document', { querySelector: () => null })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()

    channel.emit('izumi.companion.render-diagnostics', { credential: 'wrong', requestId: 'renderprobe1' }, { id: 'support-peer' })
    expect(channel.publish).not.toHaveBeenCalledWith('izumi.companion.render-diagnostics-result', expect.anything(), expect.anything())

    channel.emit('izumi.companion.render-diagnostics', { credential, requestId: 'renderprobe1' }, { id: 'support-peer' })
    expect(channel.publish).toHaveBeenCalledWith('izumi.companion.render-diagnostics-result', {
      requestId: 'renderprobe1',
      homeTitle: { available: false },
    }, 'support-peer')
    receiver.disconnect()
  })

  it('requests a token-scoped HTTP trailer bridge from the paired client', async () => {
    storage.removeItem('izumi.companion.cloudflare')
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()

    const pending = receiver.requestTrailer('M7lc1UVf-VE', 'Frieren trailer', true, true)
    const sent = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.trailer')?.[1] as {
      requestId: string
      pairingId: string
      videoId: string
      muted: boolean
      captions: boolean
    }
    expect(sent).toMatchObject({ pairingId: credential.slice(0, 16), videoId: 'M7lc1UVf-VE', muted: true, captions: true })

    channel.emit('izumi.companion.trailer-result', {
      credential,
      requestId: sent.requestId,
      url: 'http://192.168.1.20:44123/token/youtube?id=M7lc1UVf-VE',
    })
    await expect(pending).resolves.toEqual({
      requestId: sent.requestId,
      url: 'http://192.168.1.20:44123/token/youtube?id=M7lc1UVf-VE',
    })

    receiver.releaseTrailer(sent.requestId)
    expect(channel.publish).toHaveBeenLastCalledWith('izumi.companion.trailer-close', {
      pairingId: credential.slice(0, 16),
      requestId: sent.requestId,
    }, 'broadcast')
    receiver.disconnect()
  })

  it('requests audible trailer previews unless muted playback is explicitly requested', async () => {
    storage.removeItem('izumi.companion.cloudflare')
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()

    const pending = receiver.requestTrailer('M7lc1UVf-VE', 'Audible preview')
    const sent = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.trailer')?.[1] as { requestId: string; muted: boolean; captions: boolean }
    expect(sent.muted).toBe(false)
    expect(sent.captions).toBe(false)
    channel.emit('izumi.companion.trailer-result', {
      credential,
      requestId: sent.requestId,
      url: 'http://192.168.1.20:44123/token/youtube?id=M7lc1UVf-VE&muted=0',
    })
    await pending
    receiver.disconnect()
  })

  it('requests a short-lived trailer bridge from the private Worker without a linked client', async () => {
    const code = 't'.repeat(32)
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: {
        requestId: 'cloud-ticket_123456789012',
        url: `${transport.endpoint}/v1/companion/trailer?code=${code}`,
        expiresAt: Date.now() + 600_000,
      },
    })
    const receiver = new CompanionReceiver(events())

    await expect(receiver.requestTrailer('M7lc1UVf-VE', 'Frieren trailer', true, true)).resolves.toEqual({
      requestId: 'cloud-ticket_123456789012',
      url: `${transport.endpoint}/v1/companion/trailer?code=${code}`,
    })
    expect(FakeXmlHttpRequest.sent).toContainEqual(expect.objectContaining({
      method: 'POST',
      url: `${transport.endpoint}/v1/companion/pairings/${transport.pairingId}/trailer`,
      headers: expect.objectContaining({ Authorization: `Bearer ${transport.tvToken}` }),
      body: { videoId: 'M7lc1UVf-VE', muted: true, captions: true },
    }))
    receiver.releaseTrailer('cloud-ticket_123456789012')
  })

  it('loads AniList episode details from the private Worker when the paired client is unavailable', async () => {
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: {
        ok: true,
        details: {
          seasonEpisodeCounts: [2],
          seasonLabels: ['Season 1'],
          episodes: [
            { season: 1, episode: 1, title: 'The Journey’s End', image: 'https://img.example/1.jpg', runtimeMinutes: 25 },
            { season: 1, episode: 2, title: 'It Didn’t Have to Be Magic', image: 'https://img.example/2.jpg', runtimeMinutes: 24 },
          ],
        },
      },
    })
    const aniListMedia: CompanionMedia = {
      ref: { provider: 'anilist', type: 'anime', id: '154587' },
      title: 'Frieren',
      episode: 2,
      episodeProgress: .4,
    }

    const details = await new CompanionReceiver(events()).requestDetails(aniListMedia)

    expect(details).toMatchObject({
      seasonEpisodeCounts: [2],
      seasonLabels: ['Season 1'],
      episodes: [
        { season: 1, episode: 1, title: 'The Journey’s End', watched: true, progress: 1 },
        { season: 1, episode: 2, title: 'It Didn’t Have to Be Magic', watched: false, progress: .4 },
      ],
    })
    expect(FakeXmlHttpRequest.sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://private-worker.example/v1/companion/pairings/private_pairing_1/details',
      timeout: 6_000,
      headers: { Authorization: `Bearer ${transport.tvToken}` },
      body: aniListMedia,
    })
  })

  it('accepts a credential-authenticated Worker route for an already-paired TV', async () => {
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: {
        local: (callback: (error: unknown, service: unknown) => void) => callback(null, {
          channel: () => channel,
        }),
      },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const replacement = { ...transport, pairingId: 'replacement_pair', tvToken: 'x'.repeat(40) }

    channel.emit('izumi.companion.transport', { credential: 'wrong', cloudflare: replacement }, 'client')
    expect(JSON.parse(storage.getItem('izumi.companion.cloudflare') || '{}').pairingId).toBe(transport.pairingId)
    channel.emit('izumi.companion.transport', { credential, cloudflare: replacement }, 'client')
    expect(JSON.parse(storage.getItem('izumi.companion.cloudflare') || '{}')).toEqual(replacement)
    expect(channel.publish).toHaveBeenCalledWith('izumi.companion.transport-ready', {
      pairingId: replacement.pairingId,
    }, 'client')
    receiver.disconnect()
  })

  it('plays a resolved source on the TV without creating a phone request', async () => {
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: {
        ok: true,
        selectedId: 'direct',
        candidates: [{ id: 'direct', url: 'https://media.example/video.mp4', subtitles: [] }],
      },
    })
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)
    const result = await pending

    expect(result).toMatchObject({ kind: 'resolved', request: { url: 'https://media.example/video.mp4', title: 'Fight Club' } })
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
    expect(FakeXmlHttpRequest.sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://private-worker.example/v1/companion/pairings/private_pairing_1/resolve',
      timeout: 30_000,
      headers: { Authorization: `Bearer ${transport.tvToken}` },
      body: { ref: media.ref, season: 0, streamType: 'movie' },
    })
  })

  it('falls back to the encrypted mobile notification when resolving is disabled', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: true,
    }))
    FakeXmlHttpRequest.responder = (request) => request.url.endsWith('/resolve')
      ? { status: 409, body: { error: 'Cloud source resolving is disabled for this TV.' } }
      : { status: 201, body: { ok: true, notified: 1 } }
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    expect(await pending).toBe('notified')
    expect(FakeXmlHttpRequest.sent.map((request) => request.url)).toEqual([
      'https://private-worker.example/v1/companion/pairings/private_pairing_1/resolve',
      expect.stringMatching(/^https:\/\/private-worker\.example\/v1\/companion\/pairings\/private_pairing_1\/requests\//),
    ])
    expect(JSON.parse(encryptedPlaintext)).toMatchObject({
      ref: media.ref,
      resolver: { streamType: 'movie' },
      season: 0,
    })
  })

  it('does not contact or wake a linked device in Cloudflare-only mode', async () => {
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: { ok: true, selectedId: null, candidates: [], fallback: null },
    })

    await expect(new CompanionReceiver(events()).requestPlay(media)).resolves.toBe('no-source')
    expect(FakeXmlHttpRequest.sent.map((request) => request.url)).toEqual([
      'https://private-worker.example/v1/companion/pairings/private_pairing_1/resolve',
    ])
  })

  it('asks an open linked device after the Worker in combined mode', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: { ok: true, selectedId: null, candidates: [], fallback: 'paired-device' },
    })
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const pending = receiver.requestPlay(media)
    await vi.advanceTimersByTimeAsync(0)
    const play = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.play')?.[1] as {
      pairingId: string
      requestId: string
    }
    expect(play).toBeTruthy()
    channel.emit('izumi.companion.play-accepted', { pairingId: play.pairingId, requestId: play.requestId })

    await expect(pending).resolves.toBe('local')
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
    receiver.disconnect()
  })

  it('opens the linked-device picker for source changes without resolving again', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()

    const pending = receiver.requestDeviceSourceChange(media, 523.75)
    await vi.advanceTimersByTimeAsync(0)
    const play = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.play')?.[1] as {
      pairingId: string
      requestId: string
      playback: { selection: string; positionSeconds: number }
    }
    expect(play.playback).toEqual({ selection: 'manual', positionSeconds: 523.75 })
    expect(FakeXmlHttpRequest.sent).toHaveLength(0)
    channel.emit('izumi.companion.play-accepted', { pairingId: play.pairingId, requestId: play.requestId })

    await expect(pending).resolves.toBe('local')
    receiver.disconnect()
  })

  it('opens authenticated Worker setup on the linked client and accepts only its matching status', async () => {
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: {
        local: (callback: (error: unknown, service: unknown) => void) => callback(null, {
          channel: () => channel,
        }),
      },
    })
    const receiverEvents = { ...events(), onWorkerSetupStatus: vi.fn(), onIndependentPlaybackReady: vi.fn() }
    const receiver = new CompanionReceiver(receiverEvents)
    await receiver.connect()

    expect(receiver.independentPlaybackReady).toBe(true)
    expect(receiver.requestIndependentSetup()).toBe(true)
    const request = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.worker-setup')
    expect(request).toBeTruthy()
    expect(request?.[1]).toMatchObject({
      credential,
      pairingId: credential.slice(0, 16),
    })
    expect(request?.[2]).toBe('broadcast')

    const requestId = request?.[1].requestId
    channel.emit('izumi.companion.worker-setup-status', { credential: 'wrong', requestId, status: 'opened' })
    expect(receiverEvents.onWorkerSetupStatus).not.toHaveBeenCalled()
    channel.emit('izumi.companion.worker-setup-status', { credential, requestId, status: 'opened' })
    expect(receiverEvents.onWorkerSetupStatus).toHaveBeenCalledWith('opened', undefined)
    receiver.disconnect()
  })

  it('prefetches a Worker source once and consumes it on next-episode playback', async () => {
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: {
        ok: true,
        selectedId: 'direct',
        candidates: [{ id: 'direct', label: 'Binge source', url: 'https://media.example/next.mp4', subtitles: [] }],
      },
    })
    const receiver = new CompanionReceiver(events())
    expect(await receiver.prefetchPlay(media)).toBe(true)
    const result = await receiver.requestPlay(media)

    expect(result).toMatchObject({ kind: 'resolved', request: { url: 'https://media.example/next.mp4' } })
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
  })

  it('keeps device source URLs private while selecting an opaque row on the TV', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    const channel = new FakeSmartViewChannel()
    const receiverEvents = events()
    receiverEvents.onDeviceSourceOptions = vi.fn()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(receiverEvents)
    await receiver.connect()

    const pending = receiver.requestDeviceSourceChange(media, 45)
    const play = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.play')?.[1] as {
      pairingId: string
      requestId: string
    }
    channel.emit('izumi.companion.play-accepted', { pairingId: play.pairingId, requestId: play.requestId })
    await expect(pending).resolves.toBe('local')
    channel.emit('izumi.companion.source-options', {
      credential,
      requestId: play.requestId,
      choices: [{ id: 'source-1', label: '1080p Japanese', detail: 'HEVC · P2P' }],
      resolving: false,
    })

    expect(receiverEvents.onDeviceSourceOptions).toHaveBeenCalledWith({
      requestId: play.requestId,
      choices: [{ id: 'source-1', label: '1080p Japanese', detail: 'HEVC · P2P' }],
      resolving: false,
      error: undefined,
    })
    expect(receiver.selectDeviceSource(play.requestId, 'source-1')).toBe(true)
    expect(channel.publish).toHaveBeenLastCalledWith('izumi.companion.source-select', {
      pairingId: play.pairingId,
      requestId: play.requestId,
      choiceId: 'source-1',
    }, 'broadcast')
    expect(JSON.stringify(channel.publish.mock.calls)).not.toContain('https://private-source.example')
    receiver.disconnect()
  })

  it('does not offer linked-device source changes in Cloudflare-only mode', async () => {
    const receiver = new CompanionReceiver(events())
    expect(receiver.canRequestDeviceSourceChange()).toBe(false)
    await expect(receiver.requestDeviceSourceChange(media, 30)).resolves.toBe('no-source')
    expect(FakeXmlHttpRequest.sent).toHaveLength(0)
  })

  it('never queues a closed desktop request in combined mode', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: { ok: true, selectedId: null, candidates: [], fallback: 'paired-device' },
    })
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    await expect(pending).resolves.toBe('open-client')
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
  })

  it('does not assume a legacy Worker route may wake a closed desktop', async () => {
    const { playbackMode: _playbackMode, wakeWhenClosed: _wakeWhenClosed, ...legacy } = transport
    storage.setItem('izumi.companion.cloudflare', JSON.stringify(legacy))
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    await expect(pending).resolves.toBe('open-client')
    expect(FakeXmlHttpRequest.sent).toHaveLength(0)
  })

  it('discards an incompatible cached catalog before startup renders it', () => {
    storage.setItem('izumi.companion.snapshot', JSON.stringify({
      app: 'izumi',
      kind: 'companion-home',
      version: 1,
      revision: 'legacy',
      generatedAt: 1,
      rows: [],
    }))
    const receiverEvents = events()

    new CompanionReceiver(receiverEvents)

    expect(storage.getItem('izumi.companion.snapshot')).toBeNull()
    expect(receiverEvents.onSnapshot).not.toHaveBeenCalled()
  })
})
