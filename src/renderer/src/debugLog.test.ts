import { describe, expect, it } from 'vitest'
import { debugLog } from './debugLog.svelte'

describe('debugLog.sample', () => {
  it('records the first sample and ignores the rest until the interval elapses', () => {
    debugLog.setEnabled(true)
    debugLog.clear()
    debugLog.sample('remote-input', 'pointer move', { seq: 1 }, 10_000)
    debugLog.sample('remote-input', 'pointer move', { seq: 2 }, 10_000)
    const moves = debugLog.entries.filter((entry) => entry.message === 'pointer move')
    expect(moves).toHaveLength(1)
    debugLog.setEnabled(false)
    debugLog.clear()
  })
})
