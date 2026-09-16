import { describe, expect, it } from 'vitest'
import { isSframePayload, sframeDecrypt, sframeEncrypt } from './sframe'

describe('SFrame RFC 9605', () => {
  it('round-trips a frame and rejects a tampered ciphertext', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const plain = new TextEncoder().encode('frame-bytes')
    const sealed = await sframeEncrypt(plain, key, 3, 9n)
    expect(sealed.slice(10)).not.toEqual(plain)
    const opened = await sframeDecrypt(sealed, (kid) => (kid === 3 ? key : undefined))
    expect(opened).toEqual(plain)
    const tampered = sealed.slice()
    tampered[tampered.length - 1] ^= 0xff
    await expect(sframeDecrypt(tampered, () => key)).rejects.toThrow()
  })

  it('does not decrypt with the wrong key id', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const sealed = await sframeEncrypt(new Uint8Array([1, 2, 3]), key, 1, 1n)
    await expect(sframeDecrypt(sealed, () => undefined)).rejects.toThrow(/unknown/)
  })

  it('detects sframe payloads', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const sealed = await sframeEncrypt(new Uint8Array([1, 2, 3]), key, 1, 1n)
    expect(isSframePayload(sealed)).toBe(true)
    expect(isSframePayload(new Uint8Array([1, 2, 3]))).toBe(false)
  })
})
