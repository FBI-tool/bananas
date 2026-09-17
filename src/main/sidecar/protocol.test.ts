import { describe, expect, it } from 'vitest'
import {
  encodeEnvelope,
  FrameDecoder,
  parseEnvelope,
  isKnownSidecarType,
  SIDECAR_MAX_FRAME_BYTES,
  SIDECAR_PROTOCOL_VERSION,
} from './protocol'
import { mapNormalizedToSource, pickSourceForCursor } from './coordinates'

describe('sidecar protocol', () => {
  it('round-trips a handshake envelope', () => {
    const encoded = encodeEnvelope({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      requestId: 'r1',
      type: 'handshake',
      payload: { token: 'abc' },
    })
    const decoder = new FrameDecoder()
    const frames = decoder.push(encoded)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.type).toBe('handshake')
    expect(frames[0]?.requestId).toBe('r1')
  })

  it('rejects oversized frames', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(SIDECAR_MAX_FRAME_BYTES + 1, 0)
    const decoder = new FrameDecoder()
    expect(() => decoder.push(header)).toThrow(/invalid/)
  })

  it('rejects malformed JSON', () => {
    const payload = Buffer.from('{not-json', 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(payload.length, 0)
    const decoder = new FrameDecoder()
    expect(() => decoder.push(Buffer.concat([header, payload]))).toThrow(/JSON/)
  })

  it('rejects protocol version mismatch', () => {
    expect(parseEnvelope({ protocolVersion: 99, type: 'ok', payload: {} })).toBeNull()
  })

  it('flags remote control request types as known', () => {
    expect(isKnownSidecarType('pointer-move')).toBe(true)
    expect(isKnownSidecarType('remote-control-arm')).toBe(true)
    expect(isKnownSidecarType('remote-control-disabled')).toBe(true)
    expect(isKnownSidecarType('keyboard-capture-arm')).toBe(true)
    expect(isKnownSidecarType('captured-key')).toBe(true)
    expect(isKnownSidecarType('request-control')).toBe(false)
  })
})

describe('coordinate mapping', () => {
  const source = {
    displayId: '1',
    bounds: { x: -100, y: 50, width: 200, height: 100 },
    scaleFactor: 2,
    rotation: 0,
  }

  it('maps normalized points onto source bounds including negative origins', () => {
    expect(mapNormalizedToSource({ x: 0, y: 0 }, source)).toEqual({ x: -100, y: 50 })
    expect(mapNormalizedToSource({ x: 1, y: 1 }, source)).toEqual({ x: 100, y: 150 })
    expect(mapNormalizedToSource({ x: 0.5, y: 0.5 }, source)).toEqual({ x: 0, y: 100 })
  })

  it('clamps out-of-range points', () => {
    expect(mapNormalizedToSource({ x: -2, y: 3 }, source)).toEqual({ x: -100, y: 150 })
  })

  it('picks the preferred source id', () => {
    const other = { ...source, displayId: '2' }
    expect(pickSourceForCursor([source, other], '2')?.displayId).toBe('2')
    expect(pickSourceForCursor([source, other], undefined)?.displayId).toBe('1')
  })

  it('maps mixed-DPI and rotated secondary displays', () => {
    const portrait = {
      displayId: '3',
      bounds: { x: 1920, y: -200, width: 1200, height: 1920 },
      scaleFactor: 1.5,
      rotation: 90,
    }
    const mapped = mapNormalizedToSource({ x: 0, y: 0 }, portrait)
    expect(mapped).toEqual({ x: 1920, y: 1720 })
    const bottomRight = mapNormalizedToSource({ x: 1, y: 1 }, portrait)
    expect(bottomRight).toEqual({ x: 3120, y: -200 })
  })
})
