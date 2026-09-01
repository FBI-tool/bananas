export const playSessionEndedSound = (): void => {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(440, now)
    oscillator.frequency.exponentialRampToValueAtTime(220, now + 0.35)
    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.4)
    oscillator.onended = (): void => {
      void ctx.close()
    }
  } catch {
    // Playback is optional; ignore missing Web Audio support.
  }
}
