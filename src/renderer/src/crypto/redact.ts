const SECRET_KEYS = [
  'bootstrapSecret',
  'token',
  'exporter',
  'identityPrivateKey',
  'signaturePrivateKey',
  'sframeKey',
  'mediaKey',
  'plaintext',
]

const FRAGMENT_RE = /#[A-Za-z0-9._~-]+/g

export const redactText = (value: string): string => {
  let next = value.replace(FRAGMENT_RE, '#<redacted>')
  for (const key of SECRET_KEYS) {
    const re = new RegExp(`("${key}"\\s*:\\s*")([^"]*)(")`, 'gi')
    next = next.replace(re, `$1<redacted>$3`)
  }
  return next
}

export const redactUnknown = (detail: unknown): unknown => {
  if (typeof detail === 'string') return redactText(detail)
  if (!detail || typeof detail !== 'object') return detail
  try {
    return JSON.parse(redactText(JSON.stringify(detail)))
  } catch {
    return '[unserializable]'
  }
}
