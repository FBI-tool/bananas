export type SpeechLevelState = {
  smoothed: number
  speaking: boolean
  aboveSince: number | null
  lastAbove: number | null
}

export type SpeechPolicy = {
  threshold: number
  attackMs: number
  releaseMs: number
  smoothing: number
  intervalMs: number
}

export const DEFAULT_SPEECH_POLICY: SpeechPolicy = {
  threshold: 0.08,
  attackMs: 80,
  releaseMs: 1500,
  smoothing: 0.35,
  intervalMs: 100,
}

export const initialSpeechLevel = (): SpeechLevelState => ({
  smoothed: 0,
  speaking: false,
  aboveSince: null,
  lastAbove: null,
})

export const updateSpeechLevel = (
  state: SpeechLevelState,
  level: number,
  now: number,
  policy: SpeechPolicy = DEFAULT_SPEECH_POLICY,
): SpeechLevelState => {
  const smoothed = state.smoothed * (1 - policy.smoothing) + Math.max(0, level) * policy.smoothing
  const above = smoothed >= policy.threshold
  if (above) {
    const aboveSince = state.aboveSince ?? now
    const speaking = state.speaking || now - aboveSince >= policy.attackMs
    return { smoothed, speaking, aboveSince, lastAbove: now }
  }
  if (state.speaking && state.lastAbove !== null && now - state.lastAbove < policy.releaseMs) {
    return { smoothed, speaking: true, aboveSince: null, lastAbove: state.lastAbove }
  }
  return { smoothed, speaking: false, aboveSince: null, lastAbove: null }
}

const rmsFromTimeDomain = (bytes: Uint8Array): number => {
  if (!bytes.length) return 0
  let sum = 0
  for (const sample of bytes) {
    const centered = (sample - 128) / 128
    sum += centered * centered
  }
  return Math.sqrt(sum / bytes.length)
}

export class SpeechActivity {
  speaking = false
  private policy: SpeechPolicy
  private state = initialSpeechLevel()
  private timer: ReturnType<typeof setInterval> | null = null
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private now: () => number

  constructor(opts?: { policy?: SpeechPolicy; now?: () => number }) {
    this.policy = opts?.policy ?? DEFAULT_SPEECH_POLICY
    this.now = opts?.now ?? Date.now
  }

  start(stream: MediaStream | null): void {
    this.stop()
    if (!stream?.getAudioTracks().length) return
    const AudioCtx =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    try {
      this.audioCtx = new AudioCtx()
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.5
      this.source = this.audioCtx.createMediaStreamSource(stream)
      this.source.connect(this.analyser)
      const samples = new Uint8Array(this.analyser.fftSize)
      this.timer = setInterval(() => {
        if (!this.analyser) return
        this.analyser.getByteTimeDomainData(samples)
        this.state = updateSpeechLevel(
          this.state,
          rmsFromTimeDomain(samples),
          this.now(),
          this.policy,
        )
        this.speaking = this.state.speaking
      }, this.policy.intervalMs)
    } catch {
      this.stop()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    try {
      this.source?.disconnect()
    } catch {
      // ignore
    }
    this.source = null
    try {
      this.analyser?.disconnect()
    } catch {
      // ignore
    }
    this.analyser = null
    if (this.audioCtx) {
      void this.audioCtx.close()
      this.audioCtx = null
    }
    this.state = initialSpeechLevel()
    this.speaking = false
  }
}
