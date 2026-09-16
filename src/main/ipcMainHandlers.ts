import type { SettingsData } from './stateKeeper'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { createCallOverlayWindow } from './callOverlay'
import { settingsKeeper } from './stateKeeper'
import { OverlayBridge } from './sidecar/overlayBridge'
import { createAppSidecarManager } from './sidecar/sidecarManager'
import { lastShareSource } from './screenPicker'
import type { OverlaySource } from './sidecar/protocol'
import { loadOrCreateIdentity } from './identityStore'

export const sidecarManager = createAppSidecarManager()
const overlayBridge = new OverlayBridge(sidecarManager)

const sourceFromDisplay = (): OverlaySource => {
  const remembered = lastShareSource()
  if (remembered) return remembered
  const display = screen.getPrimaryDisplay()
  return {
    displayId: String(display.id),
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
  }
}

export const ipcMainHandlersInit = (): void => {
  let callOverlayWindow: BrowserWindow | null = null
  let callMainWindow: BrowserWindow | null = null
  overlayBridge.setShareSource(sourceFromDisplay())
  screen.on('display-metrics-changed', () => {
    overlayBridge.setShareSource(sourceFromDisplay())
  })

  const fromCallOverlay = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    Boolean(callOverlayWindow && event.sender.id === callOverlayWindow.webContents.id)

  const fromCallMain = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    Boolean(callMainWindow && event.sender.id === callMainWindow.webContents.id)

  ipcMain.handle('toggleRemoteCursors', async (_, state) => {
    overlayBridge.setShareSource(sourceFromDisplay())
    await overlayBridge.toggle(Boolean(state))
  })
  ipcMain.handle('updateRemoteCursor', async (_, state): Promise<void> => {
    await overlayBridge.updateCursor(state)
  })
  ipcMain.handle('remoteCursorPing', async (_, cursorId): Promise<void> => {
    await overlayBridge.ping(cursorId)
  })
  ipcMain.handle('removeRemoteCursor', async (_, peerId): Promise<void> => {
    await overlayBridge.removeCursor(peerId)
  })
  ipcMain.handle('setCursorShareSource', async (_, source: OverlaySource | null): Promise<void> => {
    overlayBridge.setShareSource(source)
  })
  ipcMain.handle('getSidecarCapabilities', async () => sidecarManager.getCapabilities())
  ipcMain.handle('updateSettings', async (_, settings): Promise<void> => {
    const settingsKeeperInstance = await settingsKeeper()
    settingsKeeperInstance.set(settings)
    sidecarManager.setDebugLogs(Boolean(settings?.debugLogsEnabled))
  })
  ipcMain.handle('getSettings', async (): Promise<SettingsData> => {
    const settingsKeeperInstance = await settingsKeeper()
    return settingsKeeperInstance.get()
  })
  ipcMain.handle('getAppVersion', (): string => {
    return app.getVersion()
  })
  ipcMain.handle('getDeviceIdentity', () => {
    const identity = loadOrCreateIdentity()
    return {
      publicKey: Buffer.from(identity.publicKey).toString('base64'),
      privateKey: Buffer.from(identity.privateKey).toString('base64'),
      fingerprint: identity.fingerprint,
    }
  })

  ipcMain.handle('toggleCallOverlay', async (event, open: boolean): Promise<void> => {
    callMainWindow = BrowserWindow.fromWebContents(event.sender)
    if (open) {
      if (callOverlayWindow && !callOverlayWindow.isDestroyed()) {
        callOverlayWindow.show()
        callOverlayWindow.focus()
        callOverlayWindow.webContents.send('call-request-sync')
        return
      }
      callOverlayWindow = await createCallOverlayWindow()
      callOverlayWindow.on('closed', () => {
        callOverlayWindow = null
        callMainWindow?.webContents.send('callOverlayClosed')
      })
      return
    }
    if (callOverlayWindow && !callOverlayWindow.isDestroyed()) {
      callOverlayWindow.close()
    }
  })
  ipcMain.handle('setCallOverlayVisible', async (_, visible: boolean): Promise<void> => {
    if (!callOverlayWindow || callOverlayWindow.isDestroyed()) return
    if (visible) callOverlayWindow.showInactive()
    else callOverlayWindow.hide()
  })

  ipcMain.on('call-overlay-ready', (event) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-overlay-ready')
  })
  ipcMain.on('call-chat-send', (event, text: string) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-chat-send', text)
  })
  ipcMain.on('call-toggle-camera', (event) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-toggle-camera')
  })
  ipcMain.on('call-loop-answer', (event, sdp: unknown) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-loop-answer', sdp)
  })
  ipcMain.on('call-loop-ice', (event, candidate: unknown) => {
    if (fromCallOverlay(event)) {
      callMainWindow?.webContents.send('call-loop-ice', candidate)
      return
    }
    if (fromCallMain(event)) {
      callOverlayWindow?.webContents.send('call-loop-ice', candidate)
    }
  })
  ipcMain.on('call-loop-offer', (event, sdp: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-loop-offer', sdp)
  })
  ipcMain.on('call-chat', (event, messages: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-chat', messages)
  })
  ipcMain.on('call-peers', (event, peers: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-peers', peers)
  })
  ipcMain.on('call-camera-mids', (event, mids: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-camera-mids', mids)
  })
}
