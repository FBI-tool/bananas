import { asBufferSource } from './constants'

export type EncryptedMessage = {
  epoch: number
  sender: string
  domain: string
  seq: number
  iv: Uint8Array
  ciphertext: Uint8Array
}

const te = new TextEncoder()

export const deriveAesKey = async (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', asBufferSource(raw).slice(0, 16), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])

export const encryptAead = async (
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: asBufferSource(aad) },
    key,
    asBufferSource(plaintext),
  )
  return { iv, ciphertext: new Uint8Array(ct) }
}

export const decryptAead = async (
  key: CryptoKey,
  message: { iv: Uint8Array; ciphertext: Uint8Array },
  aad: Uint8Array,
): Promise<Uint8Array> => {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBufferSource(message.iv), additionalData: asBufferSource(aad) },
    key,
    asBufferSource(message.ciphertext),
  )
  return new Uint8Array(pt)
}

export const encodeAad = (parts: Array<string | number>): Uint8Array =>
  te.encode(parts.map(String).join('|'))
