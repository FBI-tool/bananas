import type { CallChatMessage, CallPeerInfo } from '../callTypes'
import type { RemoteCursorData, SettingsData } from '../types'
import type { RTCSessionDescriptionOptions } from '../Utils'
import {
  ConnectionType,
  cloneSessionDescription,
  dropTcpIceCandidates,
  getConnectionString,
  getUUIDv4,
  mediaTrackConstraints,
  cloneForIpc,
} from '../Utils'
import { getRTCPeerConnectionConfig } from '../Config'
import { appState } from '../appState.svelte'
import {
  CHAT_MAX_MESSAGES,
  MAX_PEERS,
  PENDING_INVITE_TTL_MS,
  VOTE_COOLDOWN_MS,
  VOTE_TIMEOUT_MS,
  ICE_DISCONNECT_GRACE_MS,
  truncateChatText,
} from './constants'
import type { ControlMessage, HelloCrypto, RosterPeer } from './controlProtocol'
import {
  PROTOCOL_VERSION,
  domainForControl,
  parseControlMessage,
  serializeControlMessage,
  shouldEncryptControl,
} from './controlProtocol'
import {
  parseRemoteInputMessage,
  serializeRemoteInputMessage,
  type RemoteControlGrant,
  type RemoteControlRevokeReason,
  type RemoteInputMessage,
} from './remoteInputProtocol'
import {
  acceptSeq,
  activeController,
  dropPeerRemoteControl,
  getPeerRemoteControl,
  grantRemoteControlState,
  inputMatchesGrant,
  requestRemoteControlState,
  revokeAllRemoteControlState,
  revokeRemoteControlState,
  type RemoteControlMap,
  type SeqTracker,
} from './remoteControlState'
import { DEFAULT_EMERGENCY_HOTKEY, formatEmergencyHotkey } from './emergencyHotkey'
import { isPortableKeyCode } from './portableKeys'
import { CallLoopback } from './callLoopback'
import { PeerLink } from './peerLink'
import {
  answersMatchOffer,
  canStartKick,
  canStartVote,
  castVote,
  nextCoordinator,
  pickRemoteCameraAndDisplay,
  resumeVote,
  routeMeshSignal,
  sessionEndedReasonAfterDeparture,
  startVote,
  uniquePeersById,
  voteOutcome,
  type SessionEndedReason,
  type VoteKind,
  type VoteState,
} from './roomLogic'
import { playSessionEndedSound } from './sessionEndedSound'
import { playCursorPingSound } from './cursorPingSound'
import {
  dropPlaintextInbound,
  encryptionRequired,
  outboundCryptoAction,
  shouldPrepareJoinerCrypto,
} from './e2eePolicy'
import { debugLog, summarizePc, summarizeSdp } from '../debugLog.svelte'
import { RoomCrypto, type DeviceIdentity, type VerificationInfo } from '../crypto/roomCrypto'
import { MediaE2EE } from '../crypto/mediaE2ee'
import { supportsEncodedTransform } from '../crypto/sframe'
import { defaultCryptoCapabilities, fromBase64Url, toBase64Url } from '../crypto/constants'
import { deriveJoinAuthenticator, randomInviteCrypto, type InviteCrypto } from '../crypto/invite'
import {
  bodyToFrame,
  chunkMlsFrame,
  frameBodyBytes,
  MlsAssembler,
  type MlsFrame,
} from '../crypto/mlsWire'
import {
  bonjourTransport,
  cloneBonjourPayload,
  kiwiTransport,
  type BonjourSignalPayload,
  type BonjourSignalSend,
  type SignalingTransport,
  type SignalingTransportKind,
} from './bonjourSignal'

const errorHandler = (e: unknown): void => {
  console.error(e)
  debugLog.error('room', 'unhandled error', e)
}

export type RoomPeer = RosterPeer

export class Room {
  connectionState = $state('disconnected')
  sessionEndedReason = $state<SessionEndedReason | null>(null)
  presenterGone = $state(false)
  isLive = $state(false)
  localPeerId = $state('')
  coordinatorId = $state('')
  presenterId = $state('')
  peers = $state<RoomPeer[]>([])
  displayStreamActive = $state(false)
  microphoneActive = $state(false)
  cameraActive = $state(false)
  cursorsEnabled = $state(false)
  hasAudioInput = $state(false)
  activeVote = $state<VoteState | null>(null)
  localVoteCast = $state<boolean | null>(null)
  voteRejectedKind = $state<VoteKind | null>(null)
  chatMessages = $state<CallChatMessage[]>([])
  e2eeActive = $state(false)
  mediaE2eeActive = $state(false)
  e2eeRequired = $state(false)
  identityChanged = $state(false)
  verification = $state<VerificationInfo | null>(null)
  e2eeError = $state<string | null>(null)
  bonjourCallId = $state<string | null>(null)
  signalingKind = $state<SignalingTransportKind>('kiwi')
  remoteControl = $state<RemoteControlMap>({})
  remoteControlCaps = $state<{
    pointerInjection: boolean
    keyboardInjection: boolean
    emergencyHotkey: boolean
    keyboardCapture?: boolean
    backend?: string
    unavailableReason?: string
    permissions?: {
      accessibility?: 'unknown' | 'granted' | 'denied'
      screenRecording?: 'unknown' | 'granted' | 'denied'
      inputMonitoring?: 'unknown' | 'granted' | 'denied'
    }
  } | null>(null)
  emergencyStopMessage = $state<string | null>(null)
  emergencyHotkeyLabel = $state(formatEmergencyHotkey(DEFAULT_EMERGENCY_HOTKEY))

  private remoteVideo: HTMLVideoElement | null = null
  private audioStream: MediaStream | null = null
  private displayStream: MediaStream | null = null
  private pendingDisplayStream: MediaStream | null = null
  private cameraStream: MediaStream | null = null
  private cameraSendStreamId = ''
  private userSettings: SettingsData | null = null
  private username = ''
  private color = '#ffffff'
  private links = new Map<string, PeerLink>()
  private remoteVideoStreams = new Map<string, MediaStream>()
  private remoteVideoByStreamId = new Map<string, { peerId: string; stream: MediaStream }>()
  private remoteCameraState = new Map<string, { enabled: boolean; streamId: string }>()
  private remoteCameraStreams = new Map<string, MediaStream>()
  private remoteAudioElements = new Map<string, HTMLAudioElement>()
  private iceGraceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private voteTimer: ReturnType<typeof setTimeout> | null = null
  private cooldownUntil = 0
  private closing = new Set<string>()
  private quietClose = false
  private handshakeKey: string | null = null
  private lastCopiedPendingId: string | null = null
  private callIpcBound = false
  private overlayOpen = false
  private readonly loopback = new CallLoopback()
  private crypto: RoomCrypto | null = null
  private mediaE2ee: MediaE2EE | null = null
  private identity: DeviceIdentity | null = null
  private invite: InviteCrypto | null = null
  private joinAuth = ''
  private seenFingerprints = new Map<string, string>()
  private pendingKeyPackages = new Map<string, Uint8Array>()
  private pendingE2ee = new Map<PeerLink, ControlMessage[]>()
  private pendingOutbound: ControlMessage[] = []
  private addingMembers = new Set<string>()
  private mlsAssembler = new MlsAssembler()
  private mlsTail: Promise<void> = Promise.resolve()
  private bonjourSend: BonjourSignalSend | null = null
  private signaling: SignalingTransport = kiwiTransport()
  private pendingBonjourIce: RTCIceCandidateInit[] = []
  private pendingBonjourIceOut: RTCIceCandidateInit[] = []
  private bonjourLocalSdpSent = false
  private inboundRemoteSeq: SeqTracker = {}
  private outboundMotionSeq = 0
  private outboundActionSeq = 0
  private remoteControlUnsub: Array<() => void> = []

  get isCoordinator(): boolean {
    return this.localPeerId !== '' && this.localPeerId === this.coordinatorId
  }

  get isPresenter(): boolean {
    return this.localPeerId !== '' && this.localPeerId === this.presenterId
  }

  get localRemoteGrant(): { mouse: boolean; keyboard: boolean; generation: number } | null {
    const state = this.remoteControl[this.localPeerId]
    if (!state || (!state.mouse && !state.keyboard)) return null
    return { mouse: state.mouse, keyboard: state.keyboard, generation: state.generation }
  }

  get activeRemoteController(): { peerId: string; mouse: boolean; keyboard: boolean } | null {
    const active = activeController(this.remoteControl)
    if (!active) return null
    return { peerId: active.peerId, mouse: active.state.mouse, keyboard: active.state.keyboard }
  }

  get remoteControlRequests(): Array<{
    peerId: string
    username: string
    mouse: boolean
    keyboard: boolean
  }> {
    if (!this.isPresenter) return []
    return Object.entries(this.remoteControl)
      .filter(([, state]) => state.requestedMouse || state.requestedKeyboard)
      .map(([peerId, state]) => ({
        peerId,
        username: this.peers.find((peer) => peer.id === peerId)?.username ?? peerId.slice(0, 8),
        mouse: state.requestedMouse,
        keyboard: state.requestedKeyboard,
      }))
  }

  presenterUsername(): string {
    return this.peers.find((peer) => peer.id === this.presenterId)?.username ?? ''
  }

  get remotePeerCount(): number {
    return this.establishedRemoteIds().length
  }

  setRemoteVideo(video: HTMLVideoElement | null): void {
    this.remoteVideo = video
    this.attachPresenterVideo()
  }

  HasAudioInput(): boolean {
    return this.audioStream !== null
  }

  GetAudioStream(): MediaStream | null {
    return this.audioStream
  }

  IsMicrophoneActive(): boolean {
    if (!this.audioStream) return false
    return this.audioStream.getAudioTracks().some((track) => track.enabled)
  }

  IsConnected(): boolean {
    return this.establishedRemoteIds().some((id) => {
      const link = this.links.get(id)
      return link?.connectionState === 'connected' || link?.iceConnectionState === 'connected'
    })
  }

  ToggleMicrophone(): void {
    if (!this.audioStream) return
    if (this.e2eeFailClosed() && !this.mediaE2ee) {
      debugLog.warn('room', 'refusing plaintext microphone; e2ee required')
      return
    }
    for (const track of this.audioStream.getAudioTracks()) {
      track.enabled = !track.enabled
    }
    this.microphoneActive = this.IsMicrophoneActive()
  }

  ToggleDisplayStream(): void {
    if (!this.displayStream) return
    if (this.e2eeFailClosed() && !this.mediaE2ee) {
      debugLog.warn('room', 'refusing plaintext display; e2ee required')
      return
    }
    for (const track of this.displayStream.getVideoTracks()) {
      track.enabled = !track.enabled
    }
    this.displayStreamActive = this.displayStream.getVideoTracks().some((track) => track.enabled)
    if (!this.displayStreamActive) {
      this.ToggleRemoteCursors(false)
      void this.revokeAllRemoteControl('sharing-stopped')
    }
  }

  ToggleRemoteCursors(enabled: boolean): boolean {
    if (!this.isPresenter) return false
    this.cursorsEnabled = enabled
    if (!enabled) window.KiwiApi.toggleRemoteCursors(false)
    else window.KiwiApi.toggleRemoteCursors(true)
    return enabled
  }

  async ToggleCamera(): Promise<void> {
    if (this.cameraStream) {
      await this.disableCamera()
      return
    }
    await this.enableCamera()
  }

  sendChat(text: string): void {
    const trimmed = truncateChatText(text.trim())
    if (!trimmed) return
    const msg: CallChatMessage = {
      id: getUUIDv4(),
      from: this.localPeerId,
      name: this.username,
      text: trimmed,
      at: Date.now(),
    }
    this.appendChat(msg)
    this.broadcast({
      t: 'chat',
      v: PROTOCOL_VERSION,
      ...msg,
    })
    this.syncCallOverlay()
  }

  PingRemoteCursor(cursorId: string): void {
    this.broadcast({
      t: 'cursor-ping',
      v: PROTOCOL_VERSION,
      cursorId: this.localPeerId || cursorId,
    })
  }

  UpdateRemoteCursor(cursorData: RemoteCursorData): void {
    this.broadcast({
      t: 'cursor',
      v: PROTOCOL_VERSION,
      id: this.localPeerId || cursorData.id,
      name: cursorData.name,
      color: cursorData.color,
      x: cursorData.x,
      y: cursorData.y,
    })
  }

