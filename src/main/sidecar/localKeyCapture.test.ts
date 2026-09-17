import { describe, expect, it } from 'vitest'
import { capturedSidecarKeyToLocal } from './localKeyCapture'
import { portableKeyId } from '../../shared/portableKeys'

describe('capturedSidecarKeyToLocal', () => {
  it('maps portable key ids and modifier bits', () => {
    expect(
      capturedSidecarKeyToLocal({
        keyCode: portableKeyId('KeyB'),
        down: true,
        repeat: false,
        location: 0,
        modifiers: { ctrl: true, alt: false, shift: false, meta: false },
      }),
    ).toEqual({
      action: 'down',
      code: 'KeyB',
      location: 0,
      repeat: false,
      modifiers: { ctrl: true, alt: false, shift: false, meta: false },
    })
  })

  it('rejects unknown key ids', () => {
    expect(capturedSidecarKeyToLocal({ keyCode: 0, down: true })).toBeNull()
    expect(capturedSidecarKeyToLocal({ keyCode: 9999, down: false })).toBeNull()
  })
})
