import { describe, expect, it } from 'vitest'
import { DEFAULT_SPEECH_POLICY, initialSpeechLevel, updateSpeechLevel } from './speechActivity'

describe('speech activity', () => {
  it('requires a short attack before speaking and a longer hangover before silence', () => {
    const policy = { ...DEFAULT_SPEECH_POLICY, smoothing: 1 }
    let state = initialSpeechLevel()
    state = updateSpeechLevel(state, 0.4, 0, policy)
    expect(state.speaking).toBe(false)
    state = updateSpeechLevel(state, 0.4, policy.attackMs, policy)
    expect(state.speaking).toBe(true)
    state = updateSpeechLevel(state, 0, policy.attackMs + 200, policy)
    expect(state.speaking).toBe(true)
    state = updateSpeechLevel(state, 0, policy.attackMs + 200 + policy.releaseMs, policy)
    expect(state.speaking).toBe(false)
  })
})