  requestRemoteControl(mouse: boolean, keyboard: boolean): void {
    if (this.isPresenter) return
    this.broadcast({
      t: 'remote-control-request',
      v: PROTOCOL_VERSION,
      peerId: this.localPeerId,
      mouse,
      keyboard,
    })
  }

  async grantRemoteControl(peerId: string, grant: RemoteControlGrant): Promise<void> {
    if (!this.isPresenter || peerId === this.localPeerId) return
    this.emergencyStopMessage = null
    this.remoteControl = grantRemoteControlState(this.remoteControl, peerId, grant)
    const state = getPeerRemoteControl(this.remoteControl, peerId)
    this.broadcast({
      t: 'remote-control-grant',
      v: PROTOCOL_VERSION,
      peerId,
      mouse: state.mouse,
      keyboard: state.keyboard,
      generation: state.generation,
    })
    await this.syncSidecarArm()
  }

  async revokeRemoteControl(
    peerId: string,
    reason: RemoteControlRevokeReason = 'host',
  ): Promise<void> {
    if (!this.isPresenter && reason === 'host') return
    const prev = getPeerRemoteControl(this.remoteControl, peerId)
    this.remoteControl = revokeRemoteControlState(this.remoteControl, peerId, reason)
    this.inboundRemoteSeq = { ...this.inboundRemoteSeq }
    delete this.inboundRemoteSeq[peerId]
    this.broadcast({
      t: 'remote-control-revoke',
      v: PROTOCOL_VERSION,
      peerId,
      generation: prev.generation + 1,
      reason,
    })
    await this.syncSidecarArm()
  }

  async revokeAllRemoteControl(reason: RemoteControlRevokeReason): Promise<void> {
    const prev = this.remoteControl
    this.remoteControl = revokeAllRemoteControlState(prev)
    this.inboundRemoteSeq = {}
    for (const [peerId, state] of Object.entries(prev)) {
      this.broadcast({
        t: 'remote-control-revoke',
        v: PROTOCOL_VERSION,
        peerId,
        generation: state.generation + 1,
        reason,
      })
    }
    await this.syncSidecarArm()
  }

  async requestRemoteControlPermission(): Promise<void> {
    await window.KiwiApi.remoteControl?.requestPermission?.()
    this.remoteControlCaps = (await window.KiwiApi.remoteControl?.getCapabilities?.()) ?? null
  }

  denyRemoteControlRequest(peerId: string): void {
    if (!this.isPresenter) return
    this.remoteControl = requestRemoteControlState(this.remoteControl, peerId, false, false)
  }

  sendRemotePointerMove(x: number, y: number, sourceId?: string): void {
    const grant = this.localRemoteGrant
    if (!grant?.mouse) return
    this.outboundMotionSeq += 1
    void this.sendRemoteInputToPresenter({
      t: 'pointer-move',
      v: 1,
      generation: grant.generation,
      seq: this.outboundMotionSeq,
      x,
      y,
      sourceId,
    })
  }

  sendRemotePointerButton(
    button: 'left' | 'middle' | 'right' | 'back' | 'forward',
    action: 'down' | 'up',
  ): void {
    const grant = this.localRemoteGrant
    if (!grant?.mouse) return
    this.outboundActionSeq += 1
    void this.sendRemoteInputToPresenter({
      t: 'pointer-button',
      v: 1,
      generation: grant.generation,
      seq: this.outboundActionSeq,
      button,
      action,
    })
  }

  sendRemoteWheel(deltaX: number, deltaY: number): void {
    const grant = this.localRemoteGrant
    if (!grant?.mouse) return
    this.outboundActionSeq += 1
    void this.sendRemoteInputToPresenter({
      t: 'pointer-wheel',
      v: 1,
      generation: grant.generation,
      seq: this.outboundActionSeq,
      deltaX,
      deltaY,
    })
  }

  sendRemoteKey(event: {
    action: 'down' | 'up'
    code: string
    location?: number
    repeat?: boolean
    modifiers?: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
  }): void {
    const grant = this.localRemoteGrant
    if (!grant?.keyboard) return
    if (!isPortableKeyCode(event.code)) return
    this.outboundActionSeq += 1
    void this.sendRemoteInputToPresenter({
      t: 'key',
      v: 1,
      generation: grant.generation,
      seq: this.outboundActionSeq,
      action: event.action,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      modifiers: event.modifiers,
    })
  }

