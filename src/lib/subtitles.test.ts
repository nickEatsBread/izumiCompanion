import { describe, expect, it, vi } from 'vitest'
import { ExternalSubtitleController, parseSubtitleText } from './subtitles'

describe('TV external subtitle rendering', () => {
  it('parses SRT and WebVTT cues', () => {
    expect(parseSubtitleText('1\n00:00:01,000 --> 00:00:02,500\nHello')).toEqual([
      { start: 1, end: 2.5, text: 'Hello' },
    ])
    expect(parseSubtitleText('WEBVTT\n\n00:03.000 --> 00:04.000 align:center\nWorld', 'text/vtt')).toEqual([
      { start: 3, end: 4, text: 'World' },
    ])
  })

  it('honours ASS event column order instead of assuming a fixed ten-column layout', () => {
    const source = '[Events]\nFormat: Start, End, Style, Text\nDialogue: 0:00:01.50,0:00:03.00,Default,Hello,{\\i1}world'
    expect(parseSubtitleText(source, 'text/x-ssa')).toEqual([
      { start: 1.5, end: 3, text: 'Hello,world' },
    ])
  })

  it('parses TTML clock and duration timings', () => {
    const source = '<?xml version="1.0"?><tt><body><div><p begin="00:00:04.250" dur="1.5s">Hello<br/>TV &amp; friends</p></div></body></tt>'
    expect(parseSubtitleText(source, 'application/ttml+xml')).toEqual([
      { start: 4.25, end: 5.75, text: 'Hello\nTV & friends' },
    ])
  })

  it('rejects files that contain no timed cues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'not subtitles' }))
    await expect(new ExternalSubtitleController().load('https://subs.example/en.srt'))
      .rejects.toThrow('no supported timed cues')
    vi.unstubAllGlobals()
  })
})

it('detects styled dialogue from an extensionless Worker link', () => {
  const source = '[Script Info]\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic\nStyle: Default,Nunito,42,&H00FFFFFF,-1,0\n[Events]\nFormat: Start, End, Style, Text\nDialogue: 0:00:01.00,0:00:03.00,Default,Hello'
  const cue = parseSubtitleText(source, 'text/plain', 'https://worker.example/subtitles?ticket=opaque')[0]
  expect(cue.text).toBe('Hello')
  expect(cue.style).toMatchObject({ fontFamily: '"Nunito Sans", "Nunito Sans", sans-serif', fontWeight: 700, color: '#FFFFFF' })
})
it('aborts an outstanding subtitle download when changing tracks or leaving playback', async () => {
  const requests: any[] = []
  class Request {
    abort = vi.fn(() => this.onabort?.())
    onabort?: () => void
    open() {}
    send() { requests.push(this) }
  }
  vi.stubGlobal('XMLHttpRequest', Request)
  try {
    const controller = new ExternalSubtitleController()
    const pending = controller.load('https://subs.example/first.srt').catch(error => error.message)
    controller.clear()
    expect(requests[0].abort).toHaveBeenCalledOnce()
    expect(await pending).toContain('cancelled')
    expect(controller.textAt(2)).toBe('')
  } finally { vi.unstubAllGlobals() }
})
