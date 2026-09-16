import { describe, expect, it } from 'vitest'
import { RoomCrypto, type DeviceIdentity } from './roomCrypto'
import { toBase64Url } from './constants'
import { ReplayCache, controlReplayKey } from './replay'
import { sframeDecrypt, sframeEncrypt } from './sframe'

const identity = (_label: string): DeviceIdentity => {
  const publicKey = crypto.getRandomValues(new Uint8Array(32))
  return {
    publicKey,
    privateKey: crypto.getRandomValues(new Uint8Array(32)),
    fingerprint: toBase64Url(publicKey).slice(0, 32),
  }
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const decode = (value: Uint8Array): string => new TextDecoder().decode(value)

describe('RoomCrypto MLS', () => {
  it('creates, joins, encrypts with domain separation, and rejects tampers', async () => {
    const aliceId = identity('alice')
    const bobId = identity('bob')
    const alice = new RoomCrypto()
    const bob = new RoomCrypto()
    await alice.createRoom('room-1', 'alice', aliceId)
    alice.rememberMember('bob', bobId.fingerprint)
    expect(alice.hasRemoteMembers()).toBe(false)
    await bob.prepareJoiner('room-1', 'bob', bobId)
    const kp = bob.encodeKeyPackage()
    expect(kp).toBeTruthy()
    const decoded = alice.decodeKeyPackage(kp!)
    expect(decoded).toBeTruthy()
    const bundle = await alice.addMember(decoded!, 'bob', bobId.fingerprint)
    expect(bundle?.welcome).toBeTruthy()
    await bob.handleHandshakeMessage(bundle!.welcome!)
    expect(alice.epoch).toBe(bob.epoch)
    expect(alice.hasRemoteMembers()).toBe(true)
    expect(bob.hasRemoteMembers()).toBe(true)

    const chat = await alice.encryptApplication('chat', text('hello bob'))
    expect(decode(await bob.decryptApplication(chat))).toBe('hello bob')

    const cursor = await alice.encryptApplication('cursor', text('xy'))
    expect(cursor.domain).toBe('cursor')
    await expect(bob.decryptApplication({ ...cursor, domain: 'chat' })).rejects.toThrow()

    const tampered = { ...chat, ciphertext: chat.ciphertext.slice(0, -2) + 'aa' }
    await expect(bob.decryptApplication(tampered)).rejects.toThrow()

    const replayed = { ...chat, seq: chat.seq }
    await expect(bob.decryptApplication(replayed)).rejects.toThrow(/replay/)
  }, 30000)

  it('adds Charlie, removes him, and blocks post-epoch decrypt', async () => {
    const alice = new RoomCrypto()
    const bob = new RoomCrypto()
    const charlie = new RoomCrypto()
    await alice.createRoom('room-2', 'alice', identity('alice'))
    await bob.prepareJoiner('room-2', 'bob', identity('bob'))
    const bobAdd = await alice.addMember(
      alice.decodeKeyPackage(bob.encodeKeyPackage()!)!,
      'bob',
      'bob-fp',
    )
    await bob.handleHandshakeMessage(bobAdd!.welcome!)

    await charlie.prepareJoiner('room-2', 'charlie', identity('charlie'))
    const charlieAdd = await alice.addMember(
      alice.decodeKeyPackage(charlie.encodeKeyPackage()!)!,
      'charlie',
      'charlie-fp',
    )
    await charlie.handleHandshakeMessage(charlieAdd!.welcome!)
    await bob.handleHandshakeMessage(charlieAdd!.commit)

    const before = await alice.encryptApplication('chat', text('three'))
    expect(decode(await charlie.decryptApplication(before))).toBe('three')

    const commit = await alice.removeMember('charlie')
    expect(commit).toBeTruthy()
    await bob.handleHandshakeMessage(commit!)
    expect(alice.epoch).toBe(bob.epoch)
    expect(alice.epoch).not.toBe(before.epoch)

    const after = await alice.encryptApplication('chat', text('two'))
    expect(decode(await bob.decryptApplication(after))).toBe('two')
    await expect(charlie.decryptApplication(after)).rejects.toThrow()
    await expect(charlie.decryptApplication(before)).rejects.toThrow()
  }, 40000)

  it('exports matching video keys for screen and camera and matching keys for both members', async () => {
    const alice = new RoomCrypto()
    const bob = new RoomCrypto()
    await alice.createRoom('room-3', 'alice', identity('alice'))
    await bob.prepareJoiner('room-3', 'bob', identity('bob'))
    const add = await alice.addMember(alice.decodeKeyPackage(bob.encodeKeyPackage()!)!, 'bob', 'fp')
    await bob.handleHandshakeMessage(add!.welcome!)
    const screen = await alice.exportMediaKey({ sender: 'alice', kind: 'screen', streamId: 's1' })
    const camera = await alice.exportMediaKey({ sender: 'alice', kind: 'camera', streamId: 's1' })
    const audio = await alice.exportMediaKey({ sender: 'alice', kind: 'audio', streamId: 'a1' })
    const sameScreen = await alice.exportMediaKey({
      sender: 'alice',
      kind: 'screen',
      streamId: 's2',
    })
    const bobScreen = await bob.exportMediaKey({
      sender: 'alice',
      kind: 'screen',
      streamId: 'other',
    })
    expect(screen).toEqual(camera)
    expect(screen).not.toEqual(audio)
    expect(screen).toEqual(sameScreen)
    expect(screen).toEqual(bobScreen)
    const kid = alice.epoch & 0xff
    const frame = new Uint8Array([9, 8, 7, 6, 5])
    const sealed = await sframeEncrypt(frame, screen, kid, 1n)
    expect(await sframeDecrypt(sealed, () => bobScreen)).toEqual(frame)
    const cache = new ReplayCache()
    const key = controlReplayKey({ epoch: 1, sender: 'a', opId: 'kick:1', roomId: 'room-3' })
    expect(cache.remember(key)).toBe(true)
    expect(cache.remember(key)).toBe(false)
  }, 20000)
})

describe('adversarial control', () => {
  it('drops rewritten sender ids and injected cursor ciphertext', async () => {
    const alice = new RoomCrypto()
    const bob = new RoomCrypto()
    await alice.createRoom('room-4', 'alice', identity('alice'))
    await bob.prepareJoiner('room-4', 'bob', identity('bob'))
    const add = await alice.addMember(alice.decodeKeyPackage(bob.encodeKeyPackage()!)!, 'bob', 'fp')
    await bob.handleHandshakeMessage(add!.welcome!)
    const msg = await alice.encryptApplication('cursor', text('{"x":1}'))
    await expect(bob.decryptApplication({ ...msg, sender: 'mallory' })).rejects.toThrow()
    const injected = await alice.encryptApplication('cursor', text('{"x":0}'))
    injected.sender = 'mallory'
    await expect(bob.decryptApplication(injected)).rejects.toThrow()
  }, 30000)
})
