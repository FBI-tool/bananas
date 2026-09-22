import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import {
  encodeEnvelope,
  FrameDecoder,
  isSidecarEventType,
  SIDECAR_HANDSHAKE_TIMEOUT_MS,
  SIDECAR_HEARTBEAT_INTERVAL_MS,
  SIDECAR_PROTOCOL_VERSION,
  SIDECAR_STOP_GRACE_MS,
  type Envelope,
  type OverlaySpec,
  type SidecarCapabilities,
  type SidecarEventMap,
  type SidecarEventType,
} from './protocol'

export type SidecarLogger = {
  info: (message: string, detail?: unknown) => void
  warn: (message: string, detail?: unknown) => void
  error: (message: string, detail?: unknown) => void
}

const silentLogger: SidecarLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export const defaultCapabilities = (): SidecarCapabilities => ({
  overlays: false,
  clickThrough: false,
  globalPointerObservation: false,
  globalKeyboardObservation: false,
  pointerInjection: false,
  keyboardInjection: false,
  emergencyHotkey: false,
  keyboardCapture: false,
  displayEnumeration: false,
  backend: 'none',
  permissions: {
    accessibility: 'unknown',
    screenRecording: 'unknown',
    inputMonitoring: 'unknown',
  },
})

const isCapabilities = (value: unknown): value is SidecarCapabilities => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.overlays === 'boolean' && typeof v.clickThrough === 'boolean'
}

const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const PERMISSION_STATES = [
  'unknown',
  'granted',
  'denied',
  'unavailable',
  'restart-required',
] as const

const asPermission = (value: unknown): SidecarCapabilities['permissions']['accessibility'] =>
  typeof value === 'string' &&
  (PERMISSION_STATES as readonly string[]).includes(value)
    ? (value as SidecarCapabilities['permissions']['accessibility'])
    : 'unknown'

const sanitizeCapabilities = (value: SidecarCapabilities): SidecarCapabilities => ({
  overlays: asBool(value.overlays, false),
  clickThrough: asBool(value.clickThrough, false),
  globalPointerObservation: asBool(value.globalPointerObservation, false),
  globalKeyboardObservation: asBool(value.globalKeyboardObservation, false),
  pointerInjection: asBool(value.pointerInjection, false),
  keyboardInjection: asBool(value.keyboardInjection, false),
  emergencyHotkey: asBool(value.emergencyHotkey, false),
  keyboardCapture: asBool(value.keyboardCapture, false),
  displayEnumeration: asBool(value.displayEnumeration, false),
  backend: typeof value.backend === 'string' ? value.backend : 'none',
  unavailableReason:
    typeof value.unavailableReason === 'string' ? value.unavailableReason : undefined,
  permissions: {
    accessibility: asPermission(value.permissions?.accessibility),
    screenRecording: asPermission(value.permissions?.screenRecording),
    inputMonitoring: asPermission(value.permissions?.inputMonitoring),
  },
})

export const resolveSidecarPath = (
  cwd = process.cwd(),
  resourcesPath = process.resourcesPath,
): string | null => {
  const exe = process.platform === 'win32' ? 'p2p-kiwi-sidecar.exe' : 'p2p-kiwi-sidecar'
  if (process.platform === 'darwin' && resourcesPath) {
    const helper = join(
      resourcesPath,
      '..',
      'Helpers',
      'p2p.kiwi Sidecar.app',
      'Contents',
      'MacOS',
      exe,
    )
    if (existsSync(helper)) return helper
  }
  const packaged = join(resourcesPath ?? '', 'sidecar', exe)
  if (existsSync(packaged)) return packaged
  const dev = join(cwd, 'native', 'overlay-sidecar', 'dist', exe)
  if (existsSync(dev)) return dev
  return null
}

export const ipcPathForId = (id: string): string => {
  if (process.platform === 'win32') return `\\\\.\\pipe\\p2p-kiwi-sidecar-${id}`
  const candidates = [process.env.XDG_RUNTIME_DIR, join(tmpdir(), 'p2p-kiwi')]
  for (const dir of candidates) {
    if (!dir) continue
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      return join(dir, `p2p-kiwi-sidecar-${id}.sock`)
    } catch {
      continue
    }
  }
  return join(tmpdir(), `p2p-kiwi-sidecar-${id}.sock`)
}

export const tokenFileForId = (id: string): string => {
  const dir = join(tmpdir(), 'p2p-kiwi')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, `${id}.token`)
}

