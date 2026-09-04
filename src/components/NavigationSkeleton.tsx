import type { ScreenName } from '../types'

function Blocks({ count, className }: { count: number; className: string }) {
  return <>{Array.from({ length: count }, (_, index) => <i class={`skeleton-block ${className}`} key={index} />)}</>
}

export function NavigationSkeleton({ screen, leaving }: { screen: ScreenName; leaving: boolean }) {
  const shellClass = `navigation-skeleton skeleton-${screen}${leaving ? ' is-leaving' : ''}`

  if (screen === 'search') return (
    <section class={shellClass} aria-label="Loading search" aria-live="polite" aria-busy="true">
      <div class="skeleton-search-entry" aria-hidden="true">
        <div class="skeleton-key-actions"><Blocks count={3} className="skeleton-key-action" /></div>
        <div class="skeleton-key-grid"><Blocks count={36} className="skeleton-key" /></div>
        <i class="skeleton-block skeleton-small-heading" />
        <div class="skeleton-suggestion-list"><Blocks count={6} className="skeleton-suggestion" /></div>
      </div>
      <div class="skeleton-search-results" aria-hidden="true">
        <i class="skeleton-block skeleton-search-field" />
        <i class="skeleton-block skeleton-result-heading" />
        <div class="skeleton-result-grid"><Blocks count={8} className="skeleton-result-card" /></div>
      </div>
    </section>
  )

  if (screen === 'settings') return (
    <section class={shellClass} aria-label="Loading settings" aria-live="polite" aria-busy="true">
      <div class="skeleton-settings-heading" aria-hidden="true">
        <i class="skeleton-block skeleton-small-heading" />
        <i class="skeleton-block skeleton-page-title" />
        <i class="skeleton-block skeleton-copy-line" />
      </div>
      <div class="skeleton-settings-list" aria-hidden="true">
        <Blocks count={8} className="skeleton-setting-row" />
        <i class="skeleton-block skeleton-device-row" />
      </div>
    </section>
  )

  if (screen === 'series') return (
    <section class={shellClass} aria-label="Loading series" aria-live="polite" aria-busy="true">
      <i class="skeleton-block skeleton-series-art" aria-hidden="true" />
      <div class="skeleton-series-copy" aria-hidden="true">
        <i class="skeleton-block skeleton-small-heading" />
        <i class="skeleton-block skeleton-series-title" />
        <i class="skeleton-block skeleton-copy-line" />
        <i class="skeleton-block skeleton-copy-line is-short" />
        <div class="skeleton-series-actions"><Blocks count={3} className="skeleton-action" /></div>
      </div>
      <div class="skeleton-episode-list" aria-hidden="true"><Blocks count={3} className="skeleton-episode-row" /></div>
    </section>
  )

  if (screen === 'my-list') return (
    <section class={shellClass} aria-label="Loading catalogue" aria-live="polite" aria-busy="true">
      <i class="skeleton-block skeleton-catalog-art" aria-hidden="true" />
      <div class="skeleton-catalog-copy" aria-hidden="true">
        <i class="skeleton-block skeleton-small-heading" />
        <i class="skeleton-block skeleton-page-title" />
        <i class="skeleton-block skeleton-copy-line" />
        <i class="skeleton-block skeleton-copy-line is-short" />
      </div>
      <div class="skeleton-catalog-grid" aria-hidden="true"><Blocks count={12} className="skeleton-catalog-card" /></div>
    </section>
  )

  return (
    <section class={shellClass} aria-label={screen === 'trending' ? 'Loading Browse merged catalogue' : screen === 'series-home' ? 'Loading Series' : screen === 'movies' ? 'Loading Movies' : 'Loading home'} aria-live="polite" aria-busy="true">
      <i class="skeleton-block skeleton-home-art" aria-hidden="true" />
      <div class="skeleton-home-copy" aria-hidden="true">
        <i class="skeleton-block skeleton-logo" />
        <i class="skeleton-block skeleton-meta" />
        <i class="skeleton-block skeleton-copy-line" />
        <i class="skeleton-block skeleton-copy-line is-short" />
        <div class="skeleton-home-actions"><Blocks count={2} className="skeleton-action" /></div>
      </div>
      <div class="skeleton-home-row" aria-hidden="true">
        <i class="skeleton-block skeleton-row-title" />
        <div><Blocks count={6} className="skeleton-home-card" /></div>
      </div>
    </section>
  )
}
