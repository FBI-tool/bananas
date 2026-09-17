import type { WebContents } from 'electron'
import { portableKeyFromId } from '../../shared/portableKeys'
import type { SidecarEventMap } from './protocol'

export type CapturedLocalKey = {
  action: 'down' | 'up'
  code: string
  location: number
  repeat: boolean
  modifiers: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
}

const enabled = new WeakSet<WebContents>()
const hooked = new WeakSet<WebContents>()

export const capturedSidecarKeyToLocal = (
  payload: SidecarEventMap['captured-key'] | Record<string, unknown>,
): CapturedLocalKey | null => {
  const keyCode = Number((payload as { keyCode?: unknown }).keyCode)
  const code = portableKeyFromId(keyCode)
  if (!code) return null
  const raw = payload as {
    down?: unknown
    repeat?: unknown
    location?: unknown
    modifiers?: { ctrl?: unknown; alt?: unknown; shift?: unknown; meta?: unknown }
  }
  return {
    action: raw.down ? 'down' : 'up',
    code,
    location: typeof raw.location === 'number' ? raw.location : 0,
    repeat: Boolean(raw.repeat),
    modifiers: {
      ctrl: Boolean(raw.modifiers?.ctrl),
      alt: Boolean(raw.modifiers?.alt),
      shift: Boolean(raw.modifiers?.shift),
      meta: Boolean(raw.modifiers?.meta),
    },
  }
}

const hook = (contents: WebContents): void => {
  if (hooked.has(contents)) return
  hooked.add(contents)
  contents.on('before-input-event', (event, input) => {
    if (!enabled.has(contents)) return
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return
    if (!input.code) return
    event.preventDefault()
    if (contents.isDestroyed()) return
    const payload: CapturedLocalKey = {
      action: input.type === 'keyDown' ? 'down' : 'up',
      code: input.code,
      location: input.location,
      repeat: Boolean(input.isAutoRepeat),
      modifiers: {
        ctrl: Boolean(input.control),
        alt: Boolean(input.alt),
        shift: Boolean(input.shift),
        meta: Boolean(input.meta),
      },
    }
    contents.send('remoteControl:local-key', payload)
  })
  contents.on('destroyed', () => {
    enabled.delete(contents)
  })
}

export const setLocalKeyCapture = (
  contents: WebContents,
  on: boolean,
  opts: { forward?: boolean } = {},
): void => {
  hook(contents)
  if (contents.isDestroyed()) return
  if (on) {
    contents.setIgnoreMenuShortcuts(true)
    if (opts.forward !== false) enabled.add(contents)
    else enabled.delete(contents)
    return
  }
  enabled.delete(contents)
  contents.setIgnoreMenuShortcuts(false)
}
