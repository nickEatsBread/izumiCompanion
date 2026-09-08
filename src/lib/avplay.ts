import type { CastLoadRequest, PlaybackState, PlaybackTrack } from '../types'
import { subtitleTrackLabel } from './track-selection'

export interface AvPlayEvents {
  onBuffering(percent?: number): void
  onState(state: PlaybackState): void
  onTime(positionSeconds: number, durationSeconds: number): void
  onBuffered?(startSeconds: number, endSeconds: number): void
  onTracks(tracks: PlaybackTrack[]): void
  onSubtitle(text: string, durationMs: number): void
  onLive?(live: boolean): void
  onComplete(): void
  onError(message: string): void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error || 'Unknown AVPlay error')
}

function sourceKind(request: CastLoadRequest): string {
  if (/mpegurl|m3u8/i.test(`${request.contentType || ''} ${request.url}`)) return 'HLS stream'
  if (/dash|\.mpd(?:$|\?)/i.test(`${request.contentType || ''} ${request.url}`)) return 'DASH stream'
  if (/matroska|\.mkv(?:$|\?)/i.test(`${request.contentType || ''} ${request.url}`)) return 'Matroska video'
  return 'video source'
}

function sourceHost(request: CastLoadRequest): string {
  try { return new URL(request.url).hostname } catch { return 'the selected provider' }
}

function playbackError(request: CastLoadRequest, error: unknown, stage: 'prepare' | 'playback'): string {
  const raw = errorMessage(error).trim()
  if (raw && raw !== 'Unknown AVPlay error' && raw !== 'PLAYER_ERROR_NONE') return raw
  const action = stage === 'prepare' ? 'prepare' : 'play'
  return `Samsung AVPlay could not ${action} this ${sourceKind(request)} from ${sourceHost(request)}.`
}

function adaptiveValue(request: CastLoadRequest): string {
  const options: string[] = []
  const start = request.adaptive?.startBitrate ?? 'AVERAGE'
  options.push(`STARTBITRATE=${typeof start === 'number' ? Math.round(start) : start}`)
  options.push('SKIPBITRATE=HIGHEST')
  if (request.adaptive?.minBitrateKbps) options.push(`BITRATES=${Math.round(request.adaptive.minBitrateKbps)}~${Math.round(request.adaptive.maxBitrateKbps || 0) || ''}`)
  else if (request.adaptive?.maxBitrateKbps) options.push(`BITRATES=~${Math.round(request.adaptive.maxBitrateKbps)}`)
  return options.join('|')
}

