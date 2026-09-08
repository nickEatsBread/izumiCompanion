import { describe, expect, it } from 'vitest'
import { moveSettingsContentFocus, SETTINGS_SECTIONS, settingsSectionForOption, settingsSections } from './settings-navigation'

describe('settings remote navigation', () => {
  it('reaches Update Worker only when the TV has a Worker and returns to Connection', () => {
    expect(settingsSections(false)[2].options).toEqual([11, 7, 8])
    expect(settingsSections(true)[2].options).toEqual([11, 7, 13, 8])
    expect(moveSettingsContentFocus({ zone: 'setting', index: 7 }, 'down', true)).toEqual({ zone: 'setting', index: 13 })
    expect(moveSettingsContentFocus({ zone: 'setting', index: 13 }, 'down', true)).toEqual({ zone: 'setting', index: 8 })
    expect(moveSettingsContentFocus({ zone: 'setting', index: 8 }, 'up', true)).toEqual({ zone: 'setting', index: 13 })
    expect(moveSettingsContentFocus({ zone: 'setting', index: 13 }, 'back', true)).toEqual({ zone: 'settings-category', index: 2 })
    expect(moveSettingsContentFocus({ zone: 'setting', index: 7 }, 'down', false)).toEqual({ zone: 'setting', index: 8 })
  })

  it('keeps every existing action in exactly one category', () => {
    const options = SETTINGS_SECTIONS.flatMap((section) => section.options)
    expect(options.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i))
    expect(new Set(options).size).toBe(options.length)
  })

  it('enters each category, reaches its last option and returns to the same category', () => {
    SETTINGS_SECTIONS.forEach((section, index) => {
      let focus = moveSettingsContentFocus({ zone: 'settings-category', index }, 'right')
      expect(focus).toEqual({ zone: 'setting', index: section.options[0] })
      for (const option of section.options.slice(1)) {
        focus = moveSettingsContentFocus(focus, 'down')
        expect(focus).toEqual({ zone: 'setting', index: option })
      }
      expect(moveSettingsContentFocus(focus, 'down')).toEqual(focus)
      expect(moveSettingsContentFocus(focus, 'back')).toEqual({ zone: 'settings-category', index })
    })
  })

  it('returns setup and destructive-action cancellation to their original sections', () => {
    expect(settingsSectionForOption(11)).toBe(2)
    expect(settingsSectionForOption(7)).toBe(2)
    expect(settingsSectionForOption(8)).toBe(2)
    expect(settingsSectionForOption(9)).toBe(3)
    expect(moveSettingsContentFocus({ zone: 'setting', index: 10 }, 'down')).toEqual({ zone: 'setting', index: 9 })
    expect(moveSettingsContentFocus({ zone: 'setting', index: 9 }, 'up')).toEqual({ zone: 'setting', index: 10 })
  })

  it('opens Connection on Link phone or desktop and preserves its Back destination', () => {
    const linkedScreenBack = { zone: 'setting' as const, index: 11 }
    expect(SETTINGS_SECTIONS[2].options).toEqual([11, 7, 8])
    expect(moveSettingsContentFocus({ zone: 'settings-category', index: 2 }, 'select')).toEqual(linkedScreenBack)
    expect(moveSettingsContentFocus(linkedScreenBack, 'up')).toEqual(linkedScreenBack)
    expect(moveSettingsContentFocus(linkedScreenBack, 'down')).toEqual({ zone: 'setting', index: 7 })
    expect(moveSettingsContentFocus(linkedScreenBack, 'back')).toEqual({ zone: 'settings-category', index: 2 })
  })
})
