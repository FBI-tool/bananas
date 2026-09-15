<script lang="ts">
  import { onDestroy } from 'svelte'

  let {
    stream = null,
    className = '',
    visualizerIsActive = $bindable(false)
  }: {
    stream?: MediaStream | null
    className?: string
    visualizerIsActive?: boolean
  } = $props()

  const CSS_WIDTH = 22
  const CSS_HEIGHT = 18
  const BAR_COUNT = 4
  const MIN_BAR = 0.22
  const SMOOTHING = 0.28
  const ACTIVATE_AT = 0.12
  const DEACTIVATE_AT = 0.05

  let canvas: HTMLCanvasElement | undefined = $state()
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let animationFrameId = 0
  let bars = Array.from({ length: BAR_COUNT }, () => MIN_BAR)
  let speaking = false

  const stop = (): void => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
    source?.disconnect()
    source = null
    analyser?.disconnect()
    analyser = null
    if (audioCtx) {
      void audioCtx.close()
      audioCtx = null
    }
  }

  const start = (media: MediaStream): void => {
    if (!canvas) return
    stop()

    const dpr = window.devicePixelRatio || 1
    canvas.width = CSS_WIDTH * dpr
    canvas.height = CSS_HEIGHT * dpr
    canvas.style.width = `${CSS_WIDTH}px`
    canvas.style.height = `${CSS_HEIGHT}px`
    const canvasCtx = canvas.getContext('2d')
    if (!canvasCtx) return
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

    audioCtx = new AudioContext()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.65
    source = audioCtx.createMediaStreamSource(media)
    source.connect(analyser)

    const freq = new Uint8Array(analyser.frequencyBinCount)
    bars = Array.from({ length: BAR_COUNT }, () => MIN_BAR)

    const draw = (): void => {
      animationFrameId = requestAnimationFrame(draw)
      if (!canvas || !canvasCtx || !analyser) return

      analyser.getByteFrequencyData(freq)
      const usable = Math.max(1, Math.floor(freq.length * 0.45))
      let energy = 0
      for (let i = 0; i < BAR_COUNT; i++) {
        const startBin = Math.floor((i * usable) / BAR_COUNT) + 1
        const endBin = Math.floor(((i + 1) * usable) / BAR_COUNT) + 1
        let sum = 0
        let count = 0
        for (let bin = startBin; bin < endBin; bin++) {
          sum += freq[bin] ?? 0
          count += 1
        }
        const target = MIN_BAR + ((count ? sum / count : 0) / 255) * (1 - MIN_BAR)
        bars[i] += (target - bars[i]) * SMOOTHING
        energy += bars[i]
      }

      const level = energy / BAR_COUNT - MIN_BAR
      if (!speaking && level > ACTIVATE_AT) speaking = true
      else if (speaking && level < DEACTIVATE_AT) speaking = false
      visualizerIsActive = speaking

      const color = getComputedStyle(canvas).color
      canvasCtx.clearRect(0, 0, CSS_WIDTH, CSS_HEIGHT)
      canvasCtx.fillStyle = color

      const gap = 2
      const barWidth = (CSS_WIDTH - gap * (BAR_COUNT - 1)) / BAR_COUNT
      const radius = Math.min(2, barWidth / 2)

      for (let i = 0; i < BAR_COUNT; i++) {
        const height = Math.max(2, bars[i] * CSS_HEIGHT)
        const x = i * (barWidth + gap)
        const y = (CSS_HEIGHT - height) / 2
        canvasCtx.beginPath()
        canvasCtx.roundRect(x, y, barWidth, height, radius)
        canvasCtx.fill()
      }
    }

    void audioCtx.resume()
    draw()
  }

  $effect(() => {
    const media = stream
    const node = canvas
    if (!media || !node) return undefined
    start(media)
    return stop
  })

  onDestroy(stop)
</script>

<canvas class={className} bind:this={canvas} width={CSS_WIDTH} height={CSS_HEIGHT}></canvas>

<style>
  canvas {
    display: block;
    width: 1.375rem;
    height: 1.125rem;
    margin: 0 !important;
    flex: none;
  }
</style>
