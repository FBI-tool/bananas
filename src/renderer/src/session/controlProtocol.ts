import { truncateChatText } from './constants'
import type { AppDomain, CryptoCapabilities } from '../crypto/constants'
import {
  isRemoteControlGrantMessage,
  isRemoteControlRequestMessage,
  isRemoteControlRevokeMessage,
  type RemoteControlGrantMessage,
  type RemoteControlRequestMessage,
  type RemoteControlRevokeMessage,
} from './remoteInputProtocol'

export const PROTOCOL_VERSION = 1 as const

export const PLAINTEXT_CONTROL_TYPES = new Set([
  'hello',
  'roster',
  'mesh-offer',
  'mesh-answer',
  'e2ee',
  'mls',
])

export const APP_DOMAINS: AppDomain[] = [
  'chat',
  'cursor',
  'control',
  'drawing',
  'remote-input',
  'camera-state',
  'media',
]

export type RosterPeer = {
  id: string
  username: string
  foregroundColor: string
  backgroundColor: string
}

type Envelope = {
  t: string
  v: typeof PROTOCOL_VERSION
}

export type HelloCrypto = CryptoCapabilities & {
  fingerprint: string
  joinAuth?: string
  e2eeRequired?: boolean
}

export type HelloMessage = Envelope & {
  t: 'hello'
  peerId: string
  username: string
  foregroundColor: string
  backgroundColor: string
  crypto?: HelloCrypto
}

export type RosterMessage = Envelope & {
  t: 'roster'
  peers: RosterPeer[]
  coordinatorId: string
  presenterId: string
}

export type MeshOfferMessage = Envelope & {
  t: 'mesh-offer'
  from: string
  to: string
  sdp: RTCSessionDescriptionInit
}

export type MeshAnswerMessage = Envelope & {
  t: 'mesh-answer'
  from: string
  to: string
  sdp: RTCSessionDescriptionInit
}

export type VoteKind = 'presenter' | 'kick'

export type VoteStartMessage = Envelope & {
  t: 'vote-start'
  voteId: string
  kind?: VoteKind
  candidateId: string
  requesterId?: string
  expiresAt: number
}

export type VoteCastMessage = Envelope & {
  t: 'vote-cast'
  voteId: string
  peerId: string
  approve: boolean
}

export type VoteResultMessage = Envelope & {
  t: 'vote-result'
  voteId: string
  approved: boolean
  presenterId: string
  kind?: VoteKind
  removedPeerId?: string
}

export type PresenterChangedMessage = Envelope & {
  t: 'presenter-changed'
  presenterId: string
}

export type PeerLeftMessage = Envelope & {
  t: 'peer-left'
  peerId: string
}

export type CoordinatorHandoffMessage = Envelope & {
  t: 'coordinator-handoff'
  coordinatorId: string
}

export type SessionEndedMessage = Envelope & {
  t: 'session-ended'
  byPeerId: string
}

export type CursorMessage = Envelope & {
  t: 'cursor'
  id: string
  name: string
  foregroundColor: string
  backgroundColor: string
  x: number
  y: number
  sourceId?: string
}

export type E2eeMessage = Envelope & {
  t: 'e2ee'
  epoch: number
  sender: string
  domain: AppDomain
  seq: number
  iv: string
  ciphertext: string
}

export type CursorPingMessage = Envelope & {
  t: 'cursor-ping'
  cursorId: string
}

export type ChatMessage = Envelope & {
  t: 'chat'
  id: string
  from: string
  name: string
  text: string
  at: number
}

export type CameraStateMessage = Envelope & {
  t: 'camera-state'
  peerId: string
  enabled: boolean
  streamId: string
}

export type MlsControlMessage = Envelope & {
  t: 'mls'
  kind: 'key-package' | 'welcome' | 'commit'
  from: string
  to?: string
  fingerprint?: string
  body: string
  id: string
  i: number
  n: number
}

export type ControlMessage =
  | HelloMessage
  | RosterMessage
  | MeshOfferMessage
  | MeshAnswerMessage
  | VoteStartMessage
  | VoteCastMessage
  | VoteResultMessage
  | PresenterChangedMessage
  | PeerLeftMessage
  | CoordinatorHandoffMessage
  | SessionEndedMessage
  | CursorMessage
  | CursorPingMessage
  | ChatMessage
  | CameraStateMessage
  | E2eeMessage
  | MlsControlMessage
  | RemoteControlRequestMessage
  | RemoteControlGrantMessage
  | RemoteControlRevokeMessage

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isString = (value: unknown): value is string => typeof value === 'string'

const isSdp = (value: unknown): value is RTCSessionDescriptionInit => {
  if (!isRecord(value)) return false
  return value.type === 'offer' || value.type === 'answer' || value.type === 'pranswer'
}

const isRosterPeer = (value: unknown): value is RosterPeer => {
  if (!isRecord(value)) return false
  return (
    isString(value.id) &&
    isString(value.username) &&
    isString(value.foregroundColor) &&
    isString(value.backgroundColor)
  )
}

const isVoteKind = (value: unknown): value is VoteKind => value === 'presenter' || value === 'kick'

