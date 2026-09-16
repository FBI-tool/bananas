import { fromBase64Url, toBase64Url } from './constants'

export type MlsFrameKind = 'key-package' | 'welcome' | 'commit'

export type MlsFrame = {
  kind: MlsFrameKind
  from: string
  to?: string
  fingerprint?: string
  body: string
}

const te = new TextEncoder()
const td = new TextDecoder()

export const encodeMlsFrame = (frame: MlsFrame): Uint8Array => te.encode(JSON.stringify(frame))

export const decodeMlsFrame = (data: ArrayBuffer | Uint8Array | string): MlsFrame | null => {
  try {
    const text =
      typeof data === 'string'
        ? data
        : td.decode(data instanceof Uint8Array ? data : new Uint8Array(data))
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object') return null
    const rec = value as Record<string, unknown>
    if (rec.kind !== 'key-package' && rec.kind !== 'welcome' && rec.kind !== 'commit') return null
    if (typeof rec.from !== 'string' || typeof rec.body !== 'string') return null
    return {
      kind: rec.kind,
      from: rec.from,
      to: typeof rec.to === 'string' ? rec.to : undefined,
      fingerprint: typeof rec.fingerprint === 'string' ? rec.fingerprint : undefined,
      body: rec.body,
    }
  } catch {
    return null
  }
}

export const MLS_CHUNK_SIZE = 8000

export type MlsChunk = {
  id: string
  i: number
  n: number
  kind: MlsFrameKind
  from: string
  to?: string
  fingerprint?: string
  part: string
}

export const chunkMlsFrame = (frame: MlsFrame, chunkSize = MLS_CHUNK_SIZE): MlsChunk[] => {
  const n = Math.max(1, Math.ceil(frame.body.length / chunkSize))
  const id = `${frame.from}:${frame.kind}:${frame.body.length}:${n}`
  const chunks: MlsChunk[] = []
  for (let i = 0; i < n; i += 1) {
    chunks.push({
      id,
      i,
      n,
      kind: frame.kind,
      from: frame.from,
      to: frame.to,
      fingerprint: frame.fingerprint,
      part: frame.body.slice(i * chunkSize, (i + 1) * chunkSize),
    })
  }
  return chunks
}

export class MlsAssembler {
  private pending = new Map<string, { chunks: MlsChunk[]; n: number }>()

  push(chunk: MlsChunk): MlsFrame | null {
    if (chunk.n === 1) {
      return {
        kind: chunk.kind,
        from: chunk.from,
        to: chunk.to,
        fingerprint: chunk.fingerprint,
        body: chunk.part,
      }
    }
    const entry = this.pending.get(chunk.id) ?? { chunks: [], n: chunk.n }
    entry.chunks[chunk.i] = chunk
    this.pending.set(chunk.id, entry)
    if (entry.chunks.filter(Boolean).length < entry.n) return null
    this.pending.delete(chunk.id)
    return {
      kind: chunk.kind,
      from: chunk.from,
      to: chunk.to,
      fingerprint: chunk.fingerprint,
      body: entry.chunks.map((item) => item.part).join(''),
    }
  }
}

export const frameBodyBytes = (frame: MlsFrame): Uint8Array => fromBase64Url(frame.body)

export const bodyToFrame = (
  kind: MlsFrameKind,
  from: string,
  body: Uint8Array,
  extra?: { to?: string; fingerprint?: string },
): MlsFrame => ({
  kind,
  from,
  to: extra?.to,
  fingerprint: extra?.fingerprint,
  body: toBase64Url(body),
})
