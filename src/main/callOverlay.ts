import { BrowserWindow, screen } from 'electron'
import { loadWindowContents } from './utils'
import { join } from 'path'

export const createCallOverlayWindow = async (): Promise<BrowserWindow> => {
  const workArea = screen.getPrimaryDisplay().workArea
  const width = 380
  const height = 560
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 280,
    minHeight: 360,
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + 48,
    show: true,
    frame: false,
    autoHideMenuBar: true,
    closable: true,
    fullscreen: false,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/call.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: true,
    },
  })
  loadWindowContents(win, 'call.html')
  win.setAlwaysOnTop(true, 'floating', 1)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  return win
}
