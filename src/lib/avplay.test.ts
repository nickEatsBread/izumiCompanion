import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvPlayController } from './avplay'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('AVPlay setup', () => {
  it('moves the native video plane into the requested post-play viewport', () => {
    const setDisplayRect = vi.fn()
    Object.assign(globalThis, { window: { webapis: { avplay: { setDisplayRect } } } })
    const controller = new AvPlayController()
    controller.setDisplayRect(76.4, 85.6, 919.7, 518.2)
    expect(setDisplayRect).toHaveBeenCalledWith(76, 86, 920, 518)
  })

  it('configures adaptive playback while IDLE and starts after prepare', async () => {
    const calls: string[] = []
    const player = {
      open: vi.fn(() => calls.push('open')),
      close: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => 'READY'),
      setListener: vi.fn(),
      setDisplayRect: vi.fn(),
      setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(() => calls.push('buffer')),
      setStreamingProperty: vi.fn((name: string) => calls.push(name)),
      getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void) => { calls.push('prepare'); success() }),
      play: vi.fn(() => calls.push('play')),
      pause: vi.fn(),
      seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000),
      getCurrentTime: vi.fn(() => 0),
      getTotalTrackInfo: vi.fn(() => []),
      setSelectTrack: vi.fn(),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player } } })
    const controller = new AvPlayController()
    await controller.load({
      sessionId: 'session',
      url: 'https://example.test/master.m3u8',
      title: 'Test',
      contentType: 'application/vnd.apple.mpegurl',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
    }, {
      onBuffering: vi.fn(),
      onState: vi.fn(),
      onTime: vi.fn(),
      onTracks: vi.fn(),
      onSubtitle: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    })

    expect(player.setStreamingProperty).toHaveBeenCalledWith('ADAPTIVE_INFO', 'STARTBITRATE=AVERAGE')
    expect(calls.indexOf('buffer')).toBeLessThan(calls.indexOf('prepare'))
    expect(calls.indexOf('prepare')).toBeLessThan(calls.indexOf('play'))
  })

  it('retries one failed prepare without dropping the session', async () => {
    let attempts = 0
    const player = {
      open: vi.fn(), close: vi.fn(), stop: vi.fn(), getState: vi.fn(() => 'READY'),
      setListener: vi.fn(), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(), getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void, failure: (error: unknown) => void) => {
        attempts += 1
        if (attempts === 1) failure(new Error('temporary network error'))
        else success()
      }),
      play: vi.fn(), pause: vi.fn(), seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000), getCurrentTime: vi.fn(() => 0), getTotalTrackInfo: vi.fn(() => []),
      setSelectTrack: vi.fn(),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout } })
    const controller = new AvPlayController()
    await controller.load({ sessionId: 'retry', url: 'https://example.test/video.mp4', title: 'Retry', positionSeconds: 0, subtitles: [], activeTrackIds: [] }, {
      onBuffering: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks: vi.fn(), onSubtitle: vi.fn(), onComplete: vi.fn(), onError: vi.fn(),
    })
    expect(player.open).toHaveBeenCalledTimes(2)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('turns Samsung\'s empty prepare error into actionable source context', async () => {
    const player = {
      open: vi.fn(), close: vi.fn(), stop: vi.fn(), getState: vi.fn(() => 'IDLE'),
      setListener: vi.fn(), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(),
      prepareAsync: vi.fn((_success: () => void, failure: (error: unknown) => void) => failure(undefined)),
      play: vi.fn(), getDuration: vi.fn(() => 0), getTotalTrackInfo: vi.fn(() => []),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout } })
    const controller = new AvPlayController()
    await expect(controller.load({
      sessionId: 'unknown-error',
      url: 'https://video.example/master.m3u8',
      title: 'Test',
      contentType: 'application/vnd.apple.mpegurl',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
    }, {
      onBuffering: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks: vi.fn(),
      onSubtitle: vi.fn(), onComplete: vi.fn(), onError: vi.fn(),
    })).rejects.toThrow('could not prepare this HLS stream from video.example')
    expect(player.open).toHaveBeenCalledTimes(2)
  })

  it('refreshes adaptive track metadata after playback starts', async () => {
    let listener: { oncurrentplaytime(milliseconds: number): void } | undefined
    let trackInfo: { type: 'AUDIO' | 'TEXT'; index: number; extra_info: string }[] = []
    const player = {
      open: vi.fn(), close: vi.fn(), stop: vi.fn(), getState: vi.fn(() => 'READY'),
      setListener: vi.fn((value) => { listener = value }), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(), getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void) => success()), play: vi.fn(), pause: vi.fn(),
      seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000), getCurrentTime: vi.fn(() => 0),
      getTotalTrackInfo: vi.fn(() => trackInfo), setSelectTrack: vi.fn(),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player } } })
    const onTracks = vi.fn()
    await new AvPlayController().load({
      sessionId: 'late-tracks', url: 'https://example.test/master.mpd', title: 'Tracks',
      contentType: 'application/dash+xml', positionSeconds: 0, subtitles: [], activeTrackIds: [],
    }, {
      onBuffering: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks,
      onSubtitle: vi.fn(), onComplete: vi.fn(), onError: vi.fn(),
    })
    expect(onTracks).toHaveBeenLastCalledWith([])

    trackInfo = [{ type: 'AUDIO', index: 4, extra_info: JSON.stringify({ language: 'jpn', fourCC: 'AAC', channels: 2 }) }]
    listener?.oncurrentplaytime(250)

    expect(onTracks).toHaveBeenLastCalledWith([
      { type: 'AUDIO', index: 4, language: 'jpn', codec: 'AAC', label: 'JPN · 2ch' },
    ])
  })

  it('uses useful, unique labels for Samsung subtitle tracks', () => {
    const player = {
      getTotalTrackInfo: vi.fn(() => [
        { type: 'TEXT' as const, index: 7, extra_info: JSON.stringify({ LANGUAGE: 'eng', NAME: 'Subtitles' }) },
        { type: 'TEXT' as const, index: 9, extra_info: JSON.stringify({ track_language: 'eng', track_title: 'Subtitles 2' }) },
        { type: 'TEXT' as const, index: 11, extra_info: '{}' },
      ]),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player } } })

    expect(new AvPlayController().tracks()).toEqual([
      { type: 'TEXT', index: 7, language: 'eng', codec: '', label: 'English · Track 1' },
      { type: 'TEXT', index: 9, language: 'eng', codec: '', label: 'English · Track 2' },
      { type: 'TEXT', index: 11, language: '', codec: '', label: 'Subtitle 3' },
    ])
  })

  it('uses embedded subtitle handler names when Samsung omits a title field', () => {
    const player = {
      getTotalTrackInfo: vi.fn(() => [
        { type: 'TEXT' as const, index: 3, extra_info: JSON.stringify({ track_lang: 'spa', handler_name: 'Latin American' }) },
      ]),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player } } })

    expect(new AvPlayController().tracks()).toEqual([
      { type: 'TEXT', index: 3, language: 'spa', codec: '', label: 'Spanish · Latin American' },
    ])
  })

  it('confirms the native current audio stream before reporting a switch', async () => {
    let current = 1
    const player = {
      getTotalTrackInfo: vi.fn(() => [
        { type: 'AUDIO' as const, index: 1, extra_info: '{}' },
        { type: 'AUDIO' as const, index: 4, extra_info: '{}' },
      ]),
      getCurrentStreamInfo: vi.fn(() => [{ type: 'AUDIO' as const, index: current, extra_info: '{}' }]),
      setSelectTrack: vi.fn((_type: string, index: number) => { current = index }),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout } })
    const controller = new AvPlayController()

    await expect(controller.selectTrack('AUDIO', 4)).resolves.toBe(true)
    expect(controller.currentTrackIndex('AUDIO')).toBe(4)
    expect(player.setSelectTrack).toHaveBeenCalledWith('AUDIO', 4)
    await expect(controller.selectTrack('AUDIO', 9)).resolves.toBe(false)
  })

  it('keeps Samsung subtitle events enabled when selecting an embedded track', async () => {
    let listener: { onsubtitlechange(duration: number, text: string): void } | undefined
    const setSilentSubtitle = vi.fn()
    const player = {
      open: vi.fn(), close: vi.fn(), stop: vi.fn(), getState: vi.fn(() => 'READY'),
      setListener: vi.fn((value) => { listener = value }), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(), getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void) => success()), play: vi.fn(), pause: vi.fn(),
      seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000), getCurrentTime: vi.fn(() => 0),
      getTotalTrackInfo: vi.fn(() => [{ type: 'TEXT' as const, index: 5, extra_info: '{}' }]),
      getCurrentStreamInfo: vi.fn(() => [{ type: 'TEXT' as const, index: 5, extra_info: '{}' }]),
      setSelectTrack: vi.fn(), setSilentSubtitle,
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout } })
    const onSubtitle = vi.fn()
    const controller = new AvPlayController()
    await controller.load({
      sessionId: 'subtitles', url: 'https://example.test/video.mp4', title: 'Subtitles',
      positionSeconds: 0, subtitles: [], activeTrackIds: [],
    }, {
      onBuffering: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks: vi.fn(), onSubtitle,
      onComplete: vi.fn(), onError: vi.fn(),
    })

    controller.hideSubtitles(true)
    await expect(controller.selectTrack('TEXT', 5)).resolves.toBe(true)
    listener?.onsubtitlechange(2_500, 'Subtitle event text')

    expect(setSilentSubtitle).toHaveBeenCalledWith(true)
    expect(setSilentSubtitle).not.toHaveBeenCalledWith(false)
    expect(onSubtitle).toHaveBeenCalledWith('Subtitle event text', 2_500)
  })

  it('returns from runtime buffering to the intended playback state', async () => {
    let listener: {
      onbufferingstart(): void
      onbufferingprogress(percent: number): void
      onbufferingcomplete(): void
    } | undefined
    let nativeState = 'READY'
    const player = {
      open: vi.fn(), close: vi.fn(), stop: vi.fn(), getState: vi.fn(() => nativeState),
      setListener: vi.fn((value) => { listener = value }), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(), getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void) => success()),
      play: vi.fn(() => { nativeState = 'PLAYING' }),
      pause: vi.fn(() => { nativeState = 'PAUSED' }),
      seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000), getCurrentTime: vi.fn(() => 0), getTotalTrackInfo: vi.fn(() => []),
      setSelectTrack: vi.fn(),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout, clearTimeout } })
    const onState = vi.fn()
    const onBuffering = vi.fn()
    const controller = new AvPlayController()
    await controller.load({
      sessionId: 'buffering', url: 'https://example.test/video.mp4', title: 'Buffering',
      positionSeconds: 0, subtitles: [], activeTrackIds: [],
    }, {
      onBuffering, onState, onTime: vi.fn(), onTracks: vi.fn(), onSubtitle: vi.fn(),
      onComplete: vi.fn(), onError: vi.fn(),
    })

    listener?.onbufferingstart()
    listener?.onbufferingprogress(43)
    nativeState = 'IDLE'
    await controller.seek(42)
    expect(player.seekTo).not.toHaveBeenCalled()
    nativeState = 'PLAYING'
    listener?.onbufferingcomplete()
    expect(onBuffering).toHaveBeenLastCalledWith(100)
    expect(onState).toHaveBeenLastCalledWith('playing')
    expect(player.seekTo).toHaveBeenCalledWith(42_000, undefined, expect.any(Function))

    controller.pause()
    listener?.onbufferingstart()
    listener?.onbufferingcomplete()
    expect(onState).toHaveBeenLastCalledWith('paused')
  })
})
