import pingUrl from '../../../../assets/ping.mp3?url'

export const playCursorPingSound = (): void => {
  try {
    const audio = new Audio(pingUrl)
    audio.volume = 0.6
    void audio.play()
  } catch {
    // Playback is optional; ignore missing audio support.
  }
}
