import { cloneIceCandidate, dropTcpIceCandidates } from '../Utils'
import type { InviteCrypto } from '../crypto/invite'

export type BonjourSignalType = 'offer' | 'answer' | 'ice' | 'mls-invite' | 'hangup'

export type BonjourSignalPayload = {
  type: BonjourSignalType
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  invite?: InviteCrypto | null
}

export type BonjourSignalSend = (payload: BonjourSignalPayload) => void

export type SignalingTransportKind = 'kiwi' | 'bonjour'

export type SignalingTransport =
  | { kind: 'kiwi' }
  | { kind: 'bonjour'; send: BonjourSignalSend; callId: string }

export const kiwiTransport = (): SignalingTransport => ({ kind: 'kiwi' })

export const bonjourTransport = (send: BonjourSignalSend, callId: string): SignalingTransport => ({
  kind: 'bonjour',
  send,
  callId,
})

export const cloneBonjourPayload = (payload: BonjourSignalPayload): BonjourSignalPayload => ({
  type: payload.type,
  sdp: payload.sdp ? dropTcpIceCandidates(payload.sdp) : undefined,
  candidate: payload.candidate ? cloneIceCandidate(payload.candidate) : undefined,
  invite: payload.invite ? { ...payload.invite } : payload.invite,
})

export type IncomingBonjourCall = {
  callId: string
  fromUserId: string
  kind: string
  offer?: RTCSessionDescriptionInit
  invite?: InviteCrypto | null
  peerPublicKey?: string | null
}

export const mergeIncomingCallSignal = (
  incoming: IncomingBonjourCall,
  event: { callId?: string; plain?: BonjourSignalPayload | null },
): IncomingBonjourCall => {
  if (!event.plain || event.callId !== incoming.callId) return incoming
  if (event.plain.type === 'mls-invite' && event.plain.invite) {
    return { ...incoming, invite: event.plain.invite }
  }
  if (event.plain.type === 'offer') {
    return {
      ...incoming,
      offer: event.plain.sdp,
      invite: event.plain.invite ?? incoming.invite,
    }
  }
  return incoming
}
