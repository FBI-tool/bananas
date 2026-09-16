import { describe, expect, it } from 'vitest'
import {
  dropPlaintextInbound,
  encryptionRequired,
  outboundCryptoAction,
  shouldPrepareJoinerCrypto,
} from './e2eePolicy'

describe('e2ee fail-closed policy', () => {
  it('treats encryption as on by default', () => {
    expect(encryptionRequired(false, undefined)).toBe(true)
    expect(encryptionRequired(false, true)).toBe(true)
    expect(encryptionRequired(true, false)).toBe(true)
    expect(encryptionRequired(false, false)).toBe(false)
  })

  it('never sends encryptable traffic as plaintext while encryption is required', () => {
    expect(outboundCryptoAction({ encryptable: true, required: true, ready: false })).toBe('queue')
    expect(outboundCryptoAction({ encryptable: true, required: true, ready: true })).toBe('encrypt')
    expect(outboundCryptoAction({ encryptable: false, required: true, ready: false })).toBe(
      'passthrough',
    )
    expect(outboundCryptoAction({ encryptable: true, required: false, ready: false })).toBe(
      'passthrough',
    )
  })

  it('drops inbound plaintext chat and other encryptable types', () => {
    expect(dropPlaintextInbound({ encryptable: true, required: true })).toBe(true)
    expect(dropPlaintextInbound({ encryptable: false, required: true })).toBe(false)
    expect(dropPlaintextInbound({ encryptable: true, required: false })).toBe(false)
  })

  it('does not rebuild MLS as a joiner when a group already exists', () => {
    expect(shouldPrepareJoinerCrypto({ hasGroup: true, isJoinerHandshake: false })).toBe(false)
    expect(shouldPrepareJoinerCrypto({ hasGroup: true, isJoinerHandshake: true })).toBe(false)
    expect(shouldPrepareJoinerCrypto({ hasGroup: false, isJoinerHandshake: true })).toBe(true)
    expect(shouldPrepareJoinerCrypto({ hasGroup: false, isJoinerHandshake: false })).toBe(false)
  })
})
