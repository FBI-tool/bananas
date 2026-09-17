export const SIDECAR_PROTOCOL_VERSION = 2
export const SIDECAR_MAX_FRAME_BYTES = 1024 * 1024
export const SIDECAR_HEARTBEAT_INTERVAL_MS = 2000
export const SIDECAR_HANDSHAKE_TIMEOUT_MS = 5000
export const SIDECAR_STOP_GRACE_MS = 2000

export const SIDECAR_REQUEST_TYPES = [
  'handshake',
  'get-capabilities',
  'create-overlay',
  'update-overlay',
  'destroy-overlay',
  'heartbeat',
  'shutdown',
  'remote-control-arm',
  'remote-control-disarm',
  'pointer-move',
  'pointer-button',
  'pointer-wheel',
  'keyboard-event',
  'release-all',
  'set-emergency-hotkey',
  'request-input-permission',
  'keyboard-capture-arm',
  'keyboard-capture-disarm',
] as const

export const SIDECAR_RESPONSE_TYPES = [
  'handshake-ok',
  'handshake-error',
  'capabilities',
  'overlay-created',
  'ok',
  'error',
  'heartbeat-ack',
  'event',
] as const

export const SIDECAR_EVENT_TYPES = [
  'remote-control-disabled',
  'remote-control-status',
  'captured-key',
] as const

export type SidecarRequestType = (typeof SIDECAR_REQUEST_TYPES)[number]
export type SidecarResponseType = (typeof SIDECAR_RESPONSE_TYPES)[number]
export type SidecarEventType = (typeof SIDECAR_EVENT_TYPES)[number]

export type PermissionState = 'unknown' | 'granted' | 'denied'

export type RemoteControlUnavailableReason =
  | 'unsupported'
  | 'accessibility-permission'
  | 'input-monitoring-permission'
  | 'uinput-permission'
  | 'evdev-permission'
  | 'hotkey-registration-failed'

export type SidecarCapabilities = {
  overlays: boolean
  clickThrough: boolean
  globalPointerObservation: boolean
  globalKeyboardObservation: boolean
  pointerInjection: boolean
  keyboardInjection: boolean
  emergencyHotkey: boolean
  keyboardCapture: boolean
  displayEnumeration: boolean
  backend?: 'wayland' | 'x11' | 'none' | string
  unavailableReason?: RemoteControlUnavailableReason
  permissions: {
    accessibility?: PermissionState
    screenRecording?: PermissionState
    inputMonitoring?: PermissionState
  }
}

export type SidecarEventMap = {
  'remote-control-disabled': {
    reason: 'emergency-hotkey' | 'native-error' | 'shutdown'
    generation?: number
  }
  'remote-control-status': {
    armed: boolean
    mouse: boolean
    keyboard: boolean
  }
  'captured-key': {
    keyCode: number
    down: boolean
    repeat?: boolean
    location?: number
    modifiers?: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
  }
}

export type NormalizedPoint = {
  x: number
  y: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type OverlaySource = {
  displayId: string
  sourceId?: string
  bounds: Rect
  scaleFactor: number
  rotation: number
}

export type RemoteCursor = {
  peerId: string
  sourceId?: string
  normalizedPosition: NormalizedPoint
  label: string
  appearance: {
    color: string
  }
  ping?: boolean
  pingScale?: number
}

export type OverlayScene = {
  cursors: RemoteCursor[]
}

export type OverlaySpec = {
  displayId: string
  bounds: Rect
  scaleFactor: number
  rotation: number
  clickThrough: true
  alwaysOnTop: true
  content: OverlayScene
}

export type Envelope = {
  protocolVersion: number
  requestId?: string
  type: string
  payload: unknown
}

const REQUEST_TYPE_SET = new Set<string>(SIDECAR_REQUEST_TYPES)
const RESPONSE_TYPE_SET = new Set<string>(SIDECAR_RESPONSE_TYPES)
const EVENT_TYPE_SET = new Set<string>(SIDECAR_EVENT_TYPES)

export const isSidecarEventType = (type: string): type is SidecarEventType =>
  EVENT_TYPE_SET.has(type)

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseEnvelope = (value: unknown): Envelope | null => {
  if (!isRecord(value)) return null
  if (value.protocolVersion !== SIDECAR_PROTOCOL_VERSION) return null
  if (typeof value.type !== 'string' || value.type.length === 0) return null
  if (value.requestId !== undefined && typeof value.requestId !== 'string') return null
  if (!('payload' in value)) return null
  return {
    protocolVersion: SIDECAR_PROTOCOL_VERSION,
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    type: value.type,
    payload: value.payload,
  }
}

export const encodeEnvelope = (envelope: Envelope): Buffer => {
  const json = Buffer.from(JSON.stringify(envelope), 'utf8')
  if (json.length > SIDECAR_MAX_FRAME_BYTES) {
    throw new Error('sidecar frame exceeds maximum size')
  }
  const header = Buffer.alloc(4)
  header.writeUInt32LE(json.length, 0)
  return Buffer.concat([header, json])
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): Envelope[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: Envelope[] = []
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0)
      if (size === 0 || size > SIDECAR_MAX_FRAME_BYTES) {
        throw new Error('sidecar frame size is invalid')
      }
      if (this.buffer.length < 4 + size) return frames
      const payload = this.buffer.subarray(4, 4 + size)
      this.buffer = this.buffer.subarray(4 + size)
      let parsed: unknown
      try {
        parsed = JSON.parse(payload.toString('utf8'))
      } catch {
        throw new Error('sidecar frame is not JSON')
      }
      const envelope = parseEnvelope(parsed)
      if (!envelope) throw new Error('sidecar envelope is invalid')
      frames.push(envelope)
    }
    return frames
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const isNormalizedPoint = (value: unknown): value is NormalizedPoint => {
  if (!isRecord(value)) return false
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1
  )
}

export const isRect = (value: unknown): value is Rect => {
  if (!isRecord(value)) return false
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width >= 0 &&
    value.height >= 0
  )
}

export const isRemoteCursor = (value: unknown): value is RemoteCursor => {
  if (!isRecord(value)) return false
  if (typeof value.peerId !== 'string' || value.peerId.length === 0) return false
  if (value.sourceId !== undefined && typeof value.sourceId !== 'string') return false
  if (!isNormalizedPoint(value.normalizedPosition)) return false
  if (typeof value.label !== 'string') return false
  if (!isRecord(value.appearance) || typeof value.appearance.color !== 'string') return false
  if (value.ping !== undefined && typeof value.ping !== 'boolean') return false
  if (
    value.pingScale !== undefined &&
    (!isFiniteNumber(value.pingScale) || value.pingScale < 1 || value.pingScale > 2)
  ) {
    return false
  }
  return true
}

export const isOverlayScene = (value: unknown): value is OverlayScene => {
  if (!isRecord(value)) return false
  return Array.isArray(value.cursors) && value.cursors.every(isRemoteCursor)
}

export const isOverlaySpec = (value: unknown): value is OverlaySpec => {
  if (!isRecord(value)) return false
  return (
    typeof value.displayId === 'string' &&
    isRect(value.bounds) &&
    isFiniteNumber(value.scaleFactor) &&
    isFiniteNumber(value.rotation) &&
    value.clickThrough === true &&
    value.alwaysOnTop === true &&
    isOverlayScene(value.content)
  )
}

export const isKnownSidecarType = (type: string): boolean =>
  REQUEST_TYPE_SET.has(type) || RESPONSE_TYPE_SET.has(type) || EVENT_TYPE_SET.has(type)
