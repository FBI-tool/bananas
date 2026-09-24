export type IceCandidateKind = 'host' | 'srflx' | 'relay' | 'prflx'

export type IceServerError = {
  url: string
  code: number
  text: string
}

export type IceFailureEvidence = {
  candidateTypes: readonly IceCandidateKind[]
  serverErrors: readonly IceServerError[]
  gatheringTimedOut: boolean
}

export type IceFailureReason =
  | { kind: 'auth'; url: string; code: number }
  | { kind: 'unreachable'; url: string; code: number }
  | { kind: 'gathering-timeout' }
  | { kind: 'host-only' }
  | { kind: 'need-turn' }
  | { kind: 'relay-failed' }
  | { kind: 'no-candidates' }
  | { kind: 'unknown' }

const AUTH_CODES = new Set([401, 403, 438])

const isTurnUrl = (url: string): boolean => /^turns?:/i.test(url)

const pickServer = (
  errors: readonly IceServerError[],
  pred: (error: IceServerError) => boolean,
): IceServerError | undefined => {
  const matches = errors.filter(pred)
  return matches.find((error) => isTurnUrl(error.url)) ?? matches[0]
}

export const iceCandidateKind = (
  candidate: { candidate?: string; type?: string | null } | null | undefined,
): IceCandidateKind | null => {
  const type = candidate?.type
  if (type === 'host' || type === 'srflx' || type === 'relay' || type === 'prflx') return type
  const sdp = candidate?.candidate ?? ''
  const match = /\styp\s+(host|srflx|relay|prflx)\b/.exec(sdp)
  return match ? (match[1] as IceCandidateKind) : null
}

export const connectionFailureForState = (
  state: string,
  failure: IceFailureReason | null = null,
): IceFailureReason | null => (state === 'failed' ? failure : null)

export const summarizeIceFailure = (evidence: IceFailureEvidence): IceFailureReason => {
  const auth = pickServer(evidence.serverErrors, (error) => AUTH_CODES.has(error.code))
  if (auth) return { kind: 'auth', url: auth.url, code: auth.code }
  const unreachable = pickServer(evidence.serverErrors, () => true)
  if (unreachable) return { kind: 'unreachable', url: unreachable.url, code: unreachable.code }

  const types = new Set(evidence.candidateTypes)
  const publicOrRelay = types.has('srflx') || types.has('relay')
  if (evidence.gatheringTimedOut && !publicOrRelay) return { kind: 'gathering-timeout' }
  if (types.size === 0) return { kind: 'no-candidates' }
  if (types.has('relay')) return { kind: 'relay-failed' }
  if (types.has('srflx')) return { kind: 'need-turn' }
  if (types.has('host') || types.has('prflx')) return { kind: 'host-only' }
  return { kind: 'unknown' }
}

export const isWebRtcSdpError = (error: unknown): boolean => {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return true
  if (!(error instanceof Error)) return false
  return /setRemoteDescription|setLocalDescription|RTCPeerConnection|SessionDescription/i.test(
    error.message,
  )
}
