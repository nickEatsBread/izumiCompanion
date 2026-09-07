import {
  AlertTriangle,
  ArrowRight,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  House,
  MonitorUp,
  Maximize2,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import companionLockup from '../../brand/png/izumi-companion-lockup-dark-936.png'
import type {
  CompanionMedia,
  CompanionSkipSegment,
  LinkedDeviceSourceChoice,
  LinkedDeviceSourceOptions,
  PlaybackState,
  PlaybackSourceChoice,
  PlaybackTrack,
  PlayerMenu,
  SubtitleChoice,
  SubtitlePreferences,
} from '../types'
import type { MediaRating } from '../lib/media-rating'
import type { TvLinkPhase } from '../lib/tv-link'
import { informativeHeroMeta, displayRatings, ratingDisplayValue } from './HomeScreen'
import { POST_PLAY_VIDEO_RECT } from '../lib/post-play-layout'

export type IndependentSetupPhase = 'intro' | 'waiting' | 'ready' | 'error'

function usePairingCountdown(expiresAt?: number) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => Math.max(0, Math.ceil(((expiresAt ?? 0) - Date.now()) / 1000)))
  useEffect(() => {
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil(((expiresAt ?? 0) - Date.now()) / 1000)))
    update()
    if (!expiresAt) return
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  return {
    remainingSeconds,
    remainingLabel: `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`,
  }
}

function PairingBackdrop({ posters }: { posters: string[] }) {
  const posterSource = posters.slice(0, 8)
  const posterLoop = posterSource.length
    ? Array.from({ length: 12 }, (_, index) => posterSource[index % posterSource.length])
    : []
  return (
    <div class="pairing-backdrop" aria-hidden="true">
      <div class="pairing-poster-stage">
        <div class="pairing-poster-track pairing-poster-track-one">
          {posterLoop.map((poster, index) => <img src={poster} alt="" key={`${poster}-${index}`} />)}
        </div>
        <div class="pairing-poster-track pairing-poster-track-two">
          {posterLoop.slice().reverse().map((poster, index) => <img src={poster} alt="" key={`reverse-${poster}-${index}`} />)}
        </div>
      </div>
      <div class="pairing-blue-wash" />
    </div>
  )
}

export function IndependentSetupScreen({
  phase,
  connected,
  focusIndex,
  error,
  onFocus,
  onBack,
  onStart,
}: {
  phase: IndependentSetupPhase
  connected: boolean
  focusIndex: number
  error?: string
  onFocus(index: number): void
  onBack(): void
  onStart(): void
}) {
  const canStart = phase === 'intro' || phase === 'error'
  return (
    <main class="state-screen independent-setup-screen">
      <img class="state-brand" src={companionLockup} alt="izumi companion" />
      <section class="independent-setup-panel">
        <header class="independent-setup-heading">
          <p>Independent TV playback</p>
          <h1>Use this TV without keeping izumi open</h1>
          <span>A one-time Cloudflare Worker setup gives your TV a private route to the parts of izumi it needs.</span>
        </header>

        <div class="independent-setup-features">
          <article><b>01</b><div><h2>Watch progress</h2><p>Keep your izumi playtime available across your devices through your private Worker.</p></div></article>
          <article><b>02</b><div><h2>Most sources</h2><p>Resolve compatible add-on sources and optional debrid links without leaving another device running.</p></div></article>
          <article><b>03</b><div><h2>TV-first playback</h2><p>Start supported titles directly here. Device-only and P2P sources may still need izumi open.</p></div></article>
        </div>

        <div class="independent-setup-instruction">
          <strong>This takes approximately 10 minutes.</strong>
          <p>Open izumi on the device currently linked to this TV, then select OK.</p>
        </div>

        <footer class={`independent-setup-footer phase-${phase}`}>
          {phase === 'waiting' && <div class="independent-setup-progress" role="status">
            <i aria-hidden="true" />
            <div><strong>Continue on your linked device</strong><span>izumi opened the private Worker setup for this TV.</span></div>
          </div>}
          {phase === 'ready' && <div class="independent-setup-progress is-ready" role="status">
            <Check size={36} aria-hidden="true" />
            <div><strong>This TV is ready</strong><span>Independent playback is connected to your private Worker.</span></div>
          </div>}
          {phase === 'error' && <div class="independent-setup-progress is-error" role="alert">
            <AlertTriangle size={34} aria-hidden="true" />
            <div><strong>Setup could not open</strong><span>{error || 'Make sure izumi is open on the linked device, then try again.'}</span></div>
          </div>}
          <div class="independent-setup-actions">
            <button type="button" class={focusIndex === 0 ? 'is-focused' : ''} data-focus-id="setting-0" onFocus={() => onFocus(0)} onClick={onBack}>
              {phase === 'ready' ? 'Done' : 'Back'}
            </button>
            {canStart && <button type="button" class={focusIndex === 1 ? 'is-focused' : ''} data-focus-id="setting-1" onFocus={() => onFocus(1)} onClick={onStart}>
              {phase === 'error' ? 'Try again' : connected ? 'OK' : 'Open izumi, then OK'}
            </button>}
          </div>
        </footer>
      </section>
    </main>
  )
}

