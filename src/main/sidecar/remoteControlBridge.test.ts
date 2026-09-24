import { describe, expect, it, vi } from 'vitest'
import {
  parseGrant,
  parseKey,
  parsePointerButton,
  parsePointerMove,
  parsePointerWheel,
  RemoteControlBridge,
} from './remoteControlBridge'
import type { SidecarManager } from './sidecarManager'
import type { OverlaySource } from './protocol'
import { portableKeyId } from '../../shared/portableKeys'

const source: OverlaySource = {
  displayId: '1',
  bounds: { x: 0, y: 0, width: 200, height: 100 },
  scaleFactor: 1,
  rotation: 0,
}

type TestSidecar = SidecarManager & {
  emit: (type: string, payload: unknown) => void
  send: ReturnType<typeof vi.fn>
}

const mockSidecar = (
  caps?: Partial<ReturnType<SidecarManager['getCapabilities']>>,
): TestSidecar => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const send = vi.fn(async () => ({ protocolVersion: 2, type: 'ok', payload: {} }))
  return {
    isStarted: () => true,
    isAvailable: () => true,
    start: vi.fn(async () => undefined),
    getCapabilities: () => ({
      overlays: true,
      clickThrough: true,
      globalPointerObservation: false,
      globalKeyboardObservation: true,
      pointerInjection: true,
      keyboardInjection: true,
      emergencyHotkey: true,
      keyboardCapture: true,
      displayEnumeration: true,
      backend: 'x11',
      permissions: {},
      ...caps,
    }),
    send,
    on: (type: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
      return () => set.delete(listener)
    },
    onStarted: () => () => undefined,
    onStopped: () => () => undefined,
    emit: (type: string, payload: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(payload)
    },
  } as unknown as TestSidecar
}

describe('remoteControlBridge parsers', () => {
  it('rejects desktop coordinates and clamps normalized points', () => {
    expect(parsePointerMove({ generation: 1, seq: 1, x: 0.5, y: 0.5, desktopX: 10 })).toBeNull()
    expect(parsePointerMove({ generation: 1, seq: 1, x: -2, y: 3 })).toEqual({
      generation: 1,
      seq: 1,
      x: 0,
      y: 1,
      sourceId: undefined,
    })
  })

  it('rejects unknown key codes', () => {
    expect(parseKey({ generation: 1, seq: 1, action: 'down', code: 'Unidentified' })).toBeNull()
    expect(parseKey({ generation: 1, seq: 1, action: 'down', code: 'KeyA' })?.code).toBe('KeyA')
  })

  it('rejects malformed button and grant payloads', () => {
    expect(
      parsePointerButton({ generation: 1, seq: 1, button: 'thumb', action: 'down' }),
    ).toBeNull()
    expect(parseGrant({ mouse: true })).toBeNull()
    expect(parseGrant({ mouse: true, keyboard: false })).toEqual({ mouse: true, keyboard: false })
    expect(parsePointerWheel({ generation: 1, seq: 1, deltaX: 1, deltaY: 2 })?.deltaY).toBe(2)
  })
})

