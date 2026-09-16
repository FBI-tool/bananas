import { cloneSessionDescription } from '../Utils'
import type { ControlMessage } from './controlProtocol'
import { parseControlMessage, serializeControlMessage } from './controlProtocol'
import { ICE_GATHERING_TIMEOUT_MS } from './constants'
import { decodeMlsFrame, encodeMlsFrame, type MlsFrame } from '../crypto/mlsWire'
import { asBufferSource } from '../crypto/constants'
import type { MediaE2EE } from '../crypto/mediaE2ee'
import type { MediaStreamIdentity } from '../crypto/roomCrypto'

export type PeerLinkEvents = {
  onControl: (msg: ControlMessage) => void
  onTrack: (event: RTCTrackEvent) => void
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void
  onConnectionStateChange: (state: RTCPeerConnectionState) => void
  onControlOpen: () => void
  onNegotiationOffer: (sdp: RTCSessionDescriptionInit) => void
  onMlsOpen?: () => void
  onMlsFrame?: (frame: MlsFrame) => void
  onIceCandidate?: (candidate: RTCIceCandidateInit | null) => void
}

type PeerLinkOptions = {
  rtcConfig: RTCConfiguration
  localPeerId: string
  pendingId: string
  isOfferer: boolean
  remotePeerId?: string | null
  events: PeerLinkEvents
  mediaE2ee?: MediaE2EE | null
  requireMediaE2ee?: boolean
}

export class PeerLink {
  readonly pendingId: string
  readonly localPeerId: string
  readonly createdAt = Date.now()
  remotePeerId: string | null
  readonly pc: RTCPeerConnection
  established = false
  private control: RTCDataChannel | null = null
  private mls: RTCDataChannel | null = null
  private readonly events: PeerLinkEvents
  private makingOffer = false
  private ignoreOffer = false
  private suppressNegotiation = true
  private closed = false
  private displaySender: RTCRtpSender | null = null
  private cameraSender: RTCRtpSender | null = null
  private mediaE2ee: MediaE2EE | null
  private requireMediaE2ee: boolean
  private heldEnabled = new WeakMap<MediaStreamTrack, boolean>()
  private extraSenders = new Map<RTCRtpSender, MediaStreamIdentity>()
  private extraReceivers: Array<{
    receiver: RTCRtpReceiver
    streamId: string
    trackKind: string
    identity: MediaStreamIdentity
  }> = []

