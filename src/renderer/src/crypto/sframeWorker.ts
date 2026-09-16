import { assignEncodedFrameData, encodedFrameBytes } from './sframe'
import { openEncodedMedia, sealEncodedMedia } from './encodedMedia'

const keys = new Map<number, Uint8Array>()
const counters = new Map<number, bigint>()
let activeKid = 0
let logged = 0

type ScriptTransformer = {
  readable: ReadableStream
  writable: WritableStream
  options: { role: 'sender' | 'receiver'; kid: number }
}

const asBytes = (value: ArrayBuffer | Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value)

const report = (message: string, detail: Record<string, unknown>): void => {
  if (logged >= 4) return
  logged += 1
  self.postMessage({ type: 'media-e2ee', message, detail })
}

self.addEventListener('rtctransform', (event: Event) => {
  const transformer = (event as unknown as { transformer: ScriptTransformer }).transformer
  const options = transformer.options as { role: 'sender' | 'receiver'; kid: number }
  if (options.kid !== undefined) activeKid = options.kid
  const transform = new TransformStream({
    async transform(frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame, controller) {
      const data = encodedFrameBytes(frame.data)
      if (options.role === 'sender') {
        const kid = activeKid
        const key = keys.get(kid)
        if (!key) return
        const ctr = (counters.get(kid) ?? 0n) + 1n
        counters.set(kid, ctr)
        const { sealed, headerLen } = await sealEncodedMedia(frame, data, key, kid, ctr)
        report('sframe encrypt', {
          type: 'type' in frame ? frame.type : 'audio',
          headerLen,
          inBytes: data.length,
          outBytes: sealed.length,
          kid,
        })
        assignEncodedFrameData(frame, sealed)
      } else {
        try {
          const { opened, headerLen } = await openEncodedMedia(frame, data, (kid) => keys.get(kid))
          report('sframe decrypt', {
            type: 'type' in frame ? frame.type : 'audio',
            headerLen,
            inBytes: data.length,
            outBytes: opened.length,
          })
          assignEncodedFrameData(frame, opened)
        } catch {
          report('sframe decrypt dropped', {
            type: 'type' in frame ? frame.type : 'audio',
            inBytes: data.length,
            first: data[0],
          })
          return
        }
      }
      controller.enqueue(frame)
    },
  })
  transformer.readable
    .pipeThrough(transform)
    .pipeTo(transformer.writable)
    .catch(() => undefined)
})

self.addEventListener(
  'message',
  (event: MessageEvent<{ type: string; kid: number; key: ArrayBuffer | Uint8Array }>) => {
    if (event.data?.type !== 'key') return
    keys.set(event.data.kid, asBytes(event.data.key))
    activeKid = event.data.kid
  },
)
