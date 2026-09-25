import { BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron'
import type { DesktopCapturerSource, NativeImage } from 'electron'
import type { OverlaySource } from './sidecar/protocol'

const isWayland =
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY))

// PipeWire ignores this id and opens its own portal session. Passing a real
// source from getSources() would show a second chooser.
const WAYLAND_VIDEO_SOURCE = { id: 'screen:0:0', name: 'Entire Screen' }

export type ScreenShareSource = {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  isScreen: boolean
}

const SELECT_CHANNEL = 'selectScreenShareSource'
const SELECTED_CHANNEL = 'screenShareSourceSelected'
const PICKER_TIMEOUT_MS = 120000
const DISPLAY_MATCH_PX = 8

export type ShareSurfaceKind = 'monitor' | 'window' | 'browser'

export type FrameSize = {
  width: number
  height: number
}

export const displayPixelSize = (
  bounds: { width: number; height: number },
  scaleFactor: number,
): FrameSize => {
  const scale = scaleFactor > 0 ? scaleFactor : 1
  return {
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale),
  }
}

const frameMatchesDisplay = (frame: FrameSize, displays: FrameSize[]): boolean =>
  displays.some(
    (display) =>
      Math.abs(frame.width - display.width) <= DISPLAY_MATCH_PX &&
      Math.abs(frame.height - display.height) <= DISPLAY_MATCH_PX,
  )

/** A portal window share still reports monitor, but its frame is smaller than every display. */
export const shareSurfaceFromFrame = (
  reported: string | undefined,
  frame: FrameSize,
  displays: FrameSize[],
): ShareSurfaceKind | null => {
  if (reported === 'window' || reported === 'browser') return reported
  const sized = frame.width > 0 && frame.height > 0
  const matches = sized && frameMatchesDisplay(frame, displays)
  if (sized && !matches) return 'window'
  if (reported === 'monitor' || matches) return 'monitor'
  return null
}

let pickerRequestId = 0
let rememberedShareSource: OverlaySource | null = null

export const lastShareSource = (): OverlaySource | null => rememberedShareSource

export const noteShareSurface = (surface: string): void => {
  if (!rememberedShareSource) {
    console.info('[share-surface] note skipped; no remembered source', { surface })
    return
  }
  if (surface !== 'monitor' && surface !== 'window' && surface !== 'browser') return
  rememberedShareSource = {
    ...rememberedShareSource,
    windowShare: surface === 'window' || surface === 'browser',
    capture: surface === 'monitor' ? undefined : rememberedShareSource.capture,
  }
}

const overlaySourceFromCapturer = (source: DesktopCapturerSource): OverlaySource => {
  const displays = screen.getAllDisplays()
  const matched = source.display_id
    ? displays.find((display) => String(display.id) === source.display_id)
    : undefined
  const display = matched ?? screen.getPrimaryDisplay()
  return {
    displayId: source.display_id || String(display.id),
    sourceId: source.id,
    windowShare: source.id.startsWith('window:'),
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

export const rememberShareSource = (source: DesktopCapturerSource | null): void => {
  rememberedShareSource = source ? overlaySourceFromCapturer(source) : null
}

const nativeImageToDataUrl = (image?: NativeImage | null): string | null => {
  if (!image || image.isEmpty()) return null
  return image.toDataURL()
}

const serializeSource = (source: DesktopCapturerSource): ScreenShareSource => {
  const isScreen = source.id.startsWith('screen:') || Boolean(source.display_id)
  return {
    id: source.id,
    name: source.name,
    thumbnail: nativeImageToDataUrl(source.thumbnail) ?? '',
    appIcon: nativeImageToDataUrl(source.appIcon),
    isScreen,
  }
}

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const getDesktopSources = async (): Promise<DesktopCapturerSource[]> => {
  await nextTick()
  const screenThumbnails = { width: 320, height: 180 }
  const screens = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: screenThumbnails,
  })

  try {
    const windows = await Promise.race([
      desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 160, height: 90 },
        fetchWindowIcons: true,
      }),
      new Promise<DesktopCapturerSource[]>((resolve) => {
        setTimeout(() => resolve([]), 5000)
      }),
    ])
    return [...screens, ...windows]
  } catch (err) {
    console.error('desktopCapturer.getSources(window) failed', err)
    return screens
  }
}

type VideoStream = { id: string; name: string }

const respondOnce = (
  callback: (streams: { video?: VideoStream }) => void,
): ((streams: { video?: VideoStream }) => void) => {
  let responded = false
  return (streams): void => {
    if (responded) return
    responded = true
    try {
      callback(streams)
    } catch (err) {
      console.error('setDisplayMediaRequestHandler callback failed', err)
    }
  }
}

const askRendererToPickSource = async (
  win: BrowserWindow,
  sources: ScreenShareSource[],
): Promise<string | null> => {
  if (win.isMinimized()) win.restore()
  const bounds = win.getBounds()
  const minWidth = 680
  const minHeight = 520
  if (bounds.width < minWidth || bounds.height < minHeight) {
    win.setSize(Math.max(bounds.width, minWidth), Math.max(bounds.height, minHeight))
  }
  const wasAlwaysOnTop = win.isAlwaysOnTop()
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.show()
  win.focus()
  win.moveTop()
  if (process.platform === 'win32') {
    win.flashFrame(true)
  }

  const requestId = ++pickerRequestId

  try {
    return await new Promise<string | null>((resolve) => {
      const finish = (sourceId: string | null): void => {
        clearTimeout(timeoutId)
        ipcMain.removeListener(SELECTED_CHANNEL, onSelected)
        resolve(sourceId)
      }
      const onSelected = (
        _event: Electron.IpcMainEvent,
        payload: { requestId: number; sourceId: string | null },
      ): void => {
        if (payload?.requestId !== requestId) return
        finish(payload.sourceId)
      }
      const timeoutId = setTimeout(() => finish(null), PICKER_TIMEOUT_MS)
      ipcMain.on(SELECTED_CHANNEL, onSelected)
      win.webContents.send(SELECT_CHANNEL, { requestId, sources })
    })
  } finally {
    if (process.platform === 'win32') {
      win.flashFrame(false)
    }
    win.setAlwaysOnTop(wasAlwaysOnTop)
  }
}

export const installDisplayMediaHandler = (getMainWindow: () => BrowserWindow): void => {
  session.defaultSession.setPermissionCheckHandler(() => true)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true)
  })

  const handler = async (
    _request: unknown,
    callback: (streams: { video?: VideoStream }) => void,
  ): Promise<void> => {
    const respond = respondOnce(callback)
    try {
      if (isWayland) {
        rememberShareSource({
          id: WAYLAND_VIDEO_SOURCE.id,
          name: WAYLAND_VIDEO_SOURCE.name,
          display_id: String(screen.getPrimaryDisplay().id),
        } as DesktopCapturerSource)
        respond({ video: WAYLAND_VIDEO_SOURCE })
        return
      }
      const capturerSources = await getDesktopSources()
      const win = getMainWindow()
      if (!win || win.isDestroyed()) {
        respond({})
        return
      }

      const selectedId = await askRendererToPickSource(win, capturerSources.map(serializeSource))
      const selected = capturerSources.find((source) => source.id === selectedId)
      if (!selected) {
        rememberShareSource(null)
        respond({})
        return
      }
      rememberShareSource(selected)
      respond({ video: selected })
    } catch (err) {
      console.error('display media request failed', err)
      respond({})
    }
  }

  session.defaultSession.setDisplayMediaRequestHandler(handler)
}
