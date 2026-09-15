import type { SettingsData } from './stateKeeper'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { createCursorsWindow } from './cursors'
import { createCallOverlayWindow } from './callOverlay'
import { settingsKeeper } from './stateKeeper'

export const ipcMainHandlersInit = (): void => {
  const availableDimensions = screen.getPrimaryDisplay().workAreaSize
  let remoteCursorsWindow: BrowserWindow | null = null
  let remoteCursorsActive = false
  let callOverlayWindow: BrowserWindow | null = null
  let callMainWindow: BrowserWindow | null = null

  const fromCallOverlay = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    Boolean(callOverlayWindow && event.sender.id === callOverlayWindow.webContents.id)

  const fromCallMain = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    Boolean(callMainWindow && event.sender.id === callMainWindow.webContents.id)

  ipcMain.handle('toggleRemoteCursors', async (_, state) => {
    remoteCursorsActive = state
    if (!remoteCursorsWindow && remoteCursorsActive) {
      remoteCursorsWindow = await createCursorsWindow()
      remoteCursorsWindow.on('closed', () => {
        remoteCursorsWindow = null
        remoteCursorsActive = false
      })
      return
    }
    if (remoteCursorsWindow && !remoteCursorsActive) {
      remoteCursorsWindow.close()
      remoteCursorsWindow = null
      return
    }
    console.error('Invalid state')
  })
  ipcMain.handle('updateRemoteCursor', async (_, state): Promise<void> => {
    if (!remoteCursorsActive) return
    if (!remoteCursorsWindow) return
    const realX: string = (state.x * availableDimensions.width).toString()
    const realY: string = (state.y * availableDimensions.height).toString()
    const x = parseInt(realX, 10)
    const y = parseInt(realY, 10)
    const data = {
      ...state,
      x,
      y,
    }
    remoteCursorsWindow.webContents.send('updateRemoteCursor', data)
  })
  ipcMain.handle('remoteCursorPing', async (_, cursorId): Promise<void> => {
    if (!remoteCursorsActive) return
    if (!remoteCursorsWindow) return
    remoteCursorsWindow.webContents.send('remoteCursorPing', cursorId)
  })
  ipcMain.handle('updateSettings', async (_, settings): Promise<void> => {
    const settingsKeeperInstance = await settingsKeeper()
    settingsKeeperInstance.set(settings)
  })
  ipcMain.handle('getSettings', async (): Promise<SettingsData> => {
    const settingsKeeperInstance = await settingsKeeper()
    return settingsKeeperInstance.get()
  })
  ipcMain.handle('getAppVersion', (): string => {
    return app.getVersion()
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
