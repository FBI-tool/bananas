export const encryptionRequired = (
  e2eeRequired: boolean,
  e2eeEnabled: boolean | undefined,
): boolean => e2eeRequired || e2eeEnabled !== false

export type OutboundCryptoAction = 'passthrough' | 'queue' | 'encrypt'

export const outboundCryptoAction = (opts: {
  encryptable: boolean
  required: boolean
  ready: boolean
}): OutboundCryptoAction => {
  if (!opts.encryptable || !opts.required) return 'passthrough'
  if (!opts.ready) return 'queue'
  return 'encrypt'
}

export const dropPlaintextInbound = (opts: { encryptable: boolean; required: boolean }): boolean =>
  opts.required && opts.encryptable
