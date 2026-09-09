import type { LinkedDeviceSourceOptions, PlaybackSourceChoice, PlaybackTrack, SubtitleChoice } from '../types'

// Long menus exercise remote scrolling in the browser preview without starting playback.
export const previewMenuSources: PlaybackSourceChoice[] = Array.from({ length: 24 }, (_, index) => ({
  id: `preview-source-${index}`,
  label: `Preview.Title.${index % 2 === 0 ? '2160p' : '1080p'}.WEB-DL.${index % 3 === 0 ? 'DDP5.1.Atmos.HEVC' : 'AAC.H264'}-GROUP${index + 1}.mkv`,
  detail: index % 2 === 0 ? '1080p · Multi-language' : '720p',
  origin: { name: index % 3 === 0 ? 'Listing source' : index % 3 === 1 ? 'Another listing' : 'Third listing' },
  delivery: index % 3 === 0 ? 'debrid' : index % 3 === 1 ? 'direct' : 'hosted',
  quality: index % 2 === 0 ? '2160p' : '1080p',
  badges: index % 2 === 0 ? ['2160p', 'HEVC', 'HDR10', 'WEB-DL'] : ['1080p', 'H264', 'WEB-DL'],
  size: index % 2 === 0 ? '12.4 GB' : '4.1 GB',
  seeders: (index + 1) * 37,
  group: `GROUP${index + 1}`,
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
