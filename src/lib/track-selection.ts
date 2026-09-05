import { LANGUAGE_DATA, playbackLanguageName } from '../shared/languages'
import type { CastTrackHints, CastTrackPreference, PlaybackTrack } from '../types'

const languageAliases: Record<string, string> = {
  eng: 'en',
  jpn: 'ja',
  spa: 'es',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  ita: 'it',
  por: 'pt',
}

export function trackLanguageKey(value: string | undefined): string {
  const key = value?.trim().toLowerCase().replace('_', '-').split('-')[0] ?? ''
  if (!key) return ''
  if (/^(?:und|undefined|unknown|none|mul|zxx)$/.test(key)) return ''
  const language = LANGUAGE_DATA.find(row => row.code === key || row.terminology === key || row.iso1 === key)
  return language?.iso1 || language?.code || languageAliases[key] || key
}

const textKey = (value: string | undefined) => value?.trim().toLowerCase() ?? ''

const subtitleLanguageNames: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  ru: 'Russian',
  hi: 'Hindi',
}

const genericSubtitleTitle = /^(?:full[\s_-]*subtitles?|subtitles?(?:[\s_-]*\d+)?|subtitle[\s_-]*track(?:[\s_-]*\d+)?|regular|default|track[\s_-]*\d+|subrip|srt|ass|ssa|und(?:efined)?|unknown)$/i

export function subtitleTrackLabel(
  title: string | undefined,
  language: string | undefined,
  index: number,
): string {
  const key = trackLanguageKey(language)
  const languageLabel = subtitleLanguageNames[key] ?? (key ? playbackLanguageName(key) : '')
  const cleanTitle = title?.trim()
  const distinctive = cleanTitle && !genericSubtitleTitle.test(cleanTitle) ? cleanTitle : ''
  if (languageLabel && distinctive && !distinctive.toLowerCase().includes(languageLabel.toLowerCase())) {
    return `${languageLabel} · ${distinctive}`
  }
  return languageLabel || distinctive || `Subtitle ${index + 1}`
}

/** Samsung can preserve the stream indexes while dropping embedded subtitle names. Reconcile the
 * sender's bounded metadata by language/codec first, then by stable subtitle order. */
export function applyTrackHints(
  tracks: PlaybackTrack[],
  hints: CastTrackHints | undefined,
): PlaybackTrack[] {
  const available = (hints?.subtitles ?? []).map((hint, index) => ({ hint, index }))
  if (!available.length) return tracks
  const used = new Set<number>()
  return tracks.map((track) => {
    if (track.type !== 'TEXT') return track
    const language = trackLanguageKey(track.language)
    const codec = textKey(track.codec).replace(/[-_]/g, '')
    let best: { index: number; score: number } | undefined
    for (const candidate of available) {
      if (used.has(candidate.index)) continue
      let score = 0
      if (language && trackLanguageKey(candidate.hint.language) === language) score += 8
      const hintedCodec = textKey(candidate.hint.codec).replace(/[-_]/g, '')
      if (codec && hintedCodec === codec) score += 2
      if (!best || score > best.score) best = { index: candidate.index, score }
    }
    const chosen = best && best.score > 0
      ? best.index
      : available.find((candidate) => !used.has(candidate.index))?.index
    if (chosen === undefined) return track
    used.add(chosen)
    const hint = available[chosen].hint
    return {
      ...track,
      label: hint.label.trim() || subtitleTrackLabel(hint.title, hint.language, chosen),
      language: track.language || hint.language,
      codec: track.codec || hint.codec,
    }
  })
}

/** Receiver track indexes are unrelated to mpv's indexes. Match descriptive sender metadata and
 * require at least one positive field so an empty preference never enables a random subtitle. */
export function preferredTrack(
  tracks: PlaybackTrack[],
  preference: CastTrackPreference | undefined,
): PlaybackTrack | undefined {
  if (!preference) return undefined
  const wantedLanguage = trackLanguageKey(preference.language)
  const wantedTitle = textKey(preference.title)
  const wantedCodec = textKey(preference.codec).replace(/[-_]/g, '')
  let best: { track: PlaybackTrack; score: number } | undefined
  for (const track of tracks) {
    let score = 0
    if (wantedLanguage && trackLanguageKey(track.language) === wantedLanguage) score += 8
    const title = textKey(track.label)
    if (wantedTitle && (title === wantedTitle || title.includes(wantedTitle) || wantedTitle.includes(title))) score += 4
    const codec = textKey(track.codec).replace(/[-_]/g, '')
    if (wantedCodec && (codec === wantedCodec || title.replace(/[-_]/g, '').includes(wantedCodec))) score += 2
    if (score > (best?.score ?? 0)) best = { track, score }
  }
  return best?.track
}
