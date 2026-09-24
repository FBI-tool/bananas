import { describe, expect, it } from 'vitest'
import {
  connectionFailureForState,
  iceCandidateKind,
  isWebRtcSdpError,
  summarizeIceFailure,
  type IceFailureEvidence,
  type IceServerError,
} from './iceFailure'

const evidence = (patch: Partial<IceFailureEvidence> = {}): IceFailureEvidence => ({
  candidateTypes: [],
  serverErrors: [],
  gatheringTimedOut: false,
  ...patch,
})

const server = (patch: Partial<IceServerError> = {}): IceServerError => ({
  url: 'stun:stun.example:19302',
  code: 701,
  text: '',
  ...patch,
})

describe('summarizeIceFailure', () => {
  it('names a TURN or STUN login rejection ahead of other server errors', () => {
    expect(
      summarizeIceFailure(
        evidence({
          serverErrors: [
            server({ url: 'stun:stun.example:19302', code: 701 }),
            server({ url: 'turn:turn.example:3478', code: 401, text: 'Unauthorized' }),
          ],
          candidateTypes: ['host', 'srflx'],
        }),
      ),
    ).toEqual({ kind: 'auth', url: 'turn:turn.example:3478', code: 401 })

    expect(
      summarizeIceFailure(evidence({ serverErrors: [server({ code: 403 })] })),
    ).toMatchObject({ kind: 'auth', code: 403 })
    expect(
      summarizeIceFailure(evidence({ serverErrors: [server({ code: 438 })] })),
    ).toMatchObject({ kind: 'auth', code: 438 })
  })

  it('names an unreachable server, including codes other than 701', () => {
    expect(
      summarizeIceFailure(
        evidence({
          serverErrors: [server({ url: 'stun:stun.l.google.com:19302', code: 701 })],
        }),
      ),
    ).toEqual({ kind: 'unreachable', url: 'stun:stun.l.google.com:19302', code: 701 })

    expect(
      summarizeIceFailure(
        evidence({
          serverErrors: [
            server({ url: 'stun:stun.example:19302', code: 300 }),
            server({ url: 'turn:turn.example:3478', code: 400 }),
          ],
        }),
      ),
    ).toEqual({ kind: 'unreachable', url: 'turn:turn.example:3478', code: 400 })
  })

  it('reports a gathering timeout when no public or relay address appeared', () => {
    expect(
      summarizeIceFailure(evidence({ gatheringTimedOut: true, candidateTypes: ['host'] })),
    ).toEqual({ kind: 'gathering-timeout' })
    expect(summarizeIceFailure(evidence({ gatheringTimedOut: true }))).toEqual({
      kind: 'gathering-timeout',
    })
  })

  it('classifies the local candidate set when gathering finished', () => {
    expect(summarizeIceFailure(evidence())).toEqual({ kind: 'no-candidates' })
    expect(summarizeIceFailure(evidence({ candidateTypes: ['host'] }))).toEqual({
      kind: 'host-only',
    })
    expect(summarizeIceFailure(evidence({ candidateTypes: ['host', 'prflx'] }))).toEqual({
      kind: 'host-only',
    })
    expect(summarizeIceFailure(evidence({ candidateTypes: ['host', 'srflx'] }))).toEqual({
      kind: 'need-turn',
    })
    expect(
      summarizeIceFailure(
        evidence({ gatheringTimedOut: true, candidateTypes: ['host', 'srflx'] }),
      ),
    ).toEqual({ kind: 'need-turn' })
    expect(
      summarizeIceFailure(evidence({ candidateTypes: ['host', 'srflx', 'relay'] })),
    ).toEqual({ kind: 'relay-failed' })
  })
})

describe('connectionFailureForState', () => {
  it('replaces a prior reason when entering failed, and clears it for every other state', () => {
    const prior = { kind: 'host-only' as const }
    expect(connectionFailureForState('failed', { kind: 'need-turn' })).toEqual({
      kind: 'need-turn',
    })
    expect(connectionFailureForState('failed')).toBeNull()
    expect(connectionFailureForState('connected', prior)).toBeNull()
    expect(connectionFailureForState('disconnected', prior)).toBeNull()
    expect(connectionFailureForState('closed', prior)).toBeNull()
  })
})

describe('iceCandidateKind', () => {
  it('reads the candidate type from the SDP line', () => {
    expect(
      iceCandidateKind({
        candidate: 'candidate:1 1 UDP 1 1.2.3.4 9 typ srflx raddr 0.0.0.0 rport 0',
      }),
    ).toBe('srflx')
    expect(iceCandidateKind({ type: 'relay', candidate: '' })).toBe('relay')
    expect(iceCandidateKind(null)).toBeNull()
  })
})

describe('isWebRtcSdpError', () => {
  it('recognizes a browser session-description rejection', () => {
    expect(
      isWebRtcSdpError(
        new Error(
          "Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': Failed to parse SessionDescription.",
        ),
      ),
    ).toBe(true)
    expect(isWebRtcSdpError(new Error('e2ee is required but the invite is missing'))).toBe(false)
    expect(isWebRtcSdpError('nope')).toBe(false)
  })
})
