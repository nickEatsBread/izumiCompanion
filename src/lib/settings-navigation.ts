import type { FocusLocation } from '../types'
import type { RemoteAction } from './remote'

export const SETTINGS_SECTIONS = [
  { title: 'Appearance', description: 'Make the home screen feel like yours.', options: [0, 1] },
  { title: 'Playback', description: 'Choose what happens during and after you watch.', options: [2, 3, 4, 5, 6] },
  { title: 'Connection', description: 'Manage how this TV connects to izumi.', options: [7, 8] },
  { title: 'System', description: 'Keep Companion up to date and manage this device.', options: [10, 9] },
]

export function settingsSectionForOption(index: number): number {
  return Math.max(0, SETTINGS_SECTIONS.findIndex((section) => section.options.includes(index)))
}

export function moveSettingsContentFocus(focus: FocusLocation, action: RemoteAction): FocusLocation {
  if (focus.zone === 'settings-category') {
    if (action === 'up' || action === 'down') return { zone: 'settings-category', index: Math.max(0, Math.min(SETTINGS_SECTIONS.length - 1, focus.index + (action === 'up' ? -1 : 1))) }
    if (action === 'right' || action === 'select') return { zone: 'setting', index: SETTINGS_SECTIONS[focus.index]?.options[0] ?? 0 }
  }
  if (focus.zone === 'setting') {
    const section = settingsSectionForOption(focus.index)
    const options = SETTINGS_SECTIONS[section].options
    if (action === 'left' || action === 'back') return { zone: 'settings-category', index: section }
    if (action === 'up' || action === 'down') return { zone: 'setting', index: options[Math.max(0, Math.min(options.length - 1, options.indexOf(focus.index) + (action === 'up' ? -1 : 1)))] }
  }
  return focus
}