describe('RemoteControlBridge', () => {
  it('does not arm without an emergency hotkey capability', async () => {
    const sidecar = mockSidecar({ emergencyHotkey: false })
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await expect(bridge.arm({ mouse: true, keyboard: false })).rejects.toThrow(/not available/)
    expect(bridge.getStatus().armed).toBe(false)
  })

  it('surfaces a failed emergency hotkey registration', async () => {
    const sidecar = mockSidecar()
    sidecar.send.mockImplementation(async (type: string) => {
      if (type === 'set-emergency-hotkey') throw new Error('hotkey-registration-failed')
      return { protocolVersion: 2, type: 'ok', payload: {} }
    })
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await expect(bridge.arm({ mouse: true, keyboard: false })).rejects.toThrow(
      /hotkey-registration-failed/,
    )
    expect(bridge.getStatus().armed).toBe(false)
  })

  it('maps pointer moves through the host source and coalesces pending moves', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: true, keyboard: false, generation: 3 })
    sidecar.send.mockClear()
    let resolveFirst: (() => void) | undefined
    sidecar.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ protocolVersion: 2, type: 'ok', payload: {} })
        }),
    )
    const first = bridge.pointerMove({ generation: 3, seq: 1, x: 0, y: 0 })
    await Promise.resolve()
    const second = bridge.pointerMove({ generation: 3, seq: 2, x: 1, y: 1 })
    resolveFirst?.()
    await first
    await second
    const moves = sidecar.send.mock.calls.filter((call) => call[0] === 'pointer-move')
    expect(moves.length).toBeGreaterThanOrEqual(1)
    expect(moves.some((call) => call[1].x === 1 && call[1].y === 1)).toBe(true)
    expect(moves.some((call) => call[1].source?.bounds?.width === 200)).toBe(true)
  })

  it('rejects pointer events without a mouse grant and stale generations', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: false, keyboard: true, generation: 2 })
    sidecar.send.mockClear()
    await bridge.pointerMove({ generation: 2, seq: 1, x: 0.5, y: 0.5 })
    expect(sidecar.send.mock.calls.some((call) => call[0] === 'pointer-move')).toBe(false)
    await bridge.disarm()
    await bridge.arm({ mouse: true, keyboard: false, generation: 4 })
    sidecar.send.mockClear()
    await bridge.pointerButton({ generation: 3, seq: 1, button: 'left', action: 'down' })
    expect(sidecar.send.mock.calls.some((call) => call[0] === 'pointer-button')).toBe(false)
  })

  it('does not re-arm after an emergency disable', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: true, keyboard: true, generation: 1 })
    sidecar.emit('remote-control-disabled', { reason: 'emergency-hotkey', generation: 1 })
    expect(bridge.getStatus().armed).toBe(false)
    sidecar.send.mockClear()
    await bridge.pointerMove({ generation: 1, seq: 1, x: 0.2, y: 0.2 })
    expect(sidecar.send.mock.calls.some((call) => call[0] === 'pointer-move')).toBe(false)
    await expect(
      bridge.arm({ mouse: true, keyboard: true, generation: 2 }),
    ).resolves.toBeUndefined()
    const arm = sidecar.send.mock.calls.find((call) => call[0] === 'remote-control-arm')
    expect(arm?.[1]).toMatchObject({ emergencyGeneration: 1 })
  })

  it('still injects key-up after action rate limit is exhausted', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: false, keyboard: true, generation: 1 })
    sidecar.send.mockClear()
    for (let seq = 1; seq <= 130; seq += 1) {
      await bridge.key({
        generation: 1,
        seq,
        action: 'down',
        code: 'KeyC',
        repeat: seq > 1,
      })
    }
    await bridge.key({
      generation: 1,
      seq: 131,
      action: 'up',
      code: 'KeyC',
    })
    await vi.waitFor(() => {
      const keys = sidecar.send.mock.calls.filter((call) => call[0] === 'keyboard-event')
      expect(keys.some((call) => call[1].down === 1)).toBe(true)
      expect(
        keys.some((call) => call[1].down === 0 && call[1].keyCode === portableKeyId('KeyC')),
      ).toBe(true)
    })
  })

  it('does not strand a key-up behind a slow sidecar inject', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: false, keyboard: true, generation: 1 })
    sidecar.send.mockClear()
    let releaseDown: (() => void) | undefined
    sidecar.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDown = () => resolve({ protocolVersion: 2, type: 'ok', payload: {} })
        }),
    )
    const down = bridge.key({ generation: 1, seq: 1, action: 'down', code: 'KeyA' })
    const up = bridge.key({ generation: 1, seq: 2, action: 'up', code: 'KeyA' })
    await Promise.all([down, up])
    expect(sidecar.send).toHaveBeenCalledTimes(1)
    expect(sidecar.send.mock.calls[0][1].down).toBe(1)
    releaseDown?.()
    await vi.waitFor(() => {
      expect(
        sidecar.send.mock.calls.some((call) => call[0] === 'keyboard-event' && call[1].down === 0),
      ).toBe(true)
    })
  })

  it('still injects pointer-button up after action rate limit is exhausted', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: true, keyboard: false, generation: 1 })
    sidecar.send.mockClear()
    for (let seq = 1; seq <= 130; seq += 1) {
      await bridge.pointerButton({ generation: 1, seq, button: 'left', action: 'down' })
    }
    await bridge.pointerButton({ generation: 1, seq: 131, button: 'left', action: 'up' })
    const buttons = sidecar.send.mock.calls.filter((call) => call[0] === 'pointer-button')
    expect(buttons.some((call) => call[1].down === 1)).toBe(true)
    expect(buttons.some((call) => call[1].down === 0 && call[1].button === 1)).toBe(true)
  })

  it('drops a queued key after disarm so it cannot run after re-arm', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({
      mouse: false,
      keyboard: true,
      generation: 1,
      sessionId: 'room',
      peerId: 'alice',
    })
    sidecar.send.mockClear()
    let releaseDown: (() => void) | undefined
    sidecar.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDown = () => resolve({ protocolVersion: 2, type: 'ok', payload: {} })
        }),
    )
    const down = bridge.key({ generation: 1, seq: 1, action: 'down', code: 'KeyA' })
    const queued = bridge.key({ generation: 1, seq: 2, action: 'down', code: 'KeyB' })
    await Promise.resolve()
    await bridge.disarm()
    await bridge.arm({
      mouse: false,
      keyboard: true,
      generation: 2,
      sessionId: 'room',
      peerId: 'bob',
    })
    releaseDown?.()
    await down
    await queued
    const keys = sidecar.send.mock.calls.filter((call) => call[0] === 'keyboard-event')
    expect(keys).toHaveLength(1)
    expect(keys[0][1]).toMatchObject({
      keyCode: portableKeyId('KeyA'),
      sessionId: 'room',
      peerId: 'alice',
      grantEpoch: 1,
    })
  })

  it('injects a pointer-button down without waiting behind a slow key inject', async () => {
    const sidecar = mockSidecar()
    const bridge = new RemoteControlBridge(sidecar, () => source)
    await bridge.arm({ mouse: true, keyboard: true, generation: 1 })
    sidecar.send.mockClear()
    sidecar.send.mockImplementation((type: string) => {
      if (type === 'keyboard-event') {
        return new Promise(() => {
          /* hang the key inject */
        })
      }
      return Promise.resolve({ protocolVersion: 2, type: 'ok', payload: {} })
    })
    void bridge.key({ generation: 1, seq: 1, action: 'down', code: 'KeyA' })
    await bridge.pointerButton({ generation: 1, seq: 2, button: 'left', action: 'down' })
    expect(
      sidecar.send.mock.calls.some(
        (call) => call[0] === 'pointer-button' && call[1].down === 1 && call[1].button === 1,
      ),
    ).toBe(true)
  })
})
