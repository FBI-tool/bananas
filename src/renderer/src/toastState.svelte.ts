type ToastType = 'success' | 'error' | 'info'

export const DEFAULT_TOAST_MS = 1500
export const ERROR_TOAST_MS = 5000

class ToastState {
  visible = $state(false)
  type = $state<ToastType>('info')
  message = $state('')
  private timeout: ReturnType<typeof setTimeout> | null = null

  show(type: ToastType, message: string, ms?: number): void {
    const duration = ms ?? (type === 'error' ? ERROR_TOAST_MS : DEFAULT_TOAST_MS)
    this.type = type
    this.message = message
    this.visible = true
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      this.visible = false
    }, duration)
  }
}

export const toast = new ToastState()
