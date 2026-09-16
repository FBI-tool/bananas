export type RemoteCursorData = {
  id: string
  name: string
  color: string
  x: number
  y: number
  sourceId?: string
}

type IceServer = {
  urls: string
  username?: string
  credential?: string
}

export type SettingsData = {
  username: string
  color: string
  language?: string
  isMicrophoneEnabledOnConnect: boolean
  hardwareVideoAcceleration: boolean
  debugLogsEnabled: boolean
  e2eeEnabled?: boolean
  mediaE2eeEnabled?: boolean
  cameraDeviceId?: string
  microphoneDeviceId?: string
  iceServers: IceServer[]
}

export type ScreenShareSource = {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  isScreen: boolean
}

export type ViewName = 'join' | 'host' | 'settings' | 'about' | 'debug'
