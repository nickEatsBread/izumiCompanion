import { Award, Flame, History, Info, Play, Star, TrendingUp, Trophy, UsersRound } from 'lucide-preact'
import { memo } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import wordmark from '../../brand/svg/izumi-wordmark-white.svg'
import anilistLogo from '../assets/anilist-logo.svg'
import tmdbLogo from '../assets/tmdb-logo.svg'
import {
  focusArtworkSources,
  isHomeImageFailed,
  isHomeImageReady,
  markHomeImageFailed,
  preloadHomeImage,
  preloadHomeMedia,
} from '../lib/home-image-cache'
import { cyclicRailIndexes } from '../lib/home-navigation'
import { tvMotionValue } from '../lib/tv-motion'
import { linearWindow } from '../lib/windowing'
import type { CompanionCatalogOption, CompanionHomeSnapshot, CompanionMedia, FocusLocation } from '../types'
import { NavRail } from './NavRail'

interface HomeScreenProps {
  snapshot: CompanionHomeSnapshot
  hero: CompanionMedia
  heroIndex: number
  heroCount: number
  page?: 'home' | 'browse' | 'series' | 'movies'
  carouselLayout: boolean
  focus: FocusLocation
  returnFocus: FocusLocation
  activeNav: number
  catalogOpen: boolean
  catalogFocus: number
  notice?: string
  trailerPreview?: { mediaKey: string; url: string }
  prefetchMedia: CompanionMedia[]
  onFocus(focus: FocusLocation): void
  onNav(index: number): void
  onPlay(media: CompanionMedia): void
  onOpenSeries(media: CompanionMedia): void
  onDetails(media: CompanionMedia): void
  onCatalogFocus(index: number): void
  onCatalogSelect(index: number): void
  onCatalogClose(): void
}

function episodeLabel(media: CompanionMedia): string {
  if (!media.episode) return ''
  return media.season ? `S${media.season} E${media.episode}` : `Episode ${media.episode}`
}

export function minutesRemaining(media: CompanionMedia): number | undefined {
  const runtime = media.episodeRuntimeMinutes ?? media.runtimeMinutes
  const progress = media.episodeProgress
  if (runtime == null || !Number.isFinite(runtime) || runtime <= 0
    || progress == null || !Number.isFinite(progress) || progress <= 0 || progress >= 1) return undefined
  return Math.max(1, Math.ceil(runtime * (1 - progress)))
}

export interface HomeCardContext {
  facts: string[]
  secondary?: string
}

