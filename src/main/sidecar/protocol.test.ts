import { describe, expect, it } from 'vitest'
import {
  encodeEnvelope,
  FrameDecoder,
  parseEnvelope,
  isKnownSidecarType,
  SIDECAR_MAX_FRAME_BYTES,
  SIDECAR_PROTOCOL_VERSION,
} from './protocol'
import {
  mapNormalizedToCapture,
  mapNormalizedToPhysical,
  mapNormalizedToSource,
  physicalBoundsForSource,
  physicalCaptureRect,
  pickSourceForCursor,
} from './coordinates'

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

  it('maps normalized points onto physical pixels when scale is not 1', () => {
    const scaled = {
      displayId: '4',
      bounds: { x: 1280, y: -40, width: 1280, height: 720 },
      scaleFactor: 1.5,
      rotation: 0,
    }
    expect(physicalBoundsForSource(scaled)).toEqual({
      x: 1920,
      y: -60,
      width: 1920,
      height: 1080,
    })
    expect(mapNormalizedToPhysical({ x: 0, y: 0 }, scaled)).toEqual({ x: 1920, y: -60 })
    expect(mapNormalizedToPhysical({ x: 1, y: 1 }, scaled)).toEqual({ x: 3840, y: 1020 })
    expect(mapNormalizedToPhysical({ x: 0.5, y: 0.5 }, scaled)).toEqual({ x: 2880, y: 480 })
    expect(mapNormalizedToSource({ x: 0.5, y: 0.5 }, scaled)).toEqual({ x: 1920, y: 320 })
  })

  it('maps a window nested in a scaled display with a negative origin', () => {
    const display = {
      displayId: '5',
      bounds: { x: -100, y: 50, width: 800, height: 600 },
      scaleFactor: 2,
      rotation: 0,
      windowShare: true,
      capture: { x: 100, y: 80, width: 400, height: 300 },
    }
    expect(physicalCaptureRect(display)).toEqual({
      x: 200,
      y: 160,
      width: 800,
      height: 600,
    })
    expect(mapNormalizedToCapture({ x: 0, y: 0 }, display)).toEqual({ x: 200, y: 160 })
    expect(mapNormalizedToCapture({ x: 1, y: 1 }, display)).toEqual({ x: 999, y: 759 })
    expect(mapNormalizedToCapture({ x: 0.5, y: 0.5 }, display)).toEqual({ x: 599.5, y: 459.5 })
  })

  it('maps a full-screen share across the display when capture is omitted', () => {
    const display = {
      displayId: '5',
      bounds: { x: -100, y: 50, width: 800, height: 600 },
      scaleFactor: 2,
      rotation: 0,
    }
    expect(physicalCaptureRect(display)).toEqual({
      x: -200,
      y: 100,
      width: 1600,
      height: 1200,
    })
    expect(mapNormalizedToCapture({ x: 0, y: 0 }, display)).toEqual({ x: -200, y: 100 })
    expect(mapNormalizedToCapture({ x: 1, y: 1 }, display)).toEqual({ x: 1399, y: 1299 })
  })
})
