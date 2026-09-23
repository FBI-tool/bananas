import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidecarManager } from './sidecarManager'
import { OverlayBridge } from './overlayBridge'

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      rotation: 0,
    }),
  },
}))

vi.mock('../cursors', () => ({
  createCursorsWindow: vi.fn(async () => ({
    isDestroyed: () => false,
    close: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn() },
  })),
}))

const fakeSidecar = (): SidecarManager =>
  ({
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    isAvailable: vi.fn(() => true),
    createOverlay: vi.fn(async () => 1),
    updateOverlay: vi.fn(async () => undefined),
    destroyOverlay: vi.fn(async () => undefined),
    getCapabilities: vi.fn(() => ({ overlays: true, clickThrough: true })),
  }) as unknown as SidecarManager

describe('OverlayBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces high-frequency cursor updates into one overlay write', async () => {
    const sidecar = fakeSidecar()
    const bridge = new OverlayBridge(sidecar)
    await bridge.toggle(true)
    await bridge.updateCursor({ id: 'a', name: 'A', foregroundColor: '#1a1a1a', backgroundColor: '#fff', x: 0.1, y: 0.2 })
    await bridge.updateCursor({ id: 'a', name: 'A', foregroundColor: '#1a1a1a', backgroundColor: '#fff', x: 0.2, y: 0.3 })
    await bridge.updateCursor({ id: 'a', name: 'A', foregroundColor: '#1a1a1a', backgroundColor: '#fff', x: 0.4, y: 0.5 })
    const updates = vi.mocked(sidecar.updateOverlay)
    const before = updates.mock.calls.length
    await vi.advanceTimersByTimeAsync(20)
    expect(updates.mock.calls.length).toBe(before + 1)
  })

  it('drops invalid cursor payloads', async () => {
    const sidecar = fakeSidecar()
    const bridge = new OverlayBridge(sidecar)
    await bridge.toggle(true)
    await bridge.updateCursor({ id: 'a', name: 'A', foregroundColor: '#1a1a1a', backgroundColor: '#fff', x: 2, y: 0.5 })
    await vi.advanceTimersByTimeAsync(20)
    expect(vi.mocked(sidecar.updateOverlay).mock.calls.length).toBe(1)
  })

  it('pulses pingScale from 1 to 2 and back during ping', async () => {
    const sidecar = fakeSidecar()
    const bridge = new OverlayBridge(sidecar)
    await bridge.toggle(true)
    await bridge.updateCursor({ id: 'a', name: 'A', foregroundColor: '#1a1a1a', backgroundColor: '#fff', x: 0.1, y: 0.2 })
    await vi.advanceTimersByTimeAsync(20)
    vi.mocked(sidecar.updateOverlay).mockClear()
    await bridge.ping('a')
    await vi.advanceTimersByTimeAsync(16)
    const mid = vi.mocked(sidecar.updateOverlay).mock.calls.at(-1)?.[0] as {
      content?: { cursors?: Array<{ pingScale?: number; ping?: boolean }> }
    }
    const midScale = mid?.content?.cursors?.[0]?.pingScale ?? 1
    expect(midScale).toBeGreaterThan(1)
    expect(midScale).toBeLessThanOrEqual(2)
    await vi.advanceTimersByTimeAsync(250)
    const peak = vi.mocked(sidecar.updateOverlay).mock.calls.at(-1)?.[0] as {
      content?: { cursors?: Array<{ pingScale?: number }> }
    }
    expect(peak?.content?.cursors?.[0]?.pingScale ?? 1).toBeGreaterThan(1.5)
    await vi.advanceTimersByTimeAsync(300)
    const done = vi.mocked(sidecar.updateOverlay).mock.calls.at(-1)?.[0] as {
      content?: { cursors?: Array<{ pingScale?: number; ping?: boolean }> }
    }
    expect(done?.content?.cursors?.[0]?.ping).toBe(false)
    expect(done?.content?.cursors?.[0]?.pingScale).toBe(1)
    expect(vi.mocked(sidecar.updateOverlay).mock.calls.length).toBeGreaterThan(5)
  })

  it('ignores ping when the id does not match a live cursor', async () => {
    const sidecar = fakeSidecar()
    const bridge = new OverlayBridge(sidecar)
    await bridge.toggle(true)
    await bridge.updateCursor({ id: 'peer-a', name: 'A', foregroundColor: '#1a1a1a', backgroundColor: '#fff', x: 0.1, y: 0.2 })
    await vi.advanceTimersByTimeAsync(20)
    vi.mocked(sidecar.updateOverlay).mockClear()
    await bridge.ping('cursor-uuid')
    await vi.advanceTimersByTimeAsync(250)
    const mid = vi.mocked(sidecar.updateOverlay).mock.calls.at(-1)?.[0] as {
      content?: { cursors?: Array<{ pingScale?: number; ping?: boolean }> }
    }
    expect(mid?.content?.cursors?.[0]?.ping).toBeFalsy()
    expect(mid?.content?.cursors?.[0]?.pingScale ?? 1).toBe(1)
  })
})
