import { truncateChatText } from './constants'

export const PROTOCOL_VERSION = 1 as const

export type RosterPeer = {
  id: string
  username: string
  color: string
}

type Envelope = {
  t: string
  v: typeof PROTOCOL_VERSION
}

export type HelloMessage = Envelope & {
  t: 'hello'
  peerId: string
  username: string
  color: string
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
  color: string
  x: number
  y: number
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isString = (value: unknown): value is string => typeof value === 'string'

const isSdp = (value: unknown): value is RTCSessionDescriptionInit => {
  if (!isRecord(value)) return false
  return value.type === 'offer' || value.type === 'answer' || value.type === 'pranswer'
}

const isRosterPeer = (value: unknown): value is RosterPeer => {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.username) && isString(value.color)
}

const isVoteKind = (value: unknown): value is VoteKind => value === 'presenter' || value === 'kick'

const hasOptionalVoteKind = (value: Record<string, unknown>): boolean =>
  value.kind === undefined || isVoteKind(value.kind)

export const isControlMessage = (value: unknown): value is ControlMessage => {
  if (!isRecord(value)) return false
  if (value.v !== PROTOCOL_VERSION || !isString(value.t)) return false
  switch (value.t) {
    case 'hello':
      return isString(value.peerId) && isString(value.username) && isString(value.color)
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
        isString(value.color) &&
        typeof value.x === 'number' &&
        typeof value.y === 'number'
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
