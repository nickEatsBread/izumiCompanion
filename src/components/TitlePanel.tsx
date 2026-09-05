import { ArrowDown, ArrowUp, ThumbsDown, ThumbsUp, X } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { CompanionMedia } from '../types'
import type { MediaRating } from '../lib/media-rating'
import type { RemoteAction } from '../lib/remote'
import './TitlePanel.css'

export type TitlePanelKind = 'info' | 'rating'
export const TITLE_PANEL_REMOTE = 'izumi:title-panel-remote'

export function TitlePanel({ kind, media, rating, onRate, onClose }: {
  kind: TitlePanelKind
  media: CompanionMedia
  rating?: MediaRating
  onRate(value: MediaRating): void
  onClose(): void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(kind === 'info' ? 2 : rating === 'down' ? 1 : 0)
  const [scrollState, setScrollState] = useState({ above: false, below: false })
  const updateScrollState = () => {
    const body = bodyRef.current
    if (body) setScrollState({ above: body.scrollTop > 1, below: body.scrollTop + body.clientHeight < body.scrollHeight - 2 })
  }

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-panel-index="${index}"]`)?.focus()
  }, [index])

  useEffect(() => {
    updateScrollState()
    window.addEventListener('resize', updateScrollState)
    return () => window.removeEventListener('resize', updateScrollState)
  }, [media])

  useEffect(() => {
    const onRemote = (event: Event) => {
      const action = (event as CustomEvent<RemoteAction>).detail
      if (action === 'back') return onClose()
      if (kind === 'info') {
        if (action === 'select') onClose()
        else if ((action === 'up' || action === 'down') && bodyRef.current) {
          // Direct scrolling works on the TV's Chromium 56 engine and keeps a few lines of context.
          bodyRef.current.scrollTop += (action === 'up' ? -1 : 1) * bodyRef.current.clientHeight * .65
          updateScrollState()
        }
      } else if (action === 'select') {
        if (index < 2) onRate(index === 0 ? 'up' : 'down')
        else onClose()
      } else if (action === 'left') setIndex(index === 2 ? 1 : 0)
      else if (action === 'right') setIndex(Math.min(2, index + 1))
      else if (action === 'up') setIndex(2)
      else if (action === 'down') setIndex(rating === 'down' ? 1 : 0)
    }
    window.addEventListener(TITLE_PANEL_REMOTE, onRemote)
    return () => window.removeEventListener(TITLE_PANEL_REMOTE, onRemote)
  }, [kind, index, rating, onRate, onClose])

  return <div class="title-panel-backdrop">
    <section
      ref={panelRef}
      class={`title-panel is-${kind}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="title-panel-heading"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        event.preventDefault()
        if (kind === 'rating') setIndex((index + (event.shiftKey ? 2 : 1)) % 3)
      }}
    >
      <header class="title-panel-header">
        <h2 id="title-panel-heading">{kind === 'info' ? 'About this title' : 'Did you like it?'}</h2>
        <button
          type="button"
          class={`title-panel-close${index === 2 ? ' is-focused' : ''}`}
          aria-label="Close and return to title"
          data-panel-index="2"
          onFocus={() => setIndex(2)}
          onMouseEnter={() => setIndex(2)}
          onClick={onClose}
        ><X /></button>
      </header>
      {kind === 'info' ? <>
        <div class="title-panel-body" ref={bodyRef} onScroll={updateScrollState}>
          <h3>{media.title}</h3>
          <p class="title-panel-meta">{[media.subtitle, media.contentRating].filter(Boolean).join(' · ')}</p>
          <p class="title-panel-description">{media.description || 'No description is available for this title yet.'}</p>
          {Boolean(media.genres?.length) && <p class="title-panel-genres">{media.genres!.join(' · ')}</p>}
        </div>
        <footer class="title-panel-footer">
          <span class="title-panel-scroll" aria-label={scrollState.above || scrollState.below ? 'Use Up and Down to scroll the description' : 'Full description visible'}>
            <ArrowUp class={scrollState.above ? 'is-available' : ''} />
            <ArrowDown class={scrollState.below ? 'is-available' : ''} />
            {scrollState.above || scrollState.below ? 'Scroll description' : 'Full description'}
          </span>
          <span>Back to close</span>
        </footer>
      </> : <>
        <p class="title-panel-rating-title">{media.title}</p>
        <div class="title-rating-choices">
          {(['up', 'down'] as const).map((value, choice) => {
            const Icon = value === 'up' ? ThumbsUp : ThumbsDown
            const selected = rating === value
            return <button
              type="button"
              class={`${index === choice ? 'is-focused' : ''}${selected ? ' is-selected' : ''}`}
              data-panel-index={choice}
              aria-pressed={selected}
              onFocus={() => setIndex(choice)}
              onMouseEnter={() => setIndex(choice)}
              onClick={() => onRate(value)}
              key={value}
            >
              <span class="title-rating-icon"><Icon fill={selected ? 'currentColor' : 'none'} /></span>
              <strong>{value === 'up' ? 'I like this' : 'Not for me'}</strong>
              <small>{selected ? 'Select to remove rating' : 'Select to rate'}</small>
            </button>
          })}
        </div>
        <footer class="title-panel-footer"><span>Select your current rating again to remove it.</span></footer>
      </>}
    </section>
  </div>
}
