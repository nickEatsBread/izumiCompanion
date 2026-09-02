import { ChevronDown, ChevronLeft, ChevronRight, History, Info, Play, TrendingUp } from 'lucide-preact'
import { memo } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import wordmark from '../../brand/svg/izumi-wordmark-white.svg'
import {
  finishHeroArtworkTransition,
  initialHeroArtwork,
  queueHeroArtwork,
  revealHeroArtwork,
  type HeroArtworkLayers,
} from '../lib/hero-artwork'
import { TvMotionController } from '../lib/tv-motion'
import { markMotionSettled } from '../lib/tv-performance'
import { horizontalSpacerDimensions, linearWindow } from '../lib/windowing'
import type { CompanionCatalogOption, CompanionHomeSnapshot, CompanionMedia, FocusLocation } from '../types'
import { NavRail } from './NavRail'

interface HomeScreenProps {
  snapshot: CompanionHomeSnapshot
  hero: CompanionMedia
  heroIndex: number
  heroCount: number
  heroDirection: -1 | 1
  focus: FocusLocation
  activeNav: number
  catalogOpen: boolean
  catalogFocus: number
  notice?: string
  onFocus(focus: FocusLocation): void
  onNav(index: number): void
  onPlay(media: CompanionMedia): void
  onOpenSeries(media: CompanionMedia): void
  onDetails(media: CompanionMedia): void
  onHeroStep(direction: -1 | 1): void
  onCatalogFocus(index: number): void
  onCatalogSelect(index: number): void
  onCatalogClose(): void
}

function focusClass(focused: boolean): string {
  return focused ? ' is-focused' : ''
}

function episodeLabel(media: CompanionMedia): string {
  if (!media.episode) return ''
  return media.season ? `S${media.season} E${media.episode}` : `Episode ${media.episode}`
}

