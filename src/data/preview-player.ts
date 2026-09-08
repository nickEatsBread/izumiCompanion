import type { LinkedDeviceSourceOptions, PlaybackSourceChoice, PlaybackTrack, SubtitleChoice } from '../types'

// Long menus exercise remote scrolling in the browser preview without starting playback.
export const previewMenuSources: PlaybackSourceChoice[] = Array.from({ length: 24 }, (_, index) => ({
  id: `preview-source-${index}`,
  label: `Source ${index + 1}${index % 3 === 0 ? ' · Extended release with multiple audio tracks' : ''}`,
  detail: index % 2 === 0 ? '1080p · Multi-language' : '720p',
  request: { sessionId: `cloud-preview-${index}`, url: '', title: 'Preview', positionSeconds: 0, subtitles: [], activeTrackIds: [] },
}))

export const previewMenuDeviceSources: LinkedDeviceSourceOptions = {
  requestId: 'preview-device-sources',
  resolving: false,
  choices: Array.from({ length: 8 }, (_, index) => ({ id: `preview-device-${index}`, label: `Linked source ${index + 1}` })),
}

export const previewMenuAudio: PlaybackTrack[] = Array.from({ length: 24 }, (_, index) => ({
  type: 'AUDIO', index, language: 'en', label: `English · Audio track ${index + 1}`,
}))

export const previewMenuSubtitles: SubtitleChoice[] = [
  { id: 'off', label: 'Off', kind: 'off' },
  ...Array.from({ length: 24 }, (_, index): SubtitleChoice => ({
    id: `preview-subtitle-${index}`, label: `English · Subtitle track ${index + 1}`, kind: 'embedded', index,
  })),
]
