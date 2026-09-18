import { describe, expect, it } from 'vitest'
import { applyContactPresence, isPresenceStatus } from './bonjourPresence'

describe('bonjour presence', () => {
  it('accepts only live presence statuses', () => {
    expect(isPresenceStatus('available')).toBe(true)
    expect(isPresenceStatus('busy')).toBe(true)
    expect(isPresenceStatus('offline')).toBe(true)
    expect(isPresenceStatus('away')).toBe(false)
    expect(isPresenceStatus(undefined)).toBe(false)
  })

  it('patches a known contact without rewriting the rest of the list', () => {
    const alice = { userId: 'a', username: 'alice', presence: 'offline' as const }
    const bob = { userId: 'b', username: 'bob', presence: 'available' as const }
    const next = applyContactPresence([alice, bob], 'a', 'busy')
    expect(next).toEqual([{ userId: 'a', username: 'alice', presence: 'busy' }, bob])
    expect(next[1]).toBe(bob)
  })

  it('returns the same array when the contact is missing or already current', () => {
    const contacts = [{ userId: 'a', username: 'alice', presence: 'available' as const }]
    expect(applyContactPresence(contacts, 'missing', 'busy')).toBe(contacts)
    expect(applyContactPresence(contacts, 'a', 'available')).toBe(contacts)
  })
})
