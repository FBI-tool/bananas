import { beforeEach, describe, expect, it, vi } from 'vitest'

class MockDataChannel {
  label: string
  readyState = 'open'
  onmessage: ((e: MessageEvent) => void) | null = null
  send = vi.fn()
  constructor(label: string) {
    this.label = label
  }
}

const peerConnections: MockRTCPeerConnection[] = []

class MockRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  iceGatheringState = 'complete'
  connectionState = 'new'
  iceConnectionState = 'new'
  signalingState = 'stable'
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null
  ontrack: ((e: RTCTrackEvent) => void) | null = null
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  onnegotiationneeded: (() => void) | null = null
  private senders: RTCRtpSender[] = []

  createDataChannel = vi.fn((label: string) => new MockDataChannel(label))
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'v=0' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'v=0' }))
  setLocalDescription = vi.fn(async (desc?: RTCSessionDescriptionInit) => {
    if (desc) this.localDescription = desc
  })
  setRemoteDescription = vi.fn(async (desc?: RTCSessionDescriptionInit) => {
    if (desc) this.remoteDescription = desc
    this.signalingState = desc?.type === 'offer' ? 'have-remote-offer' : 'stable'
  })
  addTrack = vi.fn((track: MediaStreamTrack, _stream: MediaStream) => {
    const sender = {
      track,
      replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => {
        sender.track = next
      }),
    }
    this.senders.push(sender as unknown as RTCRtpSender)
    return sender as unknown as RTCRtpSender
  })
  getSenders = vi.fn(() => this.senders)
  getTransceivers = vi.fn(() => [])
  removeTrack = vi.fn()
  addIceCandidate = vi.fn(async () => undefined)
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  close = vi.fn()

  constructor() {
    peerConnections.push(this)
  }
}

class MockRTCSessionDescription {
  type: RTCSdpType
  sdp: string
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type ?? 'offer'
    this.sdp = init.sdp ?? ''
  }
}

const getSettings = vi.fn(async () => ({
  username: 'Kiwi',
  foregroundColor: '#1a1a1a',
  backgroundColor: '#ffffff',
  language: 'en',
  isMicrophoneEnabledOnConnect: true,
  hardwareVideoAcceleration: true,
  debugLogsEnabled: false,
  e2eeEnabled: false,
  mediaE2eeEnabled: false,
  cameraDeviceId: '',
  microphoneDeviceId: '',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}))

beforeEach(() => {
  peerConnections.length = 0
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
  vi.stubGlobal('RTCSessionDescription', MockRTCSessionDescription)
  vi.stubGlobal('RTCRtpSender', { prototype: {} })
  vi.stubGlobal('window', {
    KiwiApi: {
      getSettings,
      getDeviceIdentity: vi.fn(async () => ({
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        fingerprint: 'aa'.repeat(16),
      })),
      updateRemoteCursor: vi.fn(),
      remoteCursorPing: vi.fn(),
      toggleRemoteCursors: vi.fn(),
      removeRemoteCursor: vi.fn(),
      toggleCallOverlay: vi.fn(),
      onCallOverlayClosed: vi.fn(),
      onCallOverlayReady: vi.fn(),
      onCallChatSend: vi.fn(),
      onCallToggleCamera: vi.fn(),
      onCallLoopAnswer: vi.fn(),
      onCallLoopIce: vi.fn(),
      sendCallLoopOffer: vi.fn(),
      sendCallLoopIce: vi.fn(),
      sendCallCameraMids: vi.fn(),
      sendCallChat: vi.fn(),
      sendCallPeers: vi.fn(),
      bonjour: {
        hangup: vi.fn(async () => undefined),
      },
    },
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn(async () => ({
        getVideoTracks: () => [{ enabled: true, stop: vi.fn(), addEventListener: vi.fn() }],
        getTracks: () => [{ enabled: true, stop: vi.fn(), addEventListener: vi.fn() }],
      })),
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [
          { enabled: true, stop: vi.fn(), id: 'audio', addEventListener: vi.fn() },
        ],
        getVideoTracks: () => [],
        getTracks: () => [{ enabled: true, stop: vi.fn(), id: 'audio', addEventListener: vi.fn() }],
      })),
    },
  })
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      controls: false,
      autoplay: false,
      srcObject: null,
      style: {},
      setAttribute: vi.fn(),
      play: vi.fn(async () => undefined),
      remove: vi.fn(),
    })),
    body: { appendChild: vi.fn() },
  })
})

