import { isSframePayload, sframeDecrypt, sframeEncrypt } from './sframe'

type EncodedFrameLike = object

const frameTypeOf = (frame: EncodedFrameLike): 'key' | 'delta' | undefined => {
  if (!('type' in frame)) return undefined
  const type = (frame as { type?: unknown }).type
  return type === 'key' || type === 'delta' ? type : undefined
}

const VP8_KEY_HEADER = 10
const VP8_DELTA_HEADER = 3
const H264_SLICE_NON_IDR = 1
const H264_SLICE_IDR = 5

export const isEncodedVideoFrame = (frame: EncodedFrameLike): boolean =>
  frameTypeOf(frame) !== undefined

const looksLikeH264 = (data: Uint8Array): boolean =>
  (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) ||
  (data.length >= 3 && data[0] === 0 && data[1] === 0 && data[2] === 1)

const naluIndices = (data: Uint8Array): number[] => {
  const indices: number[] = []
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue
    if (data[i + 2] === 1) {
      indices.push(i + 3)
      i += 2
      continue
    }
    if (data[i + 2] === 0 && data[i + 3] === 1) {
      indices.push(i + 4)
      i += 3
    }
  }
  return indices
}

const h264UnencryptedBytes = (data: Uint8Array): number | null => {
  if (!looksLikeH264(data)) return null
  for (const index of naluIndices(data)) {
    const type = data[index] & 0x1f
    if (type === H264_SLICE_IDR || type === H264_SLICE_NON_IDR) {
      return Math.min(index + 2, data.length)
    }
  }
  return null
}

export const unencryptedMediaBytes = (frame: EncodedFrameLike, data: Uint8Array): number => {
  if (!isEncodedVideoFrame(frame) || data.length === 0) return 0
  const h264 = h264UnencryptedBytes(data)
  if (h264 !== null) return h264
  return frameTypeOf(frame) === 'key' ? VP8_KEY_HEADER : VP8_DELTA_HEADER
}

const concatBytes = (prefix: Uint8Array, rest: Uint8Array): Uint8Array => {
  if (prefix.length === 0) return rest
  const out = new Uint8Array(prefix.length + rest.length)
  out.set(prefix)
  out.set(rest, prefix.length)
  return out
}

const headerLengthsToTry = (frame: EncodedFrameLike, data: Uint8Array): number[] => {
  const preferred = unencryptedMediaBytes(frame, data)
  const extras = isEncodedVideoFrame(frame)
    ? [preferred, VP8_KEY_HEADER, VP8_DELTA_HEADER, 1, 0]
    : [0]
  const seen = new Set<number>()
  const out: number[] = []
  for (const length of extras) {
    if (length < 0 || length > data.length) continue
    if (seen.has(length)) continue
    seen.add(length)
    out.push(length)
  }
  return out.length > 0 ? out : [0]
}

export const sealEncodedMedia = async (
  frame: EncodedFrameLike,
  data: Uint8Array,
  key: Uint8Array,
  kid: number,
  ctr: bigint,
): Promise<{ sealed: Uint8Array; headerLen: number }> => {
  const headerLen = Math.min(unencryptedMediaBytes(frame, data), data.length)
  const sealed = concatBytes(
    data.subarray(0, headerLen),
    await sframeEncrypt(data.subarray(headerLen), key, kid, ctr),
  )
  return { sealed, headerLen }
}

export const openEncodedMedia = async (
  frame: EncodedFrameLike,
  data: Uint8Array,
  resolveKey: (kid: number) => Uint8Array | undefined,
): Promise<{ opened: Uint8Array; headerLen: number }> => {
  for (const headerLen of headerLengthsToTry(frame, data)) {
    const rest = data.subarray(headerLen)
    if (!isSframePayload(rest)) continue
    try {
      const opened = concatBytes(data.subarray(0, headerLen), await sframeDecrypt(rest, resolveKey))
      return { opened, headerLen }
    } catch {
      continue
    }
  }
  throw new Error('encoded media is not sframe')
}
