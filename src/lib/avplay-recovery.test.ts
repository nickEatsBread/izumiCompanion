import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AvPlayController } from './avplay'
import type { CastLoadRequest } from '../types'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(globalThis, 'window') })

function fixture(duration = 7_200_000) {
  let state = 'NONE', audio = 1
  let listener: SamsungAvPlayListener
  const tracks = [
    { type: 'AUDIO' as const, index: 1, extra_info: '{"language":"fra"}' },
    { type: 'AUDIO' as const, index: 4, extra_info: '{"language":"eng"}' },
    { type: 'AUDIO' as const, index: 7, extra_info: '{"language":"jpn"}' },
  ]
  const player = {
    open: vi.fn(() => { state = 'IDLE'; audio = 1 }), close: vi.fn(() => { state = 'NONE' }), stop: vi.fn(),
    getState: () => state, setListener: (value: SamsungAvPlayListener) => { listener = value },
    setDisplayRect: vi.fn(), setSilentSubtitle: vi.fn(),
    prepareAsync: (done: () => void) => { state = 'READY'; done() },
    play: vi.fn(() => { state = 'PLAYING' }), pause: vi.fn(() => { state = 'PAUSED' }),
    getDuration: vi.fn(() => duration), getCurrentTime: () => 42_000,
    seekTo: vi.fn((_position: number, done: () => void) => { audio = 1; done() }),
    getTotalTrackInfo: () => tracks,
    getCurrentStreamInfo: () => [{ type: 'AUDIO', index: audio, extra_info: '{}' }],
    setSelectTrack: vi.fn((type: string, index: number) => {
      if (type === 'AUDIO' && state !== 'PLAYING') throw new Error('Invalid audio switching state')
      audio = index
    }),
  }
  Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout, clearTimeout } })
  const controller = new AvPlayController()
  const events = { onBuffering: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks: vi.fn(), onSubtitle: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
  const request: CastLoadRequest = { sessionId: 'test-session', title: 'Example', url: 'https://media.example/video.mkv', positionSeconds: 0, subtitles: [], activeTrackIds: [],
    media: { title: 'Example', ref: { provider: 'catalog', type: 'movie', id: 'example' }, runtimeMinutes: 120 } }
  return { controller, events, request, player, listener: () => listener }
}

it('switches paused audio in PLAYING and restores the user pause state', async () => {
  const { controller, events, request, player } = fixture()
  await controller.load(request, events)
  controller.pause()
  expect(await controller.selectTrack('AUDIO', 4)).toBe(true)
  expect(controller.currentTrackIndex('AUDIO')).toBe(4)
  expect(player.getState()).toBe('PAUSED')
  controller.play()
  expect(controller.currentTrackIndex('AUDIO')).toBe(4)
  controller.close()
})

it('lets the latest audio choice win without an older retry overwriting it', async () => {
  const { controller, events, request, player } = fixture()
  await controller.load(request, events)
  const original = player.setSelectTrack.getMockImplementation()!
  player.setSelectTrack.mockImplementationOnce(() => {})
  const earlier = controller.selectTrack('AUDIO', 4)
  await vi.advanceTimersByTimeAsync(50)
  const latest = controller.selectTrack('AUDIO', 7)
  player.setSelectTrack.mockImplementation(original)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(await earlier).toBe(false)
  expect(await latest).toBe(true)
  expect(controller.currentTrackIndex('AUDIO')).toBe(7)
  controller.close()
})

it('reapplies confirmed audio after a native reopen and after seeking', async () => {
  const { controller, events, request, player, listener } = fixture()
  await controller.load(request, events)
  await controller.selectTrack('AUDIO', 4)
  listener().onerror?.('PLAYER_ERROR_CONNECTION_FAILED')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(player.open).toHaveBeenCalledTimes(2)
  expect(controller.currentTrackIndex('AUDIO')).toBe(4)
  expect(events.onError).not.toHaveBeenCalled()
  await controller.seek(100)
  expect(controller.currentTrackIndex('AUDIO')).toBe(4)
  controller.close()
})

it('does not apply a pending audio retry to the next playback session', async () => {
  const { controller, events, request, player } = fixture()
  await controller.load(request, events)
  player.setSelectTrack.mockImplementationOnce(() => {})
  const pending = controller.selectTrack('AUDIO', 4)
  await vi.advanceTimersByTimeAsync(50)
  await controller.load({ ...request, sessionId: 'next-session' }, events)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(await pending).toBe(false)
  expect(controller.currentTrackIndex('AUDIO')).toBe(1)
  expect(player.setSelectTrack).toHaveBeenCalledTimes(1)
  controller.close()
})

it('keeps an explicit audio choice queued during seeking ahead of the restored preference', async () => {
  const { controller, events, request, player } = fixture()
  await controller.load(request, events)
  await controller.selectTrack('AUDIO', 4)
  let finish: (() => void) | undefined
  player.seekTo.mockImplementationOnce((_position, done) => { finish = done })
  const seeking = controller.seek(100)
  await vi.advanceTimersByTimeAsync(1)
  const choosing = controller.selectTrack('AUDIO', 7)
  finish?.()
  await seeking
  expect(await choosing).toBe(true)
  expect(controller.currentTrackIndex('AUDIO')).toBe(7)
  controller.close()
})

it('rejects a preview when duration first arrives after prepare', async () => {
  const { controller, events, request, player, listener } = fixture(0)
  await controller.load(request, events)
  player.getDuration.mockReturnValue(180_000)
  listener().oncurrentplaytime?.(100)
  expect(events.onError).toHaveBeenCalledWith(expect.stringContaining('short preview'))
  expect(player.getState()).toBe('NONE')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(player.open).toHaveBeenCalledTimes(1)
})

it('uses the asynchronous native restore signature and retains selected audio', async () => {
  const f = fixture()
  const restoreAsync = vi.fn((_url: string, _position: number, _prepare: boolean, done: () => void) => done())
  Object.assign(f.player, { suspend: vi.fn(), restoreAsync })
  await f.controller.load(f.request, f.events)
  await f.controller.selectTrack('AUDIO', 4)
  f.controller.suspend()
  await f.controller.restore()
  expect(restoreAsync).toHaveBeenCalledWith(f.request.url, 42_000, false, expect.any(Function), expect.any(Function))
  expect(f.controller.currentTrackIndex('AUDIO')).toBe(4)
  f.controller.close()
})