describe('WebRTCSession', () => {
  it('CreateHostUrl produces a valid kiwi host URL after Setup', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const { mayBeConnectionString, ConnectionType } = await import('./Utils')
    const session = new WebRTCSession()
    const result = await session.Setup()
    expect(result).toBe('ok')
    const url = await session.CreateHostUrl({ username: 'Kiwi' })
    expect(url).toBeTruthy()
    expect(mayBeConnectionString(ConnectionType.HOST, url ?? '')).toBe(true)
    expect(url?.startsWith('kiwi://h/')).toBe(true)
  })

  it('Disconnect resets the peer connection', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    await session.Setup()
    await session.Disconnect()
    expect(session.IsConnected()).toBe(false)
  })

  it('Setup can skip the display picker', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    const result = await session.Setup(null, { captureDisplay: false })
    expect(result).toBe('ok')
    expect(navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled()
  })

  it('startBonjourCall signals an offer without a kiwi URL', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const { PeerLink } = await import('./session/peerLink')
    const session = new WebRTCSession()
    await session.Setup()
    const sent: Array<{ type: string }> = []
    session.bindBonjour((_callId, payload) => sent.push(payload))
    const waitIce = vi.spyOn(PeerLink.prototype, 'waitForIceGatheringComplete')
    await session.startBonjourCall({ callId: 'call-1', peerId: 'peer-1' })
    expect(session.bonjourCallId).toBe('call-1')
    expect(session.signalingKind).toBe('bonjour')
    expect(session.isPresenter).toBe(true)
    const offer = sent.find((item) => item.type === 'offer')
    expect(offer).toBeTruthy()
    expect('invite' in (offer ?? {})).toBe(true)
    expect(sent.every((item) => !('url' in item))).toBe(true)
    expect(waitIce).not.toHaveBeenCalled()
    const offerAt = sent.findIndex((item) => item.type === 'offer')
    const iceAt = sent.findIndex((item) => item.type === 'ice')
    if (iceAt >= 0) expect(offerAt).toBeLessThan(iceAt)
  })

  it('requestBonjourJoin waits for the host offer without a kiwi URL', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    const video = document.createElement('video') as HTMLVideoElement
    await session.Setup(video)
    const sent: Array<{ type: string }> = []
    session.bindBonjour((_callId, payload) => sent.push(payload))
    await session.requestBonjourJoin({ callId: 'join-1', peerId: 'host-1' })
    expect(session.bonjourCallId).toBe('join-1')
    expect(session.signalingKind).toBe('bonjour')
    expect(session.isPresenter).toBe(false)
    expect(sent).toEqual([])
  })

  it('acceptBonjourCall answers without emitting a kiwi URL', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    const video = document.createElement('video') as HTMLVideoElement
    await session.Setup(video)
    const sent: Array<{ type: string }> = []
    session.bindBonjour((_callId, payload) => sent.push(payload))
    await session.acceptBonjourCall({
      callId: 'call-3',
      peerId: 'host-1',
      offer: { type: 'offer', sdp: 'v=0' },
      invite: null,
    })
    expect(sent.some((item) => item.type === 'answer')).toBe(true)
    expect(sent.every((item) => !('url' in item))).toBe(true)
    expect(session.signalingKind).toBe('bonjour')
    const answerAt = sent.findIndex((item) => item.type === 'answer')
    const iceAt = sent.findIndex((item) => item.type === 'ice')
    if (iceAt >= 0) expect(answerAt).toBeLessThan(iceAt)
  })

  it('acceptBonjourCall still answers after Setup wipes the peer connection', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    const sent: Array<{ type: string }> = []
    session.bindBonjour((_callId, payload) => sent.push(payload))
    const video = document.createElement('video') as HTMLVideoElement
    await session.Setup(video)
    await session.acceptBonjourCall({
      callId: 'call-4',
      peerId: 'host-1',
      offer: { type: 'offer', sdp: 'v=0' },
      invite: null,
    })
    expect(sent.some((item) => item.type === 'answer')).toBe(true)
    expect(session.signalingKind).toBe('bonjour')
  })

  it('acceptBonjourCall fails closed without an mls-invite when e2ee is required', async () => {
    getSettings.mockResolvedValueOnce({
      username: 'Kiwi',
      foregroundColor: '#1a1a1a',
      backgroundColor: '#ffffff',
      language: 'en',
      isMicrophoneEnabledOnConnect: true,
      hardwareVideoAcceleration: true,
      debugLogsEnabled: false,
      e2eeEnabled: true,
      mediaE2eeEnabled: true,
      cameraDeviceId: '',
      microphoneDeviceId: '',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    const video = document.createElement('video') as HTMLVideoElement
    await session.Setup(video)
    session.bindBonjour(() => undefined)
    await expect(
      session.acceptBonjourCall({
        callId: 'call-2',
        peerId: 'host-1',
        offer: { type: 'offer', sdp: 'v=0' },
        invite: null,
      }),
    ).rejects.toThrow(/invite is missing/)
  })

  const emitIce = (pc: MockRTCPeerConnection, candidate: string): void => {
    pc.onicecandidate?.({
      candidate: {
        toJSON: () => ({ candidate, sdpMid: '0', sdpMLineIndex: 0 }),
      },
    } as unknown as RTCPeerConnectionIceEvent)
  }

  it('routes a second Bonjour call without stealing the first call ICE', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    await session.Setup(null, { captureDisplay: false })
    const sent: Array<{ callId: string; type: string; candidate?: string }> = []
    session.bindBonjour((callId, payload) => {
      sent.push({ callId, type: payload.type, candidate: payload.candidate?.candidate })
    })
    await session.startBonjourCall({ callId: 'call-1', peerId: 'peer-1' })
    await session.startBonjourCall({ callId: 'call-2', peerId: 'peer-2' })
    expect(sent.filter((item) => item.type === 'offer').map((item) => item.callId)).toEqual([
      'call-1',
      'call-2',
    ])
    emitIce(peerConnections[0], 'ice-1')
    emitIce(peerConnections[1], 'ice-2')
    expect(sent.filter((item) => item.type === 'ice')).toEqual([
      { callId: 'call-1', type: 'ice', candidate: 'ice-1' },
      { callId: 'call-2', type: 'ice', candidate: 'ice-2' },
    ])
  })

  it('applies a Bonjour answer to the matching call', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    await session.Setup(null, { captureDisplay: false })
    session.bindBonjour(() => undefined)
    await session.startBonjourCall({ callId: 'call-1', peerId: 'peer-1' })
    await session.startBonjourCall({ callId: 'call-2', peerId: 'peer-2' })
    await session.applyBonjourSignal('call-2', {
      type: 'answer',
      sdp: { type: 'answer', sdp: 'v=0' },
    })
    expect(peerConnections[0].remoteDescription).toBeNull()
    expect(peerConnections[1].remoteDescription?.type).toBe('answer')
  })

  it('keeps Bonjour signaling when copying a kiwi invite', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    await session.Setup(null, { captureDisplay: false })
    const sent: Array<{ callId: string; type: string }> = []
    session.bindBonjour((callId, payload) => sent.push({ callId, type: payload.type }))
    await session.startBonjourCall({ callId: 'call-1', peerId: 'peer-1' })
    sent.length = 0
    const url = await session.CreateHostUrl({ username: 'Kiwi' })
    expect(url?.startsWith('kiwi://h/')).toBe(true)
    expect(session.signalingKind).toBe('bonjour')
    emitIce(peerConnections[0], 'still-1')
    expect(sent).toEqual([{ callId: 'call-1', type: 'ice' }])
  })

  it('hangs up one Bonjour call without closing the other link', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    await session.Setup(null, { captureDisplay: false })
    const sent: Array<{ callId: string; type: string }> = []
    session.bindBonjour((callId, payload) => sent.push({ callId, type: payload.type }))
    await session.startBonjourCall({ callId: 'call-1', peerId: 'peer-1' })
    await session.startBonjourCall({ callId: 'call-2', peerId: 'peer-2' })
    await session.applyBonjourSignal('call-2', { type: 'hangup' })
    expect(peerConnections[0].close).not.toHaveBeenCalled()
    expect(peerConnections[1].close).toHaveBeenCalled()
    expect(session.hasBonjourCall('call-1')).toBe(true)
    expect(session.hasBonjourCall('call-2')).toBe(false)
    sent.length = 0
    emitIce(peerConnections[0], 'after-hangup')
    expect(sent).toEqual([{ callId: 'call-1', type: 'ice' }])
  })
})
