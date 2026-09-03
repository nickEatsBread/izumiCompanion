import {
  AlertTriangle,
  ArrowRight,
  Captions,
  Check,
  LogOut,
  House,
  MonitorUp,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
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

export function ReadyScreen({
  connected,
  qrCode,
  pairingCode,
  expiresAt,
  posters,
}: {
  connected: boolean
  qrCode?: string
  pairingCode: string
  expiresAt?: number
  posters: string[]
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => Math.max(0, Math.ceil(((expiresAt ?? 0) - Date.now()) / 1000)))
  useEffect(() => {
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil(((expiresAt ?? 0) - Date.now()) / 1000)))
    update()
    if (!expiresAt) return
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  const remainingLabel = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`
  const posterSource = posters.slice(0, 8)
  const posterLoop = posterSource.length
    ? Array.from({ length: 12 }, (_, index) => posterSource[index % posterSource.length])
    : []
  return (
    <main class="state-screen ready-screen">
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
      <div class="loading-footer">
        <span
          class="loading-track"
          role="progressbar"
          aria-label={`Loading ${title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clampedProgress)}
        >
          <i class="loading-progress-indicator" aria-hidden="true" />
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

function formatTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function PlayerScreen({
  title,
  state,
  position,
  duration,
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
            <span>Play next episode <ArrowRight size={17} /></span>
          </span>
        </button>
      )}
      <div class={`player-controls${controlsVisible ? ' is-visible' : ' is-hidden'}`}>
        <div class="player-heading">
          <span class="player-state-icon">
            {state === 'paused' ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}
          </span>
          <div>
            <p>{state === 'paused' ? 'Paused' : state === 'buffering' ? 'Buffering' : 'Now Playing'}</p>
            <h1>{title}</h1>
          </div>
        </div>
        <div class="player-timeline">
          <span style={{ width: `${progress}%` }} />
          {skipSegments.map((segment) => duration > 0 && (
            <i
              class={`player-segment-marker is-${segment.type}`}
              style={{ left: `${Math.min(100, segment.startTime / duration * 100)}%`, width: `${Math.max(.25, (segment.endTime - segment.startTime) / duration * 100)}%` }}
              key={`${segment.type}-${segment.startTime}`}
            />
          ))}
        </div>
        <div class="player-times"><span>{isLive ? 'LIVE' : formatTime(position)}</span><span>{isLive ? '' : formatTime(duration)}</span></div>
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
            <p>Izumi will wait here until you’re ready for the next episode.</p>
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

export function PostPlayScreen({
  media,
  recommendations,
  authored,
  focus,
  onFocus,
  onReplay,
  onHome,
  onRecommendation,
}: {
  media: CompanionMedia
  recommendations: CompanionMedia[]
  authored: boolean
  focus: number
  onFocus(index: number): void
  onReplay(): void
  onHome(): void
  onRecommendation(media: CompanionMedia): void
}) {
  return (
    <main class="post-play-screen">
      {media.backdrop && <img class="post-play-backdrop" src={media.backdrop} alt="" />}
      <div class="post-play-shade" />
      <section class="post-play-content">
        <p class="state-kicker">FINISHED WATCHING</p>
        <h1>{media.title}</h1>
        <p>Your progress is saved. Pick something related or head back to your home screen.</p>
        <div class="post-play-actions">
          <button type="button" class={focus === 0 ? 'is-focused' : ''} onFocus={() => onFocus(0)} onClick={onReplay}><RotateCcw size={21} /><span>Replay</span></button>
          <button type="button" class={focus === 1 ? 'is-focused' : ''} onFocus={() => onFocus(1)} onClick={onHome}><House size={21} /><span>Back home</span></button>
        </div>
        {recommendations.length > 0 && (
          <section class="post-play-recommendations">
            <header><p>{authored ? 'More like this' : 'More from your catalogue'}</p><span>{recommendations.length} picks</span></header>
            <div>
              {recommendations.map((item, index) => (
                <button
                  type="button"
                  class={focus === index + 2 ? 'is-focused' : ''}
                  onFocus={() => onFocus(index + 2)}
                  onClick={() => onRecommendation(item)}
                  key={`${item.ref.provider}-${item.ref.type}-${item.ref.id}`}
                >
                  {item.poster ? <img src={item.poster} alt="" /> : <span class="post-play-poster-fallback"><Play size={25} /></span>}
                  <strong>{item.title}</strong>
                  <small>{item.subtitle || 'Open details'}</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  )
}