function runtimeLabel(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${rounded}m`
}

export function mediaFactTokens(media: CompanionMedia): string[] {
  const facts: string[] = [media.mediaKind === 'movie' || media.ref.type === 'movie' ? 'Movie' : 'Show']
  if (media.genres?.[0]) facts.push(media.genres[0])
  if (media.releaseYear) facts.push(String(media.releaseYear))
  const seasons = media.seasonEpisodeCounts?.filter((count) => count > 0) ?? []
  if (media.mediaKind === 'movie' || media.ref.type === 'movie') {
    if (media.runtimeMinutes) facts.push(runtimeLabel(media.runtimeMinutes))
  } else if (seasons.length > 1) facts.push(`${seasons.length} seasons`)
  else if (seasons[0]) facts.push(`${seasons[0]} episode${seasons[0] === 1 ? '' : 's'}`)
  else if (media.runtimeMinutes) facts.push(runtimeLabel(media.runtimeMinutes))

  if (!media.genres?.length && !media.releaseYear && !seasons.length && !media.runtimeMinutes) {
    const genericLabels = /^(tv|series|movie|film|anime|show)$/i
    facts.push(...(media.subtitle?.split('·') ?? [])
      .map((value) => value.trim())
      .filter((value) => value && !genericLabels.test(value)))
  }
  if (media.contentRating) facts.push(media.contentRating)
  return [...new Set(facts)]
}

/** The focused tile owns the context in Netflix's current TV layout. Keeping this projection
 * deterministic also prevents copy from changing midway through the width transition. */
export function homeCardContext(media: CompanionMedia, continueCard: boolean): HomeCardContext {
  if (continueCard) {
    const episode = episodeLabel(media)
    const title = media.episodeTitle?.trim()
    const remaining = minutesRemaining(media)
    return {
      facts: [episode, title].filter((value): value is string => Boolean(value)).length
        ? [episode, title].filter((value): value is string => Boolean(value))
        : [media.title],
      secondary: remaining ? `${remaining}m left` : undefined,
    }
  }

  return { facts: mediaFactTokens(media) }
}

export function informativeHeroMeta(media: CompanionMedia): string {
  return mediaFactTokens(media).filter((fact) => fact !== media.contentRating).join('  ·  ')
}

function FactTokens({ facts, contentRating }: { facts: string[]; contentRating?: string }) {
  return <>{facts.map((fact, index) => fact === contentRating
    ? <CertificationMark value={fact} key={`${fact}-${index}`} />
    : <span key={`${fact}-${index}`}>{fact}</span>)}</>
}

export function achievementIconName(kind: NonNullable<CompanionMedia['achievements']>[number]['kind']): string {
  return ({ trending: 'flame', rating: 'trophy', popularity: 'users', award: 'award', score: 'star' })[kind]
}

function AchievementIcon({ kind }: { kind: NonNullable<CompanionMedia['achievements']>[number]['kind'] }) {
  const Icon = kind === 'trending' ? Flame
    : kind === 'rating' ? Trophy
      : kind === 'popularity' ? UsersRound
        : kind === 'award' ? Award
          : Star
  return <Icon size={21} strokeWidth={2.4} aria-hidden="true" />
}

function AchievementSource({ source }: { source: string }) {
  const normalized = source.trim().toLowerCase()
  return normalized === 'anilist'
    ? <img class="home-achievement-source-logo" src={anilistLogo} alt="AniList" width={22} height={22} />
    : normalized === 'tmdb'
      ? <img class="home-achievement-source-logo is-tmdb" src={tmdbLogo} alt="TMDB" width={47} height={22} />
    : <small>{source}</small>
}

export interface AchievementLabelParts {
  lead?: string
  context: string
}

export function achievementLabelParts(label: string): AchievementLabelParts {
  const value = label.trim()
  const match = /^(#\d+|\d+(?:\.\d+)?%)\s+(.+)$/.exec(value)
  const context = match?.[2] ?? value
  const capitalized = context ? `${context.charAt(0).toUpperCase()}${context.slice(1)}` : ''
  return { lead: match?.[1], context: capitalized }
}

function AchievementCopy({ label }: { label: string }) {
  const copy = achievementLabelParts(label)
  return <>
    {copy.lead && <strong class="home-achievement-lead">{copy.lead}</strong>}
    <span class="home-achievement-context">{copy.context}</span>
  </>
}

type CompanionRating = NonNullable<CompanionMedia['ratings']>[number]

export function ratingDisplayValue(rating: CompanionRating): string {
  if (rating.scale === 100) {
    const value = Math.round(rating.score)
    return rating.source.trim().toLowerCase() === 'metacritic' ? String(value) : `${value}%`
  }
  return rating.score.toFixed(1)
}

export function displayRatings(media: CompanionMedia): CompanionRating[] {
  return (media.ratings ?? [])
    .filter((rating) => Number.isFinite(rating.score) && rating.score >= 0 && rating.score <= rating.scale)
    .slice(0, 3)
}

function RatingSourceMark({ source }: { source: string }) {
  const normalized = source.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (normalized === 'anilist') {
    return <img class="hero-rating-source-logo" src={anilistLogo} alt="" width={26} height={26} />
  }
  if (normalized === 'tmdb') {
    return <img class="hero-rating-source-logo is-tmdb" src={tmdbLogo} alt="" width={54} height={24} />
  }
  const label = normalized === 'rottentomatoes' ? 'RT'
    : normalized === 'metacritic' ? 'M'
      : normalized === 'myanimelist' ? 'MAL'
        : source
  return <span class={`hero-rating-source is-${normalized || 'source'}`}>{label}</span>
}

export interface CertificationPresentation {
  agency: 'bbfc' | 'pegi' | 'mpa' | 'tv' | 'fsk' | 'generic'
  label: string
  className: string
}

/** Turn provider text into a compact, recognizable regional classification mark. Unknown schemes
 * retain a framed neutral treatment rather than being misrepresented as another agency. */
export function certificationPresentation(value: string): CertificationPresentation {
  const label = value.trim().toUpperCase().replace(/\s+/g, ' ')
  const key = label.replace(/[^A-Z0-9]/g, '').toLowerCase()
  if (/^pegi\s*(3|7|12|16|18)$/.test(label.toLowerCase())) {
    const age = label.match(/\d+/)?.[0] ?? label
    return { agency: 'pegi', label: age, className: `is-pegi is-${age}` }
  }
  if (/^(U|PG|12|12A|15|18|R18)$/.test(label)) {
    return { agency: 'bbfc', label, className: `is-bbfc is-${key}` }
  }
  if (/^FSK\s*(0|6|12|16|18)$/.test(label)) {
    return { agency: 'fsk', label: label.replace(/\s+/g, ' '), className: 'is-fsk' }
  }
  if (/^TV[- ]?(Y7|Y|G|PG|14|MA)$/.test(label)) {
    return { agency: 'tv', label: label.replace(' ', '-'), className: 'is-tv' }
  }
  if (/^(G|PG-13|R|NC-17)$/.test(label)) {
    return { agency: 'mpa', label, className: 'is-mpa' }
  }
  return { agency: 'generic', label: label || 'NR', className: 'is-generic' }
}

function CertificationMark({ value }: { value: string }) {
  const mark = certificationPresentation(value)
  return <span class={`media-certification ${mark.className}`} aria-label={`${mark.agency === 'generic' ? 'Content rating' : mark.agency.toUpperCase()} ${mark.label}`}>
    {mark.agency === 'pegi' && <small>PEGI</small>}
    <b>{mark.label}</b>
  </span>
}

export function homeRowVisible(rowIndex: number, activeRow: number): boolean {
  return Math.abs(rowIndex - activeRow) <= 1
}

export const HOME_POSTER_WIDTH = 320
export const HOME_POSTER_HEIGHT = 480
export const HOME_POSTER_STRIDE = 340
export const HOME_CAROUSEL_POSTER_WIDTH = 238
export const HOME_CAROUSEL_POSTER_HEIGHT = 340
export const HOME_CAROUSEL_POSTER_STRIDE = 254
export const HOME_CONTINUE_WIDTH = 416
export const HOME_CONTINUE_HEIGHT = 234
export const HOME_CONTINUE_STRIDE = 432
export const HOME_FOCUS_WIDTH = Math.round(HOME_POSTER_WIDTH * 3.5)

function rowSpacerDimensions(count: number, stride = HOME_POSTER_STRIDE): { width: string; minWidth: string } {
  const gap = stride === HOME_POSTER_STRIDE ? 20 : 16
  const width = Math.max(0, count * stride - (count ? gap : 0))
  return { width: `${width}px`, minWidth: `${width}px` }
}

export function homeRowTop(rowIndex: number, activeRow: number, browsing: boolean): number {
  if (!browsing) return 24 + rowIndex * 420
  const distance = rowIndex - activeRow
  if (distance === 0) return 52
  if (distance < 0) return -900 + (distance + 1) * 420
  return distance === 1 ? 934 : 1454 + (distance - 2) * 420
}

export function homeCarouselRowTop(rowIndex: number, activeRow: number, browsing: boolean, rowHeights?: number[]): number {
  const offset = (index: number) => Array.from({ length: index }, (_, i) => rowHeights?.[i] ?? 420).reduce((sum, height) => sum + height, 0)
  return 24 + offset(rowIndex) - (browsing ? offset(activeRow) : 0)
}

function eventIndex(event: Event, attribute: string): number | undefined {
  if (!(event.target instanceof Element) || !(event.currentTarget instanceof Element)) return undefined
  const target = event.target.closest<HTMLElement>(`[${attribute}]`)
  if (!target || !event.currentTarget.contains(target)) return undefined
  const index = Number(target.getAttribute(attribute))
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

export type HomeFocusMotion = 'forward' | 'backward' | 'vertical' | 'still'

export function homeFocusMotion(previous: FocusLocation, current: FocusLocation, rowLength = 0): HomeFocusMotion {
  if (previous.zone !== 'row' || current.zone !== 'row') return 'vertical'
  if (previous.row !== current.row) return 'vertical'
  if (rowLength > 1 && previous.index === rowLength - 1 && current.index === 0) return 'forward'
  if (previous.index < current.index) return 'forward'
  if (previous.index > current.index) return 'backward'
  return 'still'
}

const railScrollAnimations = new WeakMap<HTMLElement, number>()

function focusArtwork(media: CompanionMedia, episodeCard: boolean): string[] {
  return focusArtworkSources(media, episodeCard)
}

interface StableTitleSelection {
  identity: string
  logo: string
  showText: boolean
}

export function titleFallbackVisible(
  source?: string,
  failed = false,
  ready = true,
): boolean {
  return !source || failed || !ready
}

function initialTitleSelection(
  identity: string,
  source?: string,
): StableTitleSelection {
  const ready = Boolean(source && isHomeImageReady(source, 'title') && !isHomeImageFailed(source, 'title'))
  return {
    identity,
    // A returned URL only proves the metadata reply arrived; it does not prove that the physical
    // TV has downloaded the image. Keep readable copy in the slot until the detached preload has
    // completed, otherwise rapid D-pad navigation suppresses the text with an empty <img> layer.
    logo: ready ? source! : '',
    showText: titleFallbackVisible(source, isHomeImageFailed(source, 'title'), ready),
  }
}

/** A confirmed, preloaded logo receives the image layer. Text is always present otherwise, while a
 * focused spotlight keeps its first readable treatment for the current visit. That avoids blank
 * slots, title skeletons, and late text-to-logo swaps while the viewer is reading the card. */
function useStableTitleImage(
  identity: string,
  source?: string,
  lockFallbackForVisit = false,
): [string, boolean, () => void] {
  const selection = useRef<StableTitleSelection>(initialTitleSelection(identity, source))
  const [, refresh] = useState(0)
  if (selection.current.identity !== identity) selection.current = initialTitleSelection(identity, source)
  const visible = selection.current
  // The physical M56 runtime can paint the new card before it runs the passive effect below.
  // Derive a confirmed no-logo fallback from props in the render itself, so a completed metadata
  // response can never leave the focused card's title slot blank for an extra compositor cycle.
  const showText = visible.showText || !visible.logo
  useEffect(() => {
    if (!source) return
    let active = true
    void preloadHomeImage(source, 'title').then((loaded) => {
      if (!active) return
      const current = selection.current
      if (current.identity !== identity) return
      // Preserve exactly what the first frame displayed, even if decoding completes before the
      // effect runs. Resetting selection in a passive effect caused a late text-to-logo pop.
      if (loaded && !(current.showText && lockFallbackForVisit) && current.logo !== source) {
        selection.current = { ...current, logo: source, showText: false }
        refresh((value) => value + 1)
      } else if (isHomeImageFailed(source, 'title') && current.logo) {
        selection.current = { ...current, logo: '', showText: true }
        refresh((value) => value + 1)
      }
    })
    return () => { active = false }
  }, [identity, lockFallbackForVisit, source])
  return [visible.logo, showText, () => {
    if (visible.logo) markHomeImageFailed(visible.logo, 'title')
    if (selection.current.identity === identity) {
      selection.current = { ...selection.current, logo: '', showText: true }
      refresh((value) => value + 1)
    }
  }]
}

function animateRailScroll(element: HTMLElement, target: number, duration = 160): void {
  const previousFrame = railScrollAnimations.get(element)
  if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame)
  const start = element.scrollLeft
  const distance = target - start
  if (Math.abs(distance) < 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    element.scrollLeft = target
    railScrollAnimations.delete(element)
    return
  }
  const startedAt = performance.now()
  const step = (now: number) => {
    const elapsed = Math.min(duration, Math.max(0, now - startedAt))
    element.scrollLeft = tvMotionValue(start, target, elapsed, duration)
    if (elapsed < duration) railScrollAnimations.set(element, window.requestAnimationFrame(step))
    else railScrollAnimations.delete(element)
  }
  railScrollAnimations.set(element, window.requestAnimationFrame(step))
}

function HeroArtwork({ source }: { source?: string }) {
  const [activeSource, setActiveSource] = useState(source ?? '')

  useEffect(() => {
    if (!source || source === activeSource) return
    const image = new Image()
    image.onload = () => setActiveSource(source)
    image.src = source
    return () => { image.onload = null }
  }, [activeSource, source])

  return (
    <div class="hero-art-stage" aria-hidden="true">
      {activeSource && <img class="hero-backdrop" src={activeSource} alt="" width={1740} height={680} decoding="async" />}
    </div>
  )
}

const trailerLanguageAliases: Record<string, string> = {
  english: 'en', eng: 'en', japanese: 'ja', jpn: 'ja', korean: 'ko', kor: 'ko',
  chinese: 'zh', zho: 'zh', chi: 'zh', spanish: 'es', spa: 'es', french: 'fr', fra: 'fr', fre: 'fr',
}

export function trailerNeedsEnglishCaptions(language?: string): boolean {
  const key = language?.trim().toLowerCase().replace('_', '-').split('-')[0] ?? ''
  if (!key || /^(?:und|unknown|none|mul|zxx)$/.test(key)) return false
  return (trailerLanguageAliases[key] ?? key) !== 'en'
}

function HeroTrailer({ source, title, captions = false, onPlayingChange }: { source: string; title: string; captions?: boolean; onPlayingChange?(playing: boolean): void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hasPlayedRef = useRef(false)
  const captionsConfiguredAtRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const bridgeOrigin = (() => {
    try {
      const url = new URL(source)
      return url.hostname === 'www.youtube.com' || url.hostname === 'www.youtube-nocookie.com' ? '' : url.origin
    } catch { return '' }
  })()
  const post = (payload: Record<string, unknown>) => {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    const serialized = JSON.stringify(payload)
    if (bridgeOrigin) target.postMessage({ type: 'izumi-youtube-command', payload: serialized }, bridgeOrigin)
    else target.postMessage(serialized, 'https://www.youtube-nocookie.com')
  }
  const applyCaptionPreference = (force = false) => {
    const now = Date.now()
    if (!force && now - captionsConfiguredAtRef.current < 1_500) return
    captionsConfiguredAtRef.current = now
    if (captions) {
      post({ event: 'command', func: 'loadModule', args: ['captions'] })
      post({ event: 'command', func: 'setOption', args: ['captions', 'track', { languageCode: 'en' }] })
    } else {
      post({ event: 'command', func: 'setOption', args: ['captions', 'track', {}] })
      post({ event: 'command', func: 'unloadModule', args: ['captions'] })
      post({ event: 'command', func: 'unloadModule', args: ['cc'] })
    }
  }
  const start = () => {
    post({ event: 'listening', id: 1, channel: 'widget' })
    applyCaptionPreference(true)
    post({ event: 'command', func: 'setVolume', args: [100] })
    post({ event: 'command', func: 'unMute', args: [] })
    post({ event: 'command', func: 'playVideo', args: [] })
  }

  useEffect(() => {
    hasPlayedRef.current = false
    setPlaying(false)
    onPlayingChange?.(false)
    let attempts = 0
    start()
    const timer = window.setInterval(() => {
      attempts += 1
      start()
      if (attempts >= 40) window.clearInterval(timer)
    }, 150)
    return () => window.clearInterval(timer)
  }, [captions, source])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (bridgeOrigin && event.origin !== bridgeOrigin) return
      if (!bridgeOrigin && event.origin !== 'https://www.youtube-nocookie.com' && event.origin !== 'https://www.youtube.com') return
      let raw = event.data
      if (bridgeOrigin) {
        if (!raw || raw.type !== 'izumi-youtube-event' || typeof raw.payload !== 'string') return
        raw = raw.payload
      }
      let payload: { event?: string; info?: unknown; data?: unknown }
      try { payload = typeof raw === 'string' ? JSON.parse(raw) : raw }
      catch { return }
      const info = payload?.info
      if (payload?.event === 'onApiChange') applyCaptionPreference(true)
      const state = typeof info === 'object' && info ? Number((info as Record<string, unknown>).playerState) : Number(info ?? payload?.data)
      if ((payload?.event === 'onStateChange' || payload?.event === 'initialDelivery' || payload?.event === 'infoDelivery') && Number.isFinite(state)) {
        if (state === 1) hasPlayedRef.current = true
        const next = state === 1 || (state === 3 && hasPlayedRef.current)
        setPlaying(next)
        onPlayingChange?.(next)
        if (next) {
          applyCaptionPreference()
          post({ event: 'command', func: 'setVolume', args: [100] })
          post({ event: 'command', func: 'unMute', args: [] })
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [bridgeOrigin, captions, source])

  return (
    <iframe
      ref={iframeRef}
      class={`home-hover-trailer${playing ? ' is-playing' : ''}`}
      src={source}
      title={`${title} trailer preview`}
      allow="autoplay; encrypted-media; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      tabIndex={-1}
      onLoad={start}
    />
  )
}

function mediaIdentity(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

/** Poster slots keep one fixed stride. The focused title is drawn in a separate spotlight layer,
 * so moving through a rail does not resize or reflow its neighbours on the TV. */
const HomePosterCard = memo(function HomePosterCard({
  item,
  rowIndex,
  index,
  episodeCard,
  landscape = false,
  topTenRow,
  selectedSource,
  focused,
}: {
  item: CompanionMedia
  rowIndex: number
  index: number
  episodeCard: boolean
  landscape?: boolean
  topTenRow: boolean
  selectedSource: boolean
  focused: boolean
}) {
  const cardProgress = episodeCard ? item.episodeProgress : item.progress
  const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
  const artwork = Array.from(new Set([
    landscape ? item.episodeImage || item.backdrop : item.poster,
    episodeCard ? item.episodeImage : item.backdrop,
    item.backdrop,
    item.episodeImage,
    item.poster,
  ].filter((value): value is string => Boolean(value))))
  const artworkKey = artwork.join('|')
  const [artworkIndex, setArtworkIndex] = useState(0)
  const image = artwork[artworkIndex]
  const rank = topTenRow ? item.placement?.position ?? index + 1 : undefined

  useEffect(() => {
    setArtworkIndex(0)
  }, [artworkKey])

  return (
    <button
      type="button"
      class={`home-poster-card${episodeCard ? ' is-continue' : ''}${landscape ? ' is-landscape' : ''}${topTenRow ? ' is-top-ten' : ''}${selectedSource ? ' is-selected-source' : ''}${focused ? ' is-focused' : ''}`}
      data-focus-id={selectedSource ? undefined : `row-${rowIndex}-${index}`}
      data-media-index={index}
      tabIndex={focused ? 0 : -1}
      aria-current={focused ? 'true' : undefined}
      aria-label={`${rank ? `Number ${rank}, ` : ''}${item.title}${item.episode ? `, episode ${item.episode}` : ''}`}
    >
      <span class="home-poster-frame">
        {image
          ? <img
              class="home-poster-art"
              src={image}
              alt=""
              width={landscape ? HOME_CONTINUE_WIDTH : HOME_POSTER_WIDTH}
              height={landscape ? HOME_CONTINUE_HEIGHT : HOME_POSTER_HEIGHT}
              decoding="async"
              onError={() => setArtworkIndex((current) => current + 1)}
            />
          : <span class="home-card-placeholder">{item.title}</span>}
        {rank && <span class="home-poster-rank" aria-hidden="true">{rank}</span>}
        {landscape && <>
          <span class="continue-card-shade" aria-hidden="true" />
          {minutesRemaining(item) != null && <small class="continue-card-status">{minutesRemaining(item)} min left</small>}
          <span class="continue-card-copy">
            {item.ref.type !== 'movie' && item.mediaKind !== 'movie' && item.episode && <small>{episodeLabel(item)}</small>}
            <strong>{item.title}</strong>
            {item.episodeTitle && <span>{item.episodeTitle}</span>}
          </span>
        </>}
        {inProgress && (
          <span class="home-card-progress"><span style={{ width: `${Math.round(cardProgress * 100)}%` }} /></span>
        )}
      </span>
    </button>
  )
})

const HomeFocusCard = memo(function HomeFocusCard({
  item,
  rowIndex,
  index,
  episodeCard,
  topTenRow,
  motion,
  trailerSource,
  onActivate,
}: {
  item: CompanionMedia
  rowIndex: number
  index: number
  episodeCard: boolean
  topTenRow: boolean
  motion: HomeFocusMotion
  trailerSource?: string
  onActivate(): void
}) {
  const identity = mediaIdentity(item)
  const cardProgress = episodeCard ? item.episodeProgress : item.progress
  const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
  const artwork = focusArtwork(item, episodeCard)
  const artworkKey = artwork.join('|')
  const [artworkSelection, setArtworkSelection] = useState({ identity, index: 0 })
  const artworkIndex = artworkSelection.identity === identity ? artworkSelection.index : 0
  const [trailerState, setTrailerState] = useState({ identity, playing: false })
  const trailerPlaying = trailerState.identity === identity && trailerState.playing
  const setTrailerPlaying = (playing: boolean) => setTrailerState({ identity, playing })
  const [logoImage, , onLogoError] = useStableTitleImage(
    identity,
    item.logoImage,
    true,
  )
  const image = artwork[artworkIndex]
  const context = homeCardContext(item, episodeCard)
  const rank = topTenRow ? item.placement?.position ?? index + 1 : undefined
  const achievements = item.achievements?.slice(0, 2) ?? (item.placement?.position ? [{
    kind: 'popularity' as const,
    label: `#${item.placement.position} ${item.placement.label}`,
    source: item.ref.provider,
  }] : [])

  useEffect(() => {
    setArtworkSelection({ identity, index: 0 })
    setTrailerPlaying(false)
  }, [artworkKey, identity])

  return (
    <button
      type="button"
      class={`home-focus-card is-focused motion-${motion}${episodeCard ? ' is-continue' : ''}${topTenRow ? ' is-top-ten' : ''}${index > 0 ? ' has-previous' : ''}${trailerSource && trailerPlaying ? ' is-trailer-playing' : ''}`}
      data-focus-id={`row-${rowIndex}-${index}`}
      data-media-index={index}
      data-title-treatment={logoImage ? 'logo' : 'text'}
      tabIndex={0}
      aria-label={`${rank ? `Number ${rank}, ` : ''}${item.title}${item.episode ? `, episode ${item.episode}` : ''}`}
      onClick={onActivate}
    >
      <span class="home-focus-frame">
        <span class="home-focus-media" key={`${item.ref.provider}-${item.ref.type}-${item.ref.id}`}>
          {image
            ? <img
                class="home-focus-art"
                key={image}
                src={image}
                alt=""
                width={1112}
                height={626}
                decoding={isHomeImageReady(image, 'artwork') ? 'sync' : 'async'}
                onError={() => {
                  setArtworkSelection((current) => current.identity === identity
                    ? { ...current, index: current.index + 1 }
                    : { identity, index: 1 })
                }}
              />
            : <span class="home-card-placeholder">{item.title}</span>}
        </span>
        {trailerSource && <HeroTrailer source={trailerSource} title={item.title} captions={trailerNeedsEnglishCaptions(item.trailer?.language)} onPlayingChange={setTrailerPlaying} />}
        <span class="home-focus-shade" aria-hidden="true" />
        {logoImage
          ? <img class="home-focus-logo" key={`logo-${identity}`} src={logoImage} alt={item.title} width={460} height={130} decoding="sync" onError={onLogoError} />
          : <strong class="home-focus-title" key={`title-${item.ref.provider}-${item.ref.type}-${item.ref.id}`}>{item.title}</strong>}
        {trailerSource && <span class="home-trailer-footer" aria-hidden="true">
          <span>{item.title}</span>
        </span>}
        {achievements.length > 0 && <span class="home-focus-achievements">
          {achievements.map((achievement, achievementIndex) => <span class={`home-achievement is-${achievement.kind}`} key={`${achievement.kind}-${achievement.label}-${achievementIndex}`}>
            <AchievementIcon kind={achievement.kind} />
            <span><AchievementCopy label={achievement.label} />{achievement.source && <AchievementSource source={achievement.source} />}</span>
          </span>)}
        </span>}
        {inProgress && (
          <span class="home-card-progress"><span style={{ width: `${Math.round(cardProgress * 100)}%` }} /></span>
        )}
        <span class="home-focus-outline" aria-hidden="true" />
      </span>
      <span class="home-focus-context" key={`context-${item.ref.provider}-${item.ref.type}-${item.ref.id}`}>
        <strong class="home-focus-facts"><FactTokens facts={context.facts} contentRating={item.contentRating} /></strong>
        {context.secondary && <small class="home-focus-secondary">{context.secondary}</small>}
        {item.description && <small class="home-focus-description">{item.description}</small>}
      </span>
    </button>
  )
})

