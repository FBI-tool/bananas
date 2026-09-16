import { screen, type BrowserWindow } from 'electron'
import { createCursorsWindow } from '../cursors'
import type { OverlaySource, OverlaySpec, RemoteCursor } from './protocol'
import { isRemoteCursor } from './protocol'
import { SidecarManager } from './sidecarManager'

const COALESCE_MS = 16
const PING_MS = 500
const PING_TICK_MS = 16

export type CursorUpdate = {
  id: string
  name: string
  color: string
  x: number
  y: number
  sourceId?: string
}

const isCursorUpdate = (value: unknown): value is CursorUpdate => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.color === 'string' &&
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y)
  )
}

export class OverlayBridge {
  private cursors = new Map<string, RemoteCursor>()
  private pings = new Set<string>()
  private pingStarted = new Map<string, number>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private source: OverlaySource | null = null
  private electronWindow: BrowserWindow | null = null
  private electronActive = false
  private sidecarOverlayCreated = false
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly sidecar: SidecarManager) {}

  setShareSource(source: OverlaySource | null): void {
    this.source = source
    this.scheduleFlush()
  }

  currentSource(): OverlaySource {
    if (this.source) return this.source
    const display = screen.getPrimaryDisplay()
    return {
      displayId: String(display.id),
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
    }
  }

  async toggle(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.disable()
      return
    }
    await this.sidecar.start()
    if (this.sidecar.isAvailable()) {
      const spec = this.spec()
      const id = await this.sidecar.createOverlay(spec)
      this.sidecarOverlayCreated = id !== null
      if (this.sidecarOverlayCreated) {
        await this.flushSidecar()
        return
      }
    }
    await this.enableElectron()
  }

  async updateCursor(raw: unknown): Promise<void> {
    if (!isCursorUpdate(raw)) return
    if (raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1) return
    const peerId = raw.id
    this.cursors.set(peerId, {
      peerId,
      sourceId: raw.sourceId,
      normalizedPosition: { x: raw.x, y: raw.y },
      label: raw.name,
      appearance: { color: raw.color },
      ping: this.pings.has(peerId),
      pingScale: this.pingScaleFor(peerId),
    })
    if (this.electronActive && this.electronWindow && !this.electronWindow.isDestroyed()) {
      const source = this.currentSource()
      this.electronWindow.webContents.send('updateRemoteCursor', {
        id: peerId,
        name: raw.name,
        color: raw.color,
        x: Math.round(raw.x * source.bounds.width),
        y: Math.round(raw.y * source.bounds.height),
      })
    }
    this.scheduleFlush()
  }

  async ping(cursorId: unknown): Promise<void> {
    if (typeof cursorId !== 'string') return
    this.pings.add(cursorId)
    this.pingStarted.set(cursorId, Date.now())
    const existing = this.cursors.get(cursorId)
    if (existing) {
      this.cursors.set(cursorId, {
        ...existing,
        ping: true,
        pingScale: this.pingScaleFor(cursorId),
      })
    }
    if (this.electronActive && this.electronWindow && !this.electronWindow.isDestroyed()) {
      this.electronWindow.webContents.send('remoteCursorPing', cursorId)
    }
    this.tickPing()
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => this.tickPing(), PING_TICK_MS)
    }
  }

  async removeCursor(peerId: unknown): Promise<void> {
    if (typeof peerId !== 'string') return
    this.cursors.delete(peerId)
    this.pings.delete(peerId)
    this.pingStarted.delete(peerId)
    this.scheduleFlush()
  }

  async restoreAfterSidecarRestart(): Promise<void> {
    if (this.cursors.size === 0) return
    if (!this.sidecar.isAvailable()) return
    const id = await this.sidecar.createOverlay(this.spec())
    this.sidecarOverlayCreated = id !== null
    await this.flushSidecar()
  }

  private pingScaleFor(id: string): number {
    const start = this.pingStarted.get(id)
    if (start === undefined) return 1
    const elapsed = Date.now() - start
    if (elapsed >= PING_MS) return 1
    return 1 + Math.sin((Math.PI * elapsed) / PING_MS)
  }

  private tickPing(): void {
    const now = Date.now()
    for (const [id, start] of this.pingStarted.entries()) {
      const elapsed = now - start
      const cur = this.cursors.get(id)
      if (elapsed >= PING_MS) {
        this.pingStarted.delete(id)
        this.pings.delete(id)
        if (cur) this.cursors.set(id, { ...cur, ping: false, pingScale: 1 })
        continue
      }
      if (cur) {
        this.cursors.set(id, {
          ...cur,
          ping: true,
          pingScale: 1 + Math.sin((Math.PI * elapsed) / PING_MS),
        })
      }
    }
    if (this.sidecarOverlayCreated) void this.flushSidecar()
    if (this.pingStarted.size === 0 && this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private spec(): OverlaySpec {
    const source = this.currentSource()
    return {
      displayId: source.displayId,
      bounds: source.bounds,
      scaleFactor: source.scaleFactor,
      rotation: source.rotation,
      clickThrough: true,
      alwaysOnTop: true,
      content: { cursors: [...this.cursors.values()].filter(isRemoteCursor) },
    }
  }

  private scheduleFlush(): void {
    if (!this.sidecarOverlayCreated) return
    if (this.coalesceTimer) return
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = null
      void this.flushSidecar()
    }, COALESCE_MS)
  }

  private async flushSidecar(): Promise<void> {
    if (!this.sidecarOverlayCreated) return
    await this.sidecar.updateOverlay(this.spec())
  }

  private async enableElectron(): Promise<void> {
    if (this.electronWindow && !this.electronWindow.isDestroyed()) {
      this.electronActive = true
      return
    }
    const source = this.currentSource()
    this.electronWindow = await createCursorsWindow({
      x: source.bounds.x,
      y: source.bounds.y,
      width: source.bounds.width,
      height: source.bounds.height,
    })
    this.electronActive = true
    this.electronWindow.on('closed', () => {
      this.electronWindow = null
      this.electronActive = false
    })
  }

  private async disable(): Promise<void> {
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer)
      this.coalesceTimer = null
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    this.cursors.clear()
    this.pings.clear()
    this.pingStarted.clear()
    if (this.sidecarOverlayCreated) {
      await this.sidecar.destroyOverlay()
      this.sidecarOverlayCreated = false
    }
    if (this.electronWindow && !this.electronWindow.isDestroyed()) {
      this.electronWindow.close()
    }
    this.electronWindow = null
    this.electronActive = false
  }
}
