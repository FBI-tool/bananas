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

export type VoteStartMessage = Envelope & {
  t: 'vote-start'
  voteId: string
  candidateId: string
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
        isString(value.voteId) && isString(value.candidateId) && typeof value.expiresAt === 'number'
      )
    case 'vote-cast':
      return isString(value.voteId) && isString(value.peerId) && typeof value.approve === 'boolean'
    case 'vote-result':
      return (
        isString(value.voteId) && typeof value.approved === 'boolean' && isString(value.presenterId)
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
    default:
      return false
  }
}

export const serializeControlMessage = (msg: ControlMessage): string => JSON.stringify(msg)

export const parseControlMessage = (raw: string): ControlMessage | null => {
  try {
    const value: unknown = JSON.parse(raw)
    return isControlMessage(value) ? value : null
  } catch {
    return null
  }
}
