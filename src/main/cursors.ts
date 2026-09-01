import { BrowserWindow, screen } from 'electron'
import { loadWindowContents } from './utils'
import { join } from 'path'

export const createCursorsWindow = async (): Promise<BrowserWindow> => {
  const dimensions = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: dimensions.width,
    height: dimensions.height,
    x: 0,
    y: 0,
    show: true,
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    closable: true,
    fullscreen: true,
    minimizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/cursors.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: true,
    },
  })
  loadWindowContents(win, 'cursors.html')
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'normal', 1)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  return win
}
