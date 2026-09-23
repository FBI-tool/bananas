import { describe, expect, it } from 'vitest'
import { kiwiUrlFromArgv } from './kiwiUrl'

describe('kiwiUrlFromArgv', () => {
  it('finds a protocol URL that is not the last argument', () => {
    expect(kiwiUrlFromArgv(['p2p-kiwi.exe', 'kiwi://h/Ada/payload', '--updated'])).toBe(
      'kiwi://h/Ada/payload',
    )
  })

  it('accepts a quoted protocol URL', () => {
    expect(kiwiUrlFromArgv(['p2p-kiwi.exe', '"bananas://h/Ada/payload"'])).toBe(
      'bananas://h/Ada/payload',
    )
  })

  it('returns null when argv has no link', () => {
    expect(kiwiUrlFromArgv(['p2p-kiwi.exe', '--allow-file-access-from-files'])).toBeNull()
  })
})