export class SidecarManager {
  private child: ChildProcess | null = null
  private socket: net.Socket | null = null
  private server: net.Server | null = null
  private decoder = new FrameDecoder()
  private pending = new Map<
    string,
    { resolve: (env: Envelope) => void; reject: (err: Error) => void }
  >()
  private capabilities: SidecarCapabilities = defaultCapabilities()
  private started = false
  private restartCount = 0
  private lastStartAt = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private overlayId: number | null = null
  private crashing = false
  private logger: SidecarLogger
  private debugLogs: boolean
  private eventListeners = new Map<SidecarEventType, Set<(payload: never) => void>>()
  private startedListeners = new Set<() => void>()
  private stoppedListeners = new Set<() => void>()

  private spawnImpl: typeof nodeSpawn
  private resolvePathImpl: () => string | null

  constructor(opts?: {
    logger?: SidecarLogger
    debugLogs?: boolean
    spawn?: typeof nodeSpawn
    resolvePath?: () => string | null
  }) {
    this.logger = opts?.logger ?? silentLogger
    this.debugLogs = Boolean(opts?.debugLogs)
    this.spawnImpl = opts?.spawn ?? nodeSpawn
    this.resolvePathImpl = opts?.resolvePath ?? (() => resolveSidecarPath())
  }

  setDebugLogs(enabled: boolean): void {
    this.debugLogs = enabled
  }

  isAvailable(): boolean {
    return this.started && this.capabilities.overlays
  }

  isStarted(): boolean {
    return this.started
  }

  getCapabilities(): SidecarCapabilities {
    return this.capabilities
  }

  on<K extends SidecarEventType>(
    type: K,
    listener: (payload: SidecarEventMap[K]) => void,
  ): () => void {
    const set = this.eventListeners.get(type) ?? new Set()
    set.add(listener as (payload: never) => void)
    this.eventListeners.set(type, set)
    return () => {
      set.delete(listener as (payload: never) => void)
    }
  }

  onStarted(listener: () => void): () => void {
    this.startedListeners.add(listener)
    return () => {
      this.startedListeners.delete(listener)
    }
  }

  onStopped(listener: () => void): () => void {
    this.stoppedListeners.add(listener)
    return () => {
      this.stoppedListeners.delete(listener)
    }
  }

  async send(type: string, payload: unknown, timeoutMs = 4000): Promise<Envelope> {
    const res = await this.request(type, payload, timeoutMs)
    if (
      type === 'set-emergency-hotkey' ||
      type === 'request-input-permission' ||
      type === 'keyboard-capture-arm'
    ) {
      await this.refreshCapabilities()
    }
    return res
  }

