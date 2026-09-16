import { describe, expect, it, vi } from 'vitest'
import {
  assignEncodedFrameData,
  encodedFrameBytes,
  isSframePayload,
  requestVideoKeyFrame,
  scheduleVideoKeyFrame,
  sframeDecrypt,
  sframeEncrypt,
} from './sframe'

describe('SFrame RFC 9605', () => {
  it('round-trips a frame and rejects a tampered ciphertext', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const plain = new TextEncoder().encode('frame-bytes')
    const sealed = await sframeEncrypt(plain, key, 3, 9n)
    expect(sealed.slice(10)).not.toEqual(plain)
    const opened = await sframeDecrypt(sealed, (kid) => (kid === 3 ? key : undefined))
    expect(opened).toEqual(plain)
    const tampered = sealed.slice()
    tampered[tampered.length - 1] ^= 0xff
    await expect(sframeDecrypt(tampered, () => key)).rejects.toThrow()
  })

  it('does not decrypt with the wrong key id', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const sealed = await sframeEncrypt(new Uint8Array([1, 2, 3]), key, 1, 1n)
    await expect(sframeDecrypt(sealed, () => undefined)).rejects.toThrow(/unknown/)
  })

  it('detects sframe payloads', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const sealed = await sframeEncrypt(new Uint8Array([1, 2, 3]), key, 1, 1n)
    expect(isSframePayload(sealed)).toBe(true)
    expect(isSframePayload(new Uint8Array([1, 2, 3]))).toBe(false)
  })

  it('copies encoded frame bytes without sharing the backing buffer', () => {
    const raw = new Uint8Array([9, 8, 7, 6, 5])
    const view = raw.subarray(1, 4)
    const copied = encodedFrameBytes(view)
    expect([...copied]).toEqual([8, 7, 6])
    const frame = { data: new ArrayBuffer(0) }
    assignEncodedFrameData(frame, view)
    expect(frame.data).toBeInstanceOf(ArrayBuffer)
    expect(frame.data.byteLength).toBe(3)
  })

  it('requests a video keyframe from sender or receiver', () => {
    const generateKeyFrame = vi.fn(async () => undefined)
    requestVideoKeyFrame({ generateKeyFrame } as unknown as RTCRtpSender)
    expect(generateKeyFrame).toHaveBeenCalledOnce()
    const requestKeyFrame = vi.fn()
    requestVideoKeyFrame({ requestKeyFrame } as unknown as RTCRtpReceiver)
    expect(requestKeyFrame).toHaveBeenCalledOnce()
  })

  it('retries video keyframes after the first request', () => {
    vi.useFakeTimers()
    try {
      const generateKeyFrame = vi.fn(async () => undefined)
      scheduleVideoKeyFrame({ generateKeyFrame } as unknown as RTCRtpSender)
      expect(generateKeyFrame).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1000)
      expect(generateKeyFrame).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
