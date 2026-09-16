import { describe, expect, it } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { decryptEnvelope, encryptEnvelope, encryptionPublicKey } from './envelope'

describe('bonjour envelopes', () => {
  it('round-trips JSON to a device public key', () => {
    const sender = ed25519.keygen()
    const recipient = ed25519.keygen()
    const recipientPub = encryptionPublicKey(Buffer.from(recipient.publicKey).toString('base64'))
    const ciphertext = encryptEnvelope({
      senderEd25519SecretB64: Buffer.from(sender.secretKey).toString('base64'),
      recipientPublicKeyB64: recipientPub,
      payload: { type: 'offer', sdp: 'v=0' },
    })
    const plain = decryptEnvelope({
      recipientEd25519SecretB64: Buffer.from(recipient.secretKey).toString('base64'),
      ciphertextB64: ciphertext,
    })
    expect(plain).toEqual({ type: 'offer', sdp: 'v=0' })
  })
})
