import { describe, expect, it } from 'vitest'
import { bodyToFrame, chunkMlsFrame, MlsAssembler } from './mlsWire'

describe('MLS wire chunking', () => {
  it('round-trips a large frame through chunks', () => {
    const body = new Uint8Array(20_000)
    for (let i = 0; i < body.length; i += 1) body[i] = i % 256
    const frame = bodyToFrame('welcome', 'alice', body, { to: 'bob' })
    const chunks = chunkMlsFrame(frame, 8000)
    expect(chunks.length).toBeGreaterThan(1)
    const assembler = new MlsAssembler()
    const assembled = chunks.map((chunk) => assembler.push(chunk)).find(Boolean)
    expect(assembled?.kind).toBe('welcome')
    expect(assembled?.from).toBe('alice')
    expect(assembled?.to).toBe('bob')
    expect(assembled?.body).toBe(frame.body)
  })
})
