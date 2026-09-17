import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMERGENCY_HOTKEY,
  formatEmergencyHotkey,
  isEmergencyHotkey,
} from './emergencyHotkey'

describe('emergencyHotkey', () => {
  it('defaults to Ctrl+Esc', () => {
    expect(DEFAULT_EMERGENCY_HOTKEY).toEqual({
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
      key: 'Escape',
    })
    expect(formatEmergencyHotkey()).toBe('Ctrl+Esc')
    expect(formatEmergencyHotkey(DEFAULT_EMERGENCY_HOTKEY)).toBe('Ctrl+Esc')
  })

  it('accepts only Escape chords', () => {
    expect(isEmergencyHotkey(DEFAULT_EMERGENCY_HOTKEY)).toBe(true)
    expect(isEmergencyHotkey({ ...DEFAULT_EMERGENCY_HOTKEY, key: 'F12' })).toBe(false)
    expect(isEmergencyHotkey({ ctrl: true, key: 'Escape' })).toBe(false)
  })
})
