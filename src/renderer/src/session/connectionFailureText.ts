import { L } from '../translations'
import { isMissingInviteError } from '../Utils'
import { isWebRtcSdpError, type IceFailureReason } from './iceFailure'

const SDP_MESSAGE_MAX = 240

const serverLabel = (url: string): string => url.trim() || 'STUN/TURN'

export const iceFailureText = (reason: IceFailureReason | null): string => {
  if (!reason) return L.connection_failed()
  switch (reason.kind) {
    case 'auth':
      return L.connection_ice_auth({ url: serverLabel(reason.url), code: reason.code })
    case 'unreachable':
      return L.connection_ice_unreachable({ url: serverLabel(reason.url), code: reason.code })
    case 'gathering-timeout':
      return L.connection_ice_gathering_timeout()
    case 'host-only':
      return L.connection_ice_host_only()
    case 'need-turn':
      return L.connection_ice_need_turn()
    case 'relay-failed':
      return L.connection_ice_relay_failed()
    case 'no-candidates':
      return L.connection_ice_no_candidates()
    case 'unknown':
      return L.connection_ice_unknown()
  }
}

export const connectThrownText = (error: unknown): string => {
  if (isMissingInviteError(error)) return L.connection_invite_missing()
  if (isWebRtcSdpError(error) && error instanceof Error) {
    const message = error.message.trim()
    if (!message) return L.connection_failed()
    return message.length > SDP_MESSAGE_MAX ? `${message.slice(0, SDP_MESSAGE_MAX)}...` : message
  }
  return L.connection_failed()
}
