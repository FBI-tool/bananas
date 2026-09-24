import { BrowserWindow } from 'electron'
import { orientNormalized } from './coordinates'
import { portableKeyId, isPortableKeyCode, type PortableKeyCode } from '../../shared/portableKeys'
import {
  DEFAULT_EMERGENCY_HOTKEY,
  isEmergencyHotkey,
  type EmergencyHotkey,
} from '../../shared/emergencyHotkey'
import type { OverlaySource, SidecarCapabilities } from './protocol'
import type { SidecarManager } from './sidecarManager'

const POINTER_RATE_PER_SEC = 240
const ACTION_RATE_PER_SEC = 120
const WHEEL_RATE_PER_SEC = 120
const MOVE_TIMEOUT_MS = 250

export type RemoteControlStatus = {
  armed: boolean
  mouse: boolean
  keyboard: boolean
  generation: number
}

export type EmergencyDisableEvent = {
  reason:
    | 'emergency-hotkey'
    | 'permission-lost'
    | 'explicit-revoke'
    | 'ipc-lost'
    | 'shutdown'
    | 'native-error'
  generation?: number
}

export type RemotePointerMoveInput = {
  generation: number
  seq: number
  x: number
  y: number
  sourceId?: string
}

export type RemotePointerButtonInput = {
  generation: number
  seq: number
  button: 'left' | 'middle' | 'right' | 'back' | 'forward'
  action: 'down' | 'up'
}

export type RemotePointerWheelInput = {
  generation: number
  seq: number
  deltaX: number
  deltaY: number
}

