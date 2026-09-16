export type ReplayKey = string

const MAX_ENTRIES = 2048

export class ReplayCache {
  private seen = new Map<ReplayKey, number>()

  remember(key: ReplayKey): boolean {
    if (this.seen.has(key)) return false
    this.seen.set(key, Date.now())
    if (this.seen.size > MAX_ENTRIES) {
      const first = this.seen.keys().next().value
      if (first !== undefined) this.seen.delete(first)
    }
    return true
  }

  clear(): void {
    this.seen.clear()
  }
}

export const controlReplayKey = (input: {
  epoch: number
  sender: string
  opId: string
  roomId: string
}): ReplayKey => `${input.roomId}:${input.epoch}:${input.sender}:${input.opId}`
