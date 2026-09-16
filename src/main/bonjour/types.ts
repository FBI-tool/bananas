export type PresenceStatus = 'available' | 'busy' | 'offline'
export type SignalType = 'offer' | 'answer' | 'ice' | 'mls-invite' | 'hangup'
export type CallKind = 'start' | 'join'

export type BonjourMe = {
  userId: string
  username: string | null
  acceptRequestsUntil: string | null
  acceptCallJoins: boolean
  devicePublicKey: string | null
}

export type BonjourContact = {
  userId: string
  username: string
  devicePublicKey: string | null
  presence: PresenceStatus
  acceptCallJoins: boolean
}

export type BonjourRequest = {
  id: string
  fromUserId?: string
  toUserId?: string
  username: string
  createdAt: string
}

export type BonjourList = {
  id: string
  name: string
  memberIds: string[]
}

export type BonjourEvent = {
  type: string
  [key: string]: unknown
}

export type PlainSignal = {
  type: SignalType
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  invite?: { roomId: string; bootstrapSecret: string }
}
