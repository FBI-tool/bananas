import { ipcRenderer } from 'electron'
import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

let HANDLE_URL_CLICKS = true

const onDocumentReady = (callback: () => void): void => {
  if (document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', callback)
  } else {
    callback()
  }
}

ipcRenderer.on('openKiwiURL', (_, url) => {
  if (!HANDLE_URL_CLICKS) return
  onDocumentReady(() => {
    window.postMessage({ type: 'openKiwiURL', url }, '*')
  })
})

type IceServer = {
  urls: string
  username?: string
  credential?: string
}

export type ScreenShareSource = {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  isScreen: boolean
}

type SelectScreenShareSourceHandler = (sources: ScreenShareSource[]) => Promise<string | null>

let selectScreenShareSourceHandler: SelectScreenShareSourceHandler | null = null

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
  foregroundColor: string
  backgroundColor: string
  cameraEnabled: boolean
  isLocal: boolean
}

type CallCameraMid = {
  mid: string
  peerId: string
}

type SdpPayload = {
  type?: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string
}

type IcePayload = {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

const onIpc = (channel: string, listener: (...args: unknown[]) => void): void => {
  ipcRenderer.removeAllListeners(channel)
  ipcRenderer.on(channel, (...eventArgs) => listener(...eventArgs.slice(1)))
}

ipcRenderer.on(
  'selectScreenShareSource',
  async (_, payload: { requestId: number; sources: ScreenShareSource[] }) => {
    const sourceId = selectScreenShareSourceHandler
      ? await selectScreenShareSourceHandler(payload.sources)
      : (payload.sources.find((source) => source.isScreen)?.id ?? payload.sources[0]?.id ?? null)
    ipcRenderer.send('screenShareSourceSelected', { requestId: payload.requestId, sourceId })
  },
)

const KiwiApi = {
  getAppVersion: async (): Promise<string> => {
    return await ipcRenderer.invoke('getAppVersion')
  },
  hasRoutableIpv6: async (): Promise<boolean> => {
    return await ipcRenderer.invoke('hasRoutableIpv6')
  },
  handleUrlClicks: (state: boolean | undefined): boolean => {
    if (state) HANDLE_URL_CLICKS = state
    return HANDLE_URL_CLICKS
  },
  getSettings: async (): Promise<{
    username: string
    foregroundColor: string
    backgroundColor: string
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
    emergencyHotkey?: {
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      key: 'Escape'
    }
  }> => {
    return await ipcRenderer.invoke('getSettings')
  },
  updateSettings: async (settings: {
    username: string
    language: string
    foregroundColor: string
    backgroundColor: string
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
    emergencyHotkey?: {
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      key: 'Escape'
    }
  }): Promise<void> => {
    ipcRenderer.invoke('updateSettings', settings)
  },
  getDeviceIdentity: async (): Promise<{
    publicKey: string
    fingerprint: string
    privateKey: string
  }> => {
    return await ipcRenderer.invoke('getDeviceIdentity')
  },
  toggleRemoteCursors: async (state: boolean): Promise<void> => {
    ipcRenderer.invoke('toggleRemoteCursors', state)
  },
  remoteCursorPing: async (cursorId: string): Promise<void> => {
    ipcRenderer.invoke('remoteCursorPing', cursorId)
  },
  updateRemoteCursor: async (state: {
    id: string
    name: string
    foregroundColor: string
    backgroundColor: string
    x: number
    y: number
    sourceId?: string
  }): Promise<void> => {
    ipcRenderer.invoke('updateRemoteCursor', state)
  },
  removeRemoteCursor: async (peerId: string): Promise<void> => {
    ipcRenderer.invoke('removeRemoteCursor', peerId)
  },
  remoteControl: {
    getCapabilities: async () => ipcRenderer.invoke('remoteControl:getCapabilities'),
    arm: async (grant: {
      mouse: boolean
      keyboard: boolean
      generation?: number
      sessionId?: string
      peerId?: string
    }) => ipcRenderer.invoke('remoteControl:arm', grant),
    disarm: async () => ipcRenderer.invoke('remoteControl:disarm'),
    pointerMove: async (input: unknown) => ipcRenderer.invoke('remoteControl:pointerMove', input),
    pointerButton: async (input: unknown) =>
      ipcRenderer.invoke('remoteControl:pointerButton', input),
    wheel: async (input: unknown) => ipcRenderer.invoke('remoteControl:wheel', input),
    key: async (input: unknown) => ipcRenderer.invoke('remoteControl:key', input),
    releaseAll: async () => ipcRenderer.invoke('remoteControl:releaseAll'),
    requestPermission: async (capability?: 'post' | 'listen') =>
      ipcRenderer.invoke('remoteControl:requestPermission', capability),
    recheck: async () => ipcRenderer.invoke('remoteControl:recheck'),
    onEmergencyDisabled: (cb: (event: { reason: string }) => void): (() => void) => {
      const listener = (_: unknown, event: { reason: string }): void => cb(event)
      ipcRenderer.on('remote-control-emergency', listener)
      return () => {
        ipcRenderer.removeListener('remote-control-emergency', listener)
      }
    },
    onStatusChanged: (cb: (event: unknown) => void): (() => void) => {
      const listener = (_: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('remote-control-status', listener)
      return () => {
        ipcRenderer.removeListener('remote-control-status', listener)
      }
    },
    setLocalCapture: async (enabled: boolean) =>
      ipcRenderer.invoke('remoteControl:setLocalCapture', enabled),
    onLocalKey: (
      cb: (event: {
        action: 'down' | 'up'
        code: string
        location: number
        repeat: boolean
        modifiers: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
      }) => void,
    ): (() => void) => {
      const listener = (
        _: unknown,
        event: {
          action: 'down' | 'up'
          code: string
          location: number
          repeat: boolean
          modifiers: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
        },
      ): void => cb(event)
      ipcRenderer.on('remoteControl:local-key', listener)
      return () => {
        ipcRenderer.removeListener('remoteControl:local-key', listener)
      }
    },
  },
  onSelectScreenShareSource: (handler: SelectScreenShareSourceHandler): void => {
    selectScreenShareSourceHandler = handler
  },
  toggleCallOverlay: async (open: boolean): Promise<void> => {
    await ipcRenderer.invoke('toggleCallOverlay', open)
  },
  setCallOverlayVisible: async (visible: boolean): Promise<void> => {
    await ipcRenderer.invoke('setCallOverlayVisible', visible)
  },
  onCallOverlayClosed: (handler: () => void): void => {
    onIpc('callOverlayClosed', () => handler())
  },
  onCallOverlayReady: (handler: () => void): void => {
    onIpc('call-overlay-ready', () => handler())
  },
  onCallChatSend: (handler: (text: string) => void): void => {
    onIpc('call-chat-send', (text) => handler(String(text)))
  },
  onCallToggleCamera: (handler: () => void): void => {
    onIpc('call-toggle-camera', () => handler())
  },
  onCallLoopAnswer: (handler: (sdp: SdpPayload) => void): void => {
    onIpc('call-loop-answer', (sdp) => handler(sdp as SdpPayload))
  },
  onCallLoopIce: (handler: (candidate: IcePayload) => void): void => {
    onIpc('call-loop-ice', (candidate) => handler(candidate as IcePayload))
  },
  sendCallLoopOffer: (sdp: SdpPayload): void => {
    ipcRenderer.send('call-loop-offer', sdp)
  },
  sendCallLoopIce: (candidate: IcePayload): void => {
    ipcRenderer.send('call-loop-ice', candidate)
  },
  sendCallCameraMids: (mids: CallCameraMid[]): void => {
    ipcRenderer.send('call-camera-mids', mids)
  },
  sendCallChat: (messages: CallChatMessage[]): void => {
    ipcRenderer.send('call-chat', messages)
  },
  sendCallPeers: (peers: CallPeerInfo[]): void => {
    ipcRenderer.send('call-peers', peers)
  },
  bonjour: {
    login: () => ipcRenderer.invoke('bonjour:login'),
    logout: () => ipcRenderer.invoke('bonjour:logout'),
    me: () => ipcRenderer.invoke('bonjour:me'),
    claimUsername: (username: string) => ipcRenderer.invoke('bonjour:claimUsername', username),
    setAcceptRequests: (enabled: boolean) =>
      ipcRenderer.invoke('bonjour:setAcceptRequests', enabled),
    setAcceptCallJoins: (enabled: boolean) =>
      ipcRenderer.invoke('bonjour:setAcceptCallJoins', enabled),
    contacts: () => ipcRenderer.invoke('bonjour:contacts'),
    incoming: () => ipcRenderer.invoke('bonjour:incoming'),
    outgoing: () => ipcRenderer.invoke('bonjour:outgoing'),
    request: (username: string) => ipcRenderer.invoke('bonjour:request', username),
    retract: (requestId: string) => ipcRenderer.invoke('bonjour:retract', requestId),
    respond: (requestId: string, action: 'accept' | 'decline') =>
      ipcRenderer.invoke('bonjour:respond', requestId, action),
    ignore: (requestId: string) => ipcRenderer.invoke('bonjour:ignore', requestId),
    unignore: (userId: string) => ipcRenderer.invoke('bonjour:unignore', userId),
    ignored: () => ipcRenderer.invoke('bonjour:ignored'),
    removeContact: (peerId: string) => ipcRenderer.invoke('bonjour:removeContact', peerId),
    lists: () => ipcRenderer.invoke('bonjour:lists'),
    createList: (name: string) => ipcRenderer.invoke('bonjour:createList', name),
    renameList: (listId: string, name: string) =>
      ipcRenderer.invoke('bonjour:renameList', listId, name),
    deleteList: (listId: string) => ipcRenderer.invoke('bonjour:deleteList', listId),
    addListMember: (listId: string, peerId: string) =>
      ipcRenderer.invoke('bonjour:addListMember', listId, peerId),
    removeListMember: (listId: string, peerId: string) =>
      ipcRenderer.invoke('bonjour:removeListMember', listId, peerId),
    startCall: (peerId: string, kind: 'start' | 'join') =>
      ipcRenderer.invoke('bonjour:startCall', peerId, kind),
    acceptCall: (callId: string) => ipcRenderer.invoke('bonjour:acceptCall', callId),
    rejectCall: (callId: string) => ipcRenderer.invoke('bonjour:rejectCall', callId),
    hangup: (callId: string) => ipcRenderer.invoke('bonjour:hangup', callId),
    signal: (callId: string, type: string, peerPublicKey: string, payload: unknown) =>
      ipcRenderer.invoke('bonjour:signal', callId, type, peerPublicKey, payload),
    setPresence: (status: 'available' | 'busy' | 'offline') =>
      ipcRenderer.invoke('bonjour:setPresence', status),
    onAuth: (handler: (me: unknown) => void) => {
      onIpc('bonjour:auth', (me) => handler(me))
    },
    onEvent: (handler: (event: unknown) => void) => {
      onIpc('bonjour:event', (event) => handler(event))
    },
  },
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('KiwiApi', KiwiApi)
} catch (error) {
  console.error(error)
}
