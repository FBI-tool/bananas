import { describe, expect, it } from 'vitest'
import {
  isEncodedVideoFrame,
  openEncodedMedia,
  sealEncodedMedia,
  unencryptedMediaBytes,
} from './encodedMedia'

describe('encoded media sframe wrapping', () => {
  it('leaves vp8 keyframe descriptor bytes in the clear', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const payload = new Uint8Array(32)
    payload.set([0x90, 0xe0, 0x01, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 0)
    payload.set([7, 8, 9, 10, 11, 12], 10)
    const frame = { type: 'key' }
    expect(isEncodedVideoFrame(frame)).toBe(true)
    expect(unencryptedMediaBytes(frame, payload)).toBe(10)
    const { sealed, headerLen } = await sealEncodedMedia(frame, payload, key, 1, 4n)
    expect(headerLen).toBe(10)
    expect(sealed.subarray(0, 10)).toEqual(payload.subarray(0, 10))
    expect(sealed[10]).toBe(0x17)
    const { opened } = await openEncodedMedia(frame, sealed, () => key)
    expect(opened).toEqual(payload)
  })

  it('encrypts audio frames in full', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const payload = new Uint8Array([0x78, 1, 2, 3, 4, 5])
    const frame = {}
    expect(unencryptedMediaBytes(frame, payload)).toBe(0)
    const { sealed, headerLen } = await sealEncodedMedia(frame, payload, key, 2, 1n)
    expect(headerLen).toBe(0)
    expect(sealed[0]).toBe(0x17)
    const { opened } = await openEncodedMedia(frame, sealed, () => key)
    expect(opened).toEqual(payload)
  })

  it('leaves h264 prefix through the first slice in the clear', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const payload = new Uint8Array([0, 0, 0, 1, 0x67, 0xaa, 0, 0, 0, 1, 0x65, 0x88, 9, 8, 7])
    const frame = { type: 'key' }
    const headerLen = unencryptedMediaBytes(frame, payload)
    expect(headerLen).toBeGreaterThan(10)
    const { sealed } = await sealEncodedMedia(frame, payload, key, 1, 1n)
    expect(sealed.subarray(0, headerLen)).toEqual(payload.subarray(0, headerLen))
    const { opened } = await openEncodedMedia(frame, sealed, () => key)
    expect(opened).toEqual(payload)
  })
})
