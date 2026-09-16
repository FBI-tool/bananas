import { describe, expect, it } from 'vitest'
import { isBonjourAuthUrl, isKiwiSdpUrl, tokenFromBonjourAuthUrl } from './urls'

describe('bonjour urls', () => {
  it('splits auth callbacks from sdp invites', () => {
    expect(isBonjourAuthUrl('kiwi://bonjour-auth?token=abc')).toBe(true)
    expect(isKiwiSdpUrl('kiwi://bonjour-auth?token=abc')).toBe(false)
    expect(isKiwiSdpUrl('kiwi://h/Kiwi/payload')).toBe(true)
    expect(isBonjourAuthUrl('kiwi://h/Kiwi/payload')).toBe(false)
    expect(tokenFromBonjourAuthUrl('kiwi://bonjour-auth?token=secret')).toBe('secret')
  })
})
