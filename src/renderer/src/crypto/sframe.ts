import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { asBufferSource } from './constants'

const KEY_LEN = 16
const NONCE_LEN = 12
const TAG_LEN = 16

const encodeHeader = (kid: number, ctr: bigint): Uint8Array => {
  const header = new Uint8Array(10)
  header[0] = (1 << 4) | 7
  header[1] = kid & 0xff
  const view = new DataView(header.buffer)
  view.setBigUint64(2, ctr, false)
  return header
}

const parseHeader = (buf: Uint8Array): { kid: number; ctr: bigint; headerLen: number } => {
  if (buf.length < 10) throw new Error('sframe header is truncated')
  const kidLen = (buf[0] >> 4) & 0x0f
  const ctrLen = (buf[0] & 0x07) + 1
  if (kidLen !== 1 || ctrLen !== 8) throw new Error('unsupported sframe header')
  const kid = buf[1]
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const ctr = view.getBigUint64(2, false)
  return { kid, ctr, headerLen: 10 }
}

const derive = (baseKey: Uint8Array): { key: Uint8Array; salt: Uint8Array } => {
  const secret = hkdf(
    sha256,
    baseKey,
    new Uint8Array(32),
    new TextEncoder().encode('SFrame 1.0 Secret'),
    KEY_LEN + NONCE_LEN,
  )
  return { key: secret.slice(0, KEY_LEN), salt: secret.slice(KEY_LEN) }
}

const nonceFor = (salt: Uint8Array, ctr: bigint): Uint8Array => {
  const nonce = new Uint8Array(NONCE_LEN)
  nonce.set(salt.subarray(0, NONCE_LEN))
  const ctrBytes = new Uint8Array(8)
  new DataView(ctrBytes.buffer).setBigUint64(0, ctr, false)
  for (let i = 0; i < 8; i += 1) nonce[NONCE_LEN - 8 + i] ^= ctrBytes[i]
  return nonce
}

export const sframeEncrypt = async (
  plaintext: Uint8Array,
  baseKey: Uint8Array,
  kid: number,
  ctr: bigint,
): Promise<Uint8Array> => {
  const { key, salt } = derive(baseKey)
  const header = encodeHeader(kid, ctr)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: asBufferSource(nonceFor(salt, ctr)),
        additionalData: asBufferSource(header),
        tagLength: TAG_LEN * 8,
      },
      cryptoKey,
      asBufferSource(plaintext),
    ),
  )
  const out = new Uint8Array(header.length + ct.length)
  out.set(header)
  out.set(ct, header.length)
  return out
}

export const sframeDecrypt = async (
  buf: Uint8Array,
  resolveKey: (kid: number) => Uint8Array | undefined,
): Promise<Uint8Array> => {
  const { kid, ctr, headerLen } = parseHeader(buf)
  const baseKey = resolveKey(kid)
  if (!baseKey) throw new Error('unknown sframe kid')
  const header = buf.subarray(0, headerLen)
  const { key, salt } = derive(baseKey)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(nonceFor(salt, ctr)),
      additionalData: asBufferSource(header),
      tagLength: TAG_LEN * 8,
    },
    cryptoKey,
    asBufferSource(buf.subarray(headerLen)),
  )
  return new Uint8Array(pt)
}

export const SFRAME_HEADER0 = 0x17

export const isSframePayload = (data: Uint8Array): boolean =>
  data.length >= 10 && data[0] === SFRAME_HEADER0

export const supportsEncodedTransform = (): boolean =>
  typeof RTCRtpScriptTransform === 'function' ||
  typeof (RTCRtpSender.prototype as { createEncodedStreams?: unknown }).createEncodedStreams ===
    'function'

type KeyframeSender = RTCRtpSender & {
  generateKeyFrame?: (rids?: string[]) => Promise<void>
}

type KeyframeReceiver = RTCRtpReceiver & {
  requestKeyFrame?: () => void
}

export const requestVideoKeyFrame = (target: RTCRtpSender | RTCRtpReceiver): void => {
  const generate = (target as KeyframeSender).generateKeyFrame
  if (typeof generate === 'function') {
    void generate.call(target).catch((error) => {
      console.warn('generateKeyFrame failed', error)
    })
    return
  }
  const request = (target as KeyframeReceiver).requestKeyFrame
  if (typeof request === 'function') request.call(target)
}

const KEYFRAME_RETRY_MS = [50, 250, 1000] as const

export const scheduleVideoKeyFrame = (target: RTCRtpSender | RTCRtpReceiver): void => {
  requestVideoKeyFrame(target)
  for (const delay of KEYFRAME_RETRY_MS) {
    globalThis.setTimeout(() => requestVideoKeyFrame(target), delay)
  }
}

export const encodedFrameBytes = (data: BufferSource): Uint8Array => {
  const view =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return asBufferSource(view)
}

export const assignEncodedFrameData = (frame: { data: BufferSource }, bytes: Uint8Array): void => {
  const copy = asBufferSource(bytes)
  frame.data = copy.buffer
}
