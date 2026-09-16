import { describe, expect, it } from 'vitest'
import { redactText, redactUnknown } from './redact'

describe('log redaction', () => {
  it('redacts URL fragments and secret fields', () => {
    const text = redactText(
      'invite kiwi://h/n/abc#room.supersecret token={"bootstrapSecret":"aaa","plaintext":"hi","sframeKey":"k"}',
    )
    expect(text).toContain('#<redacted>')
    expect(text).not.toContain('supersecret')
    expect(text).not.toContain('aaa')
    expect(text).toContain('<redacted>')
  })

  it('redacts nested objects', () => {
    const redacted = redactUnknown({
      exporter: 'secret',
      identityPrivateKey: 'pk',
      mediaKey: 'mk',
      ok: true,
    }) as Record<string, unknown>
    expect(redacted.exporter).toBe('<redacted>')
    expect(redacted.identityPrivateKey).toBe('<redacted>')
    expect(redacted.mediaKey).toBe('<redacted>')
    expect(redacted.ok).toBe(true)
  })
})
