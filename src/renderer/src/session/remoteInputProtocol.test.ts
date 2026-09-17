import { describe, expect, it } from 'vitest'
import { isPortableKeyCode, portableKeyId } from './portableKeys'
import {
  isStaleGeneration,
  isStaleOrDuplicateSeq,
  parseRemoteInputMessage,
  serializeRemoteInputMessage,
} from './remoteInputProtocol'

describe('remoteInputProtocol', () => {
  it('round-trips a grant message', () => {
    const msg = {
      t: 'remote-control-grant' as const,
      v: 1 as const,
      peerId: 'a',
      mouse: true,
      keyboard: false,
      generation: 2,
    }
    expect(parseRemoteInputMessage(serializeRemoteInputMessage(msg))).toEqual(msg)
  })

  it('clamps pointer-move coordinates to 0..1', () => {
    const parsed = parseRemoteInputMessage(
      JSON.stringify({
        t: 'pointer-move',
        v: 1,
        generation: 1,
        seq: 3,
        x: -0.2,
        y: 1.8,
      }),
    )
    expect(parsed).toEqual({
      t: 'pointer-move',
      v: 1,
      generation: 1,
      seq: 3,
      x: 0,
      y: 1,
    })
  })

  it('clamps extreme wheel deltas', () => {
    const parsed = parseRemoteInputMessage(
      JSON.stringify({
        t: 'pointer-wheel',
        v: 1,
        generation: 1,
        seq: 1,
        deltaX: 99999,
        deltaY: -99999,
      }),
    )
    expect(parsed?.t).toBe('pointer-wheel')
    if (parsed?.t === 'pointer-wheel') {
      expect(parsed.deltaX).toBe(4000)
      expect(parsed.deltaY).toBe(-4000)
    }
  })

  it('rejects unknown types, unknown key codes, and malformed payloads', () => {
    expect(parseRemoteInputMessage('{"t":"cursor","v":1}')).toBeNull()
    expect(parseRemoteInputMessage('not-json')).toBeNull()
    expect(
      parseRemoteInputMessage(
        JSON.stringify({
          t: 'key',
          v: 1,
          generation: 1,
          seq: 1,
          action: 'down',
          code: 'Unidentified',
        }),
      ),
    ).toBeNull()
    expect(
      parseRemoteInputMessage(
        JSON.stringify({
          t: 'pointer-button',
          v: 1,
          generation: 1,
          seq: 1,
          button: 'thumb',
          action: 'down',
        }),
      ),
    ).toBeNull()
  })

  it('accepts an allowlisted key event', () => {
    const parsed = parseRemoteInputMessage(
      JSON.stringify({
        t: 'key',
        v: 1,
        generation: 4,
        seq: 9,
        action: 'up',
        code: 'KeyA',
        modifiers: { ctrl: true, alt: false, shift: false, meta: false },
      }),
    )
    expect(parsed?.t).toBe('key')
    if (parsed?.t === 'key') expect(parsed.code).toBe('KeyA')
  })

  it('rejects stale generation and duplicate sequences', () => {
    expect(isStaleGeneration(1, 2)).toBe(true)
    expect(isStaleGeneration(2, 2)).toBe(false)
    expect(isStaleOrDuplicateSeq(3, 3)).toBe(true)
    expect(isStaleOrDuplicateSeq(2, 3)).toBe(true)
    expect(isStaleOrDuplicateSeq(4, 3)).toBe(false)
  })

  it('maps portable key codes stably', () => {
    expect(isPortableKeyCode('Escape')).toBe(true)
    expect(isPortableKeyCode('KeyA')).toBe(true)
    expect(isPortableKeyCode('Semicolon')).toBe(true)
    expect(isPortableKeyCode('Period')).toBe(true)
    expect(isPortableKeyCode('Slash')).toBe(true)
    expect(isPortableKeyCode('Minus')).toBe(true)
    expect(isPortableKeyCode('Unidentified')).toBe(false)
    expect(portableKeyId('Escape')).toBe(1)
    expect(portableKeyId('Period')).toBe(portableKeyId('Comma') + 1)
  })
})
