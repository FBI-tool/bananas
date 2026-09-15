import { app, shell, BrowserWindow } from 'electron'
import path from 'path'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { applyChromiumFlags } from './chromiumFlags'
import { windowStateKeeper } from './stateKeeper'
import { ipcMainHandlersInit } from './ipcMainHandlers'
import { installDisplayMediaHandler } from './screenPicker'
import { isInProductionMode } from './utils'

applyChromiumFlags()

const CUSTOM_PROTOCOL = 'kiwi'
const LEGACY_PROTOCOL = 'bananas'

let MAIN_WINDOW: BrowserWindow

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
    app.setAsDefaultProtocolClient(LEGACY_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL)
  app.setAsDefaultProtocolClient(LEGACY_PROTOCOL)
}

if (isInProductionMode()) {
  const SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock()

  if (!SINGLE_INSTANCE_LOCK) {
    app.quit()
  }
}

const sendOpenKiwiUrlToRenderer = (url: string): void => {
  MAIN_WINDOW.webContents.send('openKiwiURL', url)
}

app.on('second-instance', (_, commandLine) => {
  if (MAIN_WINDOW) {
    if (MAIN_WINDOW.isMinimized()) MAIN_WINDOW.restore()
    MAIN_WINDOW.focus()
  }
  const url = commandLine.pop()
  if (url) sendOpenKiwiUrlToRenderer(url)
})

app.on('open-url', (evt, url: string) => {
  evt.preventDefault()
  sendOpenKiwiUrlToRenderer(url)
})

async function createWindow(): Promise<void> {
  const mainWindowState = await windowStateKeeper('main')

  MAIN_WINDOW = new BrowserWindow({
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 400,
    minHeight: 200,
    x: mainWindowState.x,
    y: mainWindowState.y,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: true,
    },
  })

  mainWindowState.track(MAIN_WINDOW)

  installDisplayMediaHandler(() => MAIN_WINDOW)

  MAIN_WINDOW.on('ready-to-show', () => {
    MAIN_WINDOW.show()
  })

  MAIN_WINDOW.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    MAIN_WINDOW.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    MAIN_WINDOW.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (mainWindowState.isMaximized) {
    MAIN_WINDOW.maximize()
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('kiwi.p2p.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMainHandlersInit()

  await createWindow()
  const coldStartUrl = process.argv.find(
    (arg) => arg.startsWith(CUSTOM_PROTOCOL + '://') || arg.startsWith('bananas://'),
  )
  if (coldStartUrl) {
    sendOpenKiwiUrlToRenderer(coldStartUrl)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
