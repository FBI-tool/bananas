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

  createDataChannel = vi.fn(
    (label: string, _opts?: RTCDataChannelInit) => new MockDataChannel(label),
  )
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
  getTransceivers = vi.fn(() => [])
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  addIceCandidate = vi.fn(async () => undefined)
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

  it('applies media e2ee to remembered senders after setMediaE2ee', async () => {
    const attachSender = vi.fn(async () => undefined)
    const attachReceiver = vi.fn(async () => undefined)
    const link = new PeerLink({
      rtcConfig: { iceServers: [] },
      localPeerId: 'local',
      pendingId: 'pending',
      isOfferer: true,
      events,
    })
    const display = { id: 'display', kind: 'video' } as MediaStreamTrack
    const stream = { id: 's' } as MediaStream
    await link.setDisplayTrack(display, stream)
    expect(attachSender).not.toHaveBeenCalled()
    link.setMediaE2ee({ attachSender, attachReceiver } as never)
    await link.applyMediaE2ee()
    expect(attachSender).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sender: 'local',
        kind: 'screen',
        streamId: 's',
      }),
    )
  })

  it('holds senders instead of sending plaintext when media e2ee is required', async () => {
    const link = new PeerLink({
      rtcConfig: { iceServers: [] },
      localPeerId: 'local',
      pendingId: 'pending',
      isOfferer: true,
      requireMediaE2ee: true,
      events,
    })
    const display = { id: 'display', kind: 'video', enabled: true } as MediaStreamTrack
    const stream = { id: 's' } as MediaStream
    await link.setDisplayTrack(display, stream)
    expect(display.enabled).toBe(false)
    const attachSender = vi.fn(async () => undefined)
    link.setMediaE2ee({ attachSender, attachReceiver: vi.fn() } as never)
    await link.applyMediaE2ee()
    expect(attachSender).toHaveBeenCalled()
    expect(display.enabled).toBe(true)
  })

  it('emits trickle ICE candidates when wired', () => {
    const onIceCandidate = vi.fn()
    const link = new PeerLink({
      rtcConfig: { iceServers: [] },
      localPeerId: 'local',
      pendingId: 'pending',
      isOfferer: true,
      events: { ...events, onIceCandidate },
    })
    const pc = link.pc as unknown as { onicecandidate: ((e: { candidate: null }) => void) | null }
    pc.onicecandidate?.({ candidate: null })
    expect(onIceCandidate).toHaveBeenCalledWith(null)
  })

  it('creates dedicated remote-input data channels as the offerer', () => {
    const link = new PeerLink({
      rtcConfig: { iceServers: [] },
      localPeerId: 'local',
      pendingId: 'pending',
      isOfferer: true,
      events,
    })
    const pc = link.pc as unknown as MockRTCPeerConnection
    const labels = pc.createDataChannel.mock.calls.map((call) => call[0])
    expect(labels).toEqual(['control', 'mls', 'remote-input-motion', 'remote-input-actions'])
    expect(pc.createDataChannel.mock.calls[2]?.[1]).toEqual({
      ordered: false,
      maxRetransmits: 0,
    })
    expect(pc.createDataChannel.mock.calls[3]?.[1]).toEqual({ ordered: true })
  })

  it('sends remote-input payloads on the matching channel', () => {
    const link = new PeerLink({
      rtcConfig: { iceServers: [] },
      localPeerId: 'local',
      pendingId: 'pending',
      isOfferer: true,
      events,
    })
    const pc = link.pc as unknown as MockRTCPeerConnection
    const motion = pc.createDataChannel.mock.results[2]?.value as MockDataChannel
    const actions = pc.createDataChannel.mock.results[3]?.value as MockDataChannel
    motion.readyState = 'open'
    actions.readyState = 'open'
    expect(link.sendRemoteInputMotion('{"t":"pointer-move"}')).toBe(true)
    expect(link.sendRemoteInputAction('{"t":"key"}')).toBe(true)
    expect(motion.send).toHaveBeenCalledWith('{"t":"pointer-move"}')
    expect(actions.send).toHaveBeenCalledWith('{"t":"key"}')
  })
})
