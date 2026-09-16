import { describe, expect, it } from 'vitest'
import {
  appendInviteFragment,
  deriveJoinAuthenticator,
  encodeInviteFragment,
  parseInviteFragment,
  randomInviteCrypto,
  stripInviteFragment,
} from './invite'

describe('invite fragments', () => {
  it('round-trips a 256-bit bootstrap secret', () => {
    const invite = randomInviteCrypto()
    const encoded = encodeInviteFragment(invite)
    expect(parseInviteFragment(encoded)).toEqual(invite)
    expect(parseInviteFragment(`#${encoded}`)).toEqual(invite)
  })

  it('rejects short secrets and missing fragments', () => {
    expect(parseInviteFragment(null)).toBeNull()
    expect(parseInviteFragment('roomonly')).toBeNull()
    expect(parseInviteFragment('room.AAAA')).toBeNull()
  })

  it('never treats the fragment as a path and can strip it for logs', () => {
    const invite = randomInviteCrypto()
    const url = appendInviteFragment('kiwi://h/Kiwi/payload', invite)
    expect(url).toContain('#')
    expect(stripInviteFragment(url)).toBe('kiwi://h/Kiwi/payload')
    expect(stripInviteFragment(url)).not.toContain(invite.bootstrapSecret)
  })

  it('derives a join authenticator without using the secret as a room key', async () => {
    const invite = randomInviteCrypto()
    const a = await deriveJoinAuthenticator(invite)
    const b = await deriveJoinAuthenticator(invite)
    expect(a).toEqual(b)
    expect(a.length).toBe(32)
    expect(a).not.toEqual(new TextEncoder().encode(invite.bootstrapSecret))
  })
})
