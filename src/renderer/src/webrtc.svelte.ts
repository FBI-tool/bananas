import type { RTCSessionDescriptionOptions } from './Utils'
import type { RemoteCursorData, SettingsData } from './types'
import { getConnectionString, ConnectionType, dropTcpIceCandidates } from './Utils'
import { getRTCPeerConnectionConfig } from './Config'

const ICE_GATHERING_TIMEOUT_MS = 10000

const errorHandler = (e: unknown): void => {
  console.error(e)
}

export class WebRTCSession {
  connectionState = $state('disconnected')

  private remoteVideo: HTMLVideoElement | null = null
  private pc: RTCPeerConnection | null = null
  private remoteCursorPositionsEnabled = false
  private remoteMouseCursorPositionsChannel: RTCDataChannel | null = null
  private remoteCursorPingChannel: RTCDataChannel | null = null
  private audioStream: MediaStream | null = null
  private stream: MediaStream | null = null
  private audioElement: HTMLAudioElement | null = null
  private userSettings: SettingsData | null = null

  private remoteMouseCursorPositionsChannelIsReady(): boolean {
    if (!this.remoteMouseCursorPositionsChannel) return false
    return this.remoteMouseCursorPositionsChannel.readyState === 'open'
  }

  private remoteCursorPingChannelIsReady(): boolean {
    if (!this.remoteCursorPingChannel) return false
    return this.remoteCursorPingChannel.readyState === 'open'
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    if (dc.label === 'remoteMouseCursorPositions') {
      this.remoteMouseCursorPositionsChannel = dc
      dc.onmessage = (e: MessageEvent): void => {
        if (!this.remoteCursorPositionsEnabled) return
        if (this.remoteVideo) return
        const data = JSON.parse(e.data)
        window.KiwiApi.updateRemoteCursor(data)
      }
    }
    if (dc.label === 'remoteCursorPing') {
      this.remoteCursorPingChannel = dc
      dc.onmessage = (e: MessageEvent): void => {
        if (!this.remoteCursorPositionsEnabled) return
        if (this.remoteVideo) return
        window.KiwiApi.remoteCursorPing(e.data)
      }
    }
  }

  PingRemoteCursor(cursorId: string): void {
    if (!this.remoteCursorPingChannelIsReady()) {
      console.error('remoteCursorPingChannel not ready')
      return
    }
    this.remoteCursorPingChannel.send(cursorId)
  }

  UpdateRemoteCursor(cursorData: RemoteCursorData): void {
    if (!this.remoteMouseCursorPositionsChannelIsReady()) {
      console.error('remoteMouseCursorPositionsChannel not ready')
      return
    }
    this.remoteMouseCursorPositionsChannel.send(JSON.stringify(cursorData))
  }

  HasAudioInput(): boolean {
    return this.audioStream !== null
  }

  GetAudioStream(): MediaStream | null {
    return this.audioStream
  }

  ToggleRemoteCursors(enabled: boolean): boolean {
    if (!this.remoteMouseCursorPositionsChannel) return false
    if (this.remoteMouseCursorPositionsChannel.readyState !== 'open') return false
    this.remoteCursorPositionsEnabled = enabled
    return enabled
  }