  constructor(opts: PeerLinkOptions) {
    this.pendingId = opts.pendingId
    this.localPeerId = opts.localPeerId
    this.remotePeerId = opts.remotePeerId ?? null
    this.events = opts.events
    this.mediaE2ee = opts.mediaE2ee ?? null
    this.requireMediaE2ee = Boolean(opts.requireMediaE2ee)
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
    this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent): void => {
      this.events.onIceCandidate?.(event.candidate ? event.candidate.toJSON() : null)
    }
    this.pc.onnegotiationneeded = (): void => {
      void this.onNegotiationNeeded()
    }
    if (opts.isOfferer) {
      this.control = this.pc.createDataChannel('control')
      this.bindControl(this.control)
      this.mls = this.pc.createDataChannel('mls')
      this.bindMls(this.mls)
    } else {
      this.pc.ondatachannel = (event: RTCDataChannelEvent): void => {
        if (event.channel.label === 'control') {
          this.control = event.channel
          this.bindControl(event.channel)
        }
        if (event.channel.label === 'mls') {
          this.mls = event.channel
          this.bindMls(event.channel)
        }
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
    try {
      this.control.send(serializeControlMessage(msg))
      return true
    } catch (error) {
      console.warn('control send failed', error)
      return false
    }
  }

  sendMls(frame: MlsFrame): boolean {
    if (!this.mls || this.mls.readyState !== 'open') return false
    this.mls.send(asBufferSource(encodeMlsFrame(frame)).buffer)
    return true
  }

  setMediaE2ee(media: MediaE2EE | null): void {
    this.mediaE2ee = media
  }

  async applyMediaE2ee(
    resolveKind?: (streamId: string, trackKind: string) => MediaStreamIdentity['kind'],
  ): Promise<void> {
    for (const [sender, identity] of this.extraSenders) {
      await this.pushSender(sender, identity)
    }
    for (const item of this.extraReceivers) {
      const kind = resolveKind?.(item.streamId, item.trackKind) ?? item.identity.kind
      item.identity = {
        ...item.identity,
        sender: this.remotePeerId ?? item.identity.sender,
        kind,
      }
      await this.pushReceiver(item.receiver, item.identity)
    }
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    const existing = this.pc.getSenders().find((sender) => sender.track?.id === track.id)
    if (existing) return existing
    const sender = this.pc.addTrack(track, stream)
    if (track.kind === 'audio') {
      void this.attachSender(sender, {
        sender: this.localPeerId,
        kind: 'audio',
        streamId: stream.id,
      })
    }
    return sender
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

  private hintDisplayTrack(kind: 'display' | 'camera', track: MediaStreamTrack | null): void {
    if (kind !== 'display' || !track) return
    try {
      track.contentHint = 'detail'
    } catch {
      // ignore
    }
  }

  private async replaceOrAddSender(
    kind: 'display' | 'camera',
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
  ): Promise<void> {
    this.hintDisplayTrack(kind, track)
    const existing = kind === 'display' ? this.displaySender : this.cameraSender
    if (existing) {
      await existing.replaceTrack(track)
      if (track && stream) {
        await this.attachSender(existing, {
          sender: this.localPeerId,
          kind: kind === 'display' ? 'screen' : 'camera',
          streamId: stream.id,
        })
      }
      return
    }
    if (kind === 'display') {
      const found = this.pc
        .getSenders()
        .find((item) => item.track?.kind === 'video' && item !== this.cameraSender)
      if (found) {
        this.displaySender = found
        await found.replaceTrack(track)
        if (track && stream) {
          await this.attachSender(found, {
            sender: this.localPeerId,
            kind: 'screen',
            streamId: stream.id,
          })
        }
        return
      }
    }
    if (track && stream) {
      const sender = this.pc.addTrack(track, stream)
      if (kind === 'display') this.displaySender = sender
      else this.cameraSender = sender
      await this.attachSender(sender, {
        sender: this.localPeerId,
        kind: kind === 'display' ? 'screen' : 'camera',
        streamId: stream.id,
      })
    }
  }

  async createLocalOffer(): Promise<RTCSessionDescriptionInit> {
    this.suppressNegotiation = true
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    return cloneSessionDescription(this.pc.localDescription ?? offer)
  }

  async createLocalAnswer(): Promise<RTCSessionDescriptionInit> {
    this.suppressNegotiation = true
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    return cloneSessionDescription(this.pc.localDescription ?? answer)
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(desc)
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(candidate)
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
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        this.pc.removeEventListener('icegatheringstatechange', onStateChange)
        clearTimeout(timeoutId)
        resolve()
      }
      const onStateChange = (): void => {
        if (this.pc.iceGatheringState === 'complete') finish()
      }
      const timeoutId = setTimeout(() => {
        console.warn('ICE gathering timed out; continuing with current candidates')
        finish()
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
    let opened = false
    const notifyOpen = (): void => {
      if (opened) return
      opened = true
      this.events.onControlOpen()
    }
    channel.onopen = notifyOpen
    if (channel.readyState === 'open') queueMicrotask(notifyOpen)
  }

  private bindMls(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer'
    channel.onmessage = (event: MessageEvent<ArrayBuffer | string>): void => {
      const frame = decodeMlsFrame(event.data)
      if (frame) this.events.onMlsFrame?.(frame)
    }
    let opened = false
    const notifyOpen = (): void => {
      if (opened) return
      opened = true
      this.events.onMlsOpen?.()
    }
    channel.onopen = notifyOpen
    if (channel.readyState === 'open') queueMicrotask(notifyOpen)
  }

  private async attachSender(sender: RTCRtpSender, identity: MediaStreamIdentity): Promise<void> {
    this.extraSenders.set(sender, identity)
    this.preferVideoCodecs(sender, identity.kind)
    await this.pushSender(sender, identity)
  }

  private preferVideoCodecs(sender: RTCRtpSender, kind: MediaStreamIdentity['kind']): void {
    if (kind === 'audio') return
    const transceiver = this.pc.getTransceivers?.().find((item) => item.sender === sender)
    const capabilities = (
      globalThis as {
        RTCRtpSender?: { getCapabilities?: (kind: string) => RTCRtpCapabilities | null }
      }
    ).RTCRtpSender?.getCapabilities?.('video')
    if (!transceiver?.setCodecPreferences || !capabilities) return
    const rank = (mime: string): number => {
      const type = mime.toLowerCase()
      if (type === 'video/vp8') return 0
      if (type === 'video/vp9') return 1
      if (type.includes('h264')) return 2
      return 3
    }
    try {
      transceiver.setCodecPreferences(
        [...capabilities.codecs].sort((left, right) => rank(left.mimeType) - rank(right.mimeType)),
      )
    } catch {
      // ignore
    }
  }

  async attachReceiver(receiver: RTCRtpReceiver, identity: MediaStreamIdentity): Promise<void> {
    this.extraReceivers = this.extraReceivers.filter((item) => item.receiver !== receiver)
    this.extraReceivers.push({
      receiver,
      streamId: identity.streamId,
      trackKind: identity.kind === 'audio' ? 'audio' : 'video',
      identity,
    })
    await this.pushReceiver(receiver, identity)
  }

  private holdPlaintextTrack(track: MediaStreamTrack | null): void {
    if (!track) return
    if (!this.heldEnabled.has(track)) this.heldEnabled.set(track, track.enabled)
    track.enabled = false
  }

  private releaseHeldTrack(track: MediaStreamTrack | null): void {
    if (!track || !this.heldEnabled.has(track)) return
    track.enabled = this.heldEnabled.get(track) ?? false
    this.heldEnabled.delete(track)
  }

  private async pushSender(sender: RTCRtpSender, identity: MediaStreamIdentity): Promise<void> {
    if (this.requireMediaE2ee && !this.mediaE2ee) {
      this.holdPlaintextTrack(sender.track)
      console.warn('media e2ee required; holding sender until transform is attached')
      return
    }
    if (!this.mediaE2ee) return
    try {
      await this.mediaE2ee.attachSender(sender, identity)
      this.releaseHeldTrack(sender.track)
    } catch (error) {
      if (this.requireMediaE2ee) this.holdPlaintextTrack(sender.track)
      console.warn('media e2ee attach sender failed', error)
    }
  }

  private async pushReceiver(
    receiver: RTCRtpReceiver,
    identity: MediaStreamIdentity,
  ): Promise<void> {
    if (this.requireMediaE2ee && !this.mediaE2ee) {
      receiver.track?.stop()
      console.warn('media e2ee required; dropping receiver until transform is attached')
      return
    }
    if (!this.mediaE2ee) return
    try {
      await this.mediaE2ee.attachReceiver(receiver, identity)
    } catch (error) {
      if (this.requireMediaE2ee) receiver.track?.stop()
      console.warn('media e2ee attach receiver failed', error)
    }
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
