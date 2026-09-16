import { isSframePayload, sframeDecrypt, sframeEncrypt, supportsEncodedTransform } from './sframe'
import { asBufferSource } from './constants'
import type { RoomCrypto } from './roomCrypto'
import type { MediaStreamIdentity } from './roomCrypto'

type Attached = {
  identity: MediaStreamIdentity
  kid: number
  keys: Map<number, Uint8Array>
}

type EncodedFrame = RTCEncodedVideoFrame | RTCEncodedAudioFrame

type EncodedStreams = {
  readable: ReadableStream<EncodedFrame>
  writable: WritableStream<EncodedFrame>
}

const encodedStreamsOf = (target: RTCRtpSender | RTCRtpReceiver): EncodedStreams | null => {
  const create = (target as { createEncodedStreams?: () => EncodedStreams }).createEncodedStreams
  if (typeof create !== 'function') return null
  return create.call(target)
}

export class MediaE2EE {
  private senders = new Map<RTCRtpSender, Attached>()
  private receivers = new Map<RTCRtpReceiver, Attached>()
  private workers = new Map<RTCRtpSender | RTCRtpReceiver, Worker>()
  private piped = new WeakSet<RTCRtpSender | RTCRtpReceiver>()
  private epoch = 0

  constructor(private readonly crypto: RoomCrypto) {}

  supported(): boolean {
    return supportsEncodedTransform()
  }

  enableTransforms(_enabled: boolean): void {
    this.epoch = this.crypto.epoch
  }

  private syncEpoch(): number {
    this.epoch = this.crypto.epoch
    return this.epoch & 0xff
  }

  async attachSender(sender: RTCRtpSender, identity: MediaStreamIdentity): Promise<void> {
    const attached = this.senders.get(sender) ?? { identity, kid: 0, keys: new Map() }
    attached.identity = identity
    this.senders.set(sender, attached)
    this.bindPipeline(sender, 'sender')
    await this.installKey(attached, sender)
  }

  async attachReceiver(receiver: RTCRtpReceiver, identity: MediaStreamIdentity): Promise<void> {
    const attached = this.receivers.get(receiver) ?? { identity, kid: 0, keys: new Map() }
    attached.identity = identity
    this.receivers.set(receiver, attached)
    this.bindPipeline(receiver, 'receiver')
    await this.installKey(attached, receiver)
  }

  private async installKey(
    attached: Attached,
    target: RTCRtpSender | RTCRtpReceiver,
  ): Promise<void> {
    if (!this.crypto.isReady() || !this.crypto.hasRemoteMembers()) return
    const key = await this.crypto.exportMediaKey(attached.identity)
    const kid = this.syncEpoch()
    attached.kid = kid
    attached.keys.set(kid, key)
    this.workers.get(target)?.postMessage({ type: 'key', kid, key: asBufferSource(key) })
  }

  private attachedOf(target: RTCRtpSender | RTCRtpReceiver): Attached | undefined {
    return this.senders.get(target as RTCRtpSender) ?? this.receivers.get(target as RTCRtpReceiver)
  }

  private bindPipeline(target: RTCRtpSender | RTCRtpReceiver, role: 'sender' | 'receiver'): void {
    if (this.piped.has(target) || this.workers.has(target)) return
    try {
      const streams = encodedStreamsOf(target)
      if (streams) {
        this.piped.add(target)
        this.pipeEncoded(streams, role, target)
        return
      }
    } catch (error) {
      console.warn('media e2ee createEncodedStreams failed', error)
    }
    if (typeof RTCRtpScriptTransform !== 'function') {
      throw new Error('media e2ee transform is unavailable')
    }
    const worker = new Worker(new URL('./sframeWorker.ts', import.meta.url), { type: 'module' })
    this.workers.set(target, worker)
    const attached = this.attachedOf(target)
    if (attached) {
      for (const [kid, key] of attached.keys) {
        worker.postMessage({ type: 'key', kid, key: asBufferSource(key) })
      }
    }
    try {
      target.transform = new RTCRtpScriptTransform(worker, { role, kid: this.epoch & 0xff })
    } catch (error) {
      worker.terminate()
      this.workers.delete(target)
      throw error
    }
  }

  private pipeEncoded(
    streams: EncodedStreams,
    role: 'sender' | 'receiver',
    target: RTCRtpSender | RTCRtpReceiver,
  ): void {
    const counters = new Map<number, bigint>()
    const transform = new TransformStream<EncodedFrame, EncodedFrame>({
      transform: async (frame, controller) => {
        const attached = this.attachedOf(target)
        if (!attached) return
        const data = new Uint8Array(frame.data)
        if (role === 'sender') {
          const kid = this.epoch & 0xff
          const key = attached.keys.get(kid)
          if (!key) return
          const ctr = (counters.get(kid) ?? 0n) + 1n
          counters.set(kid, ctr)
          const sealed = await sframeEncrypt(data, key, kid, ctr)
          frame.data = asBufferSource(sealed).buffer
          controller.enqueue(frame)
          return
        }
        if (!isSframePayload(data)) return
        try {
          const opened = await sframeDecrypt(data, (kid) => attached.keys.get(kid))
          frame.data = asBufferSource(opened).buffer
          controller.enqueue(frame)
        } catch {
          return
        }
      },
    })
    void streams.readable.pipeThrough(transform).pipeTo(streams.writable)
  }

  async rotateEpoch(epoch: number): Promise<void> {
    this.epoch = epoch
    const push = async (
      attached: Attached,
      target: RTCRtpSender | RTCRtpReceiver,
    ): Promise<void> => {
      await this.installKey(attached, target)
    }
    for (const [sender, attached] of this.senders) await push(attached, sender)
    for (const [receiver, attached] of this.receivers) await push(attached, receiver)
  }

  resolveKey(kid: number): Uint8Array | undefined {
    for (const attached of [...this.senders.values(), ...this.receivers.values()]) {
      const key = attached.keys.get(kid)
      if (key) return key
    }
    return undefined
  }

  async encryptFrame(data: Uint8Array, kid: number, ctr: bigint): Promise<Uint8Array> {
    const key = this.resolveKey(kid)
    if (!key) throw new Error('missing media key')
    return sframeEncrypt(data, key, kid, ctr)
  }

  async decryptFrame(data: Uint8Array): Promise<Uint8Array> {
    return sframeDecrypt(data, (kid) => this.resolveKey(kid))
  }

  detach(): void {
    for (const worker of this.workers.values()) worker.terminate()
    this.workers.clear()
    this.senders.clear()
    this.receivers.clear()
  }
}
