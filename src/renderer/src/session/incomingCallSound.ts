import ringUrl from '../../../../assets/incoming-call.mp3?url'

let ringingId: string | null = null
let audio: HTMLAudioElement | null = null

const stop = (): void => {
  ringingId = null
  if (!audio) return
  audio.pause()
  audio.src = ''
  audio = null
}

export const syncIncomingRing = (callId: string | null): void => {
  if (callId === ringingId) return
  stop()
  if (!callId) return
  try {
    const next = new Audio(ringUrl)
    next.loop = true
    next.volume = 0.6
    ringingId = callId
    audio = next
    void next.play().catch(() => {
      if (audio === next) stop()
    })
  } catch {
    stop()
  }
}
