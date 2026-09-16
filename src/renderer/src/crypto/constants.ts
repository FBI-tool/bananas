export const CRYPTO_PROTOCOL_VERSION = 1
export const E2EE_PROTOCOL = 'mls-v1' as const
export const CIPHERSUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const

export type AppDomain =
  | 'chat'
  | 'cursor'
  | 'control'
  | 'drawing'
  | 'remote-input'
  | 'camera-state'
  | 'media'

export const exporterLabel = (domain: AppDomain, extra = ''): string =>
  extra ? `p2p.kiwi/v1/${domain}/${extra}` : `p2p.kiwi/v1/${domain}`

export type CryptoCapabilities = {
  e2eeProtocol: typeof E2EE_PROTOCOL
  protocolVersion: number
  mediaE2EE: string[]
}

export const defaultCryptoCapabilities = (media: boolean): CryptoCapabilities => ({
  e2eeProtocol: E2EE_PROTOCOL,
  protocolVersion: CRYPTO_PROTOCOL_VERSION,
  mediaE2EE: media ? ['sframe-rfc9605'] : [],
})

export const toBase64Url = (bytes: Uint8Array): string => {
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const fromBase64Url = (value: string): Uint8Array => {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export const asBufferSource = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}