export function HomeScreen({
  snapshot,
  hero,
  heroIndex,
  heroCount,
  page = 'home',
  carouselLayout,
  focus,
  returnFocus,
  activeNav,
  catalogOpen,
  catalogFocus,
  notice,
  trailerPreview,
  prefetchMedia,
  onFocus,
  onNav,
  onPlay,
  onOpenSeries,
  onDetails,
  onCatalogFocus,
  onCatalogSelect,
  onCatalogClose,
}: HomeScreenProps) {
  const catalogOptions: CompanionCatalogOption[] = snapshot.catalog.options?.length
    ? snapshot.catalog.options
    : [{ screen: snapshot.catalog.screen, label: snapshot.catalog.label }]
  const meta = informativeHeroMeta(hero)
  const ratings = displayRatings(hero)
  const isContinueHero = hero.placement?.kind === 'continue'
  const ReasonIcon = isContinueHero ? History : TrendingUp
  const heroEpisodeProgress = Math.min(1, Math.max(0, hero.episodeProgress ?? 0))
  const heroMinutesRemaining = minutesRemaining(hero)
  const reason = hero.placement
    ? `${hero.placement.position ? `#${hero.placement.position} in ` : ''}${hero.placement.label}`
    : snapshot.catalog.label
  const heroImage = hero.episodeImage || hero.backdrop || hero.poster
  const heroTrailerSource = trailerPreview?.mediaKey === mediaIdentity(hero) ? trailerPreview.url : undefined
  const [heroTrailerPlaying, setHeroTrailerPlaying] = useState(false)
  const [heroLogoImage, , onHeroLogoError] = useStableTitleImage(mediaIdentity(hero), hero.logoImage)
  const homeTrackRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<FocusLocation>(focus)
  const focusMotionRef = useRef<HomeFocusMotion>('still')
  const presentedFocus = focus.zone === 'row'
    ? focus
    : focus.zone === 'nav' && returnFocus.zone === 'row'
      ? returnFocus
      : undefined
  const browsingRows = Boolean(presentedFocus)
  const activeRow = presentedFocus?.row ?? 0
  const horizontalCenter = presentedFocus?.index ?? 0
  const focusedRowLength = presentedFocus ? snapshot.rows[presentedFocus.row]?.items.length ?? 0 : 0
  let focusMotion: HomeFocusMotion = 'still'
  if (focus.zone === 'row' && previousFocusRef.current.zone !== 'nav') {
    const nextMotion = homeFocusMotion(previousFocusRef.current, focus, focusedRowLength)
    if (nextMotion !== 'still') focusMotionRef.current = nextMotion
    focusMotion = nextMotion === 'still' ? focusMotionRef.current : nextMotion
  } else {
    focusMotionRef.current = 'still'
  }

  useEffect(() => {
    void preloadHomeImage(snapshot.hero?.logoImage, 'title')
    snapshot.rows.slice(0, 2).forEach((row) => row.items.slice(0, 6).forEach((item) => { void preloadHomeImage(item.logoImage, 'title') }))
  }, [snapshot.hero?.logoImage, snapshot.rows])

  useEffect(() => {
    // Resolve title art for all ten likely destinations. Decode only the current/next two large
    // images plus the first landing item above and below; full backdrops are far costlier than logos.
    prefetchMedia.forEach((item, index) => preloadHomeMedia(
      item,
      item.placement?.kind === 'continue',
      index < 3 || index === 6 || index === 8,
    ))
  }, [prefetchMedia])

  useEffect(() => {
    previousFocusRef.current = focus
  }, [focus])

  useEffect(() => {
    const track = homeTrackRef.current
    if (!track || focus.zone !== 'row') return
    const frame = window.requestAnimationFrame(() => {
      const row = track.querySelector<HTMLElement>(`[data-home-row="${focus.row}"]`)
      if (!row) return
      const strip = row.querySelector<HTMLElement>(`[data-motion-row="${focus.row}"]`)
      const viewport = strip?.parentElement as HTMLElement | null
      const nextCard = strip?.querySelector<HTMLElement>(`[data-media-index="${focus.index + 1}"]`)
      const selectedCard = strip?.querySelector<HTMLElement>(`[data-media-index="${focus.index}"]`)
      if (!strip || !viewport) return
      if (strip.getAttribute('data-cyclic') === 'true') {
        const previousFrame = railScrollAnimations.get(viewport)
        if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame)
        railScrollAnimations.delete(viewport)
        viewport.scrollLeft = 0
        return
      }
      if (!nextCard && !selectedCard) return
      const maximum = Math.max(0, strip.scrollWidth - viewport.clientWidth)
      if (carouselLayout && selectedCard) {
        const left = selectedCard.offsetLeft
        const right = left + selectedCard.offsetWidth
        const current = viewport.scrollLeft
        const target = left < current ? left : right > current + viewport.clientWidth ? right - viewport.clientWidth + 24 : current
        animateRailScroll(viewport, Math.min(maximum, Math.max(0, target)))
      } else {
        const target = nextCard || selectedCard!
        animateRailScroll(viewport, Math.min(maximum, Math.max(0, target.offsetLeft + (nextCard ? 0 : HOME_POSTER_STRIDE))))
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [carouselLayout, focus, snapshot.rows])

  useEffect(() => {
    if (focus.zone !== 'row') return
    const row = snapshot.rows[focus.row]
    if (!row) return
    const episodeCard = row.kind === 'continue'
    const warmed = new Set<number>()
    for (let offset = -1; offset <= 5; offset += 1) {
      const index = (focus.index + offset + row.items.length) % row.items.length
      if (!warmed.has(index)) preloadHomeMedia(row.items[index], episodeCard, offset >= -1 && offset <= 2)
      warmed.add(index)
    }
  }, [focus, snapshot.rows])

  return (
    <main
      class={`home-screen page-${page} mode-${carouselLayout ? 'carousel' : 'spotlight'}${browsingRows ? ' is-browsing' : ''}`}
      aria-label={page === 'browse' ? 'Browse merged catalogue' : page === 'series' ? 'Series' : page === 'movies' ? 'Movies' : 'Home'}
    >
      <NavRail
        activeIndex={activeNav}
        focus={focus}
        catalogLabel={snapshot.catalog.label}
        expanded={catalogOpen}
        onFocus={(index) => onFocus({ zone: 'nav', index })}
        onSelect={onNav}
      />

      {catalogOpen && (
        <>
          <button type="button" class="catalog-picker-scrim" aria-label="Close catalogue picker" onClick={onCatalogClose} />
          <section class="catalog-picker" aria-label="Choose catalogue">
            <p>Catalogue</p>
            <h2>Choose what izumi shows</h2>
            <div class="catalog-picker-options">
              {catalogOptions.map((option, index) => {
                const selectedOption = option.screen === snapshot.catalog.screen
                const focusedOption = focus.zone === 'catalog' && catalogFocus === index
                return (
                  <button
                    type="button"
                    class={`${selectedOption ? 'is-selected' : ''}${focusedOption ? ' is-focused' : ''}`}
                    data-focus-id={`catalog-${index}`}
                    tabIndex={focusedOption ? 0 : -1}
                    aria-pressed={selectedOption}
                    onFocus={() => onCatalogFocus(index)}
                    onMouseEnter={() => onCatalogFocus(index)}
                    onClick={() => onCatalogSelect(index)}
                    key={option.screen}
                  >
                    <span>{option.label}</span>
                    {selectedOption && <small>Current</small>}
                  </button>
                )
              })}
            </div>
            <small>The paired izumi client supplies these catalogues.</small>
          </section>
        </>
      )}

      <div class="home-motion-track" ref={homeTrackRef}>
      <section
        class={`hero${browsingRows && !carouselLayout ? ' is-receding' : ''}${browsingRows && carouselLayout ? ' is-contextual' : ''}${carouselLayout && heroTrailerSource && heroTrailerPlaying ? ' is-trailer-playing' : ''}`}
        aria-label={`Featured: ${hero.title}`}
        aria-hidden={browsingRows && !carouselLayout}
      >
        <article class="hero-feature-card">
        <img class="hero-brand" src={wordmark} alt="izumi" />
        <HeroArtwork source={heroImage} />
        {carouselLayout && heroTrailerSource && <HeroTrailer source={heroTrailerSource} title={hero.title} captions={trailerNeedsEnglishCaptions(hero.trailer?.language)} onPlayingChange={setHeroTrailerPlaying} />}
        <div class="hero-shade" />
        <div class="hero-copy" key={`${hero.ref.provider}-${hero.ref.type}-${hero.ref.id}`}>
          {heroLogoImage
            ? <img class="hero-title-logo" src={heroLogoImage} alt={hero.title} decoding="async" onError={onHeroLogoError} />
            : <h1>{hero.title}</h1>}
          {!carouselLayout && isContinueHero && hero.episode && (
            <div class="hero-resume">
              <p><strong>{episodeLabel(hero)}</strong>{hero.episodeTitle && <span>{hero.episodeTitle}</span>}</p>
              <div class="hero-resume-status">
                <span class="hero-resume-track"><span style={{ width: `${Math.round(heroEpisodeProgress * 100)}%` }} /></span>
                <small>{heroMinutesRemaining ? `${heroMinutesRemaining} min left` : `${Math.round(heroEpisodeProgress * 100)}% watched`}</small>
              </div>
            </div>
          )}
          {(meta || hero.contentRating || ratings.length > 0) && <div class="hero-meta-line">
            {carouselLayout
              ? <p class="hero-meta home-focus-facts"><FactTokens facts={mediaFactTokens(hero)} contentRating={hero.contentRating} /></p>
              : <>{meta && <p class="hero-meta">{meta}</p>}{hero.contentRating && <CertificationMark value={hero.contentRating} />}</>}
            {ratings.length > 0 && <div class="hero-ratings" aria-label="Ratings">
              {ratings.map((rating) => <span
                class="hero-rating"
                aria-label={`${rating.source} ${ratingDisplayValue(rating)}`}
                key={`${rating.source}-${rating.score}-${rating.scale}`}
              >
                <RatingSourceMark source={rating.source} />
                <strong>{ratingDisplayValue(rating)}</strong>
              </span>)}
            </div>}
          </div>}
          {carouselLayout && heroMinutesRemaining != null && <p class="hero-time-left">
            {heroMinutesRemaining} {heroMinutesRemaining === 1 ? 'minute' : 'minutes'} left
          </p>}
          {hero.description && <p class="hero-description">{hero.description}</p>}
          {focus.zone === 'hero' && <div class="hero-actions">
            <button
              type="button"
              class="hero-button primary is-focused"
              data-focus-id={`hero-${heroIndex}`}
              tabIndex={0}
              onFocus={() => onFocus({ zone: 'hero', index: heroIndex })}
              onMouseEnter={() => onFocus({ zone: 'hero', index: heroIndex })}
              onClick={() => onPlay(hero)}
            >
              <Play size={25} fill="currentColor" aria-hidden="true" />
              {hero.progress ? 'Resume' : 'Play'}
            </button>
            <button
              type="button"
              class="hero-button secondary"
              tabIndex={-1}
              onClick={() => onDetails(hero)}
            >
              <Info size={25} aria-hidden="true" />
              More Info
            </button>
          </div>}
        </div>
        <p class="hero-rank-context"><ReasonIcon size={24} aria-hidden="true" /><span>{reason}</span></p>
        {heroCount > 1 && focus.zone === 'hero' && (
          <div class="hero-carousel-status" aria-hidden="true">
            <div class="hero-carousel-pips">
              {Array.from({ length: heroCount }, (_, index) => (
                <i class={index === heroIndex ? 'is-current' : ''} key={index} />
              ))}
            </div>
          </div>
        )}
        </article>
      </section>

      <div class={`catalog-rows${browsingRows ? carouselLayout ? ' is-carousel-browsing' : ' is-browsing' : ' is-preview'}`}>
        {snapshot.rows.map((row, rowIndex) => {
          const topTenRow = row.presentation === 'top-10'
          const continueRow = row.kind === 'continue'
          const rowStride = carouselLayout ? continueRow ? HOME_CONTINUE_STRIDE : HOME_CAROUSEL_POSTER_STRIDE : HOME_POSTER_STRIDE
          const rowVisible = homeRowVisible(rowIndex, activeRow)
          const rowActive = browsingRows && rowIndex === activeRow
          const horizontalWindow = linearWindow(
            row.items.length,
            rowIndex === activeRow ? horizontalCenter : 0,
            carouselLayout || !browsingRows ? 6 : 4,
          )
          const cyclicIndexes = rowActive
            ? cyclicRailIndexes(
                row.items.length,
                carouselLayout ? horizontalCenter : horizontalCenter + 1,
                carouselLayout ? 8 : Math.min(4, Math.max(0, row.items.length - 1)),
              )
            : []
          const renderedIndexes = rowActive
            ? cyclicIndexes
            : Array.from(
                { length: Math.max(0, horizontalWindow.end - horizontalWindow.start) },
                (_, offset) => horizontalWindow.start + offset,
              )
          const focusedItem = rowActive && !carouselLayout ? row.items[horizontalCenter] : undefined
          const rowTop = carouselLayout
            ? homeCarouselRowTop(rowIndex, activeRow, browsingRows, snapshot.rows.map((item) => item.kind === 'continue' ? 322 : 420))
            : homeRowTop(rowIndex, activeRow, browsingRows)
          return (
          <section
            class={`media-row${continueRow ? ' continue-row' : ''}${topTenRow ? ' top-ten-row' : ''}${rowActive ? ' is-active' : ''}${rowIndex > activeRow ? ' is-upcoming' : ''}${rowIndex < activeRow ? ' is-past' : ''}`}
            style={{ top: `${rowTop}px`, transform: 'none', WebkitTransform: 'none' }}
            key={row.id}
            data-home-row={rowIndex}
            aria-labelledby={`row-title-${row.id}`}
          >
            <h2 id={`row-title-${row.id}`}>{row.title}</h2>
            {!rowVisible
              ? <div class="media-strip-viewport"><div class="media-strip is-placeholder" aria-hidden="true" /></div>
              : <div class={`home-row-stage${rowActive ? ' is-active' : ''}`}>
                {!carouselLayout && rowActive && row.items.length > 1 && (
                  <div class="home-previous-peek" aria-hidden="true">
                    <HomePosterCard
                      item={row.items[(horizontalCenter - 1 + row.items.length) % row.items.length]}
                      rowIndex={rowIndex}
                      index={(horizontalCenter - 1 + row.items.length) % row.items.length}
                      episodeCard={continueRow}
                      topTenRow={topTenRow}
                      selectedSource={false}
                      focused={false}
                    />
                  </div>
                )}
                {focusedItem && (
                  <HomeFocusCard
                    item={focusedItem}
                    rowIndex={rowIndex}
                    index={horizontalCenter}
                    episodeCard={continueRow}
                    topTenRow={topTenRow}
                    motion={focusMotion}
                    trailerSource={trailerPreview?.mediaKey === mediaIdentity(focusedItem) ? trailerPreview.url : undefined}
                    onActivate={() => (continueRow ? onPlay : onOpenSeries)(focusedItem)}
                  />
                )}
                <div class="media-strip-viewport"><div
                  class="media-strip"
                  data-motion-row={rowIndex}
                  data-cyclic={rowActive ? 'true' : undefined}
                  onFocusCapture={(event) => {
                    const index = eventIndex(event, 'data-media-index')
                    if (index !== undefined) onFocus({ zone: 'row', row: rowIndex, index })
                  }}
                  onMouseOver={(event) => {
                    const index = eventIndex(event, 'data-media-index')
                    if (index !== undefined) onFocus({ zone: 'row', row: rowIndex, index })
                  }}
                  onClick={(event) => {
                    const index = eventIndex(event, 'data-media-index')
                    const item = index === undefined ? undefined : row.items[index]
                    if (item) (row.kind === 'continue' ? onPlay : onOpenSeries)(item)
                  }}
                >
              {!rowActive && horizontalWindow.start > 0 && (
                <span
                  class="media-card-spacer"
                  style={rowSpacerDimensions(horizontalWindow.start, rowStride)}
                  aria-hidden="true"
                  key={`leading-${row.id}`}
                />
              )}
              {renderedIndexes.map((index) => {
                const item = row.items[index]
                const focusedPoster = carouselLayout && rowActive && horizontalCenter === index
                const selectedSource = !carouselLayout && rowActive && horizontalCenter === index
                return (
                  <HomePosterCard
                    key={`${item.ref.provider}-${item.ref.id}`}
                    item={item}
                    rowIndex={rowIndex}
                    index={index}
                    episodeCard={continueRow}
                    landscape={carouselLayout && continueRow}
                    topTenRow={topTenRow}
                    selectedSource={selectedSource}
                    focused={focusedPoster}
                  />
                )
              })}
              {!rowActive && horizontalWindow.end < row.items.length && (
                <span
                  class="media-card-spacer"
                  style={rowSpacerDimensions(row.items.length - horizontalWindow.end, rowStride)}
                  aria-hidden="true"
                  key={`trailing-${row.id}`}
                />
              )}
            </div></div></div>}
          </section>
          )
        })}
      </div>
      </div>
      {notice && <div class="toast" role="status">{notice}</div>}
    </main>
  )
}
