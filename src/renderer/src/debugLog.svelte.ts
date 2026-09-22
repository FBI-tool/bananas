import { redactText, redactUnknown } from './crypto/redact'

export type DebugLogLevel = 'info' | 'warn' | 'error'

export type DebugLogEntry = {
  id: number
  at: number
  level: DebugLogLevel
  scope: string
  message: string
  detail?: string
}

const MAX_ENTRIES = 500

const formatDetail = (detail: unknown): string => {
  if (typeof detail === 'string') return detail
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ''}`
  }
  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    return String(detail)
  }
}

class DebugLog {
  enabled = $state(false)
  entries = $state<DebugLogEntry[]>([])
  private nextId = 1
  private lastSample = new Map<string, number>()

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.lastSample.clear()
  }

  log(level: DebugLogLevel, scope: string, message: string, detail?: unknown): void {
    if (!this.enabled) return
    const safeDetail = detail === undefined ? undefined : redactUnknown(detail)
    const entry: DebugLogEntry = {
      id: this.nextId,
      at: Date.now(),
      level,
      scope,
      message: redactText(message),
      detail: safeDetail === undefined ? undefined : formatDetail(safeDetail),
    }
    this.nextId += 1
    const next = [...this.entries, entry]
    this.entries = next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
    const line = `[${scope}] ${entry.message}`
    if (level === 'error') console.error(line, safeDetail ?? '')
    else if (level === 'warn') console.warn(line, safeDetail ?? '')
    else console.log(line, safeDetail ?? '')
  }

  info(scope: string, message: string, detail?: unknown): void {
    this.log('info', scope, message, detail)
  }

  warn(scope: string, message: string, detail?: unknown): void {
    this.log('warn', scope, message, detail)
  }

  error(scope: string, message: string, detail?: unknown): void {
    this.log('error', scope, message, detail)
  }

  /** High-frequency events (pointer moves) - at most one line per key each intervalMs. */
  sample(scope: string, message: string, detail?: unknown, intervalMs = 200): void {
    if (!this.enabled) return
    const key = `${scope}:${message}`
    const now = Date.now()
    if (now - (this.lastSample.get(key) ?? 0) < intervalMs) return
    this.lastSample.set(key, now)
    this.info(scope, message, detail)
  }

  clear(): void {
    this.entries = []
    this.lastSample.clear()
  }

  toText(): string {
    return this.entries
      .map((entry) => {
        const time = new Date(entry.at).toISOString()
        const detail = entry.detail ? `\n${entry.detail}` : ''
        return `${time} [${entry.level}] [${entry.scope}] ${entry.message}${detail}`
      })
      .join('\n\n')
  }
}

export const debugLog = new DebugLog()

export const summarizeSdp = (desc: RTCSessionDescriptionInit | null | undefined): string => {
  if (!desc) return 'none'
  const sdp = desc.sdp ?? ''
  const mLines = sdp.split(/\r?\n/).filter((line) => line.startsWith('m='))
  const candidates = sdp.split(/\r?\n/).filter((line) => line.startsWith('a=candidate:'))
  const udp = candidates.filter((line) => /\sudp\s/i.test(line)).length
  const tcp = candidates.filter((line) => /\stcp\s/i.test(line)).length
  const mdns = candidates.filter((line) => line.includes('.local')).length
  return `type=${desc.type ?? 'unknown'} m-lines=${mLines.join(' | ') || 'none'} candidates=${candidates.length} (udp=${udp} tcp=${tcp} mdns=${mdns}) sdpChars=${sdp.length}`
}

export const summarizePc = (pc: RTCPeerConnection): string =>
  `signaling=${pc.signalingState} iceGathering=${pc.iceGatheringState} iceConnection=${pc.iceConnectionState} connection=${pc.connectionState} senders=${pc.getSenders().length}`