  async refreshCapabilities(): Promise<void> {
    if (!this.started) return
    const caps = await this.request('get-capabilities', {})
    if (caps.type === 'capabilities' && isCapabilities(caps.payload)) {
      this.capabilities = sanitizeCapabilities({
        ...defaultCapabilities(),
        ...caps.payload,
      })
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    const binary = this.resolvePathImpl()
    if (!binary) {
      this.logger.warn('sidecar binary not found; using Electron overlay fallback')
      return
    }
    const id = randomBytes(8).toString('hex')
    const token = randomBytes(32).toString('hex')
    const path = ipcPathForId(id)
    const tokenFile = tokenFileForId(id)
    writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') {
      try {
        unlinkSync(path)
      } catch {
        // ignore
      }
    }

    const connected = new Promise<net.Socket>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('sidecar handshake timeout')),
        SIDECAR_HANDSHAKE_TIMEOUT_MS,
      )
      this.server = net.createServer((sock) => {
        clearTimeout(timer)
        resolve(sock)
      })
      this.server.once('error', reject)
      this.server.listen(path, () => {
        if (process.platform !== 'win32') {
          try {
            chmodSync(path, 0o600)
          } catch {
            // ignore
          }
        }
      })
    })

    this.child = this.spawnImpl(binary, ['--socket', path, '--token-file', tokenFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    })
    this.attachChildLogs()
    this.child.once('exit', (code) => {
      this.logger.warn('sidecar exited', { code })
      void this.handleExit()
    })

    try {
      this.socket = await connected
      this.socket.on('data', (chunk) =>
        this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      )
      this.socket.on('error', (err) => this.logger.warn('sidecar socket error', err.message))
      const hello = await this.request('handshake', { token })
      if (hello.type !== 'handshake-ok') {
        throw new Error('sidecar handshake failed')
      }
      const caps = await this.request('get-capabilities', {})
      if (caps.type === 'capabilities' && isCapabilities(caps.payload)) {
        this.capabilities = sanitizeCapabilities({
          ...defaultCapabilities(),
          ...caps.payload,
        })
      }
      this.started = true
      this.lastStartAt = Date.now()
      this.heartbeat = setInterval(() => {
        void this.request('heartbeat', {}).catch(() => undefined)
      }, SIDECAR_HEARTBEAT_INTERVAL_MS)
      this.logger.info('sidecar started', {
        overlays: this.capabilities.overlays,
        backend: this.capabilities.backend ?? 'none',
        pointerInjection: this.capabilities.pointerInjection,
        keyboardInjection: this.capabilities.keyboardInjection,
        emergencyHotkey: this.capabilities.emergencyHotkey,
        keyboardCapture: this.capabilities.keyboardCapture,
        unavailableReason: this.capabilities.unavailableReason,
      })
      for (const listener of this.startedListeners) listener()
    } catch (error) {
      this.logger.warn('sidecar start failed', error)
      await this.stop()
    }
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.socket && this.child) {
      try {
        await this.request('shutdown', {}, 500)
      } catch {
        // ignore
      }
    }
    this.socket?.destroy()
    this.socket = null
    this.server?.close()
    this.server = null
    const child = this.child
    this.child = null
    if (child && child.exitCode === null && child.pid) {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
          resolve()
        }, SIDECAR_STOP_GRACE_MS)
        child.once('exit', () => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    this.decoder.reset()
    this.overlayId = null
    this.capabilities = defaultCapabilities()
    this.emitEvent('remote-control-disabled', { reason: 'shutdown' })
    for (const listener of this.stoppedListeners) listener()
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async createOverlay(spec: OverlaySpec): Promise<number | null> {
    if (!this.isAvailable()) return null
    const res = await this.request('create-overlay', spec)
    if (res.type === 'overlay-created' && res.payload && typeof res.payload === 'object') {
      const id = Number((res.payload as { id?: number }).id)
      if (Number.isFinite(id)) {
        this.overlayId = id
        return id
      }
    }
    return null
  }

  async updateOverlay(spec: OverlaySpec): Promise<void> {
    if (!this.isAvailable() || this.overlayId === null) return
    await this.request('update-overlay', { id: this.overlayId, ...spec })
  }

  async destroyOverlay(): Promise<void> {
    if (!this.started || this.overlayId === null) return
    await this.request('destroy-overlay', { id: this.overlayId }).catch(() => undefined)
    this.overlayId = null
  }

  private attachChildLogs(): void {
    if (!this.child) return
    const onChunk = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return
      stream.on('data', (buf: Buffer) => {
        if (!this.debugLogs) return
        const text = buf.toString('utf8').trim()
        if (text) this.logger.info('sidecar', text.slice(0, 500))
      })
    }
    onChunk(this.child.stdout)
    onChunk(this.child.stderr)
  }

  private async handleExit(): Promise<void> {
    const wasStarted = this.started
    this.started = false
    this.socket?.destroy()
    this.socket = null
    if (wasStarted) {
      this.emitEvent('remote-control-disabled', { reason: 'shutdown' })
      for (const listener of this.stoppedListeners) listener()
    }
    if (!wasStarted || this.crashing) return
    const now = Date.now()
    if (now - this.lastStartAt < 5000) this.restartCount += 1
    else this.restartCount = 0
    if (this.restartCount > 3) {
      this.logger.error('sidecar restart loop stopped')
      return
    }
    this.crashing = true
    const delay = Math.min(8000, 500 * 2 ** this.restartCount)
    setTimeout(() => {
      this.crashing = false
      void this.start()
    }, delay)
  }

  private onData(chunk: Buffer): void {
    let frames: Envelope[]
    try {
      frames = this.decoder.push(chunk)
    } catch (error) {
      this.logger.warn('sidecar frame error', error)
      this.socket?.destroy()
      return
    }
    for (const frame of frames) {
      if (frame.requestId && this.pending.has(frame.requestId)) {
        this.pending.get(frame.requestId)?.resolve(frame)
        this.pending.delete(frame.requestId)
        continue
      }
      if (isSidecarEventType(frame.type)) {
        this.emitEvent(frame.type, frame.payload as SidecarEventMap[typeof frame.type])
      }
    }
  }

  private emitEvent<K extends SidecarEventType>(type: K, payload: SidecarEventMap[K]): void {
    const set = this.eventListeners.get(type)
    if (!set) return
    for (const listener of set) listener(payload as never)
  }

  private request(type: string, payload: unknown, timeoutMs = 4000): Promise<Envelope> {
    const requestId = randomBytes(8).toString('hex')
    const envelope: Envelope = {
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      requestId,
      type,
      payload,
    }
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('sidecar is not connected'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`sidecar request timeout: ${type}`))
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (env) => {
          clearTimeout(timer)
          resolve(env)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this.socket.write(encodeEnvelope(envelope))
    })
  }
}

export const createAppSidecarManager = (): SidecarManager => {
  const logger: SidecarLogger = {
    info: (message, detail) => {
      if (detail !== undefined) console.log('[sidecar]', message, detail)
      else console.log('[sidecar]', message)
    },
    warn: (message, detail) => console.warn('[sidecar]', message, detail ?? ''),
    error: (message, detail) => console.error('[sidecar]', message, detail ?? ''),
  }
  return new SidecarManager({ logger, debugLogs: false })
}