const isAppDomain = (value: unknown): value is AppDomain =>
  typeof value === 'string' && (APP_DOMAINS as string[]).includes(value)

const isHelloCrypto = (value: unknown): value is HelloCrypto => {
  if (!isRecord(value)) return false
  return (
    value.e2eeProtocol === 'mls-v1' &&
    typeof value.protocolVersion === 'number' &&
    Array.isArray(value.mediaE2EE) &&
    value.mediaE2EE.every(isString) &&
    isString(value.fingerprint) &&
    (value.joinAuth === undefined || isString(value.joinAuth)) &&
    (value.e2eeRequired === undefined || typeof value.e2eeRequired === 'boolean')
  )
}

const hasOptionalVoteKind = (value: Record<string, unknown>): boolean =>
  value.kind === undefined || isVoteKind(value.kind)

export const isControlMessage = (value: unknown): value is ControlMessage => {
  if (!isRecord(value)) return false
  if (value.v !== PROTOCOL_VERSION || !isString(value.t)) return false
  switch (value.t) {
    case 'hello':
      return (
        isString(value.peerId) &&
        isString(value.username) &&
        isString(value.foregroundColor) &&
        isString(value.backgroundColor) &&
        (value.crypto === undefined || isHelloCrypto(value.crypto))
      )
    case 'roster':
      return (
        Array.isArray(value.peers) &&
        value.peers.every(isRosterPeer) &&
        isString(value.coordinatorId) &&
        isString(value.presenterId)
      )
    case 'mesh-offer':
    case 'mesh-answer':
      return isString(value.from) && isString(value.to) && isSdp(value.sdp)
    case 'vote-start':
      return (
        isString(value.voteId) &&
        isString(value.candidateId) &&
        typeof value.expiresAt === 'number' &&
        hasOptionalVoteKind(value) &&
        (value.requesterId === undefined || isString(value.requesterId))
      )
    case 'vote-cast':
      return isString(value.voteId) && isString(value.peerId) && typeof value.approve === 'boolean'
    case 'vote-result':
      return (
        isString(value.voteId) &&
        typeof value.approved === 'boolean' &&
        isString(value.presenterId) &&
        hasOptionalVoteKind(value) &&
        (value.removedPeerId === undefined || isString(value.removedPeerId))
      )
    case 'presenter-changed':
      return isString(value.presenterId)
    case 'peer-left':
      return isString(value.peerId)
    case 'coordinator-handoff':
      return isString(value.coordinatorId)
    case 'session-ended':
      return isString(value.byPeerId)
    case 'cursor':
      return (
        isString(value.id) &&
        isString(value.name) &&
        isString(value.foregroundColor) &&
        isString(value.backgroundColor) &&
        typeof value.x === 'number' &&
        typeof value.y === 'number' &&
        (value.sourceId === undefined || isString(value.sourceId))
      )
    case 'cursor-ping':
      return isString(value.cursorId)
    case 'chat':
      return (
        isString(value.id) &&
        isString(value.from) &&
        isString(value.name) &&
        isString(value.text) &&
        typeof value.at === 'number'
      )
    case 'camera-state':
      return (
        isString(value.peerId) && typeof value.enabled === 'boolean' && isString(value.streamId)
      )
    case 'e2ee':
      return (
        typeof value.epoch === 'number' &&
        isString(value.sender) &&
        isAppDomain(value.domain) &&
        typeof value.seq === 'number' &&
        isString(value.iv) &&
        isString(value.ciphertext)
      )
    case 'mls':
      return (
        (value.kind === 'key-package' || value.kind === 'welcome' || value.kind === 'commit') &&
        isString(value.from) &&
        isString(value.body) &&
        isString(value.id) &&
        typeof value.i === 'number' &&
        typeof value.n === 'number' &&
        (value.to === undefined || isString(value.to)) &&
        (value.fingerprint === undefined || isString(value.fingerprint))
      )
    case 'remote-control-request':
      return isRemoteControlRequestMessage(value)
    case 'remote-control-grant':
      return isRemoteControlGrantMessage(value)
    case 'remote-control-revoke':
      return isRemoteControlRevokeMessage(value)
    default:
      return false
  }
}

export const serializeControlMessage = (msg: ControlMessage): string => JSON.stringify(msg)

export const parseControlMessage = (raw: string): ControlMessage | null => {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isControlMessage(value)) return null
    if (value.t === 'chat') {
      return { ...value, text: truncateChatText(value.text) }
    }
    return value
  } catch {
    return null
  }
}

export const domainForControl = (msg: ControlMessage): AppDomain => {
  switch (msg.t) {
    case 'chat':
      return 'chat'
    case 'cursor':
    case 'cursor-ping':
      return 'cursor'
    case 'camera-state':
      return 'camera-state'
    case 'remote-control-request':
    case 'remote-control-grant':
    case 'remote-control-revoke':
      return 'remote-input'
    default:
      return 'control'
  }
}

export const shouldEncryptControl = (msg: ControlMessage): boolean =>
  !PLAINTEXT_CONTROL_TYPES.has(msg.t)
