import { History, Info, Play, TrendingUp } from 'lucide-preact'
import { memo } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import wordmark from '../../brand/svg/izumi-wordmark-white.svg'
import { tvMotionValue } from '../lib/tv-motion'
import { linearWindow } from '../lib/windowing'
import type { CompanionCatalogOption, CompanionHomeSnapshot, CompanionMedia, FocusLocation } from '../types'
import { NavRail } from './NavRail'

interface HomeScreenProps {
  snapshot: CompanionHomeSnapshot
  hero: CompanionMedia
  heroIndex: number
  heroCount: number
  page?: 'home' | 'browse'
  carouselLayout: boolean
  focus: FocusLocation
  activeNav: number
  catalogOpen: boolean
  catalogFocus: number
  notice?: string
  trailerPreview?: { mediaKey: string; url: string }
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

function minutesRemaining(media: CompanionMedia): number | undefined {
  if (!media.episodeRuntimeMinutes || !media.episodeProgress) return undefined
  return Math.max(1, Math.ceil(media.episodeRuntimeMinutes * (1 - media.episodeProgress)))
}

export interface HomeCardContext {
  primary: string
  secondary?: string
  description?: string
}

/** The focused tile owns the context in Netflix's current TV layout. Keeping this projection
 * deterministic also prevents copy from changing midway through the width transition. */
export function homeCardContext(media: CompanionMedia, continueCard: boolean): HomeCardContext {
  if (continueCard) {
    const episode = episodeLabel(media)
    const title = media.episodeTitle?.trim()
    const remaining = minutesRemaining(media)
    return {
      primary: [episode, title].filter(Boolean).join(' · ') || media.title,
      secondary: remaining ? `${remaining}m left` : undefined,
    }
  }

  return {
    primary: informativeHeroMeta(media) || media.placement?.label || media.title,
    description: media.description?.trim(),
  }
}

export function informativeHeroMeta(media: CompanionMedia): string {
  const genericLabels = /^(tv|series|movie|film|anime)$/i
  return [
    ...(media.subtitle?.split('·') ?? []),
    media.contentRating,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && !genericLabels.test(value!))
    .join('  ·  ')
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
export const HOME_FOCUS_WIDTH = HOME_POSTER_WIDTH * 3

function rowSpacerDimensions(count: number, stride = HOME_POSTER_STRIDE): { width: string; minWidth: string } {
  const gap = stride === HOME_CAROUSEL_POSTER_STRIDE ? 16 : 20
  const width = Math.max(0, count * stride - (count ? gap : 0))
  return { width: `${width}px`, minWidth: `${width}px` }
}

export function homeRowTop(rowIndex: number, activeRow: number, browsing: boolean): number {
  if (!browsing) return 24 + rowIndex * 420
  const distance = rowIndex - activeRow
  if (distance <= 0) return 52 + distance * 580
  return distance === 1 ? 824 : 1340 + (distance - 2) * 420
}

export function homeCarouselRowTop(rowIndex: number, activeRow: number, browsing: boolean): number {
  if (!browsing) return 24 + rowIndex * 420
  return 24 + (rowIndex - activeRow) * 420
}

function eventIndex(event: Event, attribute: string): number | undefined {
  if (!(event.target instanceof Element) || !(event.currentTarget instanceof Element)) return undefined
  const target = event.target.closest<HTMLElement>(`[${attribute}]`)
  if (!target || !event.currentTarget.contains(target)) return undefined
  const index = Number(target.getAttribute(attribute))
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

export type HomeFocusMotion = 'forward' | 'backward' | 'vertical' | 'still'

export function homeFocusMotion(previous: FocusLocation, current: FocusLocation): HomeFocusMotion {
  if (previous.zone !== 'row' || current.zone !== 'row') return 'vertical'
  if (previous.row !== current.row) return 'vertical'
  if (previous.index < current.index) return 'forward'
  if (previous.index > current.index) return 'backward'
  return 'still'
}

const railScrollAnimations = new WeakMap<HTMLElement, number>()
const preloadedHomeArtwork: Record<string, boolean> = {}

function focusArtwork(media: CompanionMedia, episodeCard: boolean): string[] {
  return Array.from(new Set([
    episodeCard ? media.episodeImage : media.backdrop,
    media.backdrop,
    media.episodeImage,
    media.poster,
  ].filter((value): value is string => Boolean(value))))
}

function preloadFocusArtwork(media: CompanionMedia, episodeCard: boolean): void {
  const source = focusArtwork(media, episodeCard)[0]
  if (!source || preloadedHomeArtwork[source]) return
  const image = new Image()
  image.onload = () => { preloadedHomeArtwork[source] = true }
  image.src = source
}

function animateRailScroll(element: HTMLElement, target: number, duration = 240): void {
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

function HeroTrailer({ source, title }: { source: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
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
  const start = () => {
    post({ event: 'listening', id: 1, channel: 'widget' })
    post({ event: 'command', func: 'mute', args: [] })
    post({ event: 'command', func: 'playVideo', args: [] })
  }

  useEffect(() => {
    setPlaying(false)
    let attempts = 0
    start()
    const timer = window.setInterval(() => {
      attempts += 1
      start()
      if (attempts >= 40) window.clearInterval(timer)
    }, 150)
    return () => window.clearInterval(timer)
  }, [source])

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
      const state = typeof info === 'object' && info ? Number((info as Record<string, unknown>).playerState) : Number(info ?? payload?.data)
      if ((payload?.event === 'onStateChange' || payload?.event === 'initialDelivery' || payload?.event === 'infoDelivery') && state === 1) setPlaying(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [bridgeOrigin, source])

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
  topTenRow,
  selectedSource,
  focused,
}: {
  item: CompanionMedia
  rowIndex: number
  index: number
  episodeCard: boolean
  topTenRow: boolean
  selectedSource: boolean
  focused: boolean
}) {
  const cardProgress = episodeCard ? item.episodeProgress : item.progress
  const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
  const artwork = Array.from(new Set([
    item.poster,
    episodeCard ? item.episodeImage : item.backdrop,
    item.backdrop,
    item.episodeImage,
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
      class={`home-poster-card${episodeCard ? ' is-continue' : ''}${topTenRow ? ' is-top-ten' : ''}${selectedSource ? ' is-selected-source' : ''}${focused ? ' is-focused' : ''}`}
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
              width={HOME_POSTER_WIDTH}
              height={HOME_POSTER_HEIGHT}
              decoding="async"
              onError={() => setArtworkIndex((current) => current + 1)}
            />
          : <span class="home-card-placeholder">{item.title}</span>}
        {rank && <span class="home-poster-rank" aria-hidden="true">{rank}</span>}
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
  const cardProgress = episodeCard ? item.episodeProgress : item.progress
  const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
  const artwork = focusArtwork(item, episodeCard)
  const artworkKey = artwork.join('|')
  const [artworkIndex, setArtworkIndex] = useState(0)
  const image = artwork[artworkIndex]
  const context = homeCardContext(item, episodeCard)
  const rank = topTenRow ? item.placement?.position ?? index + 1 : undefined

  useEffect(() => {
    setArtworkIndex(0)
  }, [artworkKey])

  return (
    <button
      type="button"
      class={`home-focus-card is-focused motion-${motion}${episodeCard ? ' is-continue' : ''}${topTenRow ? ' is-top-ten' : ''}${index > 0 ? ' has-previous' : ''}`}
      data-focus-id={`row-${rowIndex}-${index}`}
      data-media-index={index}
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
                width={812}
                height={457}
                decoding="async"
                onError={() => {
                  setArtworkIndex((current) => current + 1)
                }}
              />
            : <span class="home-card-placeholder">{item.title}</span>}
          {trailerSource && <HeroTrailer source={trailerSource} title={item.title} />}
        </span>
        <span class="home-focus-shade" aria-hidden="true" />
        <strong class="home-focus-title" key={`title-${item.ref.provider}-${item.ref.type}-${item.ref.id}`}>{item.title}</strong>
        {rank && <span class="home-focus-rank">#{rank} in {item.placement?.label || 'Top 10'}</span>}
        {inProgress && (
          <span class="home-card-progress"><span style={{ width: `${Math.round(cardProgress * 100)}%` }} /></span>
        )}
        <span class="home-focus-outline" aria-hidden="true" />
      </span>
      <span class="home-focus-context" key={`context-${item.ref.provider}-${item.ref.type}-${item.ref.id}`}>
        <strong>{context.primary}</strong>
        {context.secondary && <small>{context.secondary}</small>}
        {!episodeCard && context.description && <small class="home-focus-description">{context.description}</small>}
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
  activeNav,
  catalogOpen,
  catalogFocus,
  notice,
  trailerPreview,
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
  const isContinueHero = hero.placement?.kind === 'continue'
  const ReasonIcon = isContinueHero ? History : TrendingUp
  const heroEpisodeProgress = Math.min(1, Math.max(0, hero.episodeProgress ?? 0))
  const heroMinutesRemaining = minutesRemaining(hero)
  const reason = hero.placement
    ? `${hero.placement.position ? `#${hero.placement.position} in ` : ''}${hero.placement.label}`
    : snapshot.catalog.label
  const heroImage = hero.episodeImage || hero.backdrop || hero.poster
  const heroTrailerSource = trailerPreview?.mediaKey === mediaIdentity(hero) ? trailerPreview.url : undefined
  const homeTrackRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<FocusLocation>(focus)
  const activeRow = focus.zone === 'row' ? focus.row : 0
  const horizontalCenter = focus.zone === 'row' ? focus.index : 0
  const focusMotion = homeFocusMotion(previousFocusRef.current, focus)

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
      if (!strip || !viewport || (!nextCard && !selectedCard)) return
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
    for (let index = Math.max(0, focus.index - 1); index <= Math.min(row.items.length - 1, focus.index + 2); index += 1) {
      preloadFocusArtwork(row.items[index], episodeCard)
    }
  }, [focus, snapshot.rows])

  return (
    <main
      class={`home-screen page-${page} mode-${carouselLayout ? 'carousel' : 'spotlight'}${focus.zone === 'row' ? ' is-browsing' : ''}`}
      aria-label={page === 'browse' ? 'Browse merged catalogue' : 'Home'}
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
        class={`hero${focus.zone === 'row' && !carouselLayout ? ' is-receding' : ''}${focus.zone === 'row' && carouselLayout ? ' is-contextual' : ''}`}
        aria-label={`Featured: ${hero.title}`}
        aria-hidden={focus.zone === 'row' && !carouselLayout}
      >
        <article class="hero-feature-card">
        <img class="hero-brand" src={wordmark} alt="izumi" />
        <HeroArtwork source={heroImage} />
        {carouselLayout && heroTrailerSource && <HeroTrailer source={heroTrailerSource} title={hero.title} />}
        <div class="hero-shade" />
        <div class="hero-copy" key={`${hero.ref.provider}-${hero.ref.type}-${hero.ref.id}`}>
          {hero.logoImage
            ? <img class="hero-title-logo" src={hero.logoImage} alt={hero.title} decoding="async" />
            : <h1>{hero.title}</h1>}
          {isContinueHero && hero.episode && (
            <div class="hero-resume">
              <p><strong>{episodeLabel(hero)}</strong>{hero.episodeTitle && <span>{hero.episodeTitle}</span>}</p>
              <div class="hero-resume-status">
                <span class="hero-resume-track"><span style={{ width: `${Math.round(heroEpisodeProgress * 100)}%` }} /></span>
                <small>{heroMinutesRemaining ? `${heroMinutesRemaining} min left` : `${Math.round(heroEpisodeProgress * 100)}% watched`}</small>
              </div>
            </div>
          )}
          {meta && <p class="hero-meta">{meta}</p>}
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

      <div class={`catalog-rows${focus.zone === 'row' ? carouselLayout ? ' is-carousel-browsing' : ' is-browsing' : ' is-preview'}`}>
        {snapshot.rows.map((row, rowIndex) => {
          const topTenRow = row.presentation === 'top-10'
          const continueRow = row.kind === 'continue'
          const rowVisible = homeRowVisible(rowIndex, activeRow)
          const rowActive = focus.zone === 'row' && rowIndex === activeRow
          const horizontalWindow = linearWindow(
            row.items.length,
            rowIndex === activeRow ? horizontalCenter : 0,
            carouselLayout || focus.zone !== 'row' ? 6 : 4,
          )
          const focusedItem = rowActive && !carouselLayout ? row.items[focus.index] : undefined
          const rowTop = carouselLayout
            ? homeCarouselRowTop(rowIndex, activeRow, focus.zone === 'row')
            : homeRowTop(rowIndex, activeRow, focus.zone === 'row')
          const rowTransform = `translate3d(0, ${rowTop}px, 0)`
          return (
          <section
            class={`media-row${continueRow ? ' continue-row' : ''}${topTenRow ? ' top-ten-row' : ''}${rowActive ? ' is-active' : ''}${rowIndex > activeRow ? ' is-upcoming' : ''}`}
            style={{ transform: rowTransform, WebkitTransform: rowTransform }}
            key={row.id}
            data-home-row={rowIndex}
            aria-labelledby={`row-title-${row.id}`}
          >
            <h2 id={`row-title-${row.id}`}>{row.title}</h2>
            {!rowVisible
              ? <div class="media-strip-viewport"><div class="media-strip is-placeholder" aria-hidden="true" /></div>
              : <div class={`home-row-stage${rowActive ? ' is-active' : ''}`}>
                {!carouselLayout && rowActive && focus.index > 0 && (
                  <div class="home-previous-peek" aria-hidden="true">
                    <HomePosterCard
                      item={row.items[focus.index - 1]}
                      rowIndex={rowIndex}
                      index={focus.index - 1}
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
                    index={focus.index}
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
              {horizontalWindow.start > 0 && (
                <span
                  class="media-card-spacer"
                  style={rowSpacerDimensions(horizontalWindow.start, carouselLayout ? HOME_CAROUSEL_POSTER_STRIDE : HOME_POSTER_STRIDE)}
                  aria-hidden="true"
                  key={`leading-${row.id}`}
                />
              )}
              {row.items.slice(horizontalWindow.start, horizontalWindow.end).map((item, offset) => {
                const index = horizontalWindow.start + offset
                const focusedPoster = carouselLayout && rowActive && focus.index === index
                const selectedSource = !carouselLayout && rowActive && focus.index === index
                return (
                  <HomePosterCard
                    key={`${item.ref.provider}-${item.ref.id}`}
                    item={item}
                    rowIndex={rowIndex}
                    index={index}
                    episodeCard={continueRow}
                    topTenRow={topTenRow}
                    selectedSource={selectedSource}
                    focused={focusedPoster}
                  />
                )
              })}
              {horizontalWindow.end < row.items.length && (
                <span
                  class="media-card-spacer"
                  style={rowSpacerDimensions(row.items.length - horizontalWindow.end, carouselLayout ? HOME_CAROUSEL_POSTER_STRIDE : HOME_POSTER_STRIDE)}
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