function minutesRemaining(media: CompanionMedia): number | undefined {
  if (!media.episodeRuntimeMinutes || !media.episodeProgress) return undefined
  return Math.max(1, Math.ceil(media.episodeRuntimeMinutes * (1 - media.episodeProgress)))
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

export function leadingEdgeFor(focusIndex: number, visibleCardCount: number): number {
  if (focusIndex <= 0) return -1
  return Math.max(0, focusIndex - Math.max(1, visibleCardCount))
}

function rowSpacerDimensions(count: number, continueRow: boolean, topTenRow: boolean): { width: string; minWidth: string } {
  if (continueRow) return horizontalSpacerDimensions(count, 18, 260)
  if (topTenRow) return horizontalSpacerDimensions(count, 15.6, 244)
  return horizontalSpacerDimensions(count, 12.25, 165)
}

function eventIndex(event: Event, attribute: string): number | undefined {
  if (!(event.target instanceof Element) || !(event.currentTarget instanceof Element)) return undefined
  const target = event.target.closest<HTMLElement>(`[${attribute}]`)
  if (!target || !event.currentTarget.contains(target)) return undefined
  const index = Number(target.getAttribute(attribute))
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

function offsetWithin(element: HTMLElement, ancestor: HTMLElement): number {
  let offset = 0
  let current: HTMLElement | null = element
  while (current && current !== ancestor) {
    offset += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }
  return offset
}

/** Memoization makes a horizontal D-pad move update the old tile, the new tile, and at most the
 * two artwork-window edges instead of patching every visible card in all three resident rows. */
const HomeMediaCard = memo(function HomeMediaCard({
  item,
  rowIndex,
  index,
  episodeCard,
  topTenRow,
  focused,
  leadingEdge,
}: {
  item: CompanionMedia
  rowIndex: number
  index: number
  episodeCard: boolean
  topTenRow: boolean
  focused: boolean
  leadingEdge: boolean
}) {
  const cardProgress = episodeCard ? item.episodeProgress : item.progress
  const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
  const itemMinutesRemaining = minutesRemaining(item)
  const image = episodeCard ? item.episodeImage || item.backdrop || item.poster : item.poster
  const rank = topTenRow ? item.placement?.position ?? index + 1 : undefined
  return (
    <button
      type="button"
      class={`media-card${episodeCard ? ' continue-card' : ''}${topTenRow ? ' top-ten-card' : ''}${inProgress ? ' has-progress' : ''}${leadingEdge ? ' is-leading-edge' : ''}${focusClass(focused)}`}
      data-focus-id={`row-${rowIndex}-${index}`}
      data-media-index={index}
      tabIndex={focused ? 0 : -1}
      aria-label={`${rank ? `Number ${rank}, ` : ''}${item.title}${item.episode ? `, episode ${item.episode}` : ''}`}
    >
      {rank && (
        <span class={`top-ten-rank${rank >= 10 ? ' is-double-digit' : ''}`} aria-hidden="true">
          <span class="top-ten-rank-glyph">{rank}</span>
        </span>
      )}
      <span class="media-card-frame">
        {image
          ? <img src={image} alt="" decoding="async" />
          : <span class="media-card-placeholder">{item.title}</span>}
        {episodeCard && (
          <>
            <span class="media-card-fade" />
          <span class="episode-card-copy">
            <small>{item.title}</small>
            <strong>{item.episodeTitle || (item.episode ? `Episode ${item.episode}` : 'Continue watching')}</strong>
            <span class="episode-card-meta">
              {episodeLabel(item) && <b>{episodeLabel(item)}</b>}
              {itemMinutesRemaining && <small>{itemMinutesRemaining} min left</small>}
            </span>
          </span>
          </>
        )}
        {inProgress && (
          <span class="media-progress"><span style={{ width: `${Math.round(cardProgress * 100)}%` }} /></span>
        )}
      </span>
    </button>
  )
})

export function HomeScreen({
  snapshot,
  hero,
  heroIndex,
  heroCount,
  heroDirection,
  focus,
  activeNav,
  catalogOpen,
  catalogFocus,
  notice,
  onFocus,
  onNav,
  onPlay,
  onOpenSeries,
  onDetails,
  onHeroStep,
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
  const heroKey = `${hero.ref.provider}-${hero.ref.id}`
  const heroImage = hero.episodeImage || hero.backdrop || hero.poster
  const heroLayerKey = `${heroKey}-${heroImage ?? 'empty'}`
  const [heroLayers, setHeroLayers] = useState<HeroArtworkLayers>(() => initialHeroArtwork(heroLayerKey, heroImage))
  const heroRevealFrameRef = useRef<number>()
  const heroFadeTimerRef = useRef<number>()
  const homeTrackRef = useRef<HTMLDivElement>(null)
  const motionRef = useRef<TvMotionController>()
  if (!motionRef.current) {
    motionRef.current = new TvMotionController(({ axis, duration, distance }) => {
      markMotionSettled(axis, duration, distance)
    })
  }
  const activeRow = focus.zone === 'row' ? focus.row : 0
  const horizontalCenter = focus.zone === 'row' ? focus.index : 0

  useEffect(() => () => motionRef.current?.dispose(), [])

  useEffect(() => {
    const track = homeTrackRef.current
    const motion = motionRef.current
    if (!track || !motion) return

    if (focus.zone !== 'row') {
      motion.move(track, 'y', 0, { duration: 280 })
      return
    }

    const row = track.querySelector<HTMLElement>(`[data-home-row="${focus.row}"]`)
    if (!row) return
    const viewportHeight = track.parentElement?.clientHeight || window.innerHeight
    const rowTop = offsetWithin(row, track)
    const verticalTarget = -Math.max(0, rowTop - viewportHeight * 0.085)
    motion.move(track, 'y', verticalTarget, { duration: 280 })

    const strip = row.querySelector<HTMLElement>(`[data-motion-row="${focus.row}"]`)
    const viewport = strip?.parentElement
    const focusedRow = snapshot.rows[focus.row]
    const visibleCardCount = focusedRow?.kind === 'continue' ? 4 : focusedRow?.presentation === 'top-10' ? 5 : 6
    const leadingIndex = Math.max(0, focus.index - Math.max(1, visibleCardCount) + 1)
    const leadingCard = strip?.querySelector<HTMLElement>(`[data-media-index="${leadingIndex}"]`)
    if (!strip || !viewport) return
    const maximum = Math.max(0, strip.scrollWidth - viewport.clientWidth)
    const horizontalTarget = leadingCard
      ? Math.min(maximum, Math.max(0, leadingCard.offsetLeft - 8))
      : 0
    motion.move(strip, 'x', -horizontalTarget, { duration: 170 })
  }, [focus, snapshot.rows])

  useEffect(() => {
    if (heroRevealFrameRef.current !== undefined) window.cancelAnimationFrame(heroRevealFrameRef.current)
    if (heroFadeTimerRef.current !== undefined) window.clearTimeout(heroFadeTimerRef.current)
    setHeroLayers((layers) => queueHeroArtwork(layers, heroLayerKey, heroImage))
    if (!heroImage) {
      heroFadeTimerRef.current = window.setTimeout(() => {
        setHeroLayers((layers) => finishHeroArtworkTransition(layers, heroLayerKey))
      }, 200)
    }
    return () => {
      if (heroRevealFrameRef.current !== undefined) window.cancelAnimationFrame(heroRevealFrameRef.current)
      if (heroFadeTimerRef.current !== undefined) window.clearTimeout(heroFadeTimerRef.current)
    }
  }, [heroImage, heroLayerKey])

  const settleHeroArtwork = (key: string) => {
    if (heroRevealFrameRef.current !== undefined) window.cancelAnimationFrame(heroRevealFrameRef.current)
    heroRevealFrameRef.current = window.requestAnimationFrame(() => {
      // Give the newly mounted image one committed opacity:0 frame before beginning the short
      // crossfade. Samsung's older Chromium build otherwise flashes the image at opacity:1.
      setHeroLayers((layers) => revealHeroArtwork(layers, key))
      if (heroFadeTimerRef.current !== undefined) window.clearTimeout(heroFadeTimerRef.current)
      heroFadeTimerRef.current = window.setTimeout(() => {
        setHeroLayers((layers) => finishHeroArtworkTransition(layers, key))
      }, 200)
    })
  }

  return (
    <main class="home-screen">
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
      <section class="hero" aria-label={`Featured: ${hero.title}`}>
        <img class="hero-brand" src={wordmark} alt="Izumi" />
        <div class={`hero-art-stage is-${heroDirection > 0 ? 'next' : 'previous'}`} aria-hidden="true">
          {heroLayers.previous?.image && (
            <img
              class={`hero-backdrop is-departing${heroLayers.current.visible ? '' : ' is-visible'}`}
              src={heroLayers.previous.image}
              alt=""
              decoding="async"
              key={`previous-${heroLayers.previous.key}`}
            />
          )}
          {heroLayers.current.image && (
            <img
              class={`hero-backdrop${heroLayers.previous ? ' is-entering' : ''}${heroLayers.current.visible ? ' is-visible' : ''}`}
              src={heroLayers.current.image}
              alt=""
              decoding="async"
              key={heroLayers.current.key}
              onLoad={() => settleHeroArtwork(heroLayers.current.key)}
              onError={() => settleHeroArtwork(heroLayers.current.key)}
            />
          )}
        </div>
        <div class="hero-shade" />
        <div class={`hero-copy is-${heroDirection > 0 ? 'next' : 'previous'}`} key={`copy-${heroKey}`}>
          <p class="hero-eyebrow"><ReasonIcon size={20} aria-hidden="true" /><span>{reason}</span></p>
          <h1>{hero.title}</h1>
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
        {heroCount > 1 && (
          <div class="hero-carousel-controls" aria-label="Featured titles">
            <button type="button" tabIndex={-1} aria-label="Previous featured title" onClick={() => onHeroStep(-1)}>
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <div class="hero-carousel-pips" aria-hidden="true">
              {Array.from({ length: heroCount }, (_, index) => (
                <span class={index === heroIndex ? 'is-current' : ''} key={index} />
              ))}
            </div>
            <button type="button" tabIndex={-1} aria-label="Next featured title" onClick={() => onHeroStep(1)}>
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </div>
        )}
        {focus.zone === 'hero' && (
          <div class="hero-down-hint" aria-hidden="true">
            <span>Continue watching</span>
            <ChevronDown size={22} />
          </div>
        )}
      </section>

      <div class="catalog-rows">
        {snapshot.rows.map((row, rowIndex) => {
          const topTenRow = row.presentation === 'top-10'
          const continueRow = row.kind === 'continue'
          const rowVisible = Math.abs(rowIndex - activeRow) <= 1
          const horizontalWindow = linearWindow(row.items.length, horizontalCenter, 6)
          const visibleCardCount = continueRow ? 4 : topTenRow ? 5 : 6
          const leadingEdgeIndex = focus.zone === 'row' && focus.row === rowIndex
            ? leadingEdgeFor(focus.index, visibleCardCount)
            : -1
          return (
          <section class={`media-row${continueRow ? ' continue-row' : ''}${topTenRow ? ' top-ten-row' : ''}${rowIndex > activeRow ? ' is-upcoming' : ''}`} key={row.id} data-home-row={rowIndex} aria-labelledby={`row-title-${row.id}`}>
            <h2 id={`row-title-${row.id}`}>{row.title}</h2>
            {!rowVisible
              ? <div class="media-strip-viewport"><div class="media-strip is-placeholder" aria-hidden="true" /></div>
              : <div class="media-strip-viewport"><div
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
                  style={rowSpacerDimensions(horizontalWindow.start, continueRow, topTenRow)}
                  aria-hidden="true"
                  key={`leading-${row.id}`}
                />
              )}
              {row.items.slice(horizontalWindow.start, horizontalWindow.end).map((item, offset) => {
                const index = horizontalWindow.start + offset
                const focused = focus.zone === 'row' && focus.row === rowIndex && focus.index === index
                return (
                  <HomeMediaCard
                    key={`${item.ref.provider}-${item.ref.id}`}
                    item={item}
                    rowIndex={rowIndex}
                    index={index}
                    episodeCard={continueRow}
                    topTenRow={topTenRow}
                    focused={focused}
                    leadingEdge={index === leadingEdgeIndex}
                  />
                )
              })}
              {horizontalWindow.end < row.items.length && (
                <span
                  class="media-card-spacer"
                  style={rowSpacerDimensions(row.items.length - horizontalWindow.end, continueRow, topTenRow)}
                  aria-hidden="true"
                  key={`trailing-${row.id}`}
                />
              )}
            </div></div>}
          </section>
          )
        })}
      </div>
      </div>
      {notice && <div class="toast" role="status">{notice}</div>}
    </main>
  )
}
