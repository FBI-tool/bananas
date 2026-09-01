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

class MockRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null
  iceGatheringState = 'complete'
  connectionState = 'new'
  iceConnectionState = 'new'
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null
  ontrack: ((e: RTCTrackEvent) => void) | null = null
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  private senders: RTCRtpSender[] = []

  createDataChannel = vi.fn((label: string) => new MockDataChannel(label))
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'v=0' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'v=0' }))
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc
  })
  setRemoteDescription = vi.fn(async () => undefined)
  addTrack = vi.fn((track: MediaStreamTrack, _stream: MediaStream) => {
    const sender = { track } as RTCRtpSender
    this.senders.push(sender)
    return sender
  })
  getSenders = vi.fn(() => this.senders)
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  close = vi.fn()
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
  color: '#ffffff',
  language: 'en',
  isMicrophoneEnabledOnConnect: true,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}))

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
  vi.stubGlobal('RTCSessionDescription', MockRTCSessionDescription)
  vi.stubGlobal('window', {
    KiwiApi: {
      getSettings,
      updateRemoteCursor: vi.fn(),
      remoteCursorPing: vi.fn(),
    },
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn(async () => ({
        getVideoTracks: () => [{ enabled: true, stop: vi.fn() }],
        getTracks: () => [{ enabled: true, stop: vi.fn() }],
      })),
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [{ enabled: true, stop: vi.fn() }],
        getTracks: () => [{ enabled: true, stop: vi.fn(), id: 'audio' }],
      })),
    },
  })
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      controls: false,
      autoplay: false,
      srcObject: null,
    })),
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
    expect(mayBeConnectionString(ConnectionType.HOST, url)).toBe(true)
    expect(url.startsWith('kiwi://h/')).toBe(true)
  })

  it('Disconnect resets the peer connection', async () => {
    const { WebRTCSession } = await import('./webrtc.svelte')
    const session = new WebRTCSession()
    await session.Setup()
    await session.Disconnect()
    expect(session.IsConnected()).toBe(false)
  })
})