export type RemoteKeyInput = {
  generation: number
  seq: number
  action: 'down' | 'up'
  code: PortableKeyCode
  location?: number
  repeat?: boolean
  modifiers?: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const BUTTON_IDS: Record<RemotePointerButtonInput['button'], number> = {
  left: 1,
  middle: 2,
  right: 3,
  back: 4,
  forward: 5,
}

class RateLimiter {
  private stamps: number[] = []
  constructor(private readonly maxPerSec: number) {}

  allow(): boolean {
    const now = Date.now()
    this.stamps = this.stamps.filter((t) => now - t < 1000)
    if (this.stamps.length >= this.maxPerSec) return false
    this.stamps.push(now)
    return true
  }
}

export class RemoteControlBridge {
  private armed = false
  private mouse = false
  private keyboard = false
  private generation = 0
  private pendingMove: { x: number; y: number } | null = null
  private moveInFlight = false
  private pointerRate = new RateLimiter(POINTER_RATE_PER_SEC)
  private buttonRate = new RateLimiter(ACTION_RATE_PER_SEC)
  private wheelRate = new RateLimiter(WHEEL_RATE_PER_SEC)
  private keyRate = new RateLimiter(ACTION_RATE_PER_SEC)
  private actionInjectQueue: Promise<void> = Promise.resolve()
  private mainWindow: BrowserWindow | null = null
  private hotkey: EmergencyHotkey = DEFAULT_EMERGENCY_HOTKEY
  private emergencyGeneration = 0
  private injectEpoch = 0
  private sessionId = ''
  private peerId = ''
  private unsubscribers: Array<() => void> = []

  constructor(
    private readonly sidecar: SidecarManager,
    private readonly getSource: () => OverlaySource | null,
  ) {
    this.unsubscribers.push(
      this.sidecar.on('remote-control-disabled', (event) => {
        if (typeof event.generation === 'number' && Number.isFinite(event.generation)) {
          this.emergencyGeneration = event.generation
        }
        this.failClosed()
        this.notifyRenderer('remote-control-emergency', event)
      }),
    )
    this.unsubscribers.push(
      this.sidecar.onStopped(() => {
        this.failClosed()
      }),
    )
    this.unsubscribers.push(
      this.sidecar.onStarted(() => {
        this.scheduleHotkey()
      }),
    )
  }

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win
  }

  setHotkey(hotkey: EmergencyHotkey): void {
    this.hotkey = hotkey
    if (this.sidecar.isStarted()) this.scheduleHotkey()
  }

  getStatus(): RemoteControlStatus {
    return {
      armed: this.armed,
      mouse: this.mouse,
      keyboard: this.keyboard,
      generation: this.generation,
    }
  }

  getCapabilities(): SidecarCapabilities {
    return this.sidecar.getCapabilities()
  }

  canArm(grant: { mouse: boolean; keyboard: boolean }): boolean {
    const caps = this.sidecar.getCapabilities()
    if (!caps.emergencyHotkey) return false
    if (grant.mouse && !caps.pointerInjection) return false
    if (grant.keyboard && !caps.keyboardInjection) return false
    return grant.mouse || grant.keyboard
  }

  async ensureStarted(): Promise<void> {
    await this.sidecar.start()
    if (this.sidecar.isStarted()) await this.configureHotkey()
  }

  getEmergencyGeneration(): number {
    return this.emergencyGeneration
  }

  async arm(grant: {
    mouse: boolean
    keyboard: boolean
    generation?: number
    sessionId?: string
    peerId?: string
  }): Promise<void> {
    await this.ensureStarted()
    if (!this.canArm(grant)) {
      throw new Error('remote control is not available')
    }
    const emergencyGeneration = this.emergencyGeneration
    const sessionId = typeof grant.sessionId === 'string' ? grant.sessionId : ''
    const peerId = typeof grant.peerId === 'string' ? grant.peerId : ''
    const payload: Record<string, unknown> = {
      mouse: Boolean(grant.mouse),
      keyboard: Boolean(grant.keyboard),
      emergencyGeneration,
    }
    if (sessionId !== '' && peerId !== '' && typeof grant.generation === 'number') {
      payload.sessionId = sessionId
      payload.peerId = peerId
      payload.grantEpoch = grant.generation
    }
    const res = await this.sidecar.send('remote-control-arm', payload)
    if (this.emergencyGeneration !== emergencyGeneration) {
      await this.sidecar.send('remote-control-disarm', {}).catch(() => undefined)
      this.failClosed()
      throw new Error('remote control emergency stop')
    }
    if (res.type === 'error') throw new Error('sidecar refused to arm remote control')
    this.armed = true
    this.mouse = Boolean(grant.mouse)
    this.keyboard = Boolean(grant.keyboard)
    if (typeof grant.generation === 'number' && Number.isFinite(grant.generation)) {
      this.generation = grant.generation
    }
    this.sessionId = sessionId
    this.peerId = peerId
    this.notifyRenderer('remote-control-status', this.getStatus())
  }

  async disarm(): Promise<void> {
    this.pendingMove = null
    if (this.sidecar.isStarted()) {
      await this.sidecar.send('remote-control-disarm', {}).catch(() => undefined)
    }
    this.failClosed(false)
  }

  async releaseAll(): Promise<void> {
    if (!this.sidecar.isStarted()) return
    await this.sidecar.send('release-all', {}).catch(() => undefined)
  }

  async recheck(): Promise<SidecarCapabilities> {
    if (this.sidecar.isStarted()) {
      await this.configureHotkey()
      await this.sidecar.refreshCapabilities()
    }
    return this.sidecar.getCapabilities()
  }

  async requestPermission(capability: 'post' | 'listen' = 'post'): Promise<void> {
    await this.ensureStarted()
    if (!this.sidecar.isStarted()) return
    await this.sidecar.send('request-input-permission', { capability }).catch(() => undefined)
  }

  async pointerMove(input: unknown): Promise<void> {
    const parsed = parsePointerMove(input)
    if (!parsed) return
    if (!this.armed || !this.mouse) return
    if (parsed.generation !== this.generation && this.generation !== 0) return
    if (!this.pointerRate.allow()) return
    const source = this.getSource()
    if (!source) return
    const oriented = orientNormalized({ x: parsed.x, y: parsed.y }, source.rotation)
    if (this.moveInFlight) {
      this.pendingMove = oriented
      return
    }
    await this.flushMove(oriented)
  }

  async pointerButton(input: unknown): Promise<void> {
    const parsed = parsePointerButton(input)
    if (!parsed) return
    if (!this.armed || !this.mouse) return
    if (parsed.generation !== this.generation && this.generation !== 0) return
    if (parsed.action !== 'up' && !this.buttonRate.allow()) return
    await this.sidecar.send('pointer-button', {
      button: BUTTON_IDS[parsed.button],
      down: parsed.action === 'down' ? 1 : 0,
      ...this.grantStamp(),
    })
  }

  async wheel(input: unknown): Promise<void> {
    const parsed = parsePointerWheel(input)
    if (!parsed) return
    if (!this.armed || !this.mouse) return
    if (parsed.generation !== this.generation && this.generation !== 0) return
    if (!this.wheelRate.allow()) return
    this.enqueueActionInject(() =>
      this.sidecar.send('pointer-wheel', {
        deltaX: parsed.deltaX,
        deltaY: parsed.deltaY,
        ...this.grantStamp(),
      }),
    )
  }

  async key(input: unknown): Promise<void> {
    const parsed = parseKey(input)
    if (!parsed) return
    if (!this.armed || !this.keyboard) return
    if (parsed.generation !== this.generation && this.generation !== 0) return
    if (parsed.action !== 'up' && !this.keyRate.allow()) return
    const code = portableKeyId(parsed.code)
    this.enqueueActionInject(() =>
      this.sidecar.send('keyboard-event', {
        keyCode: code,
        down: parsed.action === 'down' ? 1 : 0,
        location: parsed.location ?? 0,
        repeat: parsed.repeat ? 1 : 0,
        modifiers: {
          ctrl: Boolean(parsed.modifiers?.ctrl),
          alt: Boolean(parsed.modifiers?.alt),
          shift: Boolean(parsed.modifiers?.shift),
          meta: Boolean(parsed.modifiers?.meta),
        },
        ...this.grantStamp(),
      }),
    )
  }

  private grantStamp(): Record<string, unknown> {
    if (this.sessionId === '' || this.peerId === '') return {}
    return {
      sessionId: this.sessionId,
      peerId: this.peerId,
      grantEpoch: this.generation,
    }
  }

  private enqueueActionInject(send: () => Promise<unknown>): void {
    const epoch = this.injectEpoch
    this.actionInjectQueue = this.actionInjectQueue
      .then(async () => {
        if (epoch !== this.injectEpoch || !this.armed) return
        await send()
      })
      .catch(() => undefined)
  }

  private async flushMove(point: { x: number; y: number }): Promise<void> {
    const epoch = this.injectEpoch
    this.moveInFlight = true
    try {
      let current: { x: number; y: number } | null = point
      while (current) {
        if (epoch !== this.injectEpoch || !this.armed) {
          this.pendingMove = null
          return
        }
        const source = this.getSource()
        if (!source) {
          this.pendingMove = null
          return
        }
        await this.sidecar.send(
          'pointer-move',
          {
            x: current.x,
            y: current.y,
            source: {
              displayId: source.displayId,
              bounds: source.bounds,
              scaleFactor: source.scaleFactor,
              rotation: 0,
            },
            ...this.grantStamp(),
          },
          MOVE_TIMEOUT_MS,
        )
        current = this.pendingMove
        this.pendingMove = null
      }
    } catch {
      this.pendingMove = null
    } finally {
      this.moveInFlight = false
    }
  }

  private failClosed(notifyStatus = true): void {
    this.injectEpoch += 1
    this.armed = false
    this.mouse = false
    this.keyboard = false
    this.pendingMove = null
    this.sessionId = ''
    this.peerId = ''
    if (notifyStatus) this.notifyRenderer('remote-control-status', this.getStatus())
  }

  private scheduleHotkey(): void {
    void this.configureHotkey().catch((error: unknown) => {
      console.warn('[sidecar] emergency hotkey registration failed', error)
    })
  }

  private async configureHotkey(): Promise<void> {
    if (!this.sidecar.isStarted()) return
    await this.sidecar.send('set-emergency-hotkey', this.hotkey)
  }

  private notifyRenderer(channel: string, payload: unknown): void {
    const win = this.mainWindow
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }
}

