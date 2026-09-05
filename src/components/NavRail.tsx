import {
  Bookmark,
  Compass,
  Film,
  History,
  House,
  Search,
  Settings,
  Tv,
  Users,
} from 'lucide-preact'
import type { FocusLocation, ScreenName } from '../types'
import { tvHousehold, tvProfile } from '../lib/profiles'
import izumiMark from '../../brand/svg/izumi-mark-color.svg'

const items: Array<{ label: string; icon: typeof House; destination: ScreenName }> = [
  { label: 'Home', icon: House, destination: 'home' },
  { label: 'Search', icon: Search, destination: 'search' },
  { label: 'Browse', icon: Compass, destination: 'trending' },
  { label: 'Series', icon: Tv, destination: 'series-home' },
  { label: 'Movies', icon: Film, destination: 'movies' },
  { label: 'My List', icon: Bookmark, destination: 'my-list' },
  { label: 'Discover', icon: Compass, destination: 'discover' },
  { label: 'Watch History', icon: History, destination: 'watch-history' },
  { label: 'Settings', icon: Settings, destination: 'settings' },
]

interface NavRailProps {
  activeIndex: number
  focus: FocusLocation
  catalogLabel?: string
  expanded?: boolean
  onFocus(index: number): void
  onSelect(index: number): void
}

export function navItemCount() { return items.length + (tvHousehold().enabled ? 1 : 0) }

export function navDestinationAt(index: number): ScreenName {
  return items[index]?.destination ?? 'home'
}

export function navIndexFor(destination: ScreenName): number {
  const resolved = destination === 'series'
    ? 'series-home'
    : destination === 'details'
      ? 'movies'
      : destination === 'independent-setup'
        ? 'settings'
        : destination
  const index = items.findIndex((item) => item.destination === resolved)
  return index < 0 ? 0 : index
}

export function NavRail({ activeIndex, focus, catalogLabel = 'Catalogue', expanded = false, onFocus, onSelect }: NavRailProps) {
  const markFocused = focus.zone === 'nav' && focus.index === -1

  const renderItem = ({ label, icon: Icon }: (typeof items)[number], index: number) => {
    const focused = focus.zone === 'nav' && focus.index === index
    return (
      <button
        key={label}
        type="button"
        class={`nav-item${activeIndex === index ? ' is-active' : ''}${focused ? ' is-focused' : ''}`}
        data-focus-id={`nav-${index}`}
        tabIndex={focused ? 0 : -1}
        aria-label={label}
        aria-current={activeIndex === index ? 'page' : undefined}
        onFocus={() => onFocus(index)}
        onMouseEnter={() => onFocus(index)}
        onClick={() => onSelect(index)}
      >
        <span class="nav-item-glyph">
          <Icon size={24} strokeWidth={2} aria-hidden="true" />
        </span>
        <span class="nav-item-label"><strong>{label}</strong></span>
      </button>
    )
  }

  return (
    <nav class={`nav-rail${focus.zone === 'nav' || expanded ? ' is-open' : ''}`} aria-label="Main navigation">
      <button
        type="button"
        class={`nav-mark-button${markFocused ? ' is-focused' : ''}`}
        data-focus-id="nav--1"
        tabIndex={markFocused ? 0 : -1}
        aria-label={`Change catalogue. Current catalogue: ${catalogLabel}`}
        onFocus={() => onFocus(-1)}
        onMouseEnter={() => onFocus(-1)}
        onClick={() => onSelect(-1)}
      >
        <img class="nav-mark" src={izumiMark} alt="" />
        <span>{catalogLabel}</span>
      </button>
      <div class="nav-items">
        <p class="nav-section-label">Explore</p>
        {items.slice(0, -1).map(renderItem)}
      </div>
      <div class="nav-utility">
        {tvHousehold().enabled && renderItem({ label: tvProfile()?.name ?? 'Profiles', icon: Users, destination: 'home' }, items.length)}
        {items.slice(-1).map((item) => renderItem(item, items.length - 1))}
      </div>
    </nav>
  )
}
