import type { ControlMessage } from './controlProtocol'
import { parseControlMessage, serializeControlMessage } from './controlProtocol'
import { ICE_GATHERING_TIMEOUT_MS } from './constants'

export type PeerLinkEvents = {
  onControl: (msg: ControlMessage) => void
  onTrack: (event: RTCTrackEvent) => void
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void
  onConnectionStateChange: (state: RTCPeerConnectionState) => void
  onControlOpen: () => void
  onNegotiationOffer: (sdp: RTCSessionDescriptionInit) => void
}

type PeerLinkOptions = {
  rtcConfig: RTCConfiguration
  localPeerId: string
  pendingId: string
  isOfferer: boolean
  remotePeerId?: string | null
  events: PeerLinkEvents
}

export class PeerLink {
  readonly pendingId: string
  readonly localPeerId: string
  readonly createdAt = Date.now()
  remotePeerId: string | null
  readonly pc: RTCPeerConnection
  established = false
  private control: RTCDataChannel | null = null
  private readonly events: PeerLinkEvents
  private makingOffer = false
  private ignoreOffer = false
  private suppressNegotiation = true
  private closed = false
  private displaySender: RTCRtpSender | null = null
  private cameraSender: RTCRtpSender | null = null

  constructor(opts: PeerLinkOptions) {
    this.pendingId = opts.pendingId
    this.localPeerId = opts.localPeerId
    this.remotePeerId = opts.remotePeerId ?? null
    this.events = opts.events
    this.pc = new RTCPeerConnection(opts.rtcConfig)
    this.pc.ontrack = (event): void => {
      this.events.onTrack(event)
    }
    this.pc.onconnectionstatechange = (): void => {
      this.events.onConnectionStateChange(this.pc.connectionState)
    }
    this.pc.oniceconnectionstatechange = (): void => {
      this.events.onIceConnectionStateChange(this.pc.iceConnectionState)
    }
    this.pc.onnegotiationneeded = (): void => {
      void this.onNegotiationNeeded()
    }
    if (opts.isOfferer) {
      this.control = this.pc.createDataChannel('control')
      this.bindControl(this.control)
    } else {
      this.pc.ondatachannel = (event: RTCDataChannelEvent): void => {
        if (event.channel.label !== 'control') return
        this.control = event.channel
        this.bindControl(event.channel)
      }
    }
  }

  get polite(): boolean {
    return this.remotePeerId !== null && this.localPeerId > this.remotePeerId
  }

  get isControlOpen(): boolean {
    return this.control?.readyState === 'open'
  }

  get iceConnectionState(): RTCIceConnectionState {
    return this.pc.iceConnectionState
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState
  }

  get localDescription(): RTCSessionDescriptionInit | null {
    return this.pc.localDescription
  }

  markEstablished(): void {
    this.established = true
    this.suppressNegotiation = false
  }

  sendControl(msg: ControlMessage): boolean {
    if (!this.control || this.control.readyState !== 'open') return false
    this.control.send(serializeControlMessage(msg))
    return true
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    const existing = this.pc.getSenders().find((sender) => sender.track?.id === track.id)
    if (existing) return existing
    return this.pc.addTrack(track, stream)
  }

  async setVideoTrack(track: MediaStreamTrack | null, stream: MediaStream | null): Promise<void> {
    await this.setDisplayTrack(track, stream)
  }

  async setDisplayTrack(track: MediaStreamTrack | null, stream: MediaStream | null): Promise<void> {
    await this.replaceOrAddSender('display', track, stream)
  }

  async setCameraTrack(track: MediaStreamTrack | null, stream: MediaStream | null): Promise<void> {
    await this.replaceOrAddSender('camera', track, stream)
  }

  private async replaceOrAddSender(
    kind: 'display' | 'camera',
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
  ): Promise<void> {
    const existing = kind === 'display' ? this.displaySender : this.cameraSender
    if (existing) {
      await existing.replaceTrack(track)
      return
    }
    if (kind === 'display') {
      const found = this.pc
        .getSenders()
        .find((item) => item.track?.kind === 'video' && item !== this.cameraSender)
      if (found) {
        this.displaySender = found
        await found.replaceTrack(track)
        return
      }
    }
    if (track && stream) {
      const sender = this.pc.addTrack(track, stream)
      if (kind === 'display') this.displaySender = sender
      else this.cameraSender = sender
    }
  }

  async createLocalOffer(): Promise<RTCSessionDescriptionInit> {
    this.suppressNegotiation = true
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    return this.pc.localDescription ?? offer
  }

  async createLocalAnswer(): Promise<RTCSessionDescriptionInit> {
    this.suppressNegotiation = true
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    return this.pc.localDescription ?? answer
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(desc)
  }

  async handleRemoteSdp(
    desc: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit | null> {
    const offerCollision =
      desc.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable')
    this.ignoreOffer = !this.polite && offerCollision
    if (this.ignoreOffer) return null
    await this.pc.setRemoteDescription(desc)
    if (desc.type === 'offer') {
      await this.pc.setLocalDescription()
      return this.pc.localDescription
    }
    return null
  }

  async waitForIceGatheringComplete(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        this.pc.removeEventListener('icegatheringstatechange', onStateChange)
        clearTimeout(timeoutId)
      }
      const onStateChange = (): void => {
        if (this.pc.iceGatheringState === 'complete') {
          cleanup()
          resolve()
        }
      }
      const timeoutId = setTimeout(() => {
        cleanup()
        console.warn('ICE gathering timed out; continuing with current candidates')
        resolve()
      }, ICE_GATHERING_TIMEOUT_MS)
      this.pc.addEventListener('icegatheringstatechange', onStateChange)
      onStateChange()
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.pc.close()
    } catch {
      // ignore
    }
  }

  private bindControl(channel: RTCDataChannel): void {
    channel.onmessage = (event: MessageEvent<string>): void => {
      const msg = parseControlMessage(String(event.data))
      if (msg) this.events.onControl(msg)
    }
    const notifyOpen = (): void => {
      this.events.onControlOpen()
    }
    channel.onopen = notifyOpen
    if (channel.readyState === 'open') queueMicrotask(notifyOpen)
  }

  private async onNegotiationNeeded(): Promise<void> {
    if (this.suppressNegotiation || this.closed) return
    if (!this.remotePeerId) return
    try {
      this.makingOffer = true
      await this.pc.setLocalDescription()
      if (this.pc.localDescription) {
        this.events.onNegotiationOffer(this.pc.localDescription)
      }
    } catch (error) {
      console.error(error)
    } finally {
      this.makingOffer = false
    }
  }
}