export const parsePointerMove = (value: unknown): RemotePointerMoveInput | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if ('desktopX' in v || 'desktopY' in v || 'displayBounds' in v) return null
  if (
    !isFiniteNumber(v.generation) ||
    !isFiniteNumber(v.seq) ||
    !isFiniteNumber(v.x) ||
    !isFiniteNumber(v.y)
  ) {
    return null
  }
  return {
    generation: v.generation,
    seq: v.seq,
    x: clamp01(v.x),
    y: clamp01(v.y),
    sourceId: typeof v.sourceId === 'string' ? v.sourceId : undefined,
  }
}

export const parsePointerButton = (value: unknown): RemotePointerButtonInput | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    !isFiniteNumber(v.generation) ||
    !isFiniteNumber(v.seq) ||
    (v.button !== 'left' &&
      v.button !== 'middle' &&
      v.button !== 'right' &&
      v.button !== 'back' &&
      v.button !== 'forward') ||
    (v.action !== 'down' && v.action !== 'up')
  ) {
    return null
  }
  return {
    generation: v.generation,
    seq: v.seq,
    button: v.button,
    action: v.action,
  }
}

export const parsePointerWheel = (value: unknown): RemotePointerWheelInput | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    !isFiniteNumber(v.generation) ||
    !isFiniteNumber(v.seq) ||
    !isFiniteNumber(v.deltaX) ||
    !isFiniteNumber(v.deltaY)
  ) {
    return null
  }
  const clamp = (n: number): number => Math.min(4000, Math.max(-4000, n))
  return {
    generation: v.generation,
    seq: v.seq,
    deltaX: clamp(v.deltaX),
    deltaY: clamp(v.deltaY),
  }
}

export const parseKey = (value: unknown): RemoteKeyInput | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    !isFiniteNumber(v.generation) ||
    !isFiniteNumber(v.seq) ||
    (v.action !== 'down' && v.action !== 'up') ||
    !isPortableKeyCode(v.code)
  ) {
    return null
  }
  return {
    generation: v.generation,
    seq: v.seq,
    action: v.action,
    code: v.code,
    location: isFiniteNumber(v.location) ? v.location : undefined,
    repeat: typeof v.repeat === 'boolean' ? v.repeat : undefined,
    modifiers:
      v.modifiers && typeof v.modifiers === 'object'
        ? {
            ctrl: Boolean((v.modifiers as { ctrl?: boolean }).ctrl),
            alt: Boolean((v.modifiers as { alt?: boolean }).alt),
            shift: Boolean((v.modifiers as { shift?: boolean }).shift),
            meta: Boolean((v.modifiers as { meta?: boolean }).meta),
          }
        : undefined,
  }
}

export const parseGrant = (value: unknown): { mouse: boolean; keyboard: boolean } | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.mouse !== 'boolean' || typeof v.keyboard !== 'boolean') return null
  return { mouse: v.mouse, keyboard: v.keyboard }
}

export const parseHotkeySetting = (value: unknown): EmergencyHotkey =>
  isEmergencyHotkey(value) ? value : DEFAULT_EMERGENCY_HOTKEY
