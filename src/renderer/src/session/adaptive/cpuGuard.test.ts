import { describe, expect, it } from 'vitest'
import { DEFAULT_ADAPTIVE_POLICY } from './types'
import { ceilingForPressure, initialCpuGuard, stepCpuGuard } from './cpuGuard'

describe('cpu guard', () => {
  it('can constrain every peer profile through a shared ceiling', () => {
    let state = initialCpuGuard()
    expect(state.ceiling).toEqual(ceilingForPressure('normal'))
    state = stepCpuGuard(state, ['constrained'], 0, DEFAULT_ADAPTIVE_POLICY)
    state = stepCpuGuard(state, ['constrained'], 1000, DEFAULT_ADAPTIVE_POLICY)
    state = stepCpuGuard(state, ['constrained'], 2000, DEFAULT_ADAPTIVE_POLICY)
    expect(state.pressure).toBe('constrained')
    expect(state.ceiling.maxCamera).toBe('medium')
    expect(state.ceiling.maxScreen).toBe('high')
    state = stepCpuGuard(state, ['critical'], 3000, DEFAULT_ADAPTIVE_POLICY)
    expect(state.pressure).toBe('critical')
    expect(state.ceiling.maxCamera).toBe('suspended')
    expect(state.ceiling.maxScreen).toBe('low')
  })

  it('lifts the ceiling slowly after recovery', () => {
    let state = stepCpuGuard(initialCpuGuard(), ['critical'], 0, DEFAULT_ADAPTIVE_POLICY)
    state = stepCpuGuard(state, ['normal'], 1000, DEFAULT_ADAPTIVE_POLICY)
    expect(state.pressure).toBe('critical')
    state = stepCpuGuard(
      state,
      ['normal'],
      1000 + DEFAULT_ADAPTIVE_POLICY.upgradeHoldMs,
      DEFAULT_ADAPTIVE_POLICY,
    )
    expect(state.pressure).toBe('constrained')
  })
})