export function ReadyScreen({
  connected,
  qrCode,
  pairingCode,
  expiresAt,
  posters,
  independentFocused,
  onIndependentFocus,
  onIndependent,
}: {
  connected: boolean
  qrCode?: string
  pairingCode: string
  expiresAt?: number
  posters: string[]
  independentFocused: boolean
  onIndependentFocus(): void
  onIndependent(): void
}) {
  const { remainingSeconds, remainingLabel } = usePairingCountdown(expiresAt)
  return (
    <main class="state-screen ready-screen">
      <PairingBackdrop posters={posters} />
      <img class="state-brand" src={companionLockup} alt="izumi companion" />
      <div class="ready-panel">
        <div class="ready-copy">
          <MonitorUp size={46} strokeWidth={1.7} aria-hidden="true" />
          <h1>Pair this TV</h1>
          <p>{connected
            ? 'Scan the QR code in izumi. Check that the code shown on your device matches this TV.'
            : 'Getting this TV ready to pair…'}</p>
          <div class="pairing-code-block">
            <span>PAIRING CODE</span>
            <strong>{pairingCode || '------'}</strong>
            {expiresAt && <small>{remainingSeconds ? `Refreshes in ${remainingLabel}` : 'Refreshing code…'}</small>}
          </div>
          <div class="ready-independent-option">
            <span>Don’t want to pair?</span>
            <button
              type="button"
              class={independentFocused ? 'is-focused' : ''}
              data-focus-id="setting-0"
              onFocus={onIndependentFocus}
              onClick={onIndependent}
            >
              Use TV independently <ArrowRight size={24} aria-hidden="true" />
            </button>
          </div>
        </div>
        {connected && qrCode && (
          <div class="qr-panel">
            <div class="qr-code-shell">
              <img class="qr-code" src={qrCode} alt="Pair izumi with this TV" />
            </div>
            <strong>Scan to pair</strong>
            <span>One-time setup</span>
          </div>
        )}
      </div>
    </main>
  )
}

export function ExitConfirmation({
  focus,
  onFocus,
  onCancel,
  onExit,
}: {
  focus: number
  onFocus(index: number): void
  onCancel(): void
  onExit(): void
}) {
  return (
    <section class="exit-confirmation-backdrop" role="dialog" aria-modal="true" aria-labelledby="exit-title">
      <div class="exit-confirmation">
        <LogOut size={35} strokeWidth={1.7} aria-hidden="true" />
        <h2 id="exit-title">Leave izumi?</h2>
        <p>You’ll need to open the TV app again to keep browsing.</p>
        <div>
          <button type="button" class={focus === 0 ? 'is-focused' : ''} onFocus={() => onFocus(0)} onClick={onCancel}>Stay here</button>
          <button type="button" class={focus === 1 ? 'is-focused' : ''} onFocus={() => onFocus(1)} onClick={onExit}>Exit</button>
        </div>
      </div>
    </section>
  )
}

function ratingGuidance(contentRating: string): string {
  const normalized = contentRating.toUpperCase().replace(/\s/g, '')
  if (['TV-Y', 'TV-G', 'G', 'U'].includes(normalized)) return 'Suitable for all audiences'
  if (['TV-Y7', '7'].includes(normalized)) return 'Suitable for ages 7 and over'
  if (['TV-PG', 'PG'].includes(normalized)) return 'Parental guidance suggested'
  if (['TV-14', '12', '12A', '14'].includes(normalized)) return 'Parents strongly cautioned'
  if (['TV-MA', 'R', 'NC-17', '15', '16', '18'].includes(normalized)) return 'For mature audiences'
  return normalized === 'NR' ? 'Rating information unavailable' : 'Viewer guidance advised'
}

