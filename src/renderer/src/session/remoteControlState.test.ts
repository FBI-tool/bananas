import { describe, expect, it } from 'vitest'
import {
  acceptSeq,
  activeController,
  grantRemoteControlState,
  inputMatchesGrant,
  requestRemoteControlState,
  revokeAllRemoteControlState,
  revokeRemoteControlState,
  takeRemoteKeyEdge,
} from './remoteControlState'

describe('remoteControlState', () => {
  it('treats a request as UI-only, never a grant', () => {
    const next = requestRemoteControlState({}, 'alice', true, true)
    expect(next.alice?.requestedMouse).toBe(true)
    expect(next.alice?.mouse).toBe(false)
    expect(next.alice?.keyboard).toBe(false)
    expect(inputMatchesGrant(next, 'alice', 'mouse', 0)).toBe(false)
  })

  it('grants mouse and keyboard independently and increments generation', () => {
    const granted = grantRemoteControlState({}, 'alice', { mouse: true, keyboard: false })
    expect(granted.alice).toMatchObject({ mouse: true, keyboard: false, generation: 1 })
    expect(inputMatchesGrant(granted, 'alice', 'mouse', 1)).toBe(true)
    expect(inputMatchesGrant(granted, 'alice', 'keyboard', 1)).toBe(false)
    expect(inputMatchesGrant(granted, 'alice', 'mouse', 0)).toBe(false)
  })

  it('revokes a peer and invalidates the previous generation', () => {
    const granted = grantRemoteControlState({}, 'alice', { mouse: true, keyboard: true })
    const revoked = revokeRemoteControlState(granted, 'alice', 'host')
    expect(revoked.alice?.mouse).toBe(false)
    expect(revoked.alice?.keyboard).toBe(false)
    expect(revoked.alice?.generation).toBe(2)
    expect(inputMatchesGrant(revoked, 'alice', 'mouse', 1)).toBe(false)
  })

  it('limits v1 to one active controller', () => {
    const first = grantRemoteControlState({}, 'alice', { mouse: true, keyboard: true })
    const second = grantRemoteControlState(first, 'bob', { mouse: true, keyboard: false })
    expect(second.alice?.mouse).toBe(false)
    expect(second.alice?.keyboard).toBe(false)
    expect(second.bob?.mouse).toBe(true)
    expect(activeController(second)?.peerId).toBe('bob')
  })

  it('revoke-all increments every generation', () => {
    const granted = grantRemoteControlState({}, 'alice', { mouse: true, keyboard: true })
    const cleared = revokeAllRemoteControlState(granted)
    expect(cleared.alice?.generation).toBe(2)
    expect(activeController(cleared)).toBeNull()
  })

  it('rejects duplicate action sequences', () => {
    const first = acceptSeq({}, 'alice', 'action', 1)
    expect(first.ok).toBe(true)
    const dup = acceptSeq(first.next, 'alice', 'action', 1)
    expect(dup.ok).toBe(false)
    const next = acceptSeq(first.next, 'alice', 'action', 2)
    expect(next.ok).toBe(true)
    const motion = acceptSeq(next.next, 'alice', 'motion', 1)
    expect(motion.ok).toBe(true)
  })

  it('forwards one down per key and always forwards the matching up', () => {
    const pressed = new Set<string>()
    expect(takeRemoteKeyEdge(pressed, 'down', 'KeyA')).toBe(true)
    expect(takeRemoteKeyEdge(pressed, 'down', 'KeyA')).toBe(false)
    expect(takeRemoteKeyEdge(pressed, 'down', 'KeyA')).toBe(false)
    expect(takeRemoteKeyEdge(pressed, 'up', 'KeyA')).toBe(true)
    expect(pressed.has('KeyA')).toBe(false)
    expect(takeRemoteKeyEdge(pressed, 'down', 'KeyA')).toBe(true)
  })

  it('tracks mouse-button edges the same way as keys', () => {
    const pressed = new Set<string>()
    expect(takeRemoteKeyEdge(pressed, 'down', 'left')).toBe(true)
    expect(takeRemoteKeyEdge(pressed, 'down', 'left')).toBe(false)
    expect(takeRemoteKeyEdge(pressed, 'up', 'left')).toBe(true)
    expect(takeRemoteKeyEdge(pressed, 'up', 'left')).toBe(true)
  })
})