  private async waitForIceGatheringComplete(): Promise<void> {
    if (!this.pc) return
    if (this.pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        this.pc?.removeEventListener('icegatheringstatechange', onStateChange)
        clearTimeout(timeoutId)
      }
      const onStateChange = (): void => {
        if (this.pc?.iceGatheringState === 'complete') {
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

  private addGuestAudioTracks(): void {
    if (!this.pc || !this.audioStream || !this.userSettings) return
    const senders = this.pc.getSenders()
    for (const track of this.audioStream.getTracks()) {
      track.enabled = this.userSettings.isMicrophoneEnabledOnConnect
      if (!senders.some((sender) => sender.track?.id === track.id)) {
        this.pc.addTrack(track, this.audioStream)
      }
    }
  }

  async Setup(v: HTMLVideoElement | null = null): Promise<'ok' | 'cancelled' | 'failed'> {
    this.userSettings = await window.KiwiApi.getSettings()
    this.remoteVideo = v
    this.audioElement = document.createElement('audio')
    this.audioElement.controls = true
    this.audioElement.autoplay = true
    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
    this.pc = new RTCPeerConnection(await getRTCPeerConnectionConfig())
    this.pc.ondatachannel = (e: RTCDataChannelEvent): void => {
      if (e.channel.label === 'remoteMouseCursorPositions') {
        this.setupDataChannel(e.channel)
      }
      if (e.channel.label === 'remoteCursorPing') {
        this.setupDataChannel(e.channel)
      }
    }
    this.pc.ontrack = (evt): void => {
      if (this.remoteVideo) {
        this.remoteVideo.srcObject = evt.streams[0]
      }
      if (this.audioStream && this.audioElement) {
        this.audioElement.srcObject = evt.streams[0]
      }
    }
    this.pc.onicecandidate = (e: RTCPeerConnectionIceEvent): void => {
      const cand = e.candidate
      if (!cand) {
        console.log('icecandidate gathering: complete')
      } else {
        console.log('new icecandidate')
      }
    }
    this.pc.oniceconnectionstatechange = (): void => {
      if (this.pc) this.connectionState = this.pc.iceConnectionState
    }
    if (!this.remoteVideo) {
      try {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        })
        if (!this.stream?.getVideoTracks().length) {
          return 'failed'
        }
        for (const track of this.stream.getTracks()) {
          this.pc.addTrack(track, this.stream)
        }
      } catch (e) {
        if (e && typeof e === 'object' && 'name' in e && e.name === 'NotAllowedError') {
          return 'cancelled'
        }
        errorHandler(e)
        return 'failed'
      }
    }
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      })
    } catch (e) {
      errorHandler(e)
    }
    if (!this.remoteVideo && this.stream && this.audioStream) {
      for (const track of this.audioStream.getTracks()) {
        track.enabled = this.userSettings.isMicrophoneEnabledOnConnect
        this.pc.addTrack(track, this.stream)
      }
    }
    return 'ok'
  }

  async CreateParticipantUrl(
    c: RTCSessionDescriptionOptions,
    data: { username: string },
  ): Promise<string> {
    if (this.pc?.localDescription?.type !== 'answer') {
      try {
        const desc = new RTCSessionDescription(c)
        await this.pc.setRemoteDescription(desc)
        if (this.remoteVideo) {
          this.addGuestAudioTracks()
        }
        if (desc.type === 'offer') {
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
        }
      } catch (e) {
        errorHandler(e)
      }
    }
    await this.waitForIceGatheringComplete()
    return await getConnectionString(
      ConnectionType.PARTICIPANT,
      dropTcpIceCandidates(this.pc.localDescription),
      data,
    )
  }

  async CreateHostUrl(data: { username: string }): Promise<string> {
    if (this.pc?.localDescription?.type !== 'offer') {
      this.remoteMouseCursorPositionsChannel = this.pc.createDataChannel(
        'remoteMouseCursorPositions',
      )
      this.remoteCursorPingChannel = this.pc.createDataChannel('remoteCursorPing')
      this.setupDataChannel(this.remoteMouseCursorPositionsChannel)
      this.setupDataChannel(this.remoteCursorPingChannel)
      const desc = await this.pc.createOffer()
      await this.pc.setLocalDescription(desc)
    }
    await this.waitForIceGatheringComplete()
    return await getConnectionString(
      ConnectionType.HOST,
      dropTcpIceCandidates(this.pc.localDescription),
      data,
    )
  }

  ToggleDisplayStream(): void {
    if (this.stream) {
      for (const track of this.stream.getVideoTracks()) {
        track.enabled = !track.enabled
      }
    }
  }

  ToggleMicrophone(): void {
    if (this.audioStream) {
      for (const track of this.audioStream.getAudioTracks()) {
        track.enabled = !track.enabled
      }
    }
  }

  IsMicrophoneActive(): boolean {
    if (this.audioStream) {
      for (const track of this.audioStream.getAudioTracks()) {
        return track.enabled
      }
    }
    return false
  }

  async Connect(c: RTCSessionDescriptionOptions): Promise<void> {
    try {
      const desc = new RTCSessionDescription(c)
      await this.pc.setRemoteDescription(desc)
      if (this.remoteVideo) {
        this.addGuestAudioTracks()
      }
      if (desc.type === 'offer') {
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)
      }
    } catch (e) {
      errorHandler(e)
    }
  }

  IsConnected(): boolean {
    return this.pc ? this.pc.connectionState === 'connected' : false
  }

  async Disconnect(): Promise<void> {
    try {
      this.pc.close()
      this.pc = null
      if (this.stream) {
        for (const track of this.stream.getTracks()) {
          track.stop()
        }
        this.stream = null
      }
      if (this.audioStream) {
        for (const track of this.audioStream.getTracks()) {
          track.stop()
        }
        this.audioStream = null
      }
    } catch (e) {
      errorHandler(e)
    }
  }
}
