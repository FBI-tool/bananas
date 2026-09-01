<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let {
    stream = null,
    className = '',
    visualizerIsActive = $bindable(false)
  }: {
    stream?: MediaStream | null
    className?: string
    visualizerIsActive?: boolean
  } = $props()

  let canvas: HTMLCanvasElement | undefined = $state()
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let animationFrameId: number

  const ACTIVE_THRESHOLD = 0.006
  const ACTIVATION_PERCENTAGE = 0.1
  const HEIGHT_SCALE = 4
  const BUFFER_SIZE = 256
  const DELAY_FRAMES = 50
  const EASING_FACTOR = 0.1
  const DECAY_RATE = 0.05

  let smoothedRMS = 0
  let buffer: number[] = []
  let signalBuffer: number[][] = []
  let displayedValues: number[] = []
  let signalBufferIndex = 0

  function visualize(s: MediaStream): void {
    if (!canvas) return

    if (!audioCtx) {
      audioCtx = new AudioContext()
    }

    const canvasCtx = canvas.getContext('2d')
    const source = audioCtx.createMediaStreamSource(s)

    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    signalBuffer = Array.from({ length: DELAY_FRAMES }, () =>
      Array.from({ length: bufferLength }, () => 0)
    )
    displayedValues = Array.from({ length: bufferLength }, () => 0)

    source.connect(analyser)

    function calculateRMS(data: Uint8Array): number {
      const squaredSum = data.reduce((sum, value) => sum + Math.pow(value / 128.0 - 1.0, 2), 0)
      return Math.sqrt(squaredSum / data.length)
    }

    function draw(): void {
      animationFrameId = requestAnimationFrame(draw)

      if (!canvas || !canvasCtx || !analyser) return

      const canvasWidth = canvas.width
      const canvasHeight = canvas.height
      const centerY = canvasHeight / 2

      analyser.getByteTimeDomainData(dataArray)

      signalBuffer[signalBufferIndex] = [...dataArray]
      signalBufferIndex = (signalBufferIndex + 1) % DELAY_FRAMES

      const delayedSignal = signalBuffer[(signalBufferIndex + 1) % DELAY_FRAMES]

      for (let i = 0; i < delayedSignal.length; i++) {
        const targetValue = (delayedSignal[i] / 128.0 - 1.0) * 3
        if (Math.abs(targetValue) > Math.abs(displayedValues[i])) {
          displayedValues[i] += (targetValue - displayedValues[i]) * EASING_FACTOR
        } else {
          displayedValues[i] *= 1 - DECAY_RATE
        }
        displayedValues[i] = Math.min(Math.max(displayedValues[i], -1), 1)
      }

      canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight)
      canvasCtx.fillStyle = 'transparent'
      canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight)

      canvasCtx.lineWidth = 2
      canvasCtx.strokeStyle = 'rgb(0, 0, 0)'
      canvasCtx.beginPath()

      const sliceWidth = canvasWidth / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const y = centerY + displayedValues[i] * (centerY * HEIGHT_SCALE * 1.5)

        if (i === 0) {
          canvasCtx.moveTo(x, y)
        } else {
          canvasCtx.lineTo(x, y)
        }
        x += sliceWidth
      }

      canvasCtx.lineTo(canvasWidth, centerY)
      canvasCtx.stroke()

      const rms = calculateRMS(dataArray)

      smoothedRMS = 0.8 * smoothedRMS + 0.2 * rms

      buffer.push(smoothedRMS)
      if (buffer.length > BUFFER_SIZE) {
        buffer.shift()
      }

      const activeCount = buffer.filter((value) => value > ACTIVE_THRESHOLD).length
      const activePercentage = activeCount / buffer.length

      visualizerIsActive = activePercentage >= ACTIVATION_PERCENTAGE
    }

    draw()
  }

  onMount(() => {
    if (stream) {
      visualize(stream)
    }
  })

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }
    if (audioCtx) {
      audioCtx.close()
    }
    audioCtx = null
    analyser = null
  })
</script>

<canvas class={className} bind:this={canvas}></canvas>

<style>
  canvas {
    margin-inline-end: initial !important;
    margin-inline-start: initial !important;
  }
</style>
