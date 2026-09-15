import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerLink } from './peerLink'

class MockDataChannel {
  label: string
  readyState = 'connecting'
  onmessage: ((e: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  send = vi.fn()
  constructor(label: string) {
    this.label = label
  }
}

class MockRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null
  iceGatheringState = 'complete'
  connectionState = 'new'
  iceConnectionState = 'new'
  signalingState = 'stable'
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null
  ontrack: ((e: RTCTrackEvent) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  onnegotiationneeded: (() => void) | null = null
  private senders: Array<RTCRtpSender & { replaceTrack: ReturnType<typeof vi.fn> }> = []

  createDataChannel = vi.fn((label: string) => new MockDataChannel(label))
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'v=0' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'v=0' }))
  setLocalDescription = vi.fn(async (desc?: RTCSessionDescriptionInit) => {
    if (desc) this.localDescription = desc
  })
  setRemoteDescription = vi.fn(async () => undefined)
  addTrack = vi.fn((track: MediaStreamTrack, _stream: MediaStream) => {
    const sender = {
      track,
      replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => {
        sender.track = next
      }),
    }
    this.senders.push(sender as RTCRtpSender & { replaceTrack: ReturnType<typeof vi.fn> })
    return sender
  })
  getSenders = vi.fn(() => this.senders)
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  close = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
})

const events = {
  onControl: vi.fn(),
  onTrack: vi.fn(),
  onIceConnectionStateChange: vi.fn(),
  onConnectionStateChange: vi.fn(),
  onControlOpen: vi.fn(),
  onNegotiationOffer: vi.fn(),
}

describe('PeerLink video senders', () => {
  it('keeps display and camera tracks on separate senders', async () => {
    const link = new PeerLink({
      rtcConfig: { iceServers: [] },
      localPeerId: 'local',
      pendingId: 'pending',
      isOfferer: true,
      events,
    })
    const display = { id: 'display', kind: 'video' } as MediaStreamTrack
    const camera = { id: 'camera', kind: 'video' } as MediaStreamTrack
    const other = { id: 'other', kind: 'video' } as MediaStreamTrack
    const stream = { id: 's' } as MediaStream

    await link.setVideoTrack(display, stream)
    await link.setCameraTrack(camera, stream)
    const senders = link.pc.getSenders()
    expect(senders).toHaveLength(2)
    expect(senders[0].track).toBe(display)
    expect(senders[1].track).toBe(camera)

    await link.setVideoTrack(other, stream)
    expect(link.pc.getSenders()[0].track).toBe(other)
    expect(link.pc.getSenders()[1].track).toBe(camera)
    expect(senders[0].replaceTrack).toHaveBeenCalledWith(other)
    expect(senders[1].replaceTrack).not.toHaveBeenCalled()
  })
})
