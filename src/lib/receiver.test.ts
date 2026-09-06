import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import { chooseTvProfile, resetTvHousehold, updateTvHousehold } from './profiles'
import { CompanionReceiver, type ReceiverEvents } from './receiver'
import { persistDiscoveryChoice, readDiscoveryChoices, discoveryKey } from './discovery'

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
  FakeXmlHttpRequest.responder = () => ({ status: 404, body: {} })
  encryptedPlaintext = ''
  storage = new MemoryStorage()
  storage.setItem('izumi.companion.credential', credential)
  storage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('location', { hostname: '192.168.1.20' })
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, dispatchEvent: vi.fn() })
  resetTvHousehold()
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
  resetTvHousehold()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('companion play routing', () => {
  it('uses the TV home connection after a blocked Worker lookup, then resolves with the Worker', async () => {
    const sourceUrl = 'https://torrentio.strem.fun/stream/movie/tt0126029.json'
    FakeXmlHttpRequest.responder = request => {
      if (request.url === sourceUrl) return { status: 200, body: { streams: [{
        infoHash: 'a'.repeat(40), title: 'Shrek 1080p', url: 'https://untrusted.example/video',
        __cache: 'cached', behaviorHints: { filename: 'Shrek.mkv', proxyHeaders: { request: { Cookie: 'secret' } } },
      }] } }
      const body = request.body as Record<string, unknown>
      if (!body.tvSourceResults) return { status: 200, body: { ok: true, candidates: [],
        failures: ['Torrentio blocked the Worker (HTTP 403).'], tvSourceLookup: { version: 1, ticket: 'signed-ticket', requests: [{ id: 'torrentio-0-0', url: sourceUrl }] } } }
      return { status: 200, body: { ok: true, candidates: [{ id: 'torbox', url: 'https://cdn.example/Shrek.mkv', subtitles: [] }] } }
    }
    const result = await new CompanionReceiver(events()).requestPlay(media)
    expect(result).toMatchObject({ kind: 'resolved', request: { url: 'https://cdn.example/Shrek.mkv' } })
    expect(FakeXmlHttpRequest.sent).toHaveLength(3)
    const [first, local, resumed] = FakeXmlHttpRequest.sent
    expect(first.body).toMatchObject({ tvSourceLookup: 1 })
    expect(local).toMatchObject({ method: 'GET', url: sourceUrl, body: null, headers: { Accept: 'application/json' } })
    expect(local.headers.Authorization).toBeUndefined()
    expect(resumed.headers.Authorization).toBe(`Bearer ${transport.tvToken}`)
    expect(resumed.body).toMatchObject({ tvSourceResults: { ticket: 'signed-ticket', results: [{ id: 'torrentio-0-0', streams: [{ infoHash: 'a'.repeat(40) }] }] } })
    expect(JSON.stringify(resumed.body)).not.toMatch(/untrusted|__cache|Cookie|secret/)
    expect(FakeXmlHttpRequest.sent.some(request => request.url.includes('/requests/'))).toBe(false)
  })

  it.each([
    'http://127.0.0.1/stream/movie/tt0126029.json',
    'https://other.example/stream/movie/tt0126029.json',
    'https://torrentio.strem.fun/torbox=secret/stream/movie/tt0126029.json',
    'https://torrentio.strem.fun/stream/movie/tt0126029.json?token=secret',
  ])('rejects an unsafe or credential-bearing source request: %s', async url => {
    FakeXmlHttpRequest.responder = () => ({ status: 200, body: { ok: true, candidates: [], tvSourceLookup: {
      version: 1, ticket: 'signed-ticket', requests: [{ id: 'torrentio-0-0', url }],
    } } })
    expect(await new CompanionReceiver(events()).requestPlay(media)).toMatchObject({ kind: 'failed', message: expect.stringContaining('unsafe') })
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
  })

  it('reports a blocked TV lookup without looping or contacting a closed izumi client', async () => {
    FakeXmlHttpRequest.responder = request => request.method === 'GET'
      ? { status: 403, body: {} }
      : { status: 200, body: { ok: true, candidates: [], tvSourceLookup: { version: 1, ticket: 'signed-ticket',
        requests: [{ id: 'torrentio-0-0', url: 'https://torrentio.strem.fun/stream/movie/tt0126029.json' }] } } }
    expect(await new CompanionReceiver(events()).requestPlay(media)).toEqual({ kind: 'failed', message: 'Torrentio returned HTTP 403 to the TV.' })
    expect(FakeXmlHttpRequest.sent).toHaveLength(2)
  })

  it('does not resume a source lookup after the receiver disconnects', async () => {
    const receiver = new CompanionReceiver(events())
    FakeXmlHttpRequest.responder = request => {
      if (request.method === 'GET') {
        receiver.disconnect()
        return { status: 200, body: { streams: [{ infoHash: 'a'.repeat(40) }] } }
      }
      return { status: 200, body: { ok: true, candidates: [], tvSourceLookup: { version: 1, ticket: 'signed-ticket',
        requests: [{ id: 'torrentio-0-0', url: 'https://torrentio.strem.fun/stream/movie/tt0126029.json' }] } } }
    }
    expect(await receiver.requestPlay(media)).toBe('no-source')
    expect(FakeXmlHttpRequest.sent).toHaveLength(2)
  })

  it('acknowledges an offline discovery choice only when the linked snapshot contains that exact decision', async () => {
    storage.removeItem('izumi.companion.cloudflare')
    const channel = new FakeSmartViewChannel()
    Object.assign(window, { msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) } })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const at = Date.now()
    persistDiscoveryChoice({ profileId: 'default', media, action: 'save', at, pending: true })
    const view = { app: 'izumi', kind: 'companion-home', version: 1, revision: '1', generatedAt: at, catalog: { screen: 'tmdb', label: 'Home' }, rows: [],
      discovery: { version: 2, candidates: [], excluded: [], decisions: [{ key: discoveryKey(media), action: 'save', at }] } }
    channel.emit('izumi.companion.snapshot', { credential: 'wrong', snapshot: view })
    expect(readDiscoveryChoices()[discoveryKey(media)].pending).toBe(true)
    channel.emit('izumi.companion.snapshot', { credential, snapshot: view })
    expect(readDiscoveryChoices()[discoveryKey(media)].pending).toBe(false)
    receiver.disconnect()
  })

  it('restores child cloud progress without importing a main-profile checkpoint', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({ ...transport, tvToken: 'b'.repeat(43) }))
    const household = { enabled: true, profiles: [
      { id: 'default', name: 'Alex', color: '#457b9d', createdAt: 1, ratingLimit: 18, allowAdult: true },
      { id: 'child', name: 'Mina', color: '#2a9d8f', createdAt: 1, ratingLimit: 12, allowAdult: false },
    ] }
    updateTvHousehold(household)
    await chooseTvProfile('child')
    const snapshot = { app: 'izumi', kind: 'companion-home', version: 1, revision: '1', generatedAt: Date.now(), profileId: 'child', catalog: { screen: 'tmdb', label: 'Home' }, rows: [], household }
    const envelope = JSON.stringify({ v: 1, iv: 'AA', data: 'AA' })
    Object.assign(crypto.subtle, { decrypt: vi.fn(async (algorithm: { additionalData: Uint8Array }) => {
      const context = new TextDecoder().decode(algorithm.additionalData)
      return new TextEncoder().encode(JSON.stringify(context.includes(':snapshot:') ? snapshot : {
        profileId: context.endsWith('childrecord') ? 'child' : 'default', media,
        positionSeconds: context.endsWith('childrecord') ? 120 : 400, durationSeconds: 1000, updatedAt: Date.now(), completed: false,
      })).buffer
    }) })
    FakeXmlHttpRequest.responder = (request) => ({ status: 200, body: request.url.includes('/snapshots')
      ? { screen: 'child~tmdb', payload: envelope }
      : { records: [{ mediaKey: 'childrecord', payload: envelope }, { mediaKey: 'mainrecord', payload: envelope }] } })
    const handlers = events()
    const receiver = new CompanionReceiver(handlers)
    receiver.requestCatalog('tmdb')
    await vi.advanceTimersByTimeAsync(0)
    expect(handlers.onSnapshot).toHaveBeenCalledOnce()
    const result = vi.mocked(handlers.onSnapshot).mock.calls[0][0]
    expect(result.profileId).toBe('child')
    expect(result.rows[0].items[0].resumePositionSeconds).toBe(120)
    expect(FakeXmlHttpRequest.sent[0].url).toContain('screen=child~tmdb')
  })
  it('scopes child cloud requests and refuses another viewer’s late LAN snapshots', async () => {
    const household = { enabled: true, profiles: [
      { id: 'default', name: 'Alex', color: '#457b9d', createdAt: 1, ratingLimit: 18, allowAdult: true },
      { id: 'child', name: 'Mina', color: '#2a9d8f', createdAt: 1, ratingLimit: 12, allowAdult: false },
    ] }
    updateTvHousehold(household)
    await chooseTvProfile('child')
    const channel = new FakeSmartViewChannel()
    Object.assign(window, { msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) } })
    FakeXmlHttpRequest.responder = (request) => ({ status: 200, body: request.url.endsWith('/household') ? { household } : { items: [] } })
    const handlers = events()
    const receiver = new CompanionReceiver(handlers)
    await receiver.connect()
    receiver.requestSearch('Film')
    await vi.advanceTimersByTimeAsync(0)
    const search = FakeXmlHttpRequest.sent.find((request) => request.url.endsWith('/search'))!
    expect(search.body).toMatchObject({ profileId: 'child' })
    const snapshot = { app: 'izumi', kind: 'companion-home', version: 1, revision: '1', generatedAt: 1, catalog: { screen: 'tmdb', label: 'Home' }, rows: [], household }
    channel.emit('izumi.companion.snapshot', { credential, snapshot: { ...snapshot, profileId: 'default' } })
    expect(handlers.onSnapshot).not.toHaveBeenCalled()
    channel.emit('izumi.companion.snapshot', { credential, snapshot: { ...snapshot, profileId: 'child' } })
    expect(handlers.onSnapshot).toHaveBeenCalledOnce()
    expect(storage.getItem('izumi.companion.snapshot')).toBeNull()
    expect(storage.getItem('izumi.companion.snapshot:child')).not.toBeNull()
    channel.emit('izumi.load', { sessionId: 'other-profile', url: 'https://example.com/film.mp4', profileId: 'default', media }, 'desktop')
    expect(handlers.onLoad).not.toHaveBeenCalled()
    receiver.disconnect()
  })

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
    storage.removeItem('izumi.companion.cloudflare')
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

  it('prefetches title art through the Worker when no paired client is connected', async () => {
    FakeXmlHttpRequest.responder = () => ({ status: 200, body: { ok: true, details: {
      logoImage: 'https://image.tmdb.org/t/p/w500/title.png',
      episodes: [{ season: 1, episode: 1 }, { season: 2, episode: 1 }, { season: 2, episode: 2 }],
    } } })
    const result = await new CompanionReceiver(events()).requestDetails({ ...media, season: 2, episode: 2, episodeProgress: .5 }, true)
    expect(result?.logoImage).toBe('https://image.tmdb.org/t/p/w500/title.png')
    expect(result?.episodes).toEqual([
      expect.objectContaining({ season: 1, episode: 1, watched: false }),
      expect.objectContaining({ season: 2, episode: 1, watched: true, progress: 1 }),
      expect.objectContaining({ season: 2, episode: 2, watched: false, progress: .5 }),
    ])
    expect(FakeXmlHttpRequest.sent[0].url).toContain('/details')
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
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(1)
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
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(1)
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
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(0)
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
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(1)
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
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(0)
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
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(1)
  })

  it('does not assume a legacy Worker route may wake a closed desktop', async () => {
    const { playbackMode: _playbackMode, wakeWhenClosed: _wakeWhenClosed, ...legacy } = transport
    storage.setItem('izumi.companion.cloudflare', JSON.stringify(legacy))
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    await expect(pending).resolves.toBe('open-client')
    expect(FakeXmlHttpRequest.sent.filter((request) => !request.url.endsWith('/household'))).toHaveLength(0)
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

  it('checkpoints live playback locally and updates cached Continue Watching data', () => {
    vi.setSystemTime(10_000)
    storage.setItem('izumi.companion.snapshot', JSON.stringify({
      app: 'izumi', kind: 'companion-home', version: 1, revision: 'one', generatedAt: 1,
      catalog: { screen: 'merged', label: 'Browse' }, rows: [], history: [],
    }))
    const receiverEvents = { ...events(), onPlaybackProgress: vi.fn() }
    const receiver = new CompanionReceiver(receiverEvents)
    receiver.beginPlayback({
      sessionId: 'device-session', url: 'https://video.example/movie.mp4', title: media.title,
      positionSeconds: 0, subtitles: [], activeTrackIds: [], media,
    })

    receiver.publishStatus({
      sessionId: 'device-session', state: 'playing', positionSeconds: 321, durationSeconds: 1_000,
    })

    expect(JSON.parse(storage.getItem('izumi.companion.playback-progress') || '[]')[0]).toMatchObject({
      positionSeconds: 321, durationSeconds: 1_000, completed: false,
    })
    expect(receiverEvents.onPlaybackProgress).toHaveBeenCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({
        kind: 'continue',
        items: [expect.objectContaining({ title: 'Fight Club', resumePositionSeconds: 321 })],
      })],
    }))
  })

  it('replays crash-safe TV checkpoints to an authenticated linked client', async () => {
    vi.setSystemTime(10_000)
    storage.setItem('izumi.companion.playback-progress', JSON.stringify([{
      recordKey: 'tmdb:movie:550:0:', media, positionSeconds: 321, durationSeconds: 1_000,
      completed: false, updatedAt: 9_000,
    }]))
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()

    channel.emit('izumi.companion.progress-request', { credential }, { id: 'linked-client' })

    expect(channel.publish).toHaveBeenCalledWith('izumi.companion.progress-result', {
      credential,
      records: [expect.objectContaining({ recordKey: 'tmdb:movie:550:0:', positionSeconds: 321 })],
    }, 'linked-client')

    receiver.beginPlayback({
      sessionId: 'device-session', url: 'https://video.example/movie.mp4', title: media.title,
      positionSeconds: 321, subtitles: [], activeTrackIds: [], media,
    })
    vi.setSystemTime(15_000)
    receiver.publishStatus({
      sessionId: 'device-session', state: 'playing', positionSeconds: 456, durationSeconds: 1_000,
    })
    expect(channel.publish).toHaveBeenLastCalledWith('izumi.companion.progress-result', {
      credential,
      records: [expect.objectContaining({ positionSeconds: 456, updatedAt: 15_000 })],
    }, 'linked-client')
    receiver.disconnect()
  })

  it('adopts a TV-scoped Worker handoff without a linked client credential', async () => {
    storage.clear()
    FakeXmlHttpRequest.responder = () => ({ status: 200, body: {} })
    const receiverEvents = { ...events(), onIndependentPlaybackReady: vi.fn() }
    const receiver = new CompanionReceiver(receiverEvents)

    receiver.adoptStandaloneTransport(transport)
    await vi.advanceTimersByTimeAsync(0)

    expect(storage.getItem('izumi.companion.credential')).toBe('07'.repeat(32))
    expect(JSON.parse(storage.getItem('izumi.companion.cloudflare') || '{}')).toEqual(transport)
    expect(receiverEvents.onPaired).toHaveBeenLastCalledWith(true)
    expect(receiverEvents.onIndependentPlaybackReady).toHaveBeenLastCalledWith(true)
    expect(FakeXmlHttpRequest.sent.some((request) => request.url.endsWith('/snapshots?screen=auto'))).toBe(true)
  })
})
