export const MAX_PEERS = 4
export const VOTE_TIMEOUT_MS = 30_000
export const VOTE_COOLDOWN_MS = 60_000
export const ICE_GATHERING_TIMEOUT_MS = 10_000
export const ICE_DISCONNECT_GRACE_MS = 3_500
export const PENDING_INVITE_TTL_MS = 5 * 60_000
export const CHAT_MAX_CHARS = 2000
export const CHAT_MAX_MESSAGES = 200

export const truncateChatText = (text: string, max = CHAT_MAX_CHARS): string =>
  text.length <= max ? text : text.slice(0, max)
