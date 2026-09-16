/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'

type IceServer = {
  urls: string
  username?: string
  credential?: string
}

type ScreenShareSource = {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  isScreen: boolean
}

type CallChatMessage = {
  id: string
  from: string
  name: string
  text: string
  at: number
}

type CallPeerInfo = {
  id: string
  name: string
  color: string
  cameraEnabled: boolean
  isLocal: boolean
}

type CallCameraMid = {
  mid: string
  peerId: string
}

type KiwiApi = {
  toggleRemoteCursors: (state: boolean) => Promise<void>
  remoteCursorPing: (cursorId: string) => Promise<void>
  updateRemoteCursor: (state: {
    id: string
    name: string
    color: string
    x: number
    y: number
    sourceId?: string
  }) => Promise<void>
  removeRemoteCursor: (peerId: string) => Promise<void>
  updateSettings: (settings: {
    username: string
    language: string
    color: string
    isMicrophoneEnabledOnConnect: boolean
    hardwareVideoAcceleration: boolean
    debugLogsEnabled: boolean
    e2eeEnabled?: boolean
    mediaE2eeEnabled?: boolean
    cameraDeviceId: string
    microphoneDeviceId: string
    iceServers: IceServer[]
    bonjourEnabled?: boolean
    bonjourServerUrl?: string
  }) => Promise<void>
  getSettings: () => Promise<{
    username: string
    color: string
    language: string
    isMicrophoneEnabledOnConnect: boolean
    hardwareVideoAcceleration: boolean
    debugLogsEnabled: boolean
    e2eeEnabled?: boolean
    mediaE2eeEnabled?: boolean
    cameraDeviceId: string
    microphoneDeviceId: string
    iceServers: IceServer[]
    bonjourEnabled?: boolean
    bonjourServerUrl?: string
  }>
  getAppVersion: () => Promise<string>
  getDeviceIdentity: () => Promise<{ publicKey: string; fingerprint: string; privateKey: string }>
  onSelectScreenShareSource: (
    handler: (sources: ScreenShareSource[]) => Promise<string | null>,
  ) => void
  toggleCallOverlay: (open: boolean) => Promise<void>
  setCallOverlayVisible: (visible: boolean) => Promise<void>
  onCallOverlayClosed: (handler: () => void) => void
  onCallOverlayReady: (handler: () => void) => void
  onCallChatSend: (handler: (text: string) => void) => void
  onCallToggleCamera: (handler: () => void) => void
  onCallLoopAnswer: (handler: (sdp: RTCSessionDescriptionInit) => void) => void
  onCallLoopIce: (handler: (candidate: RTCIceCandidateInit) => void) => void
  sendCallLoopOffer: (sdp: RTCSessionDescriptionInit) => void
  sendCallLoopIce: (candidate: RTCIceCandidateInit) => void
  sendCallCameraMids: (mids: CallCameraMid[]) => void
  sendCallChat: (messages: CallChatMessage[]) => void
  sendCallPeers: (peers: CallPeerInfo[]) => void
  bonjour: {
    login: () => Promise<void>
    logout: () => Promise<void>
    me: () => Promise<{
      userId: string
      username: string | null
      acceptRequestsUntil: string | null
      acceptCallJoins: boolean
      devicePublicKey: string | null
    } | null>
    claimUsername: (username: string) => Promise<unknown>
    setAcceptRequests: (enabled: boolean) => Promise<{ acceptRequestsUntil: string | null }>
    setAcceptCallJoins: (enabled: boolean) => Promise<{ acceptCallJoins: boolean }>
    contacts: () => Promise<
      Array<{
        userId: string
        username: string
        devicePublicKey: string | null
        presence: 'available' | 'busy' | 'offline'
        acceptCallJoins: boolean
      }>
    >
    incoming: () => Promise<Array<{ id: string; fromUserId: string; username: string }>>
    outgoing: () => Promise<Array<{ id: string; toUserId: string; username: string }>>
    request: (username: string) => Promise<unknown>
    retract: (requestId: string) => Promise<unknown>
    respond: (requestId: string, action: 'accept' | 'decline') => Promise<unknown>
    ignore: (requestId: string) => Promise<unknown>
    unignore: (userId: string) => Promise<unknown>
    ignored: () => Promise<Array<{ userId: string; username: string }>>
    removeContact: (peerId: string) => Promise<unknown>
    lists: () => Promise<Array<{ id: string; name: string; memberIds: string[] }>>
    createList: (name: string) => Promise<unknown>
    renameList: (listId: string, name: string) => Promise<unknown>
    deleteList: (listId: string) => Promise<unknown>
    addListMember: (listId: string, peerId: string) => Promise<unknown>
    removeListMember: (listId: string, peerId: string) => Promise<unknown>
    startCall: (peerId: string, kind: 'start' | 'join') => Promise<{ callId: string }>
    acceptCall: (callId: string) => Promise<unknown>
    rejectCall: (callId: string) => Promise<unknown>
    hangup: (callId: string) => Promise<unknown>
    signal: (
      callId: string,
      type: string,
      peerPublicKey: string,
      payload: unknown,
    ) => Promise<unknown>
    setPresence: (status: 'available' | 'busy' | 'offline') => Promise<void>
    onAuth: (handler: (me: unknown) => void) => void
    onEvent: (handler: (event: unknown) => void) => void
  }
}

type CallApi = {
  ready: () => void
  sendChat: (text: string) => void
  sendAnswer: (sdp: RTCSessionDescriptionInit) => void
  sendIce: (candidate: RTCIceCandidateInit) => void
  toggleCamera: () => void
  onChat: (handler: (messages: CallChatMessage[]) => void) => void
  onPeers: (handler: (peers: CallPeerInfo[]) => void) => void
  onOffer: (handler: (sdp: RTCSessionDescriptionInit) => void) => void
  onIce: (handler: (candidate: RTCIceCandidateInit) => void) => void
  onCameraMids: (handler: (mids: CallCameraMid[]) => void) => void
  onRequestSync: (handler: () => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    KiwiApi: KiwiApi
    CallApi: CallApi
  }
}

declare module '*.mp3?url' {
  const src: string
  export default src
}

export {}
