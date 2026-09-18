import { describe, expect, it } from 'vitest'
import {
  CAMERA_PROFILES,
  SCREEN_PROFILES,
  clampCameraToCeiling,
  clampScreenToCeiling,
  scaleResolutionDownBy,
} from './qualityProfiles'

describe('quality profiles', () => {
  it('never upscales when computing scaleResolutionDownBy', () => {
    expect(scaleResolutionDownBy(720, 1080)).toBe(1)
    expect(scaleResolutionDownBy(1080, 1080)).toBe(1)
    expect(scaleResolutionDownBy(undefined, 720)).toBe(1)
    expect(scaleResolutionDownBy(2160, 1080)).toBe(2)
    expect(scaleResolutionDownBy(1440, 720)).toBe(2)
  })

  it('keeps bitrate caps in the profile table', () => {
    expect(SCREEN_PROFILES.ultra.maxBitrate).toBeGreaterThan(SCREEN_PROFILES.high.maxBitrate)
    expect(SCREEN_PROFILES.survival.maxFramerate).toBeLessThanOrEqual(10)
    expect(CAMERA_PROFILES.suspended.active).toBe(false)
    expect(CAMERA_PROFILES.high.active).toBe(true)
  })

  it('clamps rungs to a CPU ceiling without promoting', () => {
    expect(clampScreenToCeiling('ultra', { maxScreen: 'medium', maxCamera: 'low' })).toBe('medium')
    expect(clampScreenToCeiling('low', { maxScreen: 'medium', maxCamera: 'low' })).toBe('low')
    expect(clampCameraToCeiling('high', { maxScreen: 'ultra', maxCamera: 'medium' })).toBe('medium')
    expect(clampCameraToCeiling('suspended', { maxScreen: 'ultra', maxCamera: 'medium' })).toBe(
      'suspended',
    )
  })
})
