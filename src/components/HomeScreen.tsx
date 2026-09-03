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

function rowSpacerDimensions(count: number): { width: string; minWidth: string } {
  const width = Math.max(0, count * 244 - (count ? 16 : 0))
  return { width: `${width}px`, minWidth: `${width}px` }
}

export function homeRowTop(rowIndex: number, activeRow: number, browsing: boolean): number {
  if (!browsing) return 24 + rowIndex * 360
  const distance = rowIndex - activeRow
  if (distance <= 0) return 52 + distance * 440
  return distance === 1 ? 638 : 1120 + (distance - 2) * 344
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
  const [incomingSource, setIncomingSource] = useState('')
  const [incomingReady, setIncomingReady] = useState(false)
  const transitionTimerRef = useRef<number>()

  useEffect(() => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current)
    setIncomingReady(false)
    setIncomingSource(source && source !== activeSource ? source : '')
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current)
    }
  }, [activeSource, source])

  const revealIncoming = (nextSource: string) => {
    if (nextSource !== incomingSource) return
    setIncomingReady(true)
    transitionTimerRef.current = window.setTimeout(() => {
      setActiveSource(nextSource)
      setIncomingSource('')
      setIncomingReady(false)
    }, 380)
  }

  return (
    <div class="hero-art-stage" aria-hidden="true">
      {activeSource && <img class="hero-backdrop" src={activeSource} alt="" width={1740} height={680} decoding="async" />}
      {incomingSource && (
        <img
          class={`hero-backdrop is-incoming${incomingReady ? ' is-ready' : ''}`}
          key={incomingSource}
          src={incomingSource}
          alt=""
          width={1740}
          height={680}
          decoding="async"
          onLoad={() => revealIncoming(incomingSource)}
          onError={() => setIncomingSource('')}
        />
      )}
    </div>
  )
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
}: {
  item: CompanionMedia
  rowIndex: number
  index: number
  episodeCard: boolean
  topTenRow: boolean
  selectedSource: boolean
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
      class={`home-poster-card${episodeCard ? ' is-continue' : ''}${topTenRow ? ' is-top-ten' : ''}${selectedSource ? ' is-selected-source' : ''}`}
      data-focus-id={selectedSource ? undefined : `row-${rowIndex}-${index}`}
      data-media-index={index}
      tabIndex={-1}
      aria-label={`${rank ? `Number ${rank}, ` : ''}${item.title}${item.episode ? `, episode ${item.episode}` : ''}`}
    >
      <span class="home-poster-frame">
        {image
          ? <img
              class="home-poster-art"
              src={image}
              alt=""
              width={228}
              height={342}
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
  onActivate,
}: {
  item: CompanionMedia
  rowIndex: number
  index: number
  episodeCard: boolean
  topTenRow: boolean
  motion: HomeFocusMotion
  onActivate(): void
}) {
  const cardProgress = episodeCard ? item.episodeProgress : item.progress
  const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
  const artwork = Array.from(new Set([
    episodeCard ? item.episodeImage : item.backdrop,
    item.backdrop,
    item.episodeImage,
    item.poster,
  ].filter((value): value is string => Boolean(value))))
  const artworkKey = artwork.join('|')
  const [artworkIndex, setArtworkIndex] = useState(0)
  const image = artwork[artworkIndex]
  const baseImage = item.poster || image
  const [loadedArtwork, setLoadedArtwork] = useState('')
  const context = homeCardContext(item, episodeCard)
  const rank = topTenRow ? item.placement?.position ?? index + 1 : undefined

  useEffect(() => {
    setArtworkIndex(0)
    setLoadedArtwork('')
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
        {baseImage && <img class="home-focus-base-art" src={baseImage} alt="" width={700} height={394} decoding="async" />}
        {image
          ? <img
              class={`home-focus-art${loadedArtwork === image ? ' is-ready' : ''}`}
              key={image}
              src={image}
              alt=""
              width={700}
              height={394}
              decoding="async"
              onLoad={() => setLoadedArtwork(image)}
              onError={() => {
                setLoadedArtwork('')
                setArtworkIndex((current) => current + 1)
              }}
            />
          : <span class="home-card-placeholder">{item.title}</span>}
        <span class="home-focus-shade" aria-hidden="true" />
        <strong class="home-focus-title">{item.title}</strong>
        {rank && <span class="home-focus-rank">#{rank} in {item.placement?.label || 'Top 10'}</span>}
        {inProgress && (
          <span class="home-card-progress"><span style={{ width: `${Math.round(cardProgress * 100)}%` }} /></span>
        )}
      </span>
      <span class="home-focus-context">
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
      const target = nextCard || selectedCard!
      const maximum = Math.max(0, strip.scrollWidth - viewport.clientWidth)
      animateRailScroll(viewport, Math.min(maximum, Math.max(0, target.offsetLeft + (nextCard ? 0 : 244))))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focus, snapshot.rows])

  return (
    <main class={`home-screen${focus.zone === 'row' ? ' is-browsing' : ''}`}>
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
      <section class={`hero${focus.zone === 'row' ? ' is-receding' : ''}`} aria-label={`Featured: ${hero.title}`} aria-hidden={focus.zone === 'row'}>
        <article class="hero-feature-card">
        <img class="hero-brand" src={wordmark} alt="Izumi" />
        <HeroArtwork source={heroImage} />
        <div class="hero-shade" />
        <div class="hero-copy" key={`${hero.ref.provider}-${hero.ref.type}-${hero.ref.id}`}>
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
          <div class="hero-carousel-pips" aria-hidden="true">
            {Array.from({ length: heroCount }, (_, index) => (
              <span class={index === heroIndex ? 'is-current' : ''} key={index} />
            ))}
          </div>
        )}
        </article>
      </section>

      <div class={`catalog-rows${focus.zone === 'row' ? ' is-browsing' : ' is-preview'}`}>
        {snapshot.rows.map((row, rowIndex) => {
          const topTenRow = row.presentation === 'top-10'
          const continueRow = row.kind === 'continue'
          const rowVisible = homeRowVisible(rowIndex, activeRow)
          const rowActive = focus.zone === 'row' && rowIndex === activeRow
          const horizontalWindow = linearWindow(
            row.items.length,
            rowIndex === activeRow ? horizontalCenter : 0,
            4,
          )
          const focusedItem = rowActive ? row.items[focus.index] : undefined
          const rowTransform = `translate3d(0, ${homeRowTop(rowIndex, activeRow, focus.zone === 'row')}px, 0)`
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
                {rowActive && focus.index > 0 && (
                  <div class="home-previous-peek" aria-hidden="true">
                    <HomePosterCard
                      item={row.items[focus.index - 1]}
                      rowIndex={rowIndex}
                      index={focus.index - 1}
                      episodeCard={continueRow}
                      topTenRow={topTenRow}
                      selectedSource={false}
                    />
                  </div>
                )}
                {focusedItem && (
                  <HomeFocusCard
                    key={`${focusedItem.ref.provider}-${focusedItem.ref.type}-${focusedItem.ref.id}`}
                    item={focusedItem}
                    rowIndex={rowIndex}
                    index={focus.index}
                    episodeCard={continueRow}
                    topTenRow={topTenRow}
                    motion={focusMotion}
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
                  style={rowSpacerDimensions(horizontalWindow.start)}
                  aria-hidden="true"
                  key={`leading-${row.id}`}
                />
              )}
              {row.items.slice(horizontalWindow.start, horizontalWindow.end).map((item, offset) => {
                const index = horizontalWindow.start + offset
                const selectedSource = rowActive && focus.index === index
                return (
                  <HomePosterCard
                    key={`${item.ref.provider}-${item.ref.id}`}
                    item={item}
                    rowIndex={rowIndex}
                    index={index}
                    episodeCard={continueRow}
                    topTenRow={topTenRow}
                    selectedSource={selectedSource}
                  />
                )
              })}
              {horizontalWindow.end < row.items.length && (
                <span
                  class="media-card-spacer"
                  style={rowSpacerDimensions(row.items.length - horizontalWindow.end)}
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
