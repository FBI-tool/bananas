import { isPortableKeyCode, type PortableKeyCode } from './portableKeys'

export const REMOTE_INPUT_VERSION = 1 as const

export type RemoteControlGrant = {
  mouse: boolean
  keyboard: boolean
}

export type RemoteControlRevokeReason =
  | 'host'
  | 'emergency'
  | 'disconnect'
  | 'presenter-change'
  | 'sharing-stopped'

export type RemoteControlRequestMessage = {
  t: 'remote-control-request'
  v: typeof REMOTE_INPUT_VERSION
  peerId: string
  mouse: boolean
  keyboard: boolean
}

export type RemoteControlGrantMessage = {
  t: 'remote-control-grant'
  v: typeof REMOTE_INPUT_VERSION
  peerId: string
  mouse: boolean
  keyboard: boolean
  generation: number
}

export type RemoteControlRevokeMessage = {
  t: 'remote-control-revoke'
  v: typeof REMOTE_INPUT_VERSION
  peerId: string
  generation: number
  reason?: RemoteControlRevokeReason
}

export type RemotePointerButtonName = 'left' | 'middle' | 'right' | 'back' | 'forward'
export type RemotePointerAction = 'down' | 'up'
export type RemoteKeyAction = 'down' | 'up'

export type RemotePointerMove = {
  t: 'pointer-move'
  v: typeof REMOTE_INPUT_VERSION
  generation: number
  seq: number
  sourceId?: string
  x: number
  y: number
}

export type RemotePointerButton = {
  t: 'pointer-button'
  v: typeof REMOTE_INPUT_VERSION
  generation: number
  seq: number
  button: RemotePointerButtonName
  action: RemotePointerAction
}

export type RemotePointerWheel = {
  t: 'pointer-wheel'
  v: typeof REMOTE_INPUT_VERSION
  generation: number
  seq: number
  deltaX: number
  deltaY: number
}

export type RemoteKeyModifiers = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export type RemoteKeyEvent = {
  t: 'key'
  v: typeof REMOTE_INPUT_VERSION
  generation: number
  seq: number
  action: RemoteKeyAction
  code: PortableKeyCode
  key?: string
  location?: number
  repeat?: boolean
  modifiers?: RemoteKeyModifiers
}

export type RemoteInputMessage =
  | RemoteControlRequestMessage
  | RemoteControlGrantMessage
  | RemoteControlRevokeMessage
  | RemotePointerMove
  | RemotePointerButton
  | RemotePointerWheel
  | RemoteKeyEvent

export type RemoteInputMotionMessage = RemotePointerMove
export type RemoteInputActionMessage = RemotePointerButton | RemotePointerWheel | RemoteKeyEvent

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isString = (value: unknown): value is string => typeof value === 'string'

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isBool = (value: unknown): value is boolean => typeof value === 'boolean'

const isRevokeReason = (value: unknown): value is RemoteControlRevokeReason =>
  value === 'host' ||
  value === 'emergency' ||
  value === 'disconnect' ||
  value === 'presenter-change' ||
  value === 'sharing-stopped'

const isButton = (value: unknown): value is RemotePointerButtonName =>
  value === 'left' ||
  value === 'middle' ||
  value === 'right' ||
  value === 'back' ||
  value === 'forward'

const isPointerAction = (value: unknown): value is RemotePointerAction =>
  value === 'down' || value === 'up'

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const MAX_WHEEL_DELTA = 4000

export const clampNormalizedCoord = (value: number): number => clamp01(value)

export const clampWheelDelta = (value: number): number =>
  Math.min(MAX_WHEEL_DELTA, Math.max(-MAX_WHEEL_DELTA, value))

export const isRemoteControlGrantMessage = (value: unknown): value is RemoteControlGrantMessage => {
  if (!isRecord(value)) return false
  return (
    value.t === 'remote-control-grant' &&
    value.v === REMOTE_INPUT_VERSION &&
    isString(value.peerId) &&
    isBool(value.mouse) &&
    isBool(value.keyboard) &&
    isFiniteNumber(value.generation)
  )
}

export const isRemoteControlRequestMessage = (
  value: unknown,
): value is RemoteControlRequestMessage => {
  if (!isRecord(value)) return false
  return (
    value.t === 'remote-control-request' &&
    value.v === REMOTE_INPUT_VERSION &&
    isString(value.peerId) &&
    isBool(value.mouse) &&
    isBool(value.keyboard)
  )
}

