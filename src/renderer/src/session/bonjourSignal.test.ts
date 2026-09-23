import { describe, expect, it } from 'vitest'
import {
  bonjourTransport,
  cloneBonjourPayload,
  kiwiTransport,
  mergeIncomingCallSignal,
  shouldNotifyIncomingCall,
} from './bonjourSignal'

describe('signaling transport', () => {
  it('keeps clipboard kiwi distinct from Bonjour trickle', () => {
    expect(kiwiTransport().kind).toBe('kiwi')
    const sent: string[] = []
    const transport = bonjourTransport((callId, payload) => sent.push(`${callId}:${payload.type}`))
    expect(transport.kind).toBe('bonjour')
    if (transport.kind !== 'bonjour') throw new Error('expected bonjour transport')
    transport.send('call-1', { type: 'ice' })
    expect(sent).toEqual(['call-1:ice'])
  })
})

describe('incoming call notification', () => {
  it('shows a join request to a host who is already in a session', () => {
    expect(shouldNotifyIncomingCall({ inSession: false, kind: 'start' })).toBe(true)
    expect(shouldNotifyIncomingCall({ inSession: true, kind: 'start' })).toBe(false)
    expect(shouldNotifyIncomingCall({ inSession: true, kind: 'join' })).toBe(true)
  })
})

describe('incoming Bonjour call signals', () => {
  const incoming = {
    callId: 'call-1',
    fromUserId: 'peer-1',
    kind: 'start',
  }

  it('keeps an mls-invite until the offer arrives', () => {
    const withInvite = mergeIncomingCallSignal(incoming, {
      callId: 'call-1',
      plain: { type: 'mls-invite', invite: { roomId: 'room', bootstrapSecret: 'secret' } },
    })
    expect(withInvite.invite).toEqual({ roomId: 'room', bootstrapSecret: 'secret' })
    const withOffer = mergeIncomingCallSignal(withInvite, {
      callId: 'call-1',
      plain: { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } },
    })
    expect(withOffer.offer).toEqual({ type: 'offer', sdp: 'v=0' })
    expect(withOffer.invite).toEqual({ roomId: 'room', bootstrapSecret: 'secret' })
  })

  it('uses the invite attached to the offer', () => {
    const withOffer = mergeIncomingCallSignal(incoming, {
      callId: 'call-1',
      plain: {
        type: 'offer',
        sdp: { type: 'offer', sdp: 'v=0' },
        invite: { roomId: 'room', bootstrapSecret: 'secret' },
      },
    })
    expect(withOffer.invite).toEqual({ roomId: 'room', bootstrapSecret: 'secret' })
  })
})

describe('cloneBonjourPayload', () => {
  it('copies native SDP getters into enumerable JSON fields', () => {
    const nativeLike = {} as RTCSessionDescriptionInit
    Object.defineProperty(nativeLike, 'type', { get: () => 'offer', enumerable: false })
    Object.defineProperty(nativeLike, 'sdp', { get: () => 'v=0', enumerable: false })
    expect(JSON.stringify({ type: 'offer', sdp: nativeLike })).toBe('{"type":"offer","sdp":{}}')
    const cloned = cloneBonjourPayload({ type: 'offer', sdp: nativeLike })
    expect(JSON.parse(JSON.stringify(cloned))).toEqual({
      type: 'offer',
      sdp: { type: 'offer', sdp: 'v=0' },
    })
  })
})
