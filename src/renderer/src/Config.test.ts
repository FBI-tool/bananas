import { describe, expect, it } from 'vitest'
import { buildRtcPeerConnectionConfig } from './Config'

describe('RTCPeerConnection config', () => {
  it('omits encodedInsertableStreams unless media e2ee will attach a transform', () => {
    expect(buildRtcPeerConnectionConfig([], false).encodedInsertableStreams).toBeUndefined()
    expect(buildRtcPeerConnectionConfig([], true).encodedInsertableStreams).toBe(true)
  })
})