function trackMetadata(details: Record<string, unknown>, keys: string[]): string {
  const values: Record<string, unknown> = {}
  Object.keys(details).forEach((key) => { values[key.toLowerCase()] = details[key] })
  for (const key of keys) {
    const value = values[key.toLowerCase()]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

export class AvPlayController {
  private active?: CastLoadRequest
  private events?: AvPlayEvents
  private generation = 0
  private retryCount = 0
  private recovering = false
  private bufferingTimer?: number
  private suspendedPosition = 0
  private resumeAfterRestore = false
  private lastTrackSignature = ''
  private trackRefreshTick = 0
  private desiredState: 'playing' | 'paused' = 'playing'
  private pendingSeek?: number
  private seekBusy = false
  private seekQueue: Promise<void> = Promise.resolve()
  private cancelSeek?: () => void
  private cancelPrepare?: () => void
  private knownPosition = 0
  private knownDuration = 0
  private bufferSeconds = 0
  private bufferAnchor = 0

  get available(): boolean {
    return Boolean(window.webapis?.avplay)
  }

  get request(): CastLoadRequest | undefined {
    return this.active
  }

  async load(request: CastLoadRequest, events: AvPlayEvents): Promise<void> {
    this.close()
    this.active = request
    this.events = events
    this.retryCount = 0
    this.recovering = false
    this.lastTrackSignature = ''
    this.trackRefreshTick = 0
    this.desiredState = 'playing'
    const generation = ++this.generation
    events.onState('buffering')
    try {
      await this.openAndPlay(request.positionSeconds, generation)
    } catch (error) {
      if (generation !== this.generation || this.recovering) return
      if (this.retryCount >= 1 || !this.active) throw error
      this.retryCount += 1
      events.onBuffering()
      try { window.webapis?.avplay?.close() } catch { /* Prepare may already have closed the player. */ }
      const retryGeneration = ++this.generation
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      await this.openAndPlay(request.positionSeconds, retryGeneration)
    }
  }

  private async openAndPlay(positionSeconds: number, generation: number): Promise<void> {
    if (generation !== this.generation) return
    const player = window.webapis?.avplay
    const request = this.active
    const events = this.events
    if (!player || !request || !events) throw new Error('Samsung AVPlay is unavailable outside a Samsung TV runtime.')

    let playbackStarted = false
    try {
      player.open(request.url)
      player.setListener({
        onbufferingstart: () => {
          if (generation !== this.generation) return
          this.bufferAnchor = this.pendingSeek ?? this.knownPosition
          events.onBuffered?.(this.bufferAnchor, this.bufferAnchor)
          events.onState('buffering')
          events.onBuffering()
          this.armBufferingTimeout(generation)
        },
        onbufferingprogress: (percent) => {
          if (generation !== this.generation) return
          events.onBuffering(percent)
          this.armBufferingTimeout(generation)
        },
        onbufferingcomplete: () => {
          if (generation !== this.generation) return
          this.clearBufferingTimeout()
          events.onBuffering(100)
          // Completion confirms this minimum window, not the entire video download.
          events.onBuffered?.(this.bufferAnchor, Math.min(this.knownDuration || Infinity, this.bufferAnchor + this.bufferSeconds))
          if (this.seekBusy) return
          if (playbackStarted && this.desiredState === 'paused') {
            try { if (player.getState() === 'PLAYING') player.pause() } catch { /* State can change during the callback. */ }
          }
          if (playbackStarted) events.onState(this.desiredState)
        },
        oncurrentplaytime: (milliseconds) => {
          if (generation !== this.generation) return
          if (this.seekBusy) return
          this.knownPosition = milliseconds / 1000
          this.knownDuration = Math.max(0, player.getDuration() / 1000)
          events.onTime(this.knownPosition, this.knownDuration)
          // Adaptive manifests on older Samsung firmware often expose AUDIO/TEXT only after
          // playback begins. Re-sample a few early callbacks and emit only when metadata changes.
          this.trackRefreshTick += 1
          if (this.trackRefreshTick === 1 || this.trackRefreshTick === 4 || this.trackRefreshTick === 8) {
            this.emitTracks(generation)
          }
        },
        onstreamcompleted: () => generation === this.generation && events.onComplete(),
        onsubtitlechange: (duration, text) => generation === this.generation && events.onSubtitle(text, duration),
        onerror: (error) => this.handleRuntimeError(playbackError(request, error, 'playback'), generation),
        onerrormsg: (code, message) => this.handleRuntimeError(playbackError(request, message || code, 'playback'), generation),
      })
      player.setDisplayRect(0, 0, 1920, 1080)
      player.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX')
      this.configureIdlePlayer(player, request)
      try { player.setSilentSubtitle?.(true) } catch { /* Custom overlay uses text callbacks. */ }
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          globalThis.clearTimeout(timer)
          if (this.cancelPrepare === cancel) this.cancelPrepare = undefined
          callback()
        }
        // Some firmware never invokes either prepare callback for an unreadable/ambiguous URL.
        // Bound that state so automatic source recovery can try the next candidate instead of
        // leaving both the phone and TV on an infinite loading screen.
        const timer = globalThis.setTimeout(() => finish(() => reject(new Error(
          `Samsung AVPlay timed out while preparing this ${sourceKind(request)} from ${sourceHost(request)}.`,
        ))), 20_000)
        const cancel = () => finish(resolve)
        this.cancelPrepare = cancel
        try {
          player.prepareAsync(
            () => finish(resolve),
            (error) => finish(() => reject(new Error(playbackError(request, error, 'prepare')))),
          )
        } catch (error) { finish(() => reject(error)) }
      })
      if (generation !== this.generation) return
      this.clearBufferingTimeout()
      let live = false
      try { live = player.getStreamingProperty?.('IS_LIVE') === 'true' } catch { /* Older firmware can omit this property. */ }
      events.onLive?.(live)
      this.knownDuration = Math.max(0, player.getDuration() / 1000)
      const expectedMinutes = request.media?.runtimeMinutes
      if (!live && request.media?.ref.type === 'movie' && expectedMinutes && expectedMinutes >= 40
        && this.knownDuration > 0 && this.knownDuration < Math.min(20 * 60, expectedMinutes * 60 * .45)) {
        throw new Error('This source contains a short preview instead of the full title. Choose another source.')
      }
      if (!live && positionSeconds > 0) await this.seek(positionSeconds)
      if (generation !== this.generation) return
      player.play()
      playbackStarted = true
      if (this.desiredState === 'paused') player.pause()
      this.emitTracks(generation)
      this.recovering = false
      events.onState(this.desiredState)
    } catch (error) {
      if (generation !== this.generation) return
      throw new Error(playbackError(request, error, 'prepare'))
    }
  }

  private configureIdlePlayer(player: SamsungAvPlay, request: CastLoadRequest): void {
    this.bufferSeconds = 0
    try {
      if (player.setBufferingParam) {
        player.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 8)
        player.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 8)
        this.bufferSeconds = 8
      }
    } catch { /* Do not invent a buffered duration when firmware rejects the target. */ }
    if (/\.m3u8(?:$|\?)|\.mpd(?:$|\?)/i.test(request.url) || /mpegurl|dash/i.test(request.contentType || '') || request.adaptive) {
      try { player.setStreamingProperty?.('ADAPTIVE_INFO', adaptiveValue(request)) } catch { /* Fixed-quality streams ignore this. */ }
    }
    if (request.cookies) try { player.setStreamingProperty?.('COOKIE', request.cookies) } catch { /* Optional. */ }
    if (request.userAgent) try { player.setStreamingProperty?.('USER_AGENT', request.userAgent) } catch { /* Optional. */ }
    if (request.drm && player.setDrm) {
      const properties = {
        LicenseServer: request.drm.licenseServer,
        HttpHeader: request.drm.headers ? Object.entries(request.drm.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') : undefined,
        CustomData: request.drm.customData,
        DeleteLicenseAfterUse: request.drm.deleteLicenseAfterUse,
      }
      const system = request.drm.system === 'widevine' ? 'WIDEVINE_CDM' : 'PLAYREADY'
      player.setDrm(system, 'SetProperties', JSON.stringify(properties))
    }
  }

  private armBufferingTimeout(generation: number): void {
    this.clearBufferingTimeout()
    this.bufferingTimer = window.setTimeout(() => this.handleRuntimeError('Playback stopped responding while buffering.', generation), 20_000)
  }

  private clearBufferingTimeout(): void {
    if (this.bufferingTimer) window.clearTimeout(this.bufferingTimer)
    this.bufferingTimer = undefined
  }

  private handleRuntimeError(message: string, generation: number): void {
    if (generation !== this.generation || this.recovering) return
    if (this.retryCount >= 1 || !this.active || !this.events) {
      this.clearBufferingTimeout()
      this.events?.onError(message)
      return
    }
    this.retryCount += 1
    this.recovering = true
    const resumeAt = this.pendingSeek ?? (this.currentTime() || this.active.positionSeconds)
    this.events.onState('buffering')
    this.events.onBuffering()
    const retryGeneration = ++this.generation
    this.cancelPrepare?.()
    this.cancelSeek?.()
    this.seekBusy = false
    this.seekQueue = Promise.resolve()
    this.clearBufferingTimeout()
    try { window.webapis?.avplay?.stop() } catch { /* Already stopped. */ }
    try { window.webapis?.avplay?.close() } catch { /* Already closed. */ }
    window.setTimeout(() => {
      if (retryGeneration !== this.generation) return
      void this.openAndPlay(resumeAt, retryGeneration)
        .then(() => { this.recovering = false })
        .catch((error) => {
          this.recovering = false
          if (retryGeneration === this.generation) this.events?.onError(`${message} ${errorMessage(error)}`)
        })
    }, 350)
  }

  play(): void {
    const player = window.webapis?.avplay
    this.desiredState = 'playing'
    if (this.seekBusy) return
    if (player && ['READY', 'PAUSED'].includes(player.getState())) player.play()
  }

  pause(): void {
    const player = window.webapis?.avplay
    this.desiredState = 'paused'
    if (this.seekBusy) return
    if (player?.getState() === 'PLAYING') player.pause()
  }

  suspend(): void {
    if (this.seekBusy) { this.whenSeekReady(() => this.suspend()); return }
    const player = window.webapis?.avplay
    if (!player || !this.active) return
    try {
      this.suspendedPosition = this.currentTime()
      this.resumeAfterRestore = player.getState() === 'PLAYING'
      if (player.suspend) player.suspend()
      else if (this.resumeAfterRestore) player.pause()
    } catch { /* The application may already be hidden or stopped. */ }
  }

  async restore(): Promise<void> {
    if (this.seekBusy) await this.seekQueue.catch(() => {})
    const player = window.webapis?.avplay
    if (!player || !this.active) return
    try {
      if (player.restore) {
        await new Promise<void>((resolve, reject) => player.restore!(Math.round(this.suspendedPosition * 1000), false, resolve, reject))
      }
      if (this.resumeAfterRestore && ['READY', 'PAUSED'].includes(player.getState())) player.play()
    } catch (error) {
      this.handleRuntimeError(errorMessage(error), this.generation)
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    const generation = this.generation
    const task = this.seekQueue.catch(() => {}).then(() => this.performSeek(positionSeconds, generation))
    this.seekQueue = task
    return task
  }

  private async performSeek(positionSeconds: number, generation: number): Promise<void> {
    const player = window.webapis?.avplay
    if (!player || generation !== this.generation) return
    if (!Number.isFinite(positionSeconds)) throw new Error('Invalid playback position.')
    const target = Math.min(Math.max(0, positionSeconds), this.knownDuration ? Math.max(0, this.knownDuration - 1) : Infinity)
    this.pendingSeek = target
    this.bufferAnchor = target
    this.events?.onState('buffering')
    this.events?.onBuffering(0)
    this.events?.onBuffered?.(target, target)
    try {
      this.seekBusy = true
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: unknown) => {
          if (settled) return
          settled = true
          globalThis.clearTimeout(timer)
          this.cancelSeek = undefined
          error ? reject(error) : resolve()
        }
        const timer = globalThis.setTimeout(() => finish(new Error('Seeking timed out. Reconnecting playback.')), 12_000)
        this.cancelSeek = () => finish(new Error('Playback changed.'))
        try { player.seekTo(Math.round(target * 1000), () => finish(), finish) } catch (error) { finish(error) }
      })
      if (generation !== this.generation) return
      this.seekBusy = false
      this.knownPosition = target
      this.pendingSeek = undefined
      this.clearBufferingTimeout()
      // Some firmware omits all buffering events for seeks; the async completion is still real.
      this.events?.onBuffering(100)
      this.events?.onTime(target, this.knownDuration)
      if (this.desiredState === 'paused') {
        if (player.getState() === 'PLAYING') player.pause()
      } else if (player.getState() === 'PAUSED') player.play()
      if (player.getState() !== 'READY') this.events?.onState(this.desiredState)
    } catch (error) {
      if (generation !== this.generation) return
      this.seekBusy = false
      this.handleRuntimeError(errorMessage(error), generation)
      throw error
    }
  }

  currentTime(): number {
    if (this.seekBusy) return this.knownPosition
    try { return Math.max(0, (window.webapis?.avplay?.getCurrentTime() ?? 0) / 1000) } catch { return 0 }
  }

  duration(): number {
    if (this.seekBusy) return this.knownDuration
    try { return Math.max(0, (window.webapis?.avplay?.getDuration() ?? 0) / 1000) } catch { return 0 }
  }

  tracks(): PlaybackTrack[] {
    if (this.seekBusy) return []
    const player = window.webapis?.avplay
    if (!player) return []
    try {
      let audioOrdinal = 0
      let subtitleOrdinal = 0
      const tracks: PlaybackTrack[] = []
      player.getTotalTrackInfo().forEach((track) => {
        if (track.type !== 'AUDIO' && track.type !== 'TEXT') return
        let details: Record<string, unknown> = {}
        try { details = JSON.parse(track.extra_info || '{}') as Record<string, unknown> } catch { /* malformed metadata */ }
        const language = trackMetadata(details, ['language', 'track_lang', 'lang', 'track_language', 'trackLanguage', 'language_code', 'subtitle_language'])
        const title = trackMetadata(details, ['title', 'track_title', 'track_name', 'name', 'label', 'stream_title', 'handler_name', 'subtitle_name', 'subtitle_type'])
        const channels = Number(trackMetadata(details, ['channels', 'channel_count'])) || 0
        const codec = trackMetadata(details, ['fourCC', 'codec', 'codec_type'])
        if (track.type === 'TEXT') {
          const label = subtitleTrackLabel(title, language, subtitleOrdinal)
          subtitleOrdinal += 1
          tracks.push({ type: track.type, index: track.index, language, codec, label })
          return
        }
        const label = language ? language.toUpperCase() : title || `Audio ${audioOrdinal + 1}`
        audioOrdinal += 1
        const parts = [label]
        if (channels) parts.push(`${channels}ch`)
        else if (codec) parts.push(codec)
        tracks.push({ type: track.type, index: track.index, language, codec, label: parts.join(' · ') })
      })
      const counts: Record<string, number> = {}
      tracks.forEach((track) => { counts[`${track.type}:${track.label}`] = (counts[`${track.type}:${track.label}`] || 0) + 1 })
      const seen: Record<string, number> = {}
      return tracks.map((track) => {
        const key = `${track.type}:${track.label}`
        if (counts[key] < 2) return track
        seen[key] = (seen[key] || 0) + 1
        return { ...track, label: `${track.label} · Track ${seen[key]}` }
      })
    } catch {
      return []
    }
  }

  private emitTracks(generation: number): void {
    if (generation !== this.generation || !this.events) return
    const tracks = this.tracks()
    const signature = JSON.stringify(tracks.map((track) => [track.type, track.index, track.language, track.codec, track.label]))
    if (signature === this.lastTrackSignature) return
    this.lastTrackSignature = signature
    this.events.onTracks(tracks)
  }

  currentTrackIndex(type: 'AUDIO' | 'TEXT'): number | undefined {
    if (this.seekBusy) return undefined
    const player = window.webapis?.avplay
    if (!player?.getCurrentStreamInfo) return undefined
    try {
      const track = player.getCurrentStreamInfo().find((item) => item.type === type && item.index >= 0)
      return track?.index
    } catch { return undefined }
  }

  async selectTrack(type: 'AUDIO' | 'TEXT', index: number): Promise<boolean> {
    const generation = this.generation
    while (this.seekBusy) await this.seekQueue.catch(() => {})
    if (generation !== this.generation) return false
    const player = window.webapis?.avplay
    if (!player) return false
    const available = player.getTotalTrackInfo().some((track) => track.type === type && track.index === index)
    if (!available) return false
    player.setSelectTrack(type, index)
    if (!player.getCurrentStreamInfo) return true
    for (const wait of [0, 90, 180, 300]) {
      if (wait) await new Promise<void>((resolve) => window.setTimeout(resolve, wait))
      if (generation !== this.generation || this.seekBusy) return false
      if (this.currentTrackIndex(type) === index) return true
      if (wait === 90) player.setSelectTrack(type, index)
    }
    return false
  }

  hideSubtitles(hidden: boolean): void {
    if (this.seekBusy) { this.whenSeekReady(() => this.hideSubtitles(hidden)); return }
    try { window.webapis?.avplay?.setSilentSubtitle?.(hidden) } catch { /* unsupported stream */ }
  }

  setDisplayRect(x: number, y: number, width: number, height: number): void {
    if (this.seekBusy) { this.whenSeekReady(() => this.setDisplayRect(x, y, width, height)); return }
    const player = window.webapis?.avplay
    if (!player) return
    try {
      player.setDisplayRect(
        Math.max(0, Math.round(x)),
        Math.max(0, Math.round(y)),
        Math.max(1, Math.round(width)),
        Math.max(1, Math.round(height)),
      )
    } catch { /* The native video plane may already be closing. */ }
  }

  setSubtitleDelay(milliseconds: number): void {
    if (this.seekBusy) { this.whenSeekReady(() => this.setSubtitleDelay(milliseconds)); return }
    try { window.webapis?.avplay?.setSubtitlePosition?.(milliseconds) } catch { /* unsupported stream */ }
  }

  close(): void {
    this.generation += 1
    this.cancelPrepare?.()
    this.cancelPrepare = undefined
    this.cancelSeek?.()
    this.cancelSeek = undefined
    this.seekBusy = false
    this.seekQueue = Promise.resolve()
    this.knownPosition = 0
    this.knownDuration = 0
    this.bufferAnchor = 0
    this.clearBufferingTimeout()
    const player = window.webapis?.avplay
    if (player) {
      try { if (player.getState() !== 'NONE') player.stop() } catch { /* already stopped */ }
      try { player.close() } catch { /* already closed */ }
    }
    this.active = undefined
    this.events = undefined
    this.recovering = false
    this.resumeAfterRestore = false
    this.lastTrackSignature = ''
    this.trackRefreshTick = 0
    this.desiredState = 'playing'
    this.pendingSeek = undefined
  }

  private whenSeekReady(operation: () => void): void {
    const generation = this.generation
    void this.seekQueue.catch(() => {}).then(() => {
      if (generation !== this.generation) return
      if (this.seekBusy) this.whenSeekReady(operation)
      else operation()
    })
  }
}
