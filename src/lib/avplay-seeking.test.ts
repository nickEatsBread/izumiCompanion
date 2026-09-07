import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvPlayController } from './avplay'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
async function setup() {
  vi.useFakeTimers()
  let busy = false, state = 'READY'
  let listener: Record<string, (...args: number[]) => void> = {}
  let complete = () => {}
  const safe = () => { if (busy) throw new Error('AVPlay called during seek') }
  const player = {
    open: vi.fn(() => { busy = false; state = 'READY' }),
    close: vi.fn(() => { busy = false }), stop: vi.fn(),
    setListener: vi.fn((value) => { listener = value }), setDisplayRect: vi.fn(safe), setDisplayMethod: vi.fn(),
    setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(), getStreamingProperty: vi.fn(() => 'false'),
    prepareAsync: vi.fn((success) => success()),
    getState: vi.fn(() => { safe(); return state }),
    play: vi.fn(() => { safe(); state = 'PLAYING' }), pause: vi.fn(() => { safe(); state = 'PAUSED' }),
    getDuration: vi.fn(() => { safe(); return 100000 }), getCurrentTime: vi.fn(() => { safe(); return 10000 }),
    getTotalTrackInfo: vi.fn(() => { safe(); return [] }),
    seekTo: vi.fn((_target, success) => { safe(); busy = true; complete = () => { busy = false; success() } }),
  }
  const events = { onBuffering: vi.fn(), onBuffered: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks: vi.fn(), onSubtitle: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
  vi.stubGlobal('window', { webapis: { avplay: player }, setTimeout, clearTimeout })
  const controller = new AvPlayController()
  await controller.load({ sessionId: 'seek', url: 'https://video.example/film.mp4', title: 'Film', positionSeconds: 0, subtitles: [], activeTrackIds: [] }, events)
  return { controller, player, events, listener, complete: () => complete() }
}
describe('asynchronous TV seeking', () => {
  it('shows buffering immediately, serializes seeks, and defers native operations until completion', async () => {
    const { controller, player, events, listener, complete } = await setup()
    const first = controller.seek(40)
    await vi.advanceTimersByTimeAsync(0)
    expect(events.onState).toHaveBeenLastCalledWith('buffering')
    expect(events.onBuffering).toHaveBeenLastCalledWith(0)
    controller.pause()
    controller.setDisplayRect(0, 0, 1920, 1080)
    expect(controller.duration()).toBe(100)
    listener.oncurrentplaytime(11000)
    listener.onbufferingcomplete()
    expect(events.onState).toHaveBeenLastCalledWith('buffering')
    expect(events.onBuffered).toHaveBeenLastCalledWith(40, 48)
    const second = controller.seek(60)
    expect(player.seekTo).toHaveBeenCalledTimes(1)
    complete(); await first
    await vi.advanceTimersByTimeAsync(0)
    expect(player.seekTo).toHaveBeenCalledTimes(2)
    complete(); await second
    expect(events.onState).toHaveBeenLastCalledWith('paused')
    expect(events.onTime).toHaveBeenLastCalledWith(60, 100)
    controller.close()
  })
  it('bounds a missing decoder callback and reconnects at the requested position', async () => {
    const { controller, player, events, complete } = await setup()
    const seek = controller.seek(70)
    const failure = expect(seek).rejects.toThrow('Seeking timed out')
    await vi.advanceTimersByTimeAsync(12000)
    await failure
    expect(events.onState).toHaveBeenLastCalledWith('buffering')
    await vi.advanceTimersByTimeAsync(350)
    expect(player.open).toHaveBeenCalledTimes(2)
    expect(player.seekTo).toHaveBeenLastCalledWith(70000, expect.any(Function), expect.any(Function))
    complete(); await vi.advanceTimersByTimeAsync(0)
    expect(events.onState).toHaveBeenLastCalledWith('playing')
    expect(events.onError).not.toHaveBeenCalled()
    controller.close()
  })
  it('does not resurrect playback after closing during recovery', async () => {
    const { controller, player } = await setup()
    const seek = controller.seek(70).catch(() => {})
    await vi.advanceTimersByTimeAsync(12000)
    controller.close()
    await seek
    await vi.advanceTimersByTimeAsync(1000)
    expect(player.open).toHaveBeenCalledTimes(1)
  })
})
