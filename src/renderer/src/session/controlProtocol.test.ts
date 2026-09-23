import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  domainForControl,
  parseControlMessage,
  serializeControlMessage,
  shouldEncryptControl,
} from './controlProtocol'

describe('controlProtocol', () => {
  it('round-trips a hello message', () => {
    const msg = {
      t: 'hello' as const,
      v: PROTOCOL_VERSION,
      peerId: 'a',
      username: 'Kiwi',
      foregroundColor: '#1a1a1a',
      backgroundColor: '#fff',
    }
    const parsed = parseControlMessage(serializeControlMessage(msg))
    expect(parsed).toEqual(msg)
  })

  it('rejects unknown types and invalid payloads', () => {
    expect(parseControlMessage('{"t":"nope","v":1}')).toBeNull()
    expect(parseControlMessage('not-json')).toBeNull()
    expect(
      parseControlMessage(
        '{"t":"hello","v":2,"peerId":"a","username":"x","foregroundColor":"#1a1a1a","backgroundColor":"#fff"}',
      ),
    ).toBeNull()
    expect(parseControlMessage('{"t":"peer-left","v":1}')).toBeNull()
  })

  it('accepts a mesh-offer with SDP', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        t: 'mesh-offer',
        v: 1,
        from: 'a',
        to: 'b',
        sdp: { type: 'offer', sdp: 'v=0' },
      }),
    )
    expect(parsed?.t).toBe('mesh-offer')
  })

  it('accepts and truncates chat messages', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        t: 'chat',
        v: 1,
        id: 'm1',
        from: 'a',
        name: 'Kiwi',
        text: 'hello',
        at: 1,
      }),
    )
    expect(parsed).toEqual({
      t: 'chat',
      v: 1,
      id: 'm1',
      from: 'a',
      name: 'Kiwi',
      text: 'hello',
      at: 1,
    })
    const long = parseControlMessage(
      JSON.stringify({
        t: 'chat',
        v: 1,
        id: 'm2',
        from: 'a',
        name: 'Kiwi',
        text: 'x'.repeat(3000),
        at: 2,
      }),
    )
    expect(long?.t).toBe('chat')
    if (long?.t === 'chat') expect(long.text.length).toBe(2000)
  })

  it('rejects invalid chat and camera-state payloads', () => {
    expect(parseControlMessage('{"t":"chat","v":1,"id":"m"}')).toBeNull()
    expect(parseControlMessage('{"t":"camera-state","v":1,"peerId":"a"}')).toBeNull()
    expect(
      parseControlMessage(
        JSON.stringify({ t: 'camera-state', v: 1, peerId: 'a', enabled: 'yes', streamId: '' }),
      ),
    ).toBeNull()
  })

  it('accepts camera-state', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        t: 'camera-state',
        v: 1,
        peerId: 'a',
        enabled: true,
        streamId: 's1',
      }),
    )
    expect(parsed).toEqual({
      t: 'camera-state',
      v: 1,
      peerId: 'a',
      enabled: true,
      streamId: 's1',
    })
  })

  it('accepts kick vote-start and vote-result payloads', () => {
    const start = parseControlMessage(
      JSON.stringify({
        t: 'vote-start',
        v: 1,
        voteId: 'v1',
        kind: 'kick',
        candidateId: 'c',
        requesterId: 'a',
        expiresAt: 10,
      }),
    )
    expect(start).toEqual({
      t: 'vote-start',
      v: 1,
      voteId: 'v1',
      kind: 'kick',
      candidateId: 'c',
      requesterId: 'a',
      expiresAt: 10,
    })
    const result = parseControlMessage(
      JSON.stringify({
        t: 'vote-result',
        v: 1,
        voteId: 'v1',
        approved: true,
        presenterId: 'a',
        kind: 'kick',
        removedPeerId: 'c',
      }),
    )
    expect(result).toEqual({
      t: 'vote-result',
      v: 1,
      voteId: 'v1',
      approved: true,
      presenterId: 'a',
      kind: 'kick',
      removedPeerId: 'c',
    })
  })

  it('still accepts presenter votes without kind', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        t: 'vote-start',
        v: 1,
        voteId: 'v1',
        candidateId: 'a',
        expiresAt: 10,
      }),
    )
    expect(parsed?.t).toBe('vote-start')
  })

  it('rejects invalid vote kinds', () => {
    expect(
      parseControlMessage(
        JSON.stringify({
          t: 'vote-start',
          v: 1,
          voteId: 'v1',
          kind: 'ban',
          candidateId: 'c',
          expiresAt: 10,
        }),
      ),
    ).toBeNull()
  })

  it('accepts hello crypto capabilities and e2ee envelopes', () => {
    const hello = parseControlMessage(
      JSON.stringify({
        t: 'hello',
        v: 1,
        peerId: 'a',
        username: 'Kiwi',
        foregroundColor: '#1a1a1a',
        backgroundColor: '#fff',
        crypto: {
          e2eeProtocol: 'mls-v1',
          protocolVersion: 1,
          mediaE2EE: ['sframe-rfc9605'],
          fingerprint: 'abc',
          joinAuth: 'auth',
          e2eeRequired: true,
        },
      }),
    )
    expect(hello?.t).toBe('hello')
    if (hello?.t === 'hello') expect(hello.crypto?.e2eeProtocol).toBe('mls-v1')
    const e2ee = parseControlMessage(
      JSON.stringify({
        t: 'e2ee',
        v: 1,
        epoch: 1,
        sender: 'a',
        domain: 'chat',
        seq: 1,
        iv: 'aa',
        ciphertext: 'bb',
      }),
    )
    expect(e2ee?.t).toBe('e2ee')
  })

  it('rejects silent-downgrade hello crypto and unknown e2ee domains', () => {
    expect(
      parseControlMessage(
        JSON.stringify({
          t: 'hello',
          v: 1,
          peerId: 'a',
          username: 'Kiwi',
          foregroundColor: '#1a1a1a',
          backgroundColor: '#fff',
          crypto: { e2eeProtocol: 'none', protocolVersion: 1, mediaE2EE: [], fingerprint: 'x' },
        }),
      ),
    ).toBeNull()
    expect(
      parseControlMessage(
        JSON.stringify({
          t: 'e2ee',
          v: 1,
          epoch: 1,
          sender: 'a',
          domain: 'other',
          seq: 1,
          iv: 'aa',
          ciphertext: 'bb',
        }),
      ),
    ).toBeNull()
  })

  it('keeps mls handshake on the plaintext bootstrap channel', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        t: 'mls',
        v: 1,
        kind: 'welcome',
        from: 'a',
        to: 'b',
        body: 'abc',
        id: 'a:welcome:3:1',
        i: 0,
        n: 1,
      }),
    )
    expect(parsed?.t).toBe('mls')
    expect(
      shouldEncryptControl({
        t: 'mls',
        v: 1,
        kind: 'key-package',
        from: 'a',
        body: 'x',
        id: 'id',
        i: 0,
        n: 1,
      }),
    ).toBe(false)
    expect(
      shouldEncryptControl({
        t: 'chat',
        v: 1,
        id: 'm',
        from: 'a',
        name: 'Kiwi',
        text: 'hi',
        at: 1,
      }),
    ).toBe(true)
    expect(
      shouldEncryptControl({
        t: 'vote-start',
        v: 1,
        voteId: 'v',
        candidateId: 'a',
        expiresAt: 1,
      }),
    ).toBe(true)
    expect(
      shouldEncryptControl({
        t: 'cursor',
        v: 1,
        id: 'a',
        name: 'Kiwi',
        foregroundColor: '#1a1a1a',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
      }),
    ).toBe(true)
    expect(
      shouldEncryptControl({
        t: 'hello',
        v: 1,
        peerId: 'a',
        username: 'Kiwi',
        foregroundColor: '#1a1a1a',
        backgroundColor: '#fff',
      }),
    ).toBe(false)
  })

  it('accepts remote-control grant messages on the remote-input domain', () => {
    const grant = parseControlMessage(
      JSON.stringify({
        t: 'remote-control-grant',
        v: 1,
        peerId: 'a',
        mouse: true,
        keyboard: false,
        generation: 3,
      }),
    )
    expect(grant?.t).toBe('remote-control-grant')
    if (grant?.t === 'remote-control-grant') {
      expect(domainForControl(grant)).toBe('remote-input')
      expect(shouldEncryptControl(grant)).toBe(true)
    }
    expect(
      parseControlMessage(
        JSON.stringify({
          t: 'remote-control-revoke',
          v: 1,
          peerId: 'a',
          generation: 4,
          reason: 'emergency',
        }),
      )?.t,
    ).toBe('remote-control-revoke')
  })
})
