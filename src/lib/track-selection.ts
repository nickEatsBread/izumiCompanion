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
  return languageAliases[key] ?? key
}

const textKey = (value: string | undefined) => value?.trim().toLowerCase() ?? ''

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