export const isRemoteControlRevokeMessage = (
  value: unknown,
): value is RemoteControlRevokeMessage => {
  if (!isRecord(value)) return false
  return (
    value.t === 'remote-control-revoke' &&
    value.v === REMOTE_INPUT_VERSION &&
    isString(value.peerId) &&
    isFiniteNumber(value.generation) &&
    (value.reason === undefined || isRevokeReason(value.reason))
  )
}

export const isRemotePointerMove = (value: unknown): value is RemotePointerMove => {
  if (!isRecord(value)) return false
  return (
    value.t === 'pointer-move' &&
    value.v === REMOTE_INPUT_VERSION &&
    isFiniteNumber(value.generation) &&
    isFiniteNumber(value.seq) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    (value.sourceId === undefined || isString(value.sourceId))
  )
}

export const isRemotePointerButton = (value: unknown): value is RemotePointerButton => {
  if (!isRecord(value)) return false
  return (
    value.t === 'pointer-button' &&
    value.v === REMOTE_INPUT_VERSION &&
    isFiniteNumber(value.generation) &&
    isFiniteNumber(value.seq) &&
    isButton(value.button) &&
    isPointerAction(value.action)
  )
}

export const isRemotePointerWheel = (value: unknown): value is RemotePointerWheel => {
  if (!isRecord(value)) return false
  return (
    value.t === 'pointer-wheel' &&
    value.v === REMOTE_INPUT_VERSION &&
    isFiniteNumber(value.generation) &&
    isFiniteNumber(value.seq) &&
    isFiniteNumber(value.deltaX) &&
    isFiniteNumber(value.deltaY)
  )
}

export const isRemoteKeyEvent = (value: unknown): value is RemoteKeyEvent => {
  if (!isRecord(value)) return false
  if (
    value.t !== 'key' ||
    value.v !== REMOTE_INPUT_VERSION ||
    !isFiniteNumber(value.generation) ||
    !isFiniteNumber(value.seq) ||
    !isPointerAction(value.action) ||
    !isPortableKeyCode(value.code)
  ) {
    return false
  }
  if (value.key !== undefined && !isString(value.key)) return false
  if (value.location !== undefined && !isFiniteNumber(value.location)) return false
  if (value.repeat !== undefined && !isBool(value.repeat)) return false
  if (value.modifiers !== undefined) {
    if (!isRecord(value.modifiers)) return false
    if (
      !isBool(value.modifiers.ctrl) ||
      !isBool(value.modifiers.alt) ||
      !isBool(value.modifiers.shift) ||
      !isBool(value.modifiers.meta)
    ) {
      return false
    }
  }
  return true
}

export const isRemoteInputMessage = (value: unknown): value is RemoteInputMessage =>
  isRemoteControlRequestMessage(value) ||
  isRemoteControlGrantMessage(value) ||
  isRemoteControlRevokeMessage(value) ||
  isRemotePointerMove(value) ||
  isRemotePointerButton(value) ||
  isRemotePointerWheel(value) ||
  isRemoteKeyEvent(value)

export const isRemoteInputMotionMessage = (value: unknown): value is RemoteInputMotionMessage =>
  isRemotePointerMove(value)

export const isRemoteInputActionMessage = (value: unknown): value is RemoteInputActionMessage =>
  isRemotePointerButton(value) || isRemotePointerWheel(value) || isRemoteKeyEvent(value)

export const parseRemoteInputMessage = (raw: string): RemoteInputMessage | null => {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRemoteInputMessage(value)) return null
    if (value.t === 'pointer-move') {
      return { ...value, x: clampNormalizedCoord(value.x), y: clampNormalizedCoord(value.y) }
    }
    if (value.t === 'pointer-wheel') {
      return {
        ...value,
        deltaX: clampWheelDelta(value.deltaX),
        deltaY: clampWheelDelta(value.deltaY),
      }
    }
    return value
  } catch {
    return null
  }
}

export const serializeRemoteInputMessage = (msg: RemoteInputMessage): string => JSON.stringify(msg)

export const isStaleGeneration = (eventGeneration: number, currentGeneration: number): boolean =>
  eventGeneration !== currentGeneration

export const isStaleOrDuplicateSeq = (seq: number, lastSeq: number): boolean => seq <= lastSeq