  async Setup(
    v: HTMLVideoElement | null = null,
    opts?: { captureDisplay?: boolean },
  ): Promise<'ok' | 'cancelled' | 'failed'> {
    debugLog.info('room', 'Setup start', {
      hasVideoEl: Boolean(v),
      role: v ? 'joiner' : 'host',
      captureDisplay: opts?.captureDisplay !== false && !v,
    })
    this.bindCallIpc()
    await this.teardown(true)
    this.userSettings = await window.KiwiApi.getSettings()
    this.username = this.userSettings.username
    this.color = this.userSettings.color
    this.emergencyHotkeyLabel = formatEmergencyHotkey(
      this.userSettings.emergencyHotkey ?? DEFAULT_EMERGENCY_HOTKEY,
    )
    this.emergencyStopMessage = null
    this.remoteControl = {}
    this.bindRemoteControlIpc()
    this.remoteControlCaps = (await window.KiwiApi.remoteControl?.getCapabilities?.()) ?? null
    this.remoteVideo = v
    this.localPeerId = getUUIDv4()
    this.microphoneActive = this.userSettings.isMicrophoneEnabledOnConnect
    this.sessionEndedReason = null
    this.presenterGone = false
    this.quietClose = false
    this.e2eeError = null
    this.identityChanged = false
    await this.loadDeviceIdentity()
    if (!v && this.e2eeFailClosed()) {
      await this.initHostCrypto()
      if (!this.e2eeActive) {
        this.e2eeError = 'crypto-init-failed'
        debugLog.error('room', 'e2ee is required but host crypto init failed')
        return 'failed'
      }
    }

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: mediaTrackConstraints(this.userSettings.microphoneDeviceId),
      })
      for (const track of this.audioStream.getAudioTracks()) {
        track.enabled = this.userSettings.isMicrophoneEnabledOnConnect
      }
    } catch (e) {
      errorHandler(e)
      this.audioStream = null
      debugLog.warn('room', 'getUserMedia audio failed', e)
    }
    this.hasAudioInput = this.audioStream !== null
    debugLog.info('room', `audio input ${this.hasAudioInput ? 'available' : 'unavailable'}`)

    if (!v) {
      this.coordinatorId = this.localPeerId
      this.presenterId = this.localPeerId
      appState.isCoordinator = true
      if (opts?.captureDisplay !== false) {
        const captured = await this.acquireDisplayStream()
        if (captured === 'cancelled' || captured === 'failed') return captured
        this.displayStream = captured
        this.displayStreamActive = true
        this.bindDisplayEnded(captured)
      }
    } else {
      appState.isCoordinator = false
      const link = await this.createLink(false)
      this.handshakeKey = link.pendingId
      this.links.set(link.pendingId, link)
      debugLog.info('room', 'joiner handshake link created', {
        pendingId: link.pendingId,
        pc: summarizePc(link.pc),
      })
    }
    this.syncLocalPeer()
    debugLog.info('room', 'Setup ok', {
      localPeerId: this.localPeerId,
      coordinatorId: this.coordinatorId,
      presenterId: this.presenterId,
    })
    return 'ok'
  }

  async CreateHostUrl(data: { username: string }): Promise<string | null> {
    this.gcPendingInvites()
    if (this.occupiedSlots() >= MAX_PEERS) {
      debugLog.warn('room', 'CreateHostUrl blocked: room full', { slots: this.occupiedSlots() })
      return null
    }
    this.signaling = kiwiTransport()
    this.signalingKind = 'kiwi'
    const link = await this.createLink(true)
    await this.addLocalMediaToLink(link)
    debugLog.info('room', 'CreateHostUrl adding local media', summarizePc(link.pc))
    const offer = await link.createLocalOffer()
    debugLog.info('room', 'CreateHostUrl local offer', summarizeSdp(offer))
    await link.waitForIceGatheringComplete()
    debugLog.info('room', 'CreateHostUrl ICE gathered', {
      pc: summarizePc(link.pc),
      local: summarizeSdp(link.localDescription),
    })
    this.links.set(link.pendingId, link)
    this.lastCopiedPendingId = link.pendingId
    this.username = data.username || this.username
    const url = await getConnectionString(
      ConnectionType.HOST,
      dropTcpIceCandidates(link.localDescription ?? offer),
      { username: this.username, invite: this.invite },
    )
    debugLog.info('room', 'CreateHostUrl copied host string', {
      pendingId: link.pendingId,
      urlChars: url.length,
      e2ee: Boolean(this.invite),
    })
    return url
  }

  async CreateParticipantUrl(
    c: RTCSessionDescriptionOptions,
    data: { username: string },
  ): Promise<string> {
    this.username = data.username || this.username
    const link = this.handshakeLink()
    if (!link) {
      debugLog.error('room', 'CreateParticipantUrl: handshake missing')
      throw new Error('viewer handshake is not ready')
    }
    debugLog.info('room', 'CreateParticipantUrl start', {
      incoming: summarizeSdp(c),
      pc: summarizePc(link.pc),
      hasRemote: Boolean(link.pc.remoteDescription),
      localType: link.pc.localDescription?.type ?? 'none',
    })
    if (!link.pc.remoteDescription) {
      await link.setRemoteDescription(c)
      debugLog.info('room', 'CreateParticipantUrl setRemote', summarizePc(link.pc))
    }
    await this.addLocalMediaToLink(link)
    if (link.pc.localDescription?.type !== 'answer') {
      const answer = await link.createLocalAnswer()
      debugLog.info('room', 'CreateParticipantUrl created answer', summarizeSdp(answer))
    }
    await link.waitForIceGatheringComplete()
    const local = link.localDescription
    if (!local?.sdp) {
      debugLog.error('room', 'CreateParticipantUrl: no local SDP', summarizePc(link.pc))
      throw new Error('participant answer is not ready')
    }
    debugLog.info('room', 'CreateParticipantUrl ICE gathered', {
      pc: summarizePc(link.pc),
      local: summarizeSdp(local),
    })
    const url = await getConnectionString(ConnectionType.PARTICIPANT, dropTcpIceCandidates(local), {
      username: this.username,
      invite: this.invite,
    })
    debugLog.info('room', 'CreateParticipantUrl copied answer string', { urlChars: url.length })
    return url
  }

  bindBonjour(send: BonjourSignalSend): void {
    this.bonjourSend = send
    if (this.bonjourCallId) {
      this.signaling = bonjourTransport(send, this.bonjourCallId)
      this.signalingKind = 'bonjour'
    }
  }

  private useBonjour(callId: string): void {
    this.bonjourCallId = callId
    this.signalingKind = 'bonjour'
    if (this.bonjourSend) this.signaling = bonjourTransport(this.bonjourSend, callId)
  }

  private emitBonjour(payload: BonjourSignalPayload): void {
    if (this.signaling.kind !== 'bonjour' && this.bonjourSend && this.bonjourCallId) {
      this.signaling = bonjourTransport(this.bonjourSend, this.bonjourCallId)
      this.signalingKind = 'bonjour'
    }
    if (this.signaling.kind !== 'bonjour') {
      if (payload.type === 'offer' || payload.type === 'answer' || payload.type === 'mls-invite') {
        throw new Error('bonjour signaling is not attached')
      }
      return
    }
    this.signaling.send(cloneBonjourPayload(payload))
    if (payload.type !== 'offer' && payload.type !== 'answer') return
    this.bonjourLocalSdpSent = true
    const queued = this.pendingBonjourIceOut
    this.pendingBonjourIceOut = []
    for (const candidate of queued) {
      this.signaling.send(cloneBonjourPayload({ type: 'ice', candidate }))
    }
  }

  async startBonjourCall(opts: { callId: string; peerId: string }): Promise<void> {
    this.gcPendingInvites()
    if (this.occupiedSlots() >= MAX_PEERS) throw new Error('room is full')
    if (!this.invite && this.e2eeFailClosed()) {
      await this.initHostCrypto()
      if (!this.invite) throw new Error('e2ee is required but host crypto init failed')
    }
    this.bonjourLocalSdpSent = false
    this.pendingBonjourIceOut = []
    this.useBonjour(opts.callId)
    const link = await this.createLink(true, opts.peerId, opts.callId)
    await this.addLocalMediaToLink(link)
    this.links.set(link.pendingId, link)
    const offer = await link.createLocalOffer()
    if (this.invite) {
      this.emitBonjour({ type: 'mls-invite', invite: this.invite })
    }
    this.emitBonjour({ type: 'offer', sdp: offer, invite: this.invite })
    await this.flushBonjourIce(link)
  }

  async requestBonjourJoin(opts: { callId: string; peerId: string }): Promise<void> {
    this.useBonjour(opts.callId)
    const handshake = this.handshakeLink()
    if (!handshake) throw new Error('viewer handshake is not ready')
    this.links.delete(handshake.pendingId)
    handshake.remotePeerId = opts.peerId
    this.links.set(opts.callId, handshake)
    this.handshakeKey = opts.callId
  }

  async acceptBonjourCall(opts: {
    callId: string
    peerId: string
    offer: RTCSessionDescriptionInit
    invite?: InviteCrypto | null
  }): Promise<void> {
    this.bonjourLocalSdpSent = false
    this.pendingBonjourIceOut = []
    this.useBonjour(opts.callId)
    if (opts.invite) {
      if (
        shouldPrepareJoinerCrypto({
          hasGroup: Boolean(this.crypto?.isReady()),
          isJoinerHandshake: Boolean(this.handshakeLink()) || Boolean(this.links.get(opts.callId)),
        })
      ) {
        await this.initJoinerCrypto(opts.invite)
      }
    } else if (this.e2eeFailClosed() && !this.invite) {
      throw new Error('e2ee is required but the invite is missing')
    }
    if (this.e2eeFailClosed() && !this.e2eeActive) {
      throw new Error('e2ee is required but crypto init failed')
    }
    const handshake = this.links.get(opts.callId) ?? this.handshakeLink()
    if (!handshake) throw new Error('viewer handshake is not ready')
    this.links.delete(handshake.pendingId)
    handshake.remotePeerId = opts.peerId
    this.links.set(opts.callId, handshake)
    this.handshakeKey = opts.callId
    if (!opts.offer?.type || !opts.offer.sdp) {
      throw new Error('bonjour offer is missing SDP')
    }
    await handshake.setRemoteDescription(cloneSessionDescription(opts.offer))
    await this.addLocalMediaToLink(handshake)
    const answer = await handshake.createLocalAnswer()
    this.emitBonjour({ type: 'answer', sdp: answer })
    await this.flushBonjourIce(handshake)
  }

  async applyBonjourSignal(payload: BonjourSignalPayload): Promise<void> {
    const link =
      (this.bonjourCallId ? this.links.get(this.bonjourCallId) : undefined) ?? this.handshakeLink()
    if (payload.type === 'mls-invite' && payload.invite) {
      if (!this.invite) await this.initJoinerCrypto(payload.invite)
      return
    }
    if (payload.type === 'offer' && payload.sdp) {
      if (!this.bonjourCallId || !link) return
      if (link.pc.remoteDescription) return
      const offer = cloneBonjourPayload(payload).sdp
      if (!offer?.type || !offer.sdp) return
      await this.acceptBonjourCall({
        callId: this.bonjourCallId,
        peerId: link.remotePeerId ?? '',
        offer,
        invite: payload.invite ?? this.invite,
      })
      return
    }
    if (payload.type === 'answer' && payload.sdp) {
      if (!link) throw new Error('no pending bonjour call for answer')
      if (link.pc.remoteDescription?.type === 'answer') return
      const answer = cloneBonjourPayload(payload).sdp
      if (!answer?.type || !answer.sdp) throw new Error('bonjour answer is missing SDP')
      await link.setRemoteDescription(cloneSessionDescription(answer))
      await this.flushBonjourIce(link)
      return
    }
    if (payload.type === 'ice' && payload.candidate) {
      if (!link || !link.pc.remoteDescription) {
        this.pendingBonjourIce.push(payload.candidate)
        return
      }
      try {
        await link.addIceCandidate(payload.candidate)
      } catch {
        // duplicate or out-of-order trickle ICE
      }
      return
    }
    if (payload.type === 'hangup') {
      if (!this.bonjourCallId && this.links.size === 0) return
      this.signaling = kiwiTransport()
      this.signalingKind = 'kiwi'
      await this.leave()
    }
  }

  private async flushBonjourIce(link: PeerLink): Promise<void> {
    const queued = this.pendingBonjourIce
    this.pendingBonjourIce = []
    for (const candidate of queued) {
      try {
        await link.addIceCandidate(candidate)
      } catch {
        // duplicate or out-of-order trickle ICE
      }
    }
  }

  async Connect(
    c: RTCSessionDescriptionOptions,
    opts?: { invite?: InviteCrypto | null },
  ): Promise<void> {
    debugLog.info('room', 'Connect start', summarizeSdp(c))
    try {
      if (opts?.invite) {
        if (
          shouldPrepareJoinerCrypto({
            hasGroup: Boolean(this.crypto?.isReady()),
            isJoinerHandshake: Boolean(this.handshakeLink()),
          })
        ) {
          await this.initJoinerCrypto(opts.invite)
          debugLog.info('room', 'initialized joiner mls')
        } else {
          if (this.invite && opts.invite.roomId !== this.invite.roomId) {
            throw new Error('e2ee invite does not match this room')
          }
          debugLog.info('room', 'keeping existing mls group', {
            groupReady: Boolean(this.crypto?.isReady()),
            epoch: this.crypto?.epoch ?? 0,
          })
        }
        if (this.e2eeFailClosed() && !this.e2eeActive) {
          throw new Error('e2ee is required but crypto init failed')
        }
      } else if (this.handshakeLink() && this.e2eeFailClosed() && !this.invite) {
        throw new Error('e2ee is required but the invite is missing')
      }
      const handshake = this.handshakeLink()
      if (handshake) {
        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: c.sdp }
        debugLog.info('room', 'Connect joiner applying offer', {
          incomingType: c.type,
          pc: summarizePc(handshake.pc),
        })
        await handshake.setRemoteDescription(offer)
        debugLog.info('room', 'Connect joiner after setRemote', summarizePc(handshake.pc))
        await this.addLocalMediaToLink(handshake)
        debugLog.info('room', 'Connect joiner after addLocalMedia', summarizePc(handshake.pc))
        if (handshake.pc.localDescription?.type !== 'answer') {
          const answer = await handshake.createLocalAnswer()
          debugLog.info('room', 'Connect joiner created answer', {
            pc: summarizePc(handshake.pc),
            answer: summarizeSdp(answer),
          })
        }
        return
      }
      const answer: RTCSessionDescriptionInit = { type: 'answer', sdp: c.sdp }
      const pending = this.findPendingForAnswer(answer)
      if (!pending) {
        debugLog.error('room', 'Connect: no pending invite matches answer', {
          answer: summarizeSdp(answer),
          pendingIds: [...this.links.keys()],
        })
        throw new Error('no pending invite matches this answer')
      }
      debugLog.info('room', 'Connect applying answer to pending invite', {
        pendingId: pending.pendingId,
        incomingType: c.type,
        before: summarizePc(pending.pc),
      })
      await pending.setRemoteDescription(answer)
      this.isLive = true
      this.setConnectionState('connected')
      debugLog.info('room', 'Connect host applied answer', summarizePc(pending.pc))
    } catch (e) {
      debugLog.error('room', 'Connect failed', e)
      errorHandler(e)
      throw e
    }
  }

  async Disconnect(): Promise<void> {
    await this.leave()
  }

  async leave(): Promise<void> {
    const callId = this.bonjourCallId
    if (this.signaling.kind === 'bonjour') {
      this.signaling.send({ type: 'hangup' })
    }
    if (callId) void window.KiwiApi.bonjour?.hangup?.(callId).catch(() => undefined)
    if (this.isCoordinator) {
      const successor = nextCoordinator({
        remainingPeerIds: this.establishedRemoteIds(),
      })
      if (successor) {
        this.broadcast({
          t: 'coordinator-handoff',
          v: PROTOCOL_VERSION,
          coordinatorId: successor,
        })
      }
    }
    this.broadcast({
      t: 'peer-left',
      v: PROTOCOL_VERSION,
      peerId: this.localPeerId,
    })
    await this.teardown(true)
  }

  async endSession(): Promise<void> {
    this.broadcast({
      t: 'session-ended',
      v: PROTOCOL_VERSION,
      byPeerId: this.localPeerId,
    })
    await this.teardown(true)
  }

  async requestToPresent(): Promise<'ok' | 'blocked' | 'cooldown' | 'cancelled' | 'failed'> {
    const now = Date.now()
    if (now < this.cooldownUntil) {
      debugLog.warn('room', 'requestToPresent blocked by cooldown', {
        remainingMs: this.cooldownUntil - now,
      })
      return 'cooldown'
    }
    if (
      !canStartVote({
        now,
        cooldownUntil: 0,
        activeVote: this.activeVote,
        requesterId: this.localPeerId,
        presenterId: this.presenterId,
      })
    ) {
      debugLog.warn('room', 'requestToPresent blocked', {
        isPresenter: this.isPresenter,
        hasActiveVote: Boolean(this.activeVote),
      })
      return 'blocked'
    }
    try {
      const captured = await this.acquireDisplayStream()
      if (captured === 'cancelled' || captured === 'failed') return captured
      this.stopStream(this.pendingDisplayStream)
      this.pendingDisplayStream = captured
    } catch (e) {
      errorHandler(e)
      return 'failed'
    }

    const vote = startVote({
      voteId: getUUIDv4(),
      kind: 'presenter',
      candidateId: this.localPeerId,
      requesterId: this.localPeerId,
      now,
      timeoutMs: VOTE_TIMEOUT_MS,
      peerIds: this.allPeerIds(),
    })
    this.activeVote = vote
    this.localVoteCast = true
    this.broadcast({
      t: 'vote-start',
      v: PROTOCOL_VERSION,
      voteId: vote.voteId,
      kind: vote.kind,
      candidateId: vote.candidateId,
      requesterId: vote.requesterId,
      expiresAt: vote.expiresAt,
    })
    this.armVoteTimer(vote)
    if (voteOutcome(vote, Date.now()) === 'approved') {
      await this.concludeVote(vote, true)
    }
    return 'ok'
  }

  canRequestKick(targetId: string): boolean {
    return canStartKick({
      now: Date.now(),
      cooldownUntil: this.cooldownUntil,
      activeVote: this.activeVote,
      requesterId: this.localPeerId,
      targetId,
      peerIds: this.allPeerIds(),
    })
  }

  async requestKick(targetId: string): Promise<'ok' | 'blocked' | 'cooldown'> {
    const now = Date.now()
    if (now < this.cooldownUntil) {
      debugLog.warn('room', 'requestKick blocked by cooldown', {
        remainingMs: this.cooldownUntil - now,
        targetId,
      })
      return 'cooldown'
    }
    if (
      !canStartKick({
        now,
        cooldownUntil: 0,
        activeVote: this.activeVote,
        requesterId: this.localPeerId,
        targetId,
        peerIds: this.allPeerIds(),
      })
    ) {
      debugLog.warn('room', 'requestKick blocked', {
        targetId,
        hasActiveVote: Boolean(this.activeVote),
      })
      return 'blocked'
    }
    const started = startVote({
      voteId: getUUIDv4(),
      kind: 'kick',
      candidateId: targetId,
      requesterId: this.localPeerId,
      now,
      timeoutMs: VOTE_TIMEOUT_MS,
      peerIds: this.allPeerIds(),
    })
    const vote = castVote(started, this.localPeerId, true)
    this.activeVote = vote
    this.localVoteCast = true
    this.broadcast({
      t: 'vote-start',
      v: PROTOCOL_VERSION,
      voteId: vote.voteId,
      kind: vote.kind,
      candidateId: vote.candidateId,
      requesterId: vote.requesterId,
      expiresAt: vote.expiresAt,
    })
    this.broadcast({
      t: 'vote-cast',
      v: PROTOCOL_VERSION,
      voteId: vote.voteId,
      peerId: this.localPeerId,
      approve: true,
    })
    this.armVoteTimer(vote)
    await this.checkVoteOutcome(vote)
    return 'ok'
  }

  clearVoteRejected(): void {
    this.voteRejectedKind = null
  }

  async castLocalVote(approve: boolean): Promise<void> {
    const vote = this.activeVote
    if (!vote || this.localVoteCast !== null) return
    this.localVoteCast = approve
    const next = castVote(vote, this.localPeerId, approve)
    this.activeVote = next
    this.broadcast({
      t: 'vote-cast',
      v: PROTOCOL_VERSION,
      voteId: vote.voteId,
      peerId: this.localPeerId,
      approve,
    })
    await this.checkVoteOutcome(next)
  }

  async changeScreen(): Promise<'ok' | 'cancelled' | 'failed'> {
    if (!this.isPresenter) return 'failed'
    debugLog.info('room', 'changeScreen start')
    const captured = await this.acquireDisplayStream({ releasePrevious: true })
    if (captured === 'cancelled') {
      this.displayStreamActive = false
      await this.pushVideoToAll(null, null)
      debugLog.warn('room', 'changeScreen cancelled')
      return 'cancelled'
    }
    if (captured === 'failed') return 'failed'
    const track = captured.getVideoTracks()[0]
    if (!track) {
      this.stopStream(captured)
      return 'failed'
    }
    this.displayStream = captured
    this.displayStreamActive = true
    this.bindDisplayEnded(captured)
    await this.pushVideoToAll(track, captured)
    await this.revokeAllRemoteControl('sharing-stopped')
    debugLog.info('room', 'changeScreen ok')
    return 'ok'
  }

  occupiedSlots(): number {
    return 1 + this.establishedRemoteIds().length + this.pendingInviteCount()
  }

  dismissSessionEnded(): void {
    if (this.remoteVideo) this.remoteVideo.srcObject = null
    this.sessionEndedReason = null
  }

  private async loadDeviceIdentity(): Promise<void> {
    const raw = await window.KiwiApi.getDeviceIdentity()
    this.identity = {
      publicKey: fromBase64Url(
        raw.publicKey.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
      ),
      privateKey: fromBase64Url(
        raw.privateKey.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
      ),
      fingerprint: raw.fingerprint,
    }
  }

  private helloCrypto(): HelloCrypto | undefined {
    if (!this.e2eeActive || !this.identity) return undefined
    return {
      ...defaultCryptoCapabilities(this.mediaE2eeActive),
      fingerprint: this.identity.fingerprint,
      joinAuth: this.joinAuth || undefined,
      e2eeRequired: this.e2eeRequired,
    }
  }

  private refreshVerification(): void {
    this.verification = this.crypto?.getVerificationInfo() ?? null
  }

  private configureMediaE2ee(): void {
    const wants = this.e2eeFailClosed() || this.userSettings?.mediaE2eeEnabled !== false
    const supported = supportsEncodedTransform()
    if (wants && !supported) this.e2eeError = 'media-transform-missing'
    this.mediaE2eeActive = wants && supported
    this.mediaE2ee = this.mediaE2eeActive && this.crypto ? new MediaE2EE(this.crypto) : null
  }

  private async initHostCrypto(): Promise<void> {
    if (!this.identity) return
    this.invite = randomInviteCrypto()
    this.joinAuth = toBase64Url(await deriveJoinAuthenticator(this.invite))
    this.crypto = new RoomCrypto()
    await this.crypto.createRoom(this.invite.roomId, this.localPeerId, this.identity)
    this.e2eeActive = true
    this.e2eeRequired = true
    this.configureMediaE2ee()
    this.refreshVerification()
  }

  private async initJoinerCrypto(invite: InviteCrypto): Promise<void> {
    if (!this.identity) return
    this.invite = invite
    this.joinAuth = toBase64Url(await deriveJoinAuthenticator(invite))
    this.crypto = new RoomCrypto()
    await this.crypto.prepareJoiner(invite.roomId, this.localPeerId, this.identity)
    this.e2eeActive = true
    this.e2eeRequired = true
    this.configureMediaE2ee()
    this.handshakeLink()?.setMediaE2ee(this.mediaE2ee)
    this.refreshVerification()
  }

  private mediaKindFor(
    link: PeerLink,
    streamId: string,
    trackKind: string,
  ): 'screen' | 'camera' | 'audio' {
    if (trackKind === 'audio') return 'audio'
    const peerId = link.remotePeerId ?? link.pendingId
    const cam = this.remoteCameraState.get(peerId)
    if (cam?.enabled && cam.streamId && cam.streamId === streamId) return 'camera'
    if (this.remoteCameraStreams.get(peerId)?.id === streamId) return 'camera'
    return 'screen'
  }

  private async activateMediaE2ee(): Promise<void> {
    if (!this.mediaE2ee || !this.crypto?.isReady() || !this.crypto.hasRemoteMembers()) return
    this.mediaE2ee.enableTransforms(true)
    debugLog.info('room', 'media e2ee activate', {
      epoch: this.crypto.epoch,
      links: this.links.size,
    })
    for (const link of this.links.values()) {
      link.setMediaE2ee(this.mediaE2ee)
      await link.applyMediaE2ee((streamId, trackKind) =>
        this.mediaKindFor(link, streamId, trackKind),
      )
    }
  }

  private e2eeFailClosed(): boolean {
    return encryptionRequired(this.e2eeRequired, this.userSettings?.e2eeEnabled)
  }

  private appCryptoReady(): boolean {
    return Boolean(this.crypto?.isReady() && this.crypto.hasRemoteMembers())
  }

  private async wrapControl(msg: ControlMessage): Promise<ControlMessage | null> {
    const action = outboundCryptoAction({
      encryptable: shouldEncryptControl(msg),
      required: this.e2eeFailClosed(),
      ready: this.appCryptoReady(),
    })
    if (action === 'passthrough') return msg
    if (action === 'queue') {
      this.enqueueOutbound(msg)
      debugLog.info('room', 'queued encrypted control until mls ready', { t: msg.t })
      return null
    }
    try {
      const domain = domainForControl(msg)
      const encoded = new TextEncoder().encode(serializeControlMessage(msg))
      const sealed = await this.crypto!.encryptApplication(domain, encoded)
      return {
        t: 'e2ee',
        v: PROTOCOL_VERSION,
        ...sealed,
      }
    } catch (error) {
      debugLog.error('room', 'refusing plaintext control; encrypt failed', { t: msg.t, error })
      this.e2eeError = this.e2eeError ?? 'control-encrypt-failed'
      return null
    }
  }

  private async unwrapControl(link: PeerLink, msg: ControlMessage): Promise<ControlMessage | null> {
    if (msg.t !== 'e2ee') {
      if (
        dropPlaintextInbound({
          encryptable: shouldEncryptControl(msg),
          required: this.e2eeFailClosed(),
        })
      ) {
        debugLog.warn('room', 'dropped plaintext control in e2ee room', { t: msg.t })
        return null
      }
      return msg
    }
    if (!this.crypto?.isReady()) {
      const queued = this.pendingE2ee.get(link) ?? []
      queued.push(msg)
      this.pendingE2ee.set(link, queued)
      return null
    }
    try {
      const plaintext = await this.crypto.decryptApplication(msg)
      return parseControlMessage(new TextDecoder().decode(plaintext))
    } catch (error) {
      debugLog.warn('room', 'dropped unauthenticated control', error)
      return null
    }
  }

  private async flushPendingE2ee(link: PeerLink): Promise<void> {
    const queued = this.pendingE2ee.get(link)
    if (!queued?.length) return
    this.pendingE2ee.delete(link)
    for (const msg of queued) {
      await this.onControl(link, msg)
    }
  }

  private async flushPendingOutbound(): Promise<void> {
    if (!this.pendingOutbound.length || !this.appCryptoReady()) return
    const queued = this.pendingOutbound
    this.pendingOutbound = []
    for (const msg of queued) {
      await this.broadcastEncrypted(msg)
    }
  }

  private async flushAfterMls(link: PeerLink): Promise<void> {
    await this.flushPendingE2ee(link)
    await this.flushPendingOutbound()
  }

  private enqueueOutbound(msg: ControlMessage): void {
    if (msg.t === 'cursor') {
      this.pendingOutbound = this.pendingOutbound.filter((item) => item.t !== 'cursor')
    }
    this.pendingOutbound.push(msg)
  }

  private async flushPendingKeyPackages(link: PeerLink): Promise<void> {
    if (!this.crypto?.isReady()) return
    for (const [peerId, bytes] of this.pendingKeyPackages) {
      await this.commitAdd(link, peerId, bytes, this.seenFingerprints.get(peerId))
    }
  }

  private handshakeLink(): PeerLink | null {
    if (!this.handshakeKey) return null
    return this.links.get(this.handshakeKey) ?? null
  }

  private pendingInviteCount(): number {
    let count = 0
    for (const [key, link] of this.links) {
      if (key === this.handshakeKey) continue
      if (!link.remotePeerId) count += 1
    }
    return count
  }

  private gcPendingInvites(): void {
    const now = Date.now()
    const stale: string[] = []
    for (const [key, link] of this.links) {
      if (link.remotePeerId) continue
      if (key === this.handshakeKey) continue
      if (now - link.createdAt > PENDING_INVITE_TTL_MS) stale.push(key)
    }
    for (const key of stale) {
      this.links.get(key)?.close()
      this.links.delete(key)
    }
  }

  private async createLink(
    isOfferer: boolean,
    remotePeerId?: string,
    pendingId?: string,
  ): Promise<PeerLink> {
    const rtcConfig = await getRTCPeerConnectionConfig({
      encodedInsertableStreams: this.e2eeFailClosed() && supportsEncodedTransform(),
    })
    const link = new PeerLink({
      rtcConfig,
      localPeerId: this.localPeerId,
      pendingId: pendingId ?? getUUIDv4(),
      isOfferer,
      remotePeerId: remotePeerId ?? null,
      mediaE2ee: this.mediaE2ee,
      requireMediaE2ee: this.e2eeFailClosed(),
      events: {
        onControl: (msg) => {
          void this.onControl(link, msg)
        },
        onTrack: (event) => {
          this.onTrack(link, event)
        },
        onIceConnectionStateChange: (state) => {
          debugLog.info('room', `ICE ${state}`, {
            pendingId: link.pendingId,
            remotePeerId: link.remotePeerId,
            pc: summarizePc(link.pc),
          })
          this.onIceState(link, state)
        },
        onConnectionStateChange: (state) => {
          debugLog.info('room', `PC ${state}`, {
            pendingId: link.pendingId,
            remotePeerId: link.remotePeerId,
            pc: summarizePc(link.pc),
          })
          if (state === 'connected') this.markLive(link)
          if (state === 'failed' || state === 'closed') {
            void this.handleRemoteDeparted(link, false)
          }
        },
        onControlOpen: () => {
          debugLog.info('room', 'control open', {
            pendingId: link.pendingId,
            remotePeerId: link.remotePeerId,
          })
          this.sendHello(link)
          this.onMlsOpen(link)
        },
        onMlsOpen: () => {
          debugLog.info('room', 'mls channel open', { pendingId: link.pendingId })
        },
        onMlsFrame: (frame) => {
          void this.onMlsFrame(link, frame)
        },
        onNegotiationOffer: (sdp) => {
          if (!link.remotePeerId) return
          this.sendRouted(
            link.remotePeerId,
            {
              t: 'mesh-offer',
              v: PROTOCOL_VERSION,
              from: this.localPeerId,
              to: link.remotePeerId,
              sdp,
            },
            link,
          )
        },
        onIceCandidate: (candidate) => {
          if (this.signaling.kind !== 'bonjour' || !this.bonjourCallId) return
          const bonjourLink = this.links.get(this.bonjourCallId)
          if (bonjourLink !== link && link.pendingId !== this.bonjourCallId) return
          if (!candidate?.candidate) return
          if (!this.bonjourLocalSdpSent) {
            this.pendingBonjourIceOut.push(candidate)
            return
          }
          this.emitBonjour({ type: 'ice', candidate })
        },
        onRemoteInputMotion: (raw) => {
          void this.onRemoteInputRaw(link, raw, 'motion')
        },
        onRemoteInputAction: (raw) => {
          void this.onRemoteInputRaw(link, raw, 'action')
        },
      },
    })
    return link
  }

  private async addLocalMediaToLink(link: PeerLink): Promise<void> {
    if (this.audioStream) {
      for (const track of this.audioStream.getAudioTracks()) {
        link.addTrack(track, this.audioStream)
      }
    }
    if (this.isPresenter && this.displayStream) {
      for (const track of this.displayStream.getVideoTracks()) {
        await link.setDisplayTrack(track, this.displayStream)
      }
    }
    if (this.cameraStream) {
      const track = this.cameraStream.getVideoTracks()[0]
      if (track) await link.setCameraTrack(track, this.cameraStream)
    }
  }

  private sendHello(link: PeerLink): void {
    link.sendControl({
      t: 'hello',
      v: PROTOCOL_VERSION,
      peerId: this.localPeerId,
      username: this.username,
      color: this.color,
      crypto: this.helloCrypto(),
    })
  }

  private onMlsOpen(link: PeerLink): void {
    if (!this.e2eeActive || !this.crypto) return
    const encoded = this.crypto.encodeKeyPackage()
    if (!encoded) {
      debugLog.warn('room', 'mls key-package missing')
      return
    }
    this.sendMlsFrame(
      link,
      bodyToFrame('key-package', this.localPeerId, encoded, {
        fingerprint: this.identity?.fingerprint,
      }),
    )
  }

  private sendMlsFrame(link: PeerLink, frame: MlsFrame): void {
    const chunks = chunkMlsFrame(frame)
    debugLog.info('room', 'mls send', {
      kind: frame.kind,
      bodyChars: frame.body.length,
      chunks: chunks.length,
    })
    for (const chunk of chunks) {
      const ok = link.sendControl({
        t: 'mls',
        v: PROTOCOL_VERSION,
        kind: chunk.kind,
        from: chunk.from,
        to: chunk.to,
        fingerprint: chunk.fingerprint,
        body: chunk.part,
        id: chunk.id,
        i: chunk.i,
        n: chunk.n,
      })
      if (!ok) {
        debugLog.warn('room', 'mls chunk send failed', { kind: frame.kind, i: chunk.i, n: chunk.n })
      }
    }
  }

  private ingestMlsControl(link: PeerLink, msg: Extract<ControlMessage, { t: 'mls' }>): void {
    const frame = this.mlsAssembler.push({
      id: msg.id,
      i: msg.i,
      n: msg.n,
      kind: msg.kind,
      from: msg.from,
      to: msg.to,
      fingerprint: msg.fingerprint,
      part: msg.body,
    })
    if (!frame) return
    debugLog.info('room', 'mls received', {
      kind: frame.kind,
      from: frame.from,
      bodyChars: frame.body.length,
    })
    this.enqueueMls(() => this.onMlsFrame(link, frame))
  }

  private enqueueMls(task: () => Promise<void>): void {
    this.mlsTail = this.mlsTail.then(task).catch((error) => {
      debugLog.error('room', 'mls task failed', error)
    })
  }

  private async onMlsFrame(link: PeerLink, frame: MlsFrame): Promise<void> {
    if (!this.crypto) return
    try {
      const bytes = frameBodyBytes(frame)
      if (frame.kind === 'key-package') {
        this.pendingKeyPackages.set(frame.from, bytes)
        if (frame.fingerprint) this.crypto.rememberMember(frame.from, frame.fingerprint)
        debugLog.info('room', 'mls key-package', {
          from: frame.from,
          bytes: bytes.byteLength,
          groupReady: this.crypto.isReady(),
        })
        if (this.crypto.isReady()) {
          await this.commitAdd(link, frame.from, bytes, frame.fingerprint)
        }
        return
      }
      if (frame.kind === 'welcome') {
        if (frame.to && frame.to !== this.localPeerId) return
        if (frame.fingerprint) this.crypto.rememberMember(frame.from, frame.fingerprint)
        await this.crypto.handleHandshakeMessage(bytes)
        debugLog.info('room', 'mls welcome', { epoch: this.crypto.epoch, from: frame.from })
        this.refreshVerification()
        await this.activateMediaE2ee()
        await this.flushAfterMls(link)
        return
      }
      if (frame.kind === 'commit') {
        await this.crypto.handleHandshakeMessage(bytes)
        debugLog.info('room', 'mls commit', { epoch: this.crypto.epoch, from: frame.from })
        this.refreshVerification()
        await this.mediaE2ee?.rotateEpoch(this.crypto.epoch)
        await this.activateMediaE2ee()
        await this.flushAfterMls(link)
      }
    } catch (error) {
      debugLog.error('room', 'mls handshake failed', error)
    }
  }

  private async commitAdd(
    link: PeerLink,
    peerId: string,
    keyPackageBytes: Uint8Array,
    fingerprint?: string,
  ): Promise<void> {
    if (!this.crypto?.isReady()) {
      debugLog.warn('room', 'mls commitAdd skipped; group not ready', { peerId })
      return
    }
    if (this.addingMembers.has(peerId) || this.crypto.leafOf(peerId) !== undefined) {
      debugLog.info('room', 'mls member already present', { peerId })
      return
    }
    this.addingMembers.add(peerId)
    try {
      const keyPackage = this.crypto.decodeKeyPackage(keyPackageBytes)
      if (!keyPackage) {
        debugLog.warn('room', 'mls key-package decode failed', {
          peerId,
          bytes: keyPackageBytes.byteLength,
        })
        return
      }
      const bundle = await this.crypto.addMember(keyPackage, peerId, fingerprint ?? '')
      if (!bundle) {
        debugLog.warn('room', 'mls addMember failed', { peerId })
        return
      }
      debugLog.info('room', 'mls addMember', {
        peerId,
        epoch: this.crypto.epoch,
        hasWelcome: Boolean(bundle.welcome),
      })
      this.pendingKeyPackages.delete(peerId)
      this.refreshVerification()
      if (bundle.welcome) {
        this.sendMlsFrame(
          link,
          bodyToFrame('welcome', this.localPeerId, bundle.welcome, {
            to: peerId,
            fingerprint: this.identity?.fingerprint,
          }),
        )
      }
      this.broadcastMls(bodyToFrame('commit', this.localPeerId, bundle.commit), link)
      await this.activateMediaE2ee()
      await this.flushAfterMls(link)
    } finally {
      this.addingMembers.delete(peerId)
    }
  }

  private broadcastMls(frame: MlsFrame, except?: PeerLink): void {
    for (const item of this.links.values()) {
      if (item === except) continue
      this.sendMlsFrame(item, frame)
    }
  }

  private async onControl(link: PeerLink, msg: ControlMessage): Promise<void> {
    const inner = await this.unwrapControl(link, msg)
    if (!inner) return
    switch (inner.t) {
      case 'hello':
        await this.onHello(link, inner)
        break
      case 'mls':
        this.ingestMlsControl(link, inner)
        break
      case 'roster':
        await this.onRoster(inner)
        break
      case 'mesh-offer':
        await this.onMeshOffer(link, inner)
        break
      case 'mesh-answer':
        await this.onMeshAnswer(link, inner)
        break
      case 'vote-start':
        this.onVoteStart(inner)
        break
      case 'vote-cast':
        await this.onVoteCast(inner)
        break
      case 'vote-result':
        await this.onVoteResult(inner)
        break
      case 'presenter-changed':
        await this.onPresenterChanged(inner.presenterId)
        break
      case 'peer-left':
        await this.onPeerLeftMessage(inner.peerId)
        break
      case 'coordinator-handoff':
        this.onCoordinatorHandoff(inner.coordinatorId)
        break
      case 'session-ended':
        this.onSessionEnded()
        break
      case 'cursor':
        this.onCursor(inner)
        break
      case 'cursor-ping':
        this.onCursorPing(inner.cursorId)
        break
      case 'chat':
        this.onChat(inner)
        break
      case 'camera-state':
        this.onCameraState(inner)
        break
      case 'remote-control-request':
        this.onRemoteControlRequest(inner)
        break
      case 'remote-control-grant':
        this.onRemoteControlGrant(inner)
        break
      case 'remote-control-revoke':
        this.onRemoteControlRevoke(inner)
        break
    }
  }

  private async onHello(
    link: PeerLink,
    msg: Extract<ControlMessage, { t: 'hello' }>,
  ): Promise<void> {
    if (!this.acceptHelloCrypto(msg.crypto)) {
      debugLog.warn('room', 'rejected hello: e2ee mismatch', { peerId: msg.peerId })
      this.closing.add(link.pendingId)
      if (link.remotePeerId) this.closing.add(link.remotePeerId)
      link.close()
      this.deleteLink(link)
      this.isLive = this.establishedRemoteIds().length > 0
      if (!this.isLive) this.setConnectionState('failed')
      return
    }
    if (msg.crypto?.fingerprint) {
      const previous = this.seenFingerprints.get(msg.peerId)
      if (previous && previous !== msg.crypto.fingerprint) this.identityChanged = true
      this.seenFingerprints.set(msg.peerId, msg.crypto.fingerprint)
      this.crypto?.rememberMember(msg.peerId, msg.crypto.fingerprint)
    }
    this.rekeyLink(link, msg.peerId)
    this.upsertPeer({ id: msg.peerId, username: msg.username, color: msg.color })
    if (!this.coordinatorId) this.coordinatorId = msg.peerId
    if (!this.presenterId) this.presenterId = msg.peerId
    appState.isCoordinator = this.isCoordinator
    this.markLive(link)
    if (this.isCoordinator) this.broadcastRoster()
    this.sendCameraStateTo(link)
    this.refreshVerification()
    await this.activateMediaE2ee()
    await this.flushPendingKeyPackages(link)
  }

  private acceptHelloCrypto(crypto: HelloCrypto | undefined): boolean {
    if (this.e2eeFailClosed()) {
      if (!crypto || crypto.e2eeProtocol !== 'mls-v1') return false
      if (this.joinAuth && crypto.joinAuth && crypto.joinAuth !== this.joinAuth) return false
      if (this.mediaE2eeActive && !crypto.mediaE2EE.includes('sframe-rfc9605')) return false
    }
    if (crypto?.e2eeRequired && !this.e2eeActive) return false
    return true
  }

  private async onRoster(msg: Extract<ControlMessage, { t: 'roster' }>): Promise<void> {
    this.coordinatorId = msg.coordinatorId
    this.presenterId = msg.presenterId
    this.peers = uniquePeersById(msg.peers)
    appState.isCoordinator = this.isCoordinator
    const handshake = this.handshakeLink()
    const handshakePending = Boolean(handshake && !handshake.remotePeerId)
    for (const peer of this.peers) {
      if (peer.id === this.localPeerId) continue
      if (this.findLinkByRemote(peer.id)) continue
      if (handshakePending) continue
      await this.startMeshTo(peer.id)
    }
    this.attachPresenterVideo()
    this.syncCallOverlay()
  }

  private async startMeshTo(targetId: string): Promise<void> {
    if (this.findLinkByRemote(targetId)) return
    const link = await this.createLink(true, targetId)
    this.links.set(targetId, link)
    await this.addLocalMediaToLink(link)
    const offer = await link.createLocalOffer()
    await link.waitForIceGatheringComplete()
    this.sendRouted(
      targetId,
      {
        t: 'mesh-offer',
        v: PROTOCOL_VERSION,
        from: this.localPeerId,
        to: targetId,
        sdp: dropTcpIceCandidates(link.localDescription ?? offer),
      },
      link,
    )
  }

  private async onMeshOffer(
    fromLink: PeerLink,
    msg: Extract<ControlMessage, { t: 'mesh-offer' }>,
  ): Promise<void> {
    const route = routeMeshSignal({
      localPeerId: this.localPeerId,
      coordinatorId: this.coordinatorId,
      to: msg.to,
      from: msg.from,
      connectedPeerIds: this.routablePeerIds(),
    })
    if (route === 'drop') return
    if (route === 'forward') {
      this.sendTo(msg.to, msg)
      return
    }
    const existing = this.findLinkByRemote(msg.from)
    if (existing) {
      const answer = await existing.handleRemoteSdp(msg.sdp)
      if (answer) {
        this.sendRouted(
          msg.from,
          {
            t: 'mesh-answer',
            v: PROTOCOL_VERSION,
            from: this.localPeerId,
            to: msg.from,
            sdp: dropTcpIceCandidates(answer),
          },
          fromLink,
        )
      }
      return
    }
    const link = await this.createLink(false, msg.from)
    this.links.set(msg.from, link)
    await link.setRemoteDescription(msg.sdp)
    await this.addLocalMediaToLink(link)
    const answer = await link.createLocalAnswer()
    await link.waitForIceGatheringComplete()
    link.markEstablished()
    this.sendRouted(
      msg.from,
      {
        t: 'mesh-answer',
        v: PROTOCOL_VERSION,
        from: this.localPeerId,
        to: msg.from,
        sdp: dropTcpIceCandidates(link.localDescription ?? answer),
      },
      fromLink,
    )
  }

  private async onMeshAnswer(
    fromLink: PeerLink,
    msg: Extract<ControlMessage, { t: 'mesh-answer' }>,
  ): Promise<void> {
    const route = routeMeshSignal({
      localPeerId: this.localPeerId,
      coordinatorId: this.coordinatorId,
      to: msg.to,
      from: msg.from,
      connectedPeerIds: this.routablePeerIds(),
    })
    if (route === 'drop') return
    if (route === 'forward') {
      this.sendTo(msg.to, msg)
      return
    }
    const link = this.findLinkByRemote(msg.from)
    if (!link) return
    await link.setRemoteDescription(msg.sdp)
    link.markEstablished()
    this.markLive(link)
    void fromLink
  }

  private onVoteStart(msg: Extract<ControlMessage, { t: 'vote-start' }>): void {
    if (this.activeVote && this.activeVote.voteId === msg.voteId) return
    const kind = msg.kind === 'kick' ? 'kick' : 'presenter'
    const requesterId = msg.requesterId ?? msg.candidateId
    const vote = resumeVote({
      voteId: msg.voteId,
      kind,
      candidateId: msg.candidateId,
      requesterId,
      expiresAt: msg.expiresAt,
      peerIds: this.allPeerIds(),
    })
    this.activeVote = vote
    this.localVoteCast =
      msg.candidateId === this.localPeerId || requesterId === this.localPeerId ? true : null
    this.armVoteTimer(vote)
  }

  private async onVoteCast(msg: Extract<ControlMessage, { t: 'vote-cast' }>): Promise<void> {
    if (!this.activeVote || this.activeVote.voteId !== msg.voteId) return
    const next = castVote(this.activeVote, msg.peerId, msg.approve)
    this.activeVote = next
    await this.checkVoteOutcome(next)
  }

  private async onVoteResult(msg: Extract<ControlMessage, { t: 'vote-result' }>): Promise<void> {
    this.clearVoteTimer()
    this.cooldownUntil = msg.approved ? 0 : Date.now() + VOTE_COOLDOWN_MS
    this.activeVote = null
    this.localVoteCast = null
    if (msg.kind === 'kick') {
      if (msg.approved && msg.removedPeerId) await this.applyKick(msg.removedPeerId)
      return
    }
    if (msg.approved) await this.onPresenterChanged(msg.presenterId)
    else this.stopStream(this.pendingDisplayStream)
    this.pendingDisplayStream = null
  }

  private async checkVoteOutcome(vote: VoteState): Promise<void> {
    const outcome = voteOutcome(vote, Date.now())
    if (outcome === 'pending') return
    if (vote.requesterId === this.localPeerId) {
      await this.concludeVote(vote, outcome === 'approved')
    }
  }

  private async concludeVote(vote: VoteState, approved: boolean): Promise<void> {
    this.clearVoteTimer()
    this.cooldownUntil = approved ? 0 : Date.now() + VOTE_COOLDOWN_MS
    this.activeVote = null
    this.localVoteCast = null
    if (vote.kind === 'kick') {
      if (!approved) this.voteRejectedKind = 'kick'
      this.broadcast({
        t: 'vote-result',
        v: PROTOCOL_VERSION,
        voteId: vote.voteId,
        approved,
        presenterId: this.presenterId,
        kind: 'kick',
        removedPeerId: approved ? vote.candidateId : '',
      })
      if (approved) await this.applyKick(vote.candidateId)
      return
    }
    if (approved) {
      await this.becomePresenter()
    } else {
      this.voteRejectedKind = 'presenter'
      this.stopStream(this.pendingDisplayStream)
      this.pendingDisplayStream = null
    }
    this.broadcast({
      t: 'vote-result',
      v: PROTOCOL_VERSION,
      voteId: vote.voteId,
      approved,
      presenterId: this.presenterId,
      kind: 'presenter',
      removedPeerId: '',
    })
  }

  private async applyKick(peerId: string): Promise<void> {
    if (!peerId) return
    debugLog.info('room', 'applyKick', { peerId, localPeerId: this.localPeerId })
    if (this.crypto?.isReady() && peerId !== this.localPeerId) {
      const commit = await this.crypto.removeMember(peerId)
      if (commit) {
        this.broadcastMls(bodyToFrame('commit', this.localPeerId, commit))
        await this.mediaE2ee?.rotateEpoch(this.crypto.epoch)
        this.refreshVerification()
        await this.activateMediaE2ee()
      }
    }
    if (peerId === this.localPeerId) {
      this.sessionEndedReason = 'removed'
      playSessionEndedSound()
      await this.teardown(true)
      return
    }
    const link = this.findLinkByRemote(peerId)
    if (link) await this.handleRemoteDeparted(link, false)
    else this.removePeerById(peerId)
    window.KiwiApi.removeRemoteCursor?.(peerId)
    void this.revokeRemoteControl(peerId, 'disconnect')
    this.syncCallOverlay()
  }

  private async becomePresenter(): Promise<void> {
    const stream = this.pendingDisplayStream
    this.pendingDisplayStream = null
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    this.stopStream(this.displayStream)
    this.displayStream = stream
    this.displayStreamActive = true
    this.bindDisplayEnded(stream)
    this.presenterId = this.localPeerId
    this.presenterGone = false
    await this.pushVideoToAll(track, stream)
    this.broadcast({
      t: 'presenter-changed',
      v: PROTOCOL_VERSION,
      presenterId: this.localPeerId,
    })
    this.broadcastRoster()
    await this.revokeAllRemoteControl('presenter-change')
  }

  private async onPresenterChanged(presenterId: string): Promise<void> {
    const wasPresenter = this.isPresenter
    this.presenterId = presenterId
    this.presenterGone = presenterId === ''
    if (wasPresenter && !this.isPresenter) {
      await this.stopPresenting()
    }
    this.attachPresenterVideo()
    await this.revokeAllRemoteControl('presenter-change')
  }

  private async stopPresenting(): Promise<void> {
    this.ToggleRemoteCursors(false)
    for (const link of this.links.values()) {
      await link.setDisplayTrack(null, null)
    }
    this.stopStream(this.displayStream)
    this.displayStream = null
    this.displayStreamActive = false
  }

  private async onPeerLeftMessage(peerId: string): Promise<void> {
    const link = this.findLinkByRemote(peerId)
    if (link) await this.handleRemoteDeparted(link, false)
    else this.removePeerById(peerId)
  }

  private onCoordinatorHandoff(coordinatorId: string): void {
    this.coordinatorId = coordinatorId
    appState.isCoordinator = this.isCoordinator
  }

  private onSessionEnded(): void {
    this.sessionEndedReason = 'host-ended'
    playSessionEndedSound()
    void this.teardown(true)
  }

  private onCursor(msg: Extract<ControlMessage, { t: 'cursor' }>): void {
    if (!this.isPresenter || !this.cursorsEnabled) return
    window.KiwiApi.updateRemoteCursor({
      id: msg.id,
      name: msg.name,
      color: msg.color,
      x: msg.x,
      y: msg.y,
      sourceId: msg.sourceId,
    })
  }

  private onCursorPing(cursorId: string): void {
    if (!this.isPresenter || !this.cursorsEnabled) return
    playCursorPingSound()
    window.KiwiApi.remoteCursorPing(cursorId)
  }

  private onChat(msg: Extract<ControlMessage, { t: 'chat' }>): void {
    this.appendChat({
      id: msg.id,
      from: msg.from,
      name: msg.name,
      text: msg.text,
      at: msg.at,
    })
    this.syncCallOverlay()
  }

  private onCameraState(msg: Extract<ControlMessage, { t: 'camera-state' }>): void {
    this.remoteCameraState.set(msg.peerId, { enabled: msg.enabled, streamId: msg.streamId })
    if (!msg.enabled) this.remoteCameraStreams.delete(msg.peerId)
    this.classifyRemoteVideos(msg.peerId)
    const link = this.findLinkByRemote(msg.peerId)
    if (link) {
      void link.applyMediaE2ee((streamId, trackKind) =>
        this.mediaKindFor(link, streamId, trackKind),
      )
    }
  }

  private onTrack(link: PeerLink, event: RTCTrackEvent): void {
    const peerId = link.remotePeerId ?? link.pendingId
    const stream = event.streams[0] ?? new MediaStream([event.track])
    const receiver = event.receiver
    debugLog.info('room', 'onTrack', {
      kind: event.track.kind,
      peerId,
      streamId: stream.id,
      muted: event.track.muted,
      enabled: event.track.enabled,
      readyState: event.track.readyState,
    })
    if (this.e2eeFailClosed() && !this.mediaE2ee) {
      debugLog.warn('room', 'dropped media track; e2ee required', {
        kind: event.track.kind,
        peerId,
      })
      event.track.enabled = false
      event.track.stop()
      return
    }
    if (receiver) {
      void link.attachReceiver(receiver, {
        sender: peerId,
        kind: this.mediaKindFor(link, stream.id, event.track.kind),
        streamId: stream.id,
      })
    }
    if (event.track.kind === 'video') {
      this.remoteVideoByStreamId.set(stream.id, { peerId, stream })
      this.classifyRemoteVideos(peerId)
    }
    if (event.track.kind === 'audio') {
      this.attachRemoteAudio(peerId, stream)
    }
    event.track.addEventListener('unmute', () => {
      const settings = event.track.getSettings?.()
      debugLog.info('room', 'track unmuted', {
        kind: event.track.kind,
        peerId,
        streamId: stream.id,
        width: settings?.width,
        height: settings?.height,
      })
      if (event.track.kind === 'video') this.attachPresenterVideo()
      if (event.track.kind === 'audio') this.attachRemoteAudio(peerId, stream)
    })
  }

  private classifyRemoteVideos(peerId: string): void {
    const cam = this.remoteCameraState.get(peerId)
    const entries = [...this.remoteVideoByStreamId.entries()].filter(
      ([, entry]) => entry.peerId === peerId,
    )
    const picked = pickRemoteCameraAndDisplay({
      streamIds: entries.map(([streamId]) => streamId),
      camera: cam,
      isPresenter: peerId === this.presenterId,
      existingDisplayStreamId: this.remoteVideoStreams.get(peerId)?.id ?? null,
    })
    const cameraEntry = entries.find(([streamId]) => streamId === picked.cameraStreamId)
    const displayEntry = entries.find(([streamId]) => streamId === picked.displayStreamId)
    if (cameraEntry) this.remoteCameraStreams.set(peerId, cameraEntry[1].stream)
    else this.remoteCameraStreams.delete(peerId)
    if (displayEntry) this.remoteVideoStreams.set(peerId, displayEntry[1].stream)
    else this.remoteVideoStreams.delete(peerId)
    this.attachPresenterVideo()
    this.syncCallOverlay()
  }

  private attachPresenterVideo(): void {
    if (!this.remoteVideo || this.isPresenter) return
    const stream =
      this.remoteVideoStreams.get(this.presenterId) ?? [...this.remoteVideoStreams.values()].at(-1)
    if (stream && this.remoteVideo.srcObject !== stream) {
      this.remoteVideo.srcObject = stream
    }
    if (this.remoteVideo.srcObject) {
      void this.remoteVideo
        .play?.()
        .then(() => {
          debugLog.info('room', 'remote video play', {
            videoWidth: this.remoteVideo?.videoWidth,
            videoHeight: this.remoteVideo?.videoHeight,
          })
        })
        .catch((error) => {
          debugLog.warn('room', 'remote video play failed', error)
        })
    }
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    let audio = this.remoteAudioElements.get(peerId)
    if (!audio) {
      audio = document.createElement('audio')
      audio.autoplay = true
      audio.setAttribute('playsinline', '')
      audio.style.display = 'none'
      document.body?.appendChild(audio)
      this.remoteAudioElements.set(peerId, audio)
    }
    if (audio.srcObject !== stream) audio.srcObject = stream
    void audio.play?.().catch((error) => {
      debugLog.warn('room', 'remote audio play failed', error)
    })
  }

  private onIceState(link: PeerLink, state: RTCIceConnectionState): void {
    const key = link.remotePeerId ?? link.pendingId
    const existing = this.iceGraceTimers.get(key)
    if (existing) {
      clearTimeout(existing)
      this.iceGraceTimers.delete(key)
    }
    if (state === 'connected' || state === 'completed') {
      this.markLive(link)
      this.setConnectionState('connected')
      return
    }
    if (state === 'failed' || state === 'closed') {
      void this.handleRemoteDeparted(link, false)
      return
    }
    if (state === 'disconnected') {
      const timer = setTimeout(() => {
        this.iceGraceTimers.delete(key)
        void this.handleRemoteDeparted(link, false)
      }, ICE_DISCONNECT_GRACE_MS)
      this.iceGraceTimers.set(key, timer)
    }
  }

  private markLive(link: PeerLink): void {
    link.markEstablished()
    this.isLive = this.remotePeerCount > 0 || link.iceConnectionState === 'connected'
    if (link.connectionState === 'connected' || link.iceConnectionState === 'connected') {
      this.setConnectionState('connected')
      this.isLive = true
    }
    this.syncLocalPeer()
  }

  private async handleRemoteDeparted(
    link: PeerLink,
    sessionEndedBroadcast: boolean,
  ): Promise<void> {
    const key = link.remotePeerId ?? link.pendingId
    if (this.quietClose || this.closing.has(key)) return
    this.closing.add(key)
    const peerId = link.remotePeerId
    this.clearIceGrace(key)
    link.close()
    this.deleteLink(link)
    if (peerId) {
      this.removePeerById(peerId)
      window.KiwiApi.removeRemoteCursor?.(peerId)
      this.remoteControl = dropPeerRemoteControl(this.remoteControl, peerId)
      this.inboundRemoteSeq = { ...this.inboundRemoteSeq }
      delete this.inboundRemoteSeq[peerId]
      if (this.isPresenter) void this.syncSidecarArm()
      this.remoteVideoStreams.delete(peerId)
      this.remoteCameraStreams.delete(peerId)
      this.remoteCameraState.delete(peerId)
      for (const [streamId, entry] of this.remoteVideoByStreamId) {
        if (entry.peerId === peerId) this.remoteVideoByStreamId.delete(streamId)
      }
      const audio = this.remoteAudioElements.get(peerId)
      if (audio) {
        audio.srcObject = null
        this.remoteAudioElements.delete(peerId)
      }
      await this.dropVoterFromActiveVote(peerId)
    }
    const remaining = this.establishedRemoteIds().length
    const reason = sessionEndedReasonAfterDeparture({
      sessionEndedBroadcast,
      remainingRemoteCount: remaining,
      wasEstablished: link.established,
    })
    if (reason) {
      this.sessionEndedReason = reason
      this.isLive = false
      this.setConnectionState('closed')
      playSessionEndedSound()
      return
    }
    this.isLive = remaining > 0
    if (!peerId && remaining === 0) {
      this.setConnectionState('failed')
      return
    }
    if (peerId && peerId === this.presenterId) {
      this.presenterId = ''
      this.presenterGone = true
    }
    if (peerId && peerId === this.coordinatorId) {
      const next = nextCoordinator({
        remainingPeerIds: [this.localPeerId, ...this.establishedRemoteIds()],
      })
      if (next) {
        this.coordinatorId = next
        appState.isCoordinator = this.isCoordinator
      }
    }
    if (this.isCoordinator) this.broadcastRoster()
    this.syncLocalPeer()
    this.syncCallOverlay()
  }

  private async dropVoterFromActiveVote(peerId: string): Promise<void> {
    const vote = this.activeVote
    if (!vote) return
    if (vote.candidateId === peerId || vote.requesterId === peerId) {
      this.clearVoteTimer()
      this.activeVote = null
      this.localVoteCast = null
      return
    }
    if (!vote.requiredVoterIds.includes(peerId)) return
    const next: VoteState = {
      ...vote,
      requiredVoterIds: vote.requiredVoterIds.filter((id) => id !== peerId),
      votes: Object.fromEntries(Object.entries(vote.votes).filter(([id]) => id !== peerId)),
    }
    this.activeVote = next
    await this.checkVoteOutcome(next)
  }

  private findPendingForAnswer(answer: RTCSessionDescriptionInit): PeerLink | null {
    for (const link of this.links.values()) {
      if (link.remotePeerId) continue
      if (answersMatchOffer(link.localDescription?.sdp, answer.sdp)) return link
    }
    if (this.lastCopiedPendingId) {
      const last = this.links.get(this.lastCopiedPendingId)
      if (last && !last.remotePeerId) return last
    }
    for (const [key, link] of this.links) {
      if (key === this.handshakeKey) continue
      if (!link.remotePeerId) return link
    }
    return null
  }

  private rekeyLink(link: PeerLink, remotePeerId: string): void {
    link.remotePeerId = remotePeerId
    const oldKey = [...this.links.entries()].find(([, value]) => value === link)?.[0]
    if (oldKey && oldKey !== remotePeerId) this.links.delete(oldKey)
    this.links.set(remotePeerId, link)
    const pendingStream = this.remoteVideoStreams.get(link.pendingId)
    if (pendingStream) {
      this.remoteVideoStreams.delete(link.pendingId)
      this.remoteVideoStreams.set(remotePeerId, pendingStream)
      this.attachPresenterVideo()
    }
    const pendingCamera = this.remoteCameraStreams.get(link.pendingId)
    if (pendingCamera) {
      this.remoteCameraStreams.delete(link.pendingId)
      this.remoteCameraStreams.set(remotePeerId, pendingCamera)
    }
    const pendingCamState = this.remoteCameraState.get(link.pendingId)
    if (pendingCamState) {
      this.remoteCameraState.delete(link.pendingId)
      this.remoteCameraState.set(remotePeerId, pendingCamState)
    }
    for (const entry of this.remoteVideoByStreamId.values()) {
      if (entry.peerId === link.pendingId) entry.peerId = remotePeerId
    }
    const pendingAudio = this.remoteAudioElements.get(link.pendingId)
    if (pendingAudio) {
      this.remoteAudioElements.delete(link.pendingId)
      this.remoteAudioElements.set(remotePeerId, pendingAudio)
    }
    if (this.handshakeKey === oldKey) this.handshakeKey = remotePeerId
  }

  private findLinkByRemote(peerId: string): PeerLink | undefined {
    return this.links.get(peerId)
  }

  private deleteLink(link: PeerLink): void {
    for (const [key, value] of this.links) {
      if (value === link) this.links.delete(key)
    }
  }

  private upsertPeer(peer: RoomPeer): void {
    const others = this.peers.filter((item) => item.id !== peer.id)
    this.peers = uniquePeersById([...others, peer])
  }

  private removePeerById(peerId: string): void {
    this.peers = this.peers.filter((peer) => peer.id !== peerId)
  }

  private syncLocalPeer(): void {
    this.upsertPeer({
      id: this.localPeerId,
      username: this.username,
      color: this.color,
    })
    this.syncCallOverlay()
  }

  private allPeerIds(): string[] {
    const ids = new Set<string>([this.localPeerId, ...this.establishedRemoteIds()])
    return [...ids]
  }

  private establishedRemoteIds(): string[] {
    const ids: string[] = []
    for (const [key, link] of this.links) {
      if (key === this.handshakeKey && !link.remotePeerId) continue
      if (link.remotePeerId) ids.push(link.remotePeerId)
    }
    return ids
  }

  private routablePeerIds(): string[] {
    return this.establishedRemoteIds()
  }

  private broadcastRoster(): void {
    const withLocal = this.peers.some((peer) => peer.id === this.localPeerId)
      ? this.peers
      : [...this.peers, { id: this.localPeerId, username: this.username, color: this.color }]
    this.peers = uniquePeersById(withLocal)
    this.broadcast({
      t: 'roster',
      v: PROTOCOL_VERSION,
      peers: this.peers,
      coordinatorId: this.coordinatorId,
      presenterId: this.presenterId,
    })
    this.syncCallOverlay()
  }

  private broadcast(msg: ControlMessage): void {
    void this.broadcastEncrypted(msg)
  }

  private async broadcastEncrypted(msg: ControlMessage): Promise<void> {
    const wrapped = await this.wrapControl(msg)
    if (!wrapped) return
    for (const link of this.links.values()) {
      link.sendControl(wrapped)
    }
  }

  private sendTo(peerId: string, msg: ControlMessage): boolean {
    const link = this.findLinkByRemote(peerId)
    if (!link) return false
    void this.sendEncrypted(link, msg)
    return true
  }

  private async sendEncrypted(link: PeerLink, msg: ControlMessage): Promise<void> {
    const wrapped = await this.wrapControl(msg)
    if (!wrapped) return
    link.sendControl(wrapped)
  }

  private onRemoteControlRequest(
    msg: Extract<ControlMessage, { t: 'remote-control-request' }>,
  ): void {
    if (!this.isPresenter) return
    if (msg.peerId === this.localPeerId) return
    this.remoteControl = requestRemoteControlState(
      this.remoteControl,
      msg.peerId,
      msg.mouse,
      msg.keyboard,
    )
  }

  private onRemoteControlGrant(msg: Extract<ControlMessage, { t: 'remote-control-grant' }>): void {
    this.remoteControl = {
      ...this.remoteControl,
      [msg.peerId]: {
        requestedMouse: false,
        requestedKeyboard: false,
        mouse: msg.mouse,
        keyboard: msg.keyboard,
        generation: msg.generation,
      },
    }
    if (msg.peerId === this.localPeerId) this.emergencyStopMessage = null
  }

  private onRemoteControlRevoke(
    msg: Extract<ControlMessage, { t: 'remote-control-revoke' }>,
  ): void {
    this.remoteControl = {
      ...this.remoteControl,
      [msg.peerId]: {
        requestedMouse: false,
        requestedKeyboard: false,
        mouse: false,
        keyboard: false,
        generation: msg.generation,
      },
    }
    if (msg.reason === 'emergency') {
      this.emergencyStopMessage = 'Remote control disabled by host hotkey'
    }
  }

  private async syncSidecarArm(): Promise<void> {
    if (!window.KiwiApi.remoteControl) return
    const active = this.isPresenter ? activeController(this.remoteControl) : null
    if (!active) {
      await window.KiwiApi.remoteControl.disarm().catch(() => undefined)
      await window.KiwiApi.remoteControl.releaseAll().catch(() => undefined)
      return
    }
    try {
      await window.KiwiApi.remoteControl.arm({
        mouse: active.state.mouse,
        keyboard: active.state.keyboard,
        generation: active.state.generation,
      })
    } catch (error) {
      debugLog.warn('room', 'remote control arm failed', error)
      this.remoteControlCaps = (await window.KiwiApi.remoteControl.getCapabilities()) ?? null
    }
  }

  private bindRemoteControlIpc(): void {
    if (this.remoteControlUnsub.length) return
    const emergency = window.KiwiApi.remoteControl?.onEmergencyDisabled?.((event) => {
      debugLog.info('room', 'remote control emergency', { reason: event.reason })
      this.emergencyStopMessage = 'Remote control disabled by host hotkey'
      void this.revokeAllRemoteControl('emergency')
    })
    const status = window.KiwiApi.remoteControl?.onStatusChanged?.((event) => {
      void event
      void window.KiwiApi.remoteControl?.getCapabilities?.().then((caps) => {
        this.remoteControlCaps = caps ?? null
      })
    })
    if (emergency) this.remoteControlUnsub.push(emergency)
    if (status) this.remoteControlUnsub.push(status)
  }

  private async sendRemoteInputToPresenter(msg: RemoteInputMessage): Promise<void> {
    const link = this.findLinkByRemote(this.presenterId)
    if (!link) return
    const wrapped = await this.wrapRemoteInput(msg)
    if (!wrapped) return
    if (msg.t === 'pointer-move') link.sendRemoteInputMotion(wrapped)
    else link.sendRemoteInputAction(wrapped)
  }

  private async wrapRemoteInput(msg: RemoteInputMessage): Promise<string | null> {
    const action = outboundCryptoAction({
      encryptable: true,
      required: this.e2eeFailClosed(),
      ready: this.appCryptoReady(),
    })
    if (action === 'queue' || action === 'passthrough') {
      if (action === 'queue') return null
      return serializeRemoteInputMessage(msg)
    }
    try {
      const encoded = new TextEncoder().encode(serializeRemoteInputMessage(msg))
      const sealed = await this.crypto!.encryptApplication('remote-input', encoded)
      return serializeControlMessage({
        t: 'e2ee',
        v: PROTOCOL_VERSION,
        ...sealed,
      })
    } catch (error) {
      debugLog.error('room', 'refusing plaintext remote-input; encrypt failed', error)
      return null
    }
  }

  private async unwrapRemoteInput(raw: string): Promise<RemoteInputMessage | null> {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
    const asControl = parseControlMessage(JSON.stringify(value))
    if (asControl?.t === 'e2ee') {
      if (!this.crypto?.isReady()) return null
      try {
        const plaintext = await this.crypto.decryptApplication(asControl)
        return parseRemoteInputMessage(new TextDecoder().decode(plaintext))
      } catch (error) {
        debugLog.warn('room', 'dropped unauthenticated remote-input', error)
        return null
      }
    }
    if (dropPlaintextInbound({ encryptable: true, required: this.e2eeFailClosed() })) {
      debugLog.warn('room', 'dropped plaintext remote-input in e2ee room')
      return null
    }
    return parseRemoteInputMessage(raw)
  }

  private async onRemoteInputRaw(
    link: PeerLink,
    raw: string,
    channel: 'motion' | 'action',
  ): Promise<void> {
    if (!this.isPresenter) return
    const peerId = link.remotePeerId
    if (!peerId) return
    const msg = await this.unwrapRemoteInput(raw)
    if (!msg) return
    if (
      msg.t === 'remote-control-request' ||
      msg.t === 'remote-control-grant' ||
      msg.t === 'remote-control-revoke'
    ) {
      return
    }
    const kind = msg.t === 'key' ? 'keyboard' : 'mouse'
    if (!inputMatchesGrant(this.remoteControl, peerId, kind, msg.generation)) return
    const seq = acceptSeq(this.inboundRemoteSeq, peerId, channel, msg.seq)
    if (!seq.ok) return
    this.inboundRemoteSeq = seq.next
    const api = window.KiwiApi.remoteControl
    if (!api) return
    if (msg.t === 'pointer-move') {
      await api.pointerMove(msg)
      return
    }
    if (msg.t === 'pointer-button') {
      await api.pointerButton(msg)
      return
    }
    if (msg.t === 'pointer-wheel') {
      await api.wheel(msg)
      return
    }
    await api.key(msg)
  }

  private sendRouted(to: string, msg: ControlMessage, fallback: PeerLink): void {
    if (this.sendTo(to, msg)) return
    void this.sendEncrypted(fallback, msg)
    if (this.coordinatorId && this.coordinatorId !== this.localPeerId) {
      this.sendTo(this.coordinatorId, msg)
    }
  }

  private async pushVideoToAll(
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
  ): Promise<void> {
    for (const link of this.links.values()) {
      await link.setDisplayTrack(track, stream)
    }
  }

  private armVoteTimer(vote: VoteState): void {
    this.clearVoteTimer()
    const delay = Math.max(0, vote.expiresAt - Date.now())
    this.voteTimer = setTimeout(() => {
      if (!this.activeVote || this.activeVote.voteId !== vote.voteId) return
      void this.checkVoteOutcome(this.activeVote)
    }, delay)
  }

  private clearVoteTimer(): void {
    if (this.voteTimer) {
      clearTimeout(this.voteTimer)
      this.voteTimer = null
    }
  }

  private clearIceGrace(key: string): void {
    const timer = this.iceGraceTimers.get(key)
    if (timer) clearTimeout(timer)
    this.iceGraceTimers.delete(key)
  }

  private bindDisplayEnded(stream: MediaStream): void {
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (this.displayStream !== stream) return
        this.displayStreamActive = false
        void this.revokeAllRemoteControl('sharing-stopped')
      })
    }
  }

  private async setOverlayTemporarilyHidden(hidden: boolean): Promise<void> {
    if (!this.overlayOpen) return
    await window.KiwiApi.setCallOverlayVisible?.(!hidden)
  }

  private async acquireDisplayStream(options?: {
    releasePrevious?: boolean
  }): Promise<MediaStream | 'cancelled' | 'failed'> {
    await this.setOverlayTemporarilyHidden(true)
    try {
      if (options?.releasePrevious) {
        this.stopStream(this.displayStream)
        this.displayStream = null
      }
      debugLog.info('room', 'getDisplayMedia start', {
        releasePrevious: Boolean(options?.releasePrevious),
      })
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
      if (!stream.getVideoTracks().length) {
        this.stopStream(stream)
        debugLog.warn('room', 'getDisplayMedia returned no video tracks')
        return 'failed'
      }
      return stream
    } catch (e) {
      if (e && typeof e === 'object' && 'name' in e && e.name === 'NotAllowedError') {
        return 'cancelled'
      }
      errorHandler(e)
      return 'failed'
    } finally {
      await this.setOverlayTemporarilyHidden(false)
    }
  }

  private stopStream(stream: MediaStream | null): void {
    if (!stream) return
    for (const track of stream.getTracks()) track.stop()
  }

  private async teardown(quiet: boolean): Promise<void> {
    this.quietClose = quiet
    this.clearVoteTimer()
    for (const timer of this.iceGraceTimers.values()) clearTimeout(timer)
    this.iceGraceTimers.clear()
    for (const link of this.links.values()) link.close()
    this.links.clear()
    this.stopStream(this.displayStream)
    this.stopStream(this.pendingDisplayStream)
    this.stopStream(this.audioStream)
    this.stopStream(this.cameraStream)
    this.displayStream = null
    this.pendingDisplayStream = null
    this.audioStream = null
    this.cameraStream = null
    this.cameraSendStreamId = ''
    this.cameraActive = false
    this.chatMessages = []
    this.remoteVideoStreams.clear()
    this.remoteVideoByStreamId.clear()
    this.remoteCameraStreams.clear()
    this.remoteCameraState.clear()
    this.overlayOpen = false
    this.loopback.close()
    window.KiwiApi.toggleCallOverlay?.(false)
    for (const audio of this.remoteAudioElements.values()) {
      audio.srcObject = null
      audio.remove()
    }
    this.remoteAudioElements.clear()
    this.hasAudioInput = false
    this.isLive = false
    this.activeVote = null
    this.localVoteCast = null
    this.voteRejectedKind = null
    this.displayStreamActive = false
    this.cursorsEnabled = false
    this.remoteControl = {}
    this.inboundRemoteSeq = {}
    this.emergencyStopMessage = null
    void window.KiwiApi.remoteControl?.disarm?.()
    this.peers = []
    this.handshakeKey = null
    this.lastCopiedPendingId = null
    this.localPeerId = ''
    this.coordinatorId = ''
    this.presenterId = ''
    this.closing.clear()
    this.e2eeActive = false
    this.mediaE2eeActive = false
    this.e2eeRequired = false
    this.verification = null
    this.invite = null
    this.joinAuth = ''
    this.bonjourCallId = null
    this.signaling = kiwiTransport()
    this.signalingKind = 'kiwi'
    this.pendingBonjourIce = []
    this.pendingBonjourIceOut = []
    this.bonjourLocalSdpSent = false
    this.seenFingerprints.clear()
    this.pendingKeyPackages.clear()
    this.pendingE2ee.clear()
    this.pendingOutbound = []
    this.addingMembers.clear()
    this.mlsAssembler = new MlsAssembler()
    this.mlsTail = Promise.resolve()
    this.mediaE2ee?.detach()
    this.mediaE2ee = null
    await this.crypto?.dispose()
    this.crypto = null
    window.KiwiApi.toggleRemoteCursors(false)
    appState.isCoordinator = false
    this.setConnectionState('disconnected')
  }

  private bindCallIpc(): void {
    if (this.callIpcBound) return
    this.callIpcBound = true
    window.KiwiApi.onCallOverlayClosed?.(() => {
      this.overlayOpen = false
      this.loopback.close()
    })
    window.KiwiApi.onCallOverlayReady?.(() => {
      void this.onCallOverlayReady()
    })
    window.KiwiApi.onCallChatSend?.((text) => {
      this.sendChat(text)
    })
    window.KiwiApi.onCallToggleCamera?.(() => {
      void this.ToggleCamera()
    })
    window.KiwiApi.onCallLoopAnswer?.((sdp) => {
      void this.loopback.handleAnswer(sdp)
    })
    window.KiwiApi.onCallLoopIce?.((candidate) => {
      void this.loopback.addIce(candidate)
    })
  }

  private async onCallOverlayReady(): Promise<void> {
    this.overlayOpen = true
    await this.loopback.start()
    this.syncCallOverlay()
  }

  private async enableCamera(): Promise<void> {
    try {
      this.userSettings = await window.KiwiApi.getSettings()
      const deviceId = this.userSettings.cameraDeviceId
      debugLog.info('room', 'camera getUserMedia', { deviceId: deviceId || 'default' })
      const stream = await navigator.mediaDevices.getUserMedia({
        video: mediaTrackConstraints(deviceId),
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      if (!track) {
        this.stopStream(stream)
        return
      }
      track.addEventListener('ended', () => {
        if (this.cameraStream === stream) void this.disableCamera()
      })
      this.stopStream(this.cameraStream)
      this.cameraStream = stream
      this.cameraActive = true
      this.cameraSendStreamId = stream.id
      debugLog.info('room', 'camera enabled', {
        streamId: stream.id,
        requestedDeviceId: deviceId || 'default',
        deviceId: track.getSettings().deviceId ?? '',
        label: track.label,
        links: this.links.size,
      })
      for (const link of this.links.values()) {
        await link.setCameraTrack(track, stream)
      }
      this.broadcastCameraState()
      this.syncCallOverlay()
    } catch (e) {
      errorHandler(e)
    }
  }

  private async disableCamera(): Promise<void> {
    if (!this.cameraStream && !this.cameraActive) return
    for (const link of this.links.values()) {
      await link.setCameraTrack(null, null)
    }
    this.stopStream(this.cameraStream)
    this.cameraStream = null
    this.cameraActive = false
    this.cameraSendStreamId = ''
    this.broadcastCameraState()
    this.syncCallOverlay()
  }

  private broadcastCameraState(): void {
    const msg = {
      t: 'camera-state' as const,
      v: PROTOCOL_VERSION,
      peerId: this.localPeerId,
      enabled: this.cameraActive,
      streamId: this.cameraActive ? this.cameraSendStreamId : '',
    }
    this.broadcast(msg)
  }

  private sendCameraStateTo(link: PeerLink): void {
    if (!this.cameraActive) return
    void this.sendEncrypted(link, {
      t: 'camera-state',
      v: PROTOCOL_VERSION,
      peerId: this.localPeerId,
      enabled: true,
      streamId: this.cameraSendStreamId,
    })
  }

  private appendChat(msg: CallChatMessage): void {
    if (this.chatMessages.some((item) => item.id === msg.id)) return
    const next = [...this.chatMessages, msg]
    this.chatMessages = next.length > CHAT_MAX_MESSAGES ? next.slice(-CHAT_MAX_MESSAGES) : next
  }

  private cameraSources(): Array<{ peerId: string; stream: MediaStream }> {
    const sources: Array<{ peerId: string; stream: MediaStream }> = []
    if (this.cameraStream) {
      sources.push({ peerId: this.localPeerId, stream: this.cameraStream })
    }
    for (const [peerId, stream] of this.remoteCameraStreams) {
      sources.push({ peerId, stream })
    }
    return sources
  }

  private callPeerInfos(): CallPeerInfo[] {
    return uniquePeersById(this.peers).map((peer) => ({
      id: peer.id,
      name: peer.username,
      color: peer.color,
      cameraEnabled:
        peer.id === this.localPeerId
          ? this.cameraActive
          : Boolean(this.remoteCameraState.get(peer.id)?.enabled),
      isLocal: peer.id === this.localPeerId,
    }))
  }

  private syncCallOverlay(): void {
    if (!this.overlayOpen) return
    window.KiwiApi.sendCallPeers?.(cloneForIpc(this.callPeerInfos()))
    window.KiwiApi.sendCallChat?.(cloneForIpc(this.chatMessages))
    void this.loopback.setVideoSources(this.cameraSources())
  }

  private setConnectionState(state: string): void {
    if (this.connectionState === state) return
    this.connectionState = state
  }
}
