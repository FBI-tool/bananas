import { isSframePayload, sframeDecrypt, sframeEncrypt } from './sframe'
import { asBufferSource } from './constants'

const keys = new Map<number, Uint8Array>()
const counters = new Map<number, bigint>()
let activeKid = 0

type ScriptTransformer = {
  readable: ReadableStream
  writable: WritableStream
  options: { role: 'sender' | 'receiver'; kid: number }
}

const asBytes = (value: ArrayBuffer | Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value)

self.addEventListener('rtctransform', (event: Event) => {
  const transformer = (event as unknown as { transformer: ScriptTransformer }).transformer
  const options = transformer.options as { role: 'sender' | 'receiver'; kid: number }
  if (options.kid !== undefined) activeKid = options.kid
  const transform = new TransformStream({
    async transform(frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame, controller) {
      const data = new Uint8Array(frame.data)
      if (options.role === 'sender') {
        const kid = activeKid
        const key = keys.get(kid)
        if (!key) return
        const ctr = (counters.get(kid) ?? 0n) + 1n
        counters.set(kid, ctr)
        const sealed = await sframeEncrypt(data, key, kid, ctr)
        frame.data = asBufferSource(sealed).buffer
      } else {
        if (!isSframePayload(data)) return
        try {
          const opened = await sframeDecrypt(data, (kid) => keys.get(kid))
          frame.data = asBufferSource(opened).buffer
        } catch {
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
