import { fromBase64Url, toBase64Url, asBufferSource } from './constants'

const SECRET_BYTES = 32

export type InviteCrypto = {
  roomId: string
  bootstrapSecret: string
}

export const randomInviteCrypto = (): InviteCrypto => {
  const roomId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const bootstrapSecret = toBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)))
  return { roomId, bootstrapSecret }
}

export const encodeInviteFragment = (invite: InviteCrypto): string =>
  `${invite.roomId}.${invite.bootstrapSecret}`

export const parseInviteFragment = (fragment: string | null | undefined): InviteCrypto | null => {
  if (!fragment) return null
  const value = fragment.startsWith('#') ? fragment.slice(1) : fragment
  const dot = value.indexOf('.')
  if (dot <= 0 || dot === value.length - 1) return null
  const roomId = value.slice(0, dot)
  const bootstrapSecret = value.slice(dot + 1)
  if (fromBase64Url(bootstrapSecret).length < 16) return null
  return { roomId, bootstrapSecret }
}

export const stripInviteFragment = (url: string): string => {
  const hash = url.indexOf('#')
  return hash === -1 ? url : url.slice(0, hash)
}

export const appendInviteFragment = (url: string, invite: InviteCrypto): string =>
  `${stripInviteFragment(url)}#${encodeInviteFragment(invite)}`

export const deriveJoinAuthenticator = async (invite: InviteCrypto): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    'raw',
    asBufferSource(fromBase64Url(invite.bootstrapSecret)),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(invite.roomId),
      info: new TextEncoder().encode('p2p.kiwi/v1/invite'),
    },
    key,
    256,
  )
  return new Uint8Array(bits)
}
