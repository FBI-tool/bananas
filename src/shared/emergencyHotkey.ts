export type EmergencyHotkey = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: 'Escape'
}

export const DEFAULT_EMERGENCY_HOTKEY: EmergencyHotkey = {
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
  key: 'Escape',
}

export const formatEmergencyHotkey = (
  hotkey: EmergencyHotkey = DEFAULT_EMERGENCY_HOTKEY,
): string => {
  const parts: string[] = []
  if (hotkey.ctrl) parts.push('Ctrl')
  if (hotkey.alt) parts.push('Alt')
  if (hotkey.shift) parts.push('Shift')
  if (hotkey.meta) parts.push('Meta')
  parts.push(hotkey.key === 'Escape' ? 'Esc' : hotkey.key)
  return parts.join('+')
}

export const isEmergencyHotkey = (value: unknown): value is EmergencyHotkey => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.ctrl === 'boolean' &&
    typeof v.alt === 'boolean' &&
    typeof v.shift === 'boolean' &&
    typeof v.meta === 'boolean' &&
    v.key === 'Escape'
  )
}
