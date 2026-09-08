export interface SubtitleCueStyle { fontFamily?: string; fontSize?: string; fontWeight?: number; fontStyle?: string; color?: string }

export interface SubtitleCue {
  start: number
  end: number
  text: string
  style?: SubtitleCueStyle
}

function timecode(value: string): number {
  const fields = value.trim().replace(',', '.').split(':')
  if (fields.length === 2) fields.unshift('0')
  if (fields.length !== 3) return Number.NaN
  return Number(fields[0]) * 3600 + Number(fields[1]) * 60 + Number(fields[2])
}

export function plainSubtitleText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
    })
    .trim()
}

function timedText(source: string): SubtitleCue[] {
  return source.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split('\n')
    const timingIndex = lines[0]?.includes('-->') ? 0 : 1
    const halves = (lines[timingIndex] || '').split('-->')
    if (halves.length !== 2) return []
    const start = timecode(halves[0])
    const end = timecode(halves[1].trim().split(/\s+/)[0])
    const text = plainSubtitleText(lines.slice(timingIndex + 1).join('\n'))
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && text ? [{ start, end, text }] : []
  })
}

function assText(source: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const styles: Record<string, SubtitleCueStyle> = {}
  let styleFields: string[] = []
  const playResY = Number(source.match(/^PlayResY\s*:\s*(\d+)/im)?.[1]) || 720
  const color = (value: string | undefined) => {
    const hex = value?.replace(/^&H/i, '').replace(/&$/, '').padStart(8, '0')
    return hex && /^[0-9a-f]{8}$/i.test(hex) ? `#${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}` : undefined
  }
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  for (const line of source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')) {
    if (/^Format\s*:/i.test(line)) {
      const next = line.slice(line.indexOf(':') + 1).split(',').map((value) => value.trim().toLowerCase())
      if (next.includes('start') && next.includes('end') && next.includes('text')) fields = next
      else if (next.includes('fontname') && next.includes('name')) styleFields = next
      continue
    }
    if (/^Style\s*:/i.test(line) && styleFields.length) {
      const values = line.slice(line.indexOf(':') + 1).split(',').map(value => value.trim())
      const field = (name: string) => values[styleFields.indexOf(name)]
      const font = field('fontname')?.replace(/["'\\;{}]/g, '').slice(0, 80)
      styles[field('name')] = {
        fontFamily: font ? `"${font === 'Nunito' ? 'Nunito Sans' : font}", "Nunito Sans", sans-serif` : undefined,
        fontSize: Number(field('fontsize')) > 0 ? `${Math.max(1.6, Math.min(6, Number(field('fontsize')) / playResY * 100))}vh` : undefined,
        fontWeight: Number(field('bold')) ? 700 : 400,
        fontStyle: Number(field('italic')) ? 'italic' : 'normal',
        color: color(field('primarycolour')),
      }
      continue
    }
    if (!/^Dialogue\s*:/i.test(line)) continue
    const values = line.slice(line.indexOf(':') + 1).split(',')
    const startIndex = fields.indexOf('start')
    const endIndex = fields.indexOf('end')
    const textIndex = fields.indexOf('text')
    if (startIndex < 0 || endIndex < 0 || textIndex < 0 || values.length <= textIndex) continue
    const start = timecode(values[startIndex])
    const end = timecode(values[endIndex])
    const text = plainSubtitleText(values.slice(textIndex).join(','))
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && text) cues.push({ start, end, text, ...(styles[values[fields.indexOf('style')]?.trim()] ? { style: styles[values[fields.indexOf('style')].trim()] } : {}) })
  }
  return cues
}

function ttmlTime(value: string | undefined): number {
  const raw = value?.trim() ?? ''
  const unit = raw.match(/^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h)$/i)
  if (unit) {
    const amount = Number(unit[1])
    return amount * ({ ms: 0.001, s: 1, m: 60, h: 3600 } as Record<string, number>)[unit[2].toLowerCase()]
  }
  return timecode(raw)
}

function ttmlText(source: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const paragraphs = /<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi
  let paragraph: RegExpExecArray | null
  while ((paragraph = paragraphs.exec(source))) {
    const attributes = paragraph[1]
    const read = (name: string) => attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]
    const start = ttmlTime(read('begin'))
    const declaredEnd = ttmlTime(read('end'))
    const duration = ttmlTime(read('dur'))
    const end = Number.isFinite(declaredEnd) ? declaredEnd : start + duration
    const text = plainSubtitleText(paragraph[2])
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && text) cues.push({ start, end, text })
  }
  return cues
}

export function parseSubtitleText(source: string, contentType = '', url = ''): SubtitleCue[] {
  const cues = /^Dialogue\s*:/im.test(source) || /(?:ass|ssa)/i.test(contentType) || /\.(?:ass|ssa)(?:[?#]|$)/i.test(url)
    ? assText(source)
    : /<tt(?:\s|>)/i.test(source) || /(?:ttml|xml)/i.test(contentType) || /\.(?:ttml|dfxp|xml)(?:[?#]|$)/i.test(url)
      ? ttmlText(source)
      : timedText(source)
  return cues.sort((a, b) => a.start - b.start)
}

export class ExternalSubtitleController {
  private cues: SubtitleCue[] = []
  private key = ''
  private generation = 0
  private pending?: XMLHttpRequest

  async load(url: string, contentType = ''): Promise<void> {
    this.clear()
    const generation = ++this.generation
    this.cues = []
    this.key = ''
    const source = typeof XMLHttpRequest === 'undefined'
      ? await fetch(url).then(response => { if (!response.ok) throw new Error('Subtitle download failed.'); return response.text() })
      : await new Promise<string>((resolve, reject) => {
        const request = new XMLHttpRequest()
        this.pending = request
        request.open('GET', url, true)
        request.timeout = 15_000
        request.onprogress = event => { if (event.loaded > 2 * 1024 * 1024) request.abort() }
        request.onload = () => request.status >= 200 && request.status < 300 && request.responseText.length <= 2 * 1024 * 1024
          ? resolve(request.responseText) : reject(new Error('The subtitle download failed. Try another track.'))
        request.onerror = () => reject(new Error('The subtitle could not be reached.'))
        request.ontimeout = () => reject(new Error('The subtitle download timed out.'))
        request.onabort = () => reject(new Error('Subtitle download cancelled.'))
        request.onloadend = () => { if (this.pending === request) this.pending = undefined }
        request.send(null)
      })
    if (generation !== this.generation) return
    const cues = parseSubtitleText(source, contentType, url)
    if (!cues.length) throw new Error('The subtitle file contains no supported timed cues.')
    if (generation !== this.generation) return
    this.cues = cues
  }

  textAt(positionSeconds: number, delayMs = 0): string {
    const time = positionSeconds - delayMs / 1000
    const active = this.cues.filter((cue) => cue.start <= time && cue.end >= time)
    const key = active.map((cue) => `${cue.start}:${cue.end}`).join('|')
    if (key === this.key && !active.length) return ''
    this.key = key
    return active.map((cue) => cue.text).join('\n')
  }

  styleAt(positionSeconds: number, delayMs = 0): SubtitleCueStyle | undefined {
    const time = positionSeconds - delayMs / 1000
    return this.cues.find(cue => cue.start <= time && cue.end >= time)?.style
  }

  clear(): void {
    this.generation += 1
    this.pending?.abort()
    this.pending = undefined
    this.cues = []
    this.key = ''
  }
}
