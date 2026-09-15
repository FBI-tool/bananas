import { BrowserWindow, screen } from 'electron'
import { loadWindowContents } from './utils'
import { join } from 'path'

const overlayBounds = (): Electron.Rectangle => screen.getPrimaryDisplay().bounds

const applyOverlayBehavior = (win: BrowserWindow): void => {
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

export const createCursorsWindow = async (): Promise<BrowserWindow> => {
  const bounds = overlayBounds()
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    closable: true,
    fullscreen: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    movable: false,
    enableLargerThanScreen: true,
    ...(process.platform === 'linux' ? { type: 'toolbar' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/cursors.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: true,
    },
  })
  loadWindowContents(win, 'cursors.html')
  applyOverlayBehavior(win)

  const onDisplayChange = (): void => {
    if (win.isDestroyed()) return
    win.setBounds(overlayBounds())
    applyOverlayBehavior(win)
  }
  screen.on('display-metrics-changed', onDisplayChange)
  win.on('closed', () => {
    screen.off('display-metrics-changed', onDisplayChange)
  })
  win.on('show', () => {
    applyOverlayBehavior(win)
  })
  win.once('ready-to-show', () => {
    win.setBounds(overlayBounds())
    win.showInactive()
    applyOverlayBehavior(win)
  })
  return win
}
