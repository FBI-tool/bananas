import type { AdaptivePolicy, CpuCeiling, CpuState } from './types'
import { CPU_BY_RANK, CPU_RANK, DEFAULT_ADAPTIVE_POLICY } from './types'

export type CpuGuardState = {
  pressure: CpuState
  ceiling: CpuCeiling
  worse: number
  goodSince: number | null
  lastUpgradeAt: number | null
}

export const ceilingForPressure = (pressure: CpuState): CpuCeiling => {
  if (pressure === 'critical') return { maxScreen: 'low', maxCamera: 'suspended' }
  if (pressure === 'constrained') return { maxScreen: 'high', maxCamera: 'medium' }
  return { maxScreen: 'ultra', maxCamera: 'high' }
}

export const aggregateCpuPressure = (samples: CpuState[]): CpuState => {
  if (samples.some((sample) => sample === 'critical')) return 'critical'
  if (samples.some((sample) => sample === 'constrained')) return 'constrained'
  return 'normal'
}

export const initialCpuGuard = (): CpuGuardState => ({
  pressure: 'normal',
  ceiling: ceilingForPressure('normal'),
  worse: 0,
  goodSince: null,
  lastUpgradeAt: null,
})

export const stepCpuGuard = (
  state: CpuGuardState,
  samples: CpuState[],
  now: number,
  policy: AdaptivePolicy = DEFAULT_ADAPTIVE_POLICY,
): CpuGuardState => {
  const instant = aggregateCpuPressure(samples)
  const next: CpuGuardState = { ...state }
  const current = CPU_RANK[next.pressure]
  const target = CPU_RANK[instant]

  if (instant === 'critical' && next.pressure !== 'critical') {
    next.pressure = 'critical'
    next.worse = 0
    next.goodSince = null
    next.ceiling = ceilingForPressure(next.pressure)
    return next
  }

  if (target > current) {
    next.worse += 1
    next.goodSince = null
    if (next.worse >= policy.downgradeConsecutive) {
      next.pressure = CPU_BY_RANK[current + 1] ?? next.pressure
      next.worse = 0
    }
  } else if (target < current) {
    next.worse = 0
    if (next.goodSince === null) next.goodSince = now
    const held = now - next.goodSince >= policy.upgradeHoldMs
    const cooled =
      next.lastUpgradeAt === null || now - next.lastUpgradeAt >= policy.upgradeCooldownMs
    if (held && cooled) {
      next.pressure = CPU_BY_RANK[current - 1] ?? next.pressure
      next.lastUpgradeAt = now
      next.goodSince = now
    }
  } else {
    next.worse = 0
    next.goodSince = null
  }

  next.ceiling = ceilingForPressure(next.pressure)
  return next
}
