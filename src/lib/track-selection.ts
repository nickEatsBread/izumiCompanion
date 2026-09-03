import type { CastTrackPreference, PlaybackTrack } from '../types'

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
  if (/^(?:und|undefined|unknown|none|mul|zxx)$/.test(key)) return ''
  return languageAliases[key] ?? key
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
  const languageLabel = subtitleLanguageNames[key] ?? (key ? key.toUpperCase() : '')
  const cleanTitle = title?.trim()
  const distinctive = cleanTitle && !genericSubtitleTitle.test(cleanTitle) ? cleanTitle : ''
  if (languageLabel && distinctive && !distinctive.toLowerCase().includes(languageLabel.toLowerCase())) {
    return `${languageLabel} · ${distinctive}`
  }
  return languageLabel || distinctive || `Subtitle ${index + 1}`
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
