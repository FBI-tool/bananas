import { app } from 'electron'
import settings from 'electron-settings'
import { defaultSettings, type SettingsData } from './stateKeeper'
import { isLinux, isWaylandSession, linuxGpuCliArgs } from './linuxGpuFlags'

const readHardwareVideoAcceleration = (): boolean => {
  try {
    const saved = settings.getSync('settings') as Partial<SettingsData> | undefined
    if (typeof saved?.hardwareVideoAcceleration === 'boolean') {
      return saved.hardwareVideoAcceleration
    }
  } catch {
    // Settings file may not exist on first launch.
  }
  return defaultSettings.hardwareVideoAcceleration
}

const switchName = (arg: string): string => {
  const [flag] = arg.slice(2).split('=')
  return flag
}

const switchValue = (arg: string): string => {
  const eq = arg.indexOf('=')
  return eq === -1 ? '' : arg.slice(eq + 1)
}

export const applyChromiumFlags = (): void => {
  if (!isLinux) return

  for (const arg of linuxGpuCliArgs({
    wayland: isWaylandSession(),
    vaapi: readHardwareVideoAcceleration(),
  })) {
    const name = switchName(arg)
    const value = switchValue(arg)
    if (value) app.commandLine.appendSwitch(name, value)
    else app.commandLine.appendSwitch(name)
  }
}
