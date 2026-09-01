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
})
