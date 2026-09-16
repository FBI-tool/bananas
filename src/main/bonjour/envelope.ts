import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

const toBytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, 'base64'))
const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

export const encryptionPublicKey = (ed25519PublicKeyB64: string): string => {
  const mont = ed25519.utils.toMontgomery(toBytes(ed25519PublicKeyB64))
  return toB64(mont)
}

export const encryptEnvelope = (opts: {
  senderEd25519SecretB64: string
  recipientPublicKeyB64: string
  payload: unknown
}): string => {
  const senderX = ed25519.utils.toMontgomerySecret(toBytes(opts.senderEd25519SecretB64))
  const recipientX = toBytes(opts.recipientPublicKeyB64)
  const eph = x25519.keygen()
  const shared = x25519.getSharedSecret(eph.secretKey, recipientX)
  const key = Buffer.from(shared).subarray(0, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plain = Buffer.from(JSON.stringify(payloadWithSender(opts.payload, senderX)), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return toB64(Buffer.concat([Buffer.from(eph.publicKey), iv, tag, encrypted]))
}

export const decryptEnvelope = (opts: {
  recipientEd25519SecretB64: string
  ciphertextB64: string
}): unknown => {
  const raw = Buffer.from(opts.ciphertextB64, 'base64')
  const ephPub = raw.subarray(0, 32)
  const iv = raw.subarray(32, 44)
  const tag = raw.subarray(44, 60)
  const encrypted = raw.subarray(60)
  const recipientX = ed25519.utils.toMontgomerySecret(toBytes(opts.recipientEd25519SecretB64))
  const shared = x25519.getSharedSecret(recipientX, ephPub)
  const key = Buffer.from(shared).subarray(0, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

const payloadWithSender = (payload: unknown, _senderX: Uint8Array): unknown => payload
