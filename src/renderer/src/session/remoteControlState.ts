import type { RemoteControlGrant, RemoteControlRevokeReason } from './remoteInputProtocol'

export type PeerRemoteControlState = {
  requestedMouse: boolean
  requestedKeyboard: boolean
  mouse: boolean
  keyboard: boolean
  generation: number
}

export type RemoteControlMap = Record<string, PeerRemoteControlState>

export const emptyPeerRemoteControl = (): PeerRemoteControlState => ({
  requestedMouse: false,
  requestedKeyboard: false,
  mouse: false,
  keyboard: false,
  generation: 0,
})

export const getPeerRemoteControl = (
  map: RemoteControlMap,
  peerId: string,
): PeerRemoteControlState => map[peerId] ?? emptyPeerRemoteControl()

export const requestRemoteControlState = (
  map: RemoteControlMap,
  peerId: string,
  mouse: boolean,
  keyboard: boolean,
): RemoteControlMap => {
  const prev = getPeerRemoteControl(map, peerId)
  return {
    ...map,
    [peerId]: {
      ...prev,
      requestedMouse: mouse,
      requestedKeyboard: keyboard,
    },
  }
}

const grantedPeerIds = (map: RemoteControlMap): string[] =>
  Object.entries(map)
    .filter(([, state]) => state.mouse || state.keyboard)
    .map(([id]) => id)

/** v1: at most one controller. Granting another peer revokes the previous. */
export const grantRemoteControlState = (
  map: RemoteControlMap,
  peerId: string,
  grant: RemoteControlGrant,
): RemoteControlMap => {
  const next: RemoteControlMap = { ...map }
  for (const id of grantedPeerIds(next)) {
    if (id === peerId) continue
    const prev = getPeerRemoteControl(next, id)
    next[id] = {
      ...prev,
      mouse: false,
      keyboard: false,
      requestedMouse: false,
      requestedKeyboard: false,
      generation: prev.generation + 1,
    }
  }
  const prev = getPeerRemoteControl(next, peerId)
  next[peerId] = {
    requestedMouse: false,
    requestedKeyboard: false,
    mouse: grant.mouse,
    keyboard: grant.keyboard,
    generation: prev.generation + 1,
  }
  return next
}

export const revokeRemoteControlState = (
  map: RemoteControlMap,
  peerId: string,
  _reason?: RemoteControlRevokeReason,
): RemoteControlMap => {
  const prev = map[peerId]
  if (!prev) return map
  return {
    ...map,
    [peerId]: {
      ...prev,
      requestedMouse: false,
      requestedKeyboard: false,
      mouse: false,
      keyboard: false,
      generation: prev.generation + 1,
    },
  }
}

export const revokeAllRemoteControlState = (map: RemoteControlMap): RemoteControlMap => {
  const next: RemoteControlMap = {}
  for (const [peerId, prev] of Object.entries(map)) {
    next[peerId] = {
      ...prev,
      requestedMouse: false,
      requestedKeyboard: false,
      mouse: false,
      keyboard: false,
      generation: prev.generation + 1,
    }
  }
  return next
}

export const dropPeerRemoteControl = (map: RemoteControlMap, peerId: string): RemoteControlMap => {
  if (!(peerId in map)) return map
  const next = { ...map }
  delete next[peerId]
  return next
}

export const peerHasMouseGrant = (map: RemoteControlMap, peerId: string): boolean =>
  Boolean(map[peerId]?.mouse)

export const peerHasKeyboardGrant = (map: RemoteControlMap, peerId: string): boolean =>
  Boolean(map[peerId]?.keyboard)

export const inputMatchesGrant = (
  map: RemoteControlMap,
  peerId: string,
  kind: 'mouse' | 'keyboard',
  generation: number,
): boolean => {
  const state = map[peerId]
  if (!state) return false
  if (state.generation !== generation) return false
  return kind === 'mouse' ? state.mouse : state.keyboard
}

export const activeController = (
  map: RemoteControlMap,
): { peerId: string; state: PeerRemoteControlState } | null => {
  for (const [peerId, state] of Object.entries(map)) {
    if (state.mouse || state.keyboard) return { peerId, state }
  }
  return null
}

export type SeqTracker = Record<string, { motion: number; action: number }>

export const acceptSeq = (
  tracker: SeqTracker,
  peerId: string,
  channel: 'motion' | 'action',
  seq: number,
): { ok: boolean; next: SeqTracker } => {
  const prev = tracker[peerId] ?? { motion: 0, action: 0 }
  if (seq <= prev[channel]) return { ok: false, next: tracker }
  return {
    ok: true,
    next: {
      ...tracker,
      [peerId]: { ...prev, [channel]: seq },
    },
  }
}
