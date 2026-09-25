import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {},
  desktopCapturer: {},
  ipcMain: {},
  screen: {},
  session: { defaultSession: {} },
}))

import { shareSurfaceFromFrame } from './screenPicker'

const display = { width: 3440, height: 1440 }

describe('shareSurfaceFromFrame', () => {
  it('keeps a frame that matches a display as a monitor', () => {
    expect(shareSurfaceFromFrame('monitor', { width: 3440, height: 1440 }, [display])).toBe(
      'monitor',
    )
    expect(shareSurfaceFromFrame(undefined, { width: 3436, height: 1444 }, [display])).toBe(
      'monitor',
    )
  })

  it('treats a smaller frame as a window even when the reported surface is monitor', () => {
    expect(shareSurfaceFromFrame('monitor', { width: 1200, height: 800 }, [display])).toBe('window')
  })

  it('keeps an explicit window or browser surface', () => {
    expect(shareSurfaceFromFrame('window', display, [display])).toBe('window')
    expect(shareSurfaceFromFrame('browser', { width: 800, height: 600 }, [display])).toBe('browser')
  })
})
