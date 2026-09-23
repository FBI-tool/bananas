import { screen } from 'electron'
import settings from 'electron-settings'
import { DEFAULT_EMERGENCY_HOTKEY, type EmergencyHotkey } from '../shared/emergencyHotkey'
import { debounce } from './utils'

type IceServer = {
  urls: string
  username?: string
  credential?: string
}

export type SettingsData = {
  username: string
  foregroundColor: string
  backgroundColor: string
  language: string
  isMicrophoneEnabledOnConnect: boolean
  hardwareVideoAcceleration: boolean
  debugLogsEnabled: boolean
  e2eeEnabled: boolean
  mediaE2eeEnabled: boolean
  cameraDeviceId: string
  microphoneDeviceId: string
  iceServers: IceServer[]
  bonjourEnabled: boolean
  bonjourServerUrl: string
  emergencyHotkey: EmergencyHotkey
}

type Settings = {
  get: () => SettingsData
  set: (data: SettingsData) => void
}

type WindowState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

type WindowStateKeeper = WindowState & {
  track: (win: Electron.BrowserWindow) => void
}

export const defaultSettings: SettingsData = {
  username: 'Kiwi',
  foregroundColor: '#ffffff',
  backgroundColor: '#0099ff',
  language: 'en',
  isMicrophoneEnabledOnConnect: true,
  hardwareVideoAcceleration: true,
  debugLogsEnabled: false,
  e2eeEnabled: true,
  mediaE2eeEnabled: true,
  cameraDeviceId: '',
  microphoneDeviceId: '',
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ],
  bonjourEnabled: false,
  bonjourServerUrl: 'https://bonjour.p2p.kiwi',
  emergencyHotkey: DEFAULT_EMERGENCY_HOTKEY,
}

export const settingsKeeper = async (): Promise<Settings> => {
  const hasSettings = await settings.has('settings')
  if (hasSettings) {
    const data = (await settings.get('settings')) as unknown as SettingsData
    return {
      get: (): SettingsData => {
        return {
          ...defaultSettings,
          ...data,
        }
      },
      set: (data: SettingsData) => settings.set('settings', data),
    }
  }
  return {
    get: (): SettingsData => defaultSettings,
    set: (data: SettingsData) => settings.set('settings', data),
  }
}

export const windowStateKeeper = async (windowName: string): Promise<WindowStateKeeper> => {
  let window: Electron.BrowserWindow
  let windowState: WindowState

  const setBounds = async (): Promise<WindowState> => {
    const hasState = await settings.has(`windowState.${windowName}`)
    if (hasState) {
      return (await settings.get(`windowState.${windowName}`)) as unknown as WindowState
    }

    const size = screen.getPrimaryDisplay().workAreaSize

    return {
      width: size.width / 2,
      height: size.height / 2,
      isMaximized: false,
    }
  }

  const saveState = async (): Promise<void> => {
    const bounds = window.getBounds()
    windowState = {
      ...bounds,
      isMaximized: window.isMaximized(),
    }
    await settings.set(`windowState.${windowName}`, windowState)
  }

  const track = async (win: Electron.BrowserWindow): Promise<void> => {
    window = win
    win.on('move', debounce(saveState, 400))
    win.on('resize', debounce(saveState, 400))
    win.on('unmaximize', debounce(saveState, 400))
  }

  windowState = await setBounds()

  return {
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    isMaximized: windowState.isMaximized,
    track,
  }
}
