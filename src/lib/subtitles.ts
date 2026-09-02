export interface SubtitleCue {
  start: number
  end: number
  text: string
}

function timecode(value: string): number {
  const fields = value.trim().replace(',', '.').split(':')
  if (fields.length === 2) fields.unshift('0')
  if (fields.length !== 3) return Number.NaN
  return Number(fields[0]) * 3600 + Number(fields[1]) * 60 + Number(fields[2])
}

function plainText(value: string): string {
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
    const text = plainText(lines.slice(timingIndex + 1).join('\n'))
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && text ? [{ start, end, text }] : []
  })
}

function assText(source: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  for (const line of source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')) {
    if (/^Format\s*:/i.test(line)) {
      const next = line.slice(line.indexOf(':') + 1).split(',').map((value) => value.trim().toLowerCase())
      if (next.includes('start') && next.includes('end') && next.includes('text')) fields = next
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
    const text = plainText(values.slice(textIndex).join(','))
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && text) cues.push({ start, end, text })
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
    const text = plainText(paragraph[2])
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && text) cues.push({ start, end, text })
  }
  return cues
}

export function parseSubtitleText(source: string, contentType = '', url = ''): SubtitleCue[] {
  const cues = /(?:ass|ssa)/i.test(contentType) || /\.(?:ass|ssa)(?:[?#]|$)/i.test(url)
    ? assText(source)
    : /(?:ttml|xml)/i.test(contentType) || /\.(?:ttml|dfxp|xml)(?:[?#]|$)/i.test(url)
      ? ttmlText(source)
      : timedText(source)
  return cues.sort((a, b) => a.start - b.start)
}

export class ExternalSubtitleController {
  private cues: SubtitleCue[] = []
  private key = ''
  private generation = 0

  async load(url: string, contentType = ''): Promise<void> {
    const generation = ++this.generation
    this.cues = []
    this.key = ''
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Subtitle download failed (${response.status})`)
    const source = await response.text()
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

  clear(): void {
    this.generation += 1
    this.cues = []
    this.key = ''
  }
}