export function LoadingScreen({
  title,
  progress,
  contentRating,
}: {
  title: string
  progress: number
  contentRating?: string
}) {
  const rating = contentRating?.trim() || 'NR'
  const clampedProgress = Math.min(100, Math.max(0, progress))
  const progressKnown = clampedProgress > 0
  return (
    <main class="state-screen loading-screen">
      <header class="loading-title-lockup">
        <h1>{title}</h1>
      </header>
      <aside class="loading-rating" aria-label={`${rating}. ${ratingGuidance(rating)}`} key={`${title}-${rating}`}>
        <strong class="loading-rating-badge">{rating}</strong>
        <span class="loading-rating-copy">
          <small>Maturity rating</small>
          <strong>{ratingGuidance(rating)}</strong>
        </span>
      </aside>
      <div class="loading-status" role="status" aria-live="polite">
        <strong>{progressKnown ? `${Math.round(clampedProgress)}%` : 'Preparing stream'}</strong>
        <small>{progressKnown ? 'Buffered for playback' : 'Connecting to the video source'}</small>
      </div>
      <div class="loading-footer">
        <span
          class={`loading-track${progressKnown ? ' is-determinate' : ' is-indeterminate'}`}
          role="progressbar"
          aria-label={`Loading ${title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressKnown ? Math.round(clampedProgress) : undefined}
          aria-valuetext={progressKnown ? `${Math.round(clampedProgress)}% buffered for playback` : 'Preparing stream'}
        >
          <i class="loading-progress-indicator" style={progressKnown ? { width: `${clampedProgress}%` } : undefined} aria-hidden="true" />
        </span>
      </div>
      <p class="back-hint"><RotateCcw size={19} /> Back to cancel</p>
    </main>
  )
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry(): void }) {
  const retryRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => retryRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return (
    <main class="state-screen error-screen">
      <div class="error-lockup">
        <AlertTriangle size={48} strokeWidth={1.8} aria-hidden="true" />
        <p class="state-kicker">PLAYBACK ERROR</p>
        <h1>We couldn't open that video</h1>
        <p>{message}</p>
        <button
          ref={retryRef}
          type="button"
          class="hero-button primary is-focused"
          data-focus-id="error-retry"
          onClick={onRetry}
        >
          <RefreshCcw size={23} /> Try Again
        </button>
      </div>
    </main>
  )
}

export function formatPlaybackTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds / 60)
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function PlayerScreen({
  title,
  state,
  position,
  duration,
  bufferedPosition,
  isLive,
  controlFocus,
  controlsFocused,
  menu,
  menuFocus,
  sourceChoices,
  deviceSourceOptions,
  activeSourceId,
  deviceSourceChangeAvailable,
  audioTracks,
  subtitleChoices,
  activeAudio,
  activeSubtitle,
  subtitleText,
  subtitlePreferences,
  previewBackdrop,
  controlsVisible,
  bufferingProgress,
  seekFeedback,
  transportFocused,
  timelineFocused,
  skipSegments,
  skipSegment,
  skipFocused,
  nextEpisode,
  nextEpisodeVisible,
  nextFocused,
  nextCountdown,
  nextSourceReady,
  stillWatching,
  stillWatchingFocus,
  onControlFocus,
  onTransportFocus,
  onTimelineFocus,
  onToggle,
  onControl,
  onMenuFocus,
  onSource,
  onDeviceSource,
  onDeviceSources,
  onAudio,
  onSubtitle,
  onAppearance,
  onSkip,
  onNext,
  onStillWatching,
}: {
  title: string
  state: PlaybackState
  position: number
  duration: number
  bufferedPosition: number
  isLive: boolean
  controlFocus: number
  controlsFocused: boolean
  menu: PlayerMenu | null
  menuFocus: number
  sourceChoices: PlaybackSourceChoice[]
  deviceSourceOptions?: LinkedDeviceSourceOptions
  activeSourceId?: string
  deviceSourceChangeAvailable: boolean
  audioTracks: PlaybackTrack[]
  subtitleChoices: SubtitleChoice[]
  activeAudio?: number
  activeSubtitle: string
  subtitleText: string
  subtitlePreferences: SubtitlePreferences
  previewBackdrop?: string
  controlsVisible: boolean
  bufferingProgress: number
  seekFeedback?: { direction: 'backward' | 'forward'; multiplier: number; seconds: number }
  transportFocused: boolean
  timelineFocused: boolean
  skipSegments: CompanionSkipSegment[]
  skipSegment?: CompanionSkipSegment
  skipFocused: boolean
  nextEpisode?: CompanionMedia
  nextEpisodeVisible: boolean
  nextFocused: boolean
  nextCountdown?: number
  nextSourceReady: boolean
  stillWatching: boolean
  stillWatchingFocus: number
  onControlFocus(index: number): void
  onTransportFocus(): void
  onTimelineFocus(): void
  onToggle(): void
  onControl(index: number): void
  onMenuFocus(index: number): void
  onSource(source: PlaybackSourceChoice): void
  onDeviceSource(source: LinkedDeviceSourceChoice): void
  onDeviceSources(): void
  onAudio(track: PlaybackTrack): void
  onSubtitle(choice: SubtitleChoice): void
  onAppearance(setting: 'size' | 'background' | 'delay'): void
  onSkip(): void
  onNext(): void
  onStillWatching(continueWatching: boolean): void
}) {
  const progress = isLive ? 100 : duration ? Math.min(100, position / duration * 100) : 0
  const bufferedProgress = isLive ? 100 : duration ? Math.min(100, Math.max(position, bufferedPosition) / duration * 100) : 0
  const bufferingProgressKnown = bufferingProgress > 0 && bufferingProgress < 100
  const showPause = state === 'playing' || state === 'buffering'
  const selectedAudio = audioTracks.find((track) => track.index === activeAudio)?.label ?? 'Default'
  const selectedSubtitle = subtitleChoices.find((track) => track.id === activeSubtitle)?.label ?? 'Off'
  const selectedSource = sourceChoices.find((source) => source.id === activeSourceId)?.label ?? 'Current source'
  const appearanceLabel = subtitlePreferences.size === 'source' && subtitlePreferences.background === 'source'
    ? 'Original'
    : subtitlePreferences.size === 'source' ? 'Custom' : subtitlePreferences.size
  const sourceStyle = subtitlePreferences.castStyle
  const subtitleStyle = sourceStyle ? {
    fontFamily: sourceStyle.font ? `"${sourceStyle.font}", "Nunito Sans", sans-serif` : undefined,
    fontWeight: sourceStyle.bold ? 800 : 600,
    fontSize: sourceStyle.fontSize ? `${Math.max(1.4, sourceStyle.fontSize / 10.8)}vh` : undefined,
    color: sourceStyle.textColor,
    WebkitTextStroke: sourceStyle.borderSize && sourceStyle.borderColor
      ? `${Math.max(1, sourceStyle.borderSize)}px ${sourceStyle.borderColor}`
      : undefined,
    textShadow: sourceStyle.shadow && sourceStyle.borderColor
      ? `0 ${sourceStyle.shadow}px ${Math.max(2, sourceStyle.shadow * 2)}px ${sourceStyle.borderColor}`
      : undefined,
  } : undefined
  const controls = [
    { label: 'Change source', detail: selectedSource, icon: RefreshCcw },
    { label: 'Audio', detail: selectedAudio, icon: Volume2 },
    { label: 'Subtitles', detail: selectedSubtitle, icon: Captions },
    { label: 'Appearance', detail: appearanceLabel, icon: SlidersHorizontal },
  ]
  return (
    <main class="player-screen">
      {previewBackdrop && <img class="player-preview-backdrop" src={previewBackdrop} alt="" />}
      <div class={`player-vignette${controlsVisible ? ' is-visible' : ''}`} />
      {state === 'buffering' && !seekFeedback && (
        <div class="player-buffering-status" role="status" aria-live="polite">
          <span class="player-buffering-spinner" aria-hidden="true" />
          <span class="player-buffering-copy">
            <strong>Buffering</strong>
            <small>{bufferingProgressKnown ? `${Math.round(bufferingProgress)}% buffered` : 'Preparing stream'}</small>
            <span class={`player-buffering-meter${bufferingProgressKnown ? ' is-determinate' : ''}`} aria-hidden="true">
              <i style={{ width: `${bufferingProgressKnown ? bufferingProgress : 0}%` }} />
            </span>
          </span>
        </div>
      )}
      {seekFeedback && (
        <div class={`player-seek-feedback is-${seekFeedback.direction}`} role="status" aria-live="polite">
          <span class="player-seek-chevrons" aria-hidden="true">
            {[0, 1, 2].map((index) => seekFeedback.direction === 'forward'
              ? <ChevronRight size={42} strokeWidth={3.2} key={index} />
              : <ChevronLeft size={42} strokeWidth={3.2} key={index} />)}
          </span>
          <strong>{seekFeedback.multiplier}×</strong>
          <small>{seekFeedback.direction === 'forward' ? '+' : '−'}{seekFeedback.seconds} seconds</small>
        </div>
      )}
      {subtitleText && !menu && (
        <div class={`player-subtitle${controlsVisible ? ' is-controls-visible' : ''} subtitle-${subtitlePreferences.size} subtitle-bg-${subtitlePreferences.background}`} style={subtitleStyle}>
          {subtitleText}
        </div>
      )}
      {skipSegment && !menu && (
        <button type="button" class={`player-skip${skipFocused ? ' is-focused' : ''}`} onClick={onSkip}>
          <span>{skipSegment.label || (skipSegment.type === 'recap' ? 'Skip recap' : skipSegment.type === 'op' || skipSegment.type === 'intro' ? 'Skip intro' : 'Skip ending')}</span>
          <ArrowRight size={22} />
        </button>
      )}
      {nextEpisodeVisible && nextEpisode && !menu && (
        <button type="button" class={`next-episode-card${nextFocused ? ' is-focused' : ''}`} onClick={onNext}>
          {nextEpisode.episodeImage || nextEpisode.backdrop ? <img src={nextEpisode.episodeImage || nextEpisode.backdrop} alt="" /> : <span class="next-episode-art-fallback"><Play size={27} /></span>}
          <span class="next-episode-copy">
            <small>{nextCountdown != null ? `Playing in ${nextCountdown}` : 'Up next'}{nextSourceReady ? ' · Ready' : ''}</small>
            <strong>S{nextEpisode.season ?? 1} E{nextEpisode.episode} · {nextEpisode.episodeTitle || nextEpisode.title}</strong>
            <span><span>Play next episode</span><ArrowRight size={24} /></span>
          </span>
        </button>
      )}
      <div class={`player-controls${controlsVisible ? ' is-visible' : ' is-hidden'}`}>
        <div class="player-heading">
          <button
            type="button"
            class={`player-state-icon${transportFocused && !menu ? ' is-focused' : ''}`}
            aria-label={showPause ? 'Pause' : 'Play'}
            onFocus={onTransportFocus}
            onMouseEnter={onTransportFocus}
            onClick={onToggle}
          >
            {showPause ? <Pause size={27} fill="currentColor" /> : <Play size={27} fill="currentColor" />}
          </button>
          <div>
            <p>{state === 'paused' ? 'Paused' : state === 'buffering' ? 'Buffering' : 'Now Playing'}</p>
            <h1>{title}</h1>
          </div>
        </div>
        <div
          class={`player-timeline-control${timelineFocused && !menu ? ' is-focused' : ''}`}
          role="slider"
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(duration))}
          aria-valuenow={Math.max(0, Math.round(position))}
          aria-valuetext={isLive ? 'Live' : `${formatPlaybackTime(position)} of ${formatPlaybackTime(duration)}, buffered to ${formatPlaybackTime(bufferedPosition)}`}
          tabIndex={0}
          onFocus={onTimelineFocus}
          onMouseEnter={onTimelineFocus}
        >
          <div class="player-timeline">
            <span class="player-timeline-buffered" style={{ width: `${bufferedProgress}%` }} />
            <span class="player-timeline-played" style={{ width: `${progress}%` }} />
            <i class="player-scrubber-handle" style={{ left: `${progress}%` }} aria-hidden="true" />
            {skipSegments.map((segment) => duration > 0 && (
              <i
                class={`player-segment-marker is-${segment.type}`}
                style={{ left: `${Math.min(100, segment.startTime / duration * 100)}%`, width: `${Math.max(.25, (segment.endTime - segment.startTime) / duration * 100)}%` }}
                key={`${segment.type}-${segment.startTime}`}
              />
            ))}
          </div>
          <div class="player-times"><span>{isLive ? 'LIVE' : formatPlaybackTime(position)}</span><span>{isLive ? '' : formatPlaybackTime(duration)}</span></div>
        </div>
        <div class="player-actions" aria-label="Playback options">
          {controls.map(({ label, detail, icon: Icon }, index) => (
            <button
              type="button"
              class={controlsFocused && controlFocus === index && !menu ? 'is-focused' : ''}
              aria-label={detail ? `${label}: ${detail}` : label}
              onFocus={() => onControlFocus(index)}
              onMouseEnter={() => onControlFocus(index)}
              onClick={() => onControl(index)}
              key={label}
            >
              <Icon size={22} />
              <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
            </button>
          ))}
        </div>
      </div>

      {menu && (
        <section class="player-menu" aria-label={`${menu} options`}>
          <header class="player-menu-heading">
            <span class="player-menu-heading-icon">
              {menu === 'source' ? <RefreshCcw size={28} /> : menu === 'audio' ? <Volume2 size={29} /> : menu === 'subtitles' ? <Captions size={30} /> : <SlidersHorizontal size={29} />}
            </span>
            <span>
              <p>{menu === 'source' ? 'Change source' : menu === 'audio' ? 'Audio' : menu === 'subtitles' ? 'Subtitles' : 'Subtitle appearance'}</p>
              <small>{menu === 'source' ? 'Choose where this title plays from' : menu === 'audio' ? 'Choose an audio track' : menu === 'subtitles' ? 'Choose a language or turn subtitles off' : 'Adjust how subtitles appear on this TV'}</small>
            </span>
          </header>
          {menu === 'source' && (
            <div class="player-menu-options">
              {sourceChoices.map((source, index) => (
                <button
                  type="button"
                  class={`${menuFocus === index ? 'is-focused' : ''}${activeSourceId === source.id ? ' is-selected' : ''}`}
                  aria-pressed={activeSourceId === source.id}
                  onFocus={() => onMenuFocus(index)}
                  onClick={() => onSource(source)}
                  key={source.id}
                >
                  <span>{source.label}</span><small>{activeSourceId === source.id ? 'Current' : source.detail ?? ''}</small>
                </button>
              ))}
              {deviceSourceOptions?.choices.map((source, index) => {
                const menuIndex = sourceChoices.length + index
                return (
                  <button
                    type="button"
                    class={menuFocus === menuIndex ? 'is-focused' : ''}
                    onFocus={() => onMenuFocus(menuIndex)}
                    onClick={() => onDeviceSource(source)}
                    key={`device-${deviceSourceOptions.requestId}-${source.id}`}
                  >
                    <span>{source.label}</span><small>{source.detail ?? 'Linked device'}</small>
                  </button>
                )
              })}
              {deviceSourceOptions?.resolving && !deviceSourceOptions.choices.length && (
                <div class="player-menu-loading">Finding sources on linked device…</div>
              )}
              {deviceSourceChangeAvailable && (
                <button
                  type="button"
                  class={menuFocus === sourceChoices.length + (deviceSourceOptions?.choices.length ?? 0) ? 'is-focused' : ''}
                  onFocus={() => onMenuFocus(sourceChoices.length + (deviceSourceOptions?.choices.length ?? 0))}
                  onClick={onDeviceSources}
                >
                  <span>{deviceSourceOptions ? 'Refresh linked-device sources' : 'More sources on linked device'}</span><small>Debrid · P2P · device sources</small>
                </button>
              )}
            </div>
          )}
          {menu === 'audio' && (
            <div class="player-menu-options">
              {audioTracks.map((track, index) => (
                <button
                  type="button"
                  class={`${menuFocus === index ? 'is-focused' : ''}${activeAudio === track.index ? ' is-selected' : ''}`}
                  aria-pressed={activeAudio === track.index}
                  onFocus={() => onMenuFocus(index)}
                  onClick={() => onAudio(track)}
                  key={`${track.type}-${track.index}`}
                >
                  <span>{track.label}</span><small>{activeAudio === track.index ? 'Current' : ''}</small>
                </button>
              ))}
            </div>
          )}
          {menu === 'subtitles' && (
            <div class="player-menu-options">
              {subtitleChoices.map((choice, index) => (
                <button
                  type="button"
                  class={`${menuFocus === index ? 'is-focused' : ''}${activeSubtitle === choice.id ? ' is-selected' : ''}`}
                  aria-pressed={activeSubtitle === choice.id}
                  onFocus={() => onMenuFocus(index)}
                  onClick={() => onSubtitle(choice)}
                  key={choice.id}
                >
                  <span class="player-menu-option-copy">
                    <span>{choice.label}</span>
                    <small>{choice.kind === 'off' ? 'No subtitles' : choice.kind === 'external' ? 'From izumi' : 'Included track'}</small>
                  </span>
                  {activeSubtitle === choice.id && <Check class="player-menu-check" size={27} strokeWidth={3} aria-label="Selected" />}
                </button>
              ))}
            </div>
          )}
          {menu === 'appearance' && (
            <div class="player-menu-options appearance-options">
              <button type="button" class={menuFocus === 0 ? 'is-focused' : ''} onFocus={() => onMenuFocus(0)} onClick={() => onAppearance('size')}>
                <span>Text size</span><small>{subtitlePreferences.size === 'source' ? 'Original' : subtitlePreferences.size}</small>
              </button>
              <button type="button" class={menuFocus === 1 ? 'is-focused' : ''} onFocus={() => onMenuFocus(1)} onClick={() => onAppearance('background')}>
                <span>Background</span><small>{subtitlePreferences.background === 'source' ? 'Original' : subtitlePreferences.background}</small>
              </button>
              <button type="button" class={menuFocus === 2 ? 'is-focused' : ''} onFocus={() => onMenuFocus(2)} onClick={() => onAppearance('delay')}>
                <span>Timing</span><small>{subtitlePreferences.delayMs > 0 ? '+' : ''}{subtitlePreferences.delayMs / 1000}s</small>
              </button>
            </div>
          )}
        </section>
      )}
      {stillWatching && (
        <section class="still-watching-backdrop" role="dialog" aria-modal="true" aria-label="Still watching">
          <div class="still-watching-panel">
            <p class="state-kicker">AUTOPLAY PAUSED</p>
            <h2>Still watching?</h2>
            <p>izumi will wait here until you’re ready for the next episode.</p>
            <div>
              <button type="button" class={stillWatchingFocus === 0 ? 'is-focused' : ''} onClick={() => onStillWatching(true)}><Play size={20} /><span>Keep watching</span></button>
              <button type="button" class={stillWatchingFocus === 1 ? 'is-focused' : ''} onClick={() => onStillWatching(false)}><House size={20} /><span>Exit to home</span></button>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

export function StandaloneLinkScreen({
  connected,
  qrCode,
  pairingCode,
  expiresAt,
  phase,
  statusMessage,
  setupSaved = false,
  confirmation,
  confirmationFocus,
  posters,
  backFocused,
  onBackFocus,
  onConfirmationFocus,
  onBack,
  onApprove,
  onReject,
}: {
  connected: boolean
  qrCode?: string
  pairingCode: string
  expiresAt?: number
  phase: TvLinkPhase
  statusMessage?: string
  setupSaved?: boolean
  confirmation?: string
  confirmationFocus: number
  posters: string[]
  backFocused: boolean
  onBackFocus(): void
  onConfirmationFocus(index: number): void
  onBack(): void
  onApprove(): void
  onReject(): void
}) {
  const { remainingSeconds, remainingLabel } = usePairingCountdown(expiresAt)
  const statusTitle = phase === 'phone-connected' ? 'Phone connected'
    : phase === 'confirming' ? 'Check the confirmation number'
      : phase === 'approved' ? 'Secure link approved'
        : phase === 'installing' ? 'Linking your private Worker'
        : phase === 'complete' ? 'TV setup complete'
          : phase === 'error' ? 'Setup needs attention'
            : phase === 'preparing' ? 'Preparing secure setup'
              : 'Secure setup ready'
  return (
    <main class="state-screen ready-screen standalone-link-screen">
      <PairingBackdrop posters={posters} />
      <img class="state-brand" src={companionLockup} alt="izumi companion" />
      <section class="standalone-link-panel">
        <div class="standalone-link-copy">
          <p class="state-kicker">INDEPENDENT TV SETUP</p>
          <h1>Set up this TV directly</h1>
          <p>Scan with your phone to connect this TV to your private Cloudflare setup. Supported sources and watch progress will work without keeping izumi open on another device.</p>
          <div class="standalone-link-steps" aria-label="Setup overview">
            <div><b>1</b><span>Scan the QR code</span></div>
            <div><b>2</b><span>Complete the one-time phone setup</span></div>
            <div><b>3</b><span>Return here to start watching</span></div>
          </div>
          <div class={`standalone-link-status is-${phase}`} aria-live="polite">
            <strong>{statusTitle}</strong>
            <span>{statusMessage || 'Scan the QR code to begin the one-time setup.'}</span>
            {confirmation && (phase === 'confirming' || phase === 'approved' || phase === 'installing') && (
              <div class="standalone-confirmation">
                <small>CONFIRMATION NUMBER</small>
                <b>{confirmation.slice(0, 3)} {confirmation.slice(3)}</b>
                <em>{phase === 'confirming' ? 'Compare with your phone, then approve using the TV remote.' : 'Approved on this TV.'}</em>
              </div>
            )}
            {phase === 'confirming' && (
              <div class="standalone-confirm-actions" aria-label="Approve secure TV link">
                <button
                  type="button"
                  class={confirmationFocus === 0 ? 'is-focused' : ''}
                  data-focus-id="setting-0"
                  onFocus={() => onConfirmationFocus(0)}
                  onClick={onReject}
                ><RotateCcw size={20} aria-hidden="true" /> Does not match</button>
                <button
                  type="button"
                  class={confirmationFocus === 1 ? 'is-focused is-approve' : 'is-approve'}
                  data-focus-id="setting-1"
                  onFocus={() => onConfirmationFocus(1)}
                  onClick={onApprove}
                ><Check size={20} aria-hidden="true" /> Numbers match</button>
              </div>
            )}
          </div>
          {phase !== 'confirming' && <button
              type="button"
              class={`standalone-link-back${backFocused ? ' is-focused' : ''}`}
              data-focus-id="setting-0"
              onFocus={onBackFocus}
              onClick={onBack}
            ><ChevronLeft size={25} aria-hidden="true" /> {setupSaved ? 'Retry catalogue' : 'Back to pairing'}</button>}
        </div>
        <aside class="standalone-qr-panel">
          {qrCode
            ? <div class="standalone-qr-shell"><img src={qrCode} alt="Open independent TV setup on your phone" /></div>
            : <div class="standalone-qr-wait" role="status"><i aria-hidden="true" /><span>{connected ? 'Preparing secure link…' : 'Connecting this TV…'}</span></div>}
          <strong>Scan with your phone</strong>
          <span>or visit tv-link.izumi.watch</span>
          <div class="standalone-code">
            <small>TV CODE</small>
            <b>{pairingCode || '--------'}</b>
            {expiresAt && phase !== 'complete' && <em>{remainingSeconds ? `Refreshes in ${remainingLabel}` : 'Refreshing code…'}</em>}
          </div>
        </aside>
      </section>
    </main>
  )
}

export function PostPlayScreen({
  media,
  recommendations,
  authored,
  focus,
  stage,
  rating,
  ratingTransitioning,
  miniPlayerEnabled,
  nativeVideoAvailable,
  recommendationIndex,
  onRecommendationStep,
  onFocus,
  onRate,
  onReturnToPlayer,
  onReplay,
  onHome,
  onRecommendation,
}: {
  media: CompanionMedia
  recommendations: CompanionMedia[]
  authored: boolean
  focus: number
  stage: 'rating' | 'recommendations'
  rating?: MediaRating
  ratingTransitioning: boolean
  miniPlayerEnabled: boolean
  nativeVideoAvailable: boolean
  recommendationIndex: number
  onRecommendationStep(direction: -1 | 1): void
  onFocus(index: number): void
  onRate(value: MediaRating): void
  onReturnToPlayer(): void
  onReplay(): void
  onHome(): void
  onRecommendation(media: CompanionMedia): void
}) {
  const recommendation = recommendations[Math.min(recommendationIndex, recommendations.length - 1)]
  const featured = stage === 'recommendations' && recommendation ? recommendation : media
  const identity = `${featured.ref.provider}:${featured.ref.type}:${featured.ref.id}`
  const [failedLogo, setFailedLogo] = useState('')
  const { x, y, width, height } = POST_PLAY_VIDEO_RECT
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-focus-id="post-play-${focus}"]`)?.focus()
  }, [focus, stage])
  const focusButton = (index: number) => ({
    'data-focus-id': `post-play-${index}`,
    tabIndex: focus === index ? 0 : -1,
    onFocus: () => onFocus(index),
    onMouseEnter: () => onFocus(index),
  })
  return (
    <main ref={rootRef} class={`post-play-screen is-${stage}${miniPlayerEnabled ? ' has-mini-player' : ' without-mini-player'}${ratingTransitioning ? ' is-transitioning' : ''}`}>
      {(featured.backdrop || featured.poster) && <img key={identity} class="post-play-backdrop" src={featured.backdrop || featured.poster} alt="" />}
      <div class="post-play-shade" />
      {miniPlayerEnabled && <button
        type="button"
        class={`post-play-mini-player${focus === 0 ? ' is-focused' : ''}${nativeVideoAvailable ? ' has-native-video' : ''}`}
        style={{ left: x, top: y, width, height }}
        {...focusButton(0)}
        aria-label={`Return to ${media.title}`}
        onClick={onReturnToPlayer}
      >
        {!nativeVideoAvailable && media.backdrop && <img src={media.backdrop} alt="" />}
        <span class="post-play-mini-vignette" />
        <span class="post-play-mini-label"><Maximize2 size={24} /><span><strong>{media.title}</strong><small>Press OK to return to the player</small></span></span>
      </button>}
      {stage === 'rating' ? <section class="post-play-rating-panel">
        <p class="state-kicker">FINISHED WATCHING</p>
        <h1>Did you like it?</h1>
        <p class="post-play-watched-title">{media.title}</p>
        <p>Your answer helps izumi shape what appears next.</p>
        <div class="post-play-rating-actions">
          <button
            type="button"
            class={`${focus === 1 ? 'is-focused' : ''}${rating === 'up' ? ' is-selected' : ''}`}
            aria-pressed={rating === 'up'}
            {...focusButton(1)}
            disabled={ratingTransitioning}
            onClick={() => onRate('up')}
          ><ThumbsUp size={38} fill={rating === 'up' ? 'currentColor' : 'none'} /><span>Yes</span></button>
          <button
            type="button"
            class={`${focus === 2 ? 'is-focused' : ''}${rating === 'down' ? ' is-selected' : ''}`}
            aria-pressed={rating === 'down'}
            {...focusButton(2)}
            disabled={ratingTransitioning}
            onClick={() => onRate('down')}
          ><ThumbsDown size={38} fill={rating === 'down' ? 'currentColor' : 'none'} /><span>No</span></button>
        </div>
        <small>Back returns to the player</small>
      </section> : <section class="post-play-feature-panel">
        <div class="post-play-feature-copy" key={identity} aria-live="polite">
          <p class="state-kicker">{authored ? 'YOU MIGHT LIKE' : 'MORE FROM YOUR CATALOGUE'}</p>
          <p class="post-play-because">Because you watched <strong>{media.title}</strong></p>
          {recommendation ? <>
            {featured.logoImage && failedLogo !== featured.logoImage
              ? <h1 aria-label={featured.title}><img class="post-play-title-logo" src={featured.logoImage} alt="" onError={() => setFailedLogo(featured.logoImage!)} /></h1>
              : <h1>{featured.title}</h1>}
            <p class="post-play-feature-meta">{informativeHeroMeta(featured)}{featured.contentRating && <span>{featured.contentRating}</span>}</p>
            {displayRatings(featured).length > 0 && <p class="post-play-feature-ratings">{displayRatings(featured).map((item) => <span key={item.source}><small>{item.source}</small> <strong>{ratingDisplayValue(item)}</strong></span>)}</p>}
            {featured.description && <p class="post-play-feature-description">{featured.description}</p>}
          </> : <><h1>What’s next?</h1><p class="post-play-empty">Your progress is saved. More recommendations will appear after izumi refreshes this catalogue.</p></>}
        </div>
        <div class="post-play-feature-actions">
          <button type="button" class={`post-play-primary${focus === 1 ? ' is-focused' : ''}`} {...focusButton(1)} onClick={() => recommendation ? onRecommendation(recommendation) : onReplay}><Play size={26} fill="currentColor" /><span>{recommendation ? 'Play' : 'Replay'}</span></button>
          {recommendation && <>
            <button type="button" class={`post-play-arrow${focus === 3 ? ' is-focused' : ''}`} {...focusButton(3)} aria-label="Previous recommendation" onClick={() => onRecommendationStep(-1)}><ChevronLeft size={30} /></button>
            <button type="button" class={`post-play-arrow${focus === 4 ? ' is-focused' : ''}`} {...focusButton(4)} aria-label="Next recommendation" onClick={() => onRecommendationStep(1)}><ChevronRight size={30} /></button>
            <span class="post-play-count">{recommendationIndex + 1} / {recommendations.length}</span>
          </>}
        </div>
        <div class="post-play-secondary-actions">
          <button type="button" class={focus === 5 ? 'is-focused' : ''} {...focusButton(5)} onClick={onReplay}><RotateCcw size={20} /><span>Watch again</span></button>
          <button type="button" class={focus === 2 ? 'is-focused' : ''} {...focusButton(2)} onClick={onHome}><House size={20} /><span>Back home</span></button>
        </div>
      </section>}
    </main>
  )
}
