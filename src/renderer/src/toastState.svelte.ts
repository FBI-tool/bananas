type ToastType = 'success' | 'error' | 'info'

class ToastState {
  visible = $state(false)
  type = $state<ToastType>('info')
  message = $state('')
  private timeout: ReturnType<typeof setTimeout> | null = null

  show(type: ToastType, message: string, ms = 1500): void {
    this.type = type
    this.message = message
    this.visible = true
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      this.visible = false
    }, ms)
  }
}

export const toast = new ToastState()
