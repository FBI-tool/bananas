import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, parseControlMessage, serializeControlMessage } from './controlProtocol'

describe('controlProtocol', () => {
  it('round-trips a hello message', () => {
    const msg = {
      t: 'hello' as const,
      v: PROTOCOL_VERSION,
      peerId: 'a',
      username: 'Kiwi',
      color: '#fff',
    }
    const parsed = parseControlMessage(serializeControlMessage(msg))
    expect(parsed).toEqual(msg)
  })

  it('rejects unknown types and invalid payloads', () => {
    expect(parseControlMessage('{"t":"nope","v":1}')).toBeNull()
    expect(parseControlMessage('not-json')).toBeNull()
    expect(
      parseControlMessage('{"t":"hello","v":2,"peerId":"a","username":"x","color":"#fff"}'),
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
})
