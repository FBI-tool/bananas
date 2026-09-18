export type NetworkState = 'excellent' | 'good' | 'constrained' | 'poor' | 'critical'
export type CpuState = 'normal' | 'constrained' | 'critical'

export type ScreenProfileId = 'ultra' | 'high' | 'medium' | 'low' | 'survival'
export type CameraProfileId = 'high' | 'medium' | 'low' | 'survival' | 'suspended'
export type AudioProfileId = 'protected'

export type DegradationPreference = 'maintain-framerate' | 'maintain-resolution' | 'balanced'

export type ScreenProfile = {
  id: ScreenProfileId
  maxHeight: number | null
  maxFramerate: number
  maxBitrate: number
  degradationPreference: DegradationPreference
}

export type CameraProfile = {
  id: CameraProfileId
  maxHeight: number | null
  maxFramerate: number
  maxBitrate: number
  active: boolean
  degradationPreference: DegradationPreference
}

export type AudioProfile = {
  id: AudioProfileId
  maxBitrate: number
  priority: 'high'
}

export type CpuCeiling = {
  maxScreen: ScreenProfileId
  maxCamera: CameraProfileId
}

export type AdaptivePolicy = {
  sampleIntervalMs: number
  ewmaAlpha: number
  rttBaselineAlpha: number
  downgradeConsecutive: number
  upgradeHoldMs: number
  upgradeCooldownMs: number
  emergencyLoss: number
  emergencyRttMs: number
  emergencyEncodeMs: number
  lossExcellent: number
  lossGood: number
  lossConstrained: number
  lossPoor: number
  rttExcellentMs: number
  rttGoodMs: number
  rttConstrainedMs: number
  rttPoorMs: number
  rttRiseConstrained: number
  rttRisePoor: number
  availRatioConstrained: number
  availRatioPoor: number
  availRatioCritical: number
  retransmitConstrained: number
  retransmitPoor: number
  nackBurstConstrained: number
  pliBurstConstrained: number
  encodeConstrainedMs: number
  encodeCriticalMs: number
  fpsRatioConstrained: number
  droppedFrameRatioConstrained: number
  controlHeadroomBps: number
  historyLimit: number
}

export const DEFAULT_ADAPTIVE_POLICY: AdaptivePolicy = {
  sampleIntervalMs: 1000,
  ewmaAlpha: 0.3,
  rttBaselineAlpha: 0.05,
  downgradeConsecutive: 3,
  upgradeHoldMs: 10_000,
  upgradeCooldownMs: 8000,
  emergencyLoss: 0.15,
  emergencyRttMs: 800,
  emergencyEncodeMs: 80,
  lossExcellent: 0.01,
  lossGood: 0.03,
  lossConstrained: 0.06,
  lossPoor: 0.1,
  rttExcellentMs: 80,
  rttGoodMs: 150,
  rttConstrainedMs: 250,
  rttPoorMs: 400,
  rttRiseConstrained: 1.8,
  rttRisePoor: 2.5,
  availRatioConstrained: 0.75,
  availRatioPoor: 0.45,
  availRatioCritical: 0.25,
  retransmitConstrained: 0.03,
  retransmitPoor: 0.08,
  nackBurstConstrained: 8,
  pliBurstConstrained: 2,
  encodeConstrainedMs: 25,
  encodeCriticalMs: 50,
  fpsRatioConstrained: 0.6,
  droppedFrameRatioConstrained: 0.1,
  controlHeadroomBps: 100_000,
  historyLimit: 32,
}

export type LinkHealth = {
  network: NetworkState
  cpu: CpuState
  rttMs?: number
  packetLoss?: number
  availableOutgoingBitrate?: number
  retransmitRate?: number
  speaking: boolean
  remoteControlActive: boolean
}

export type AdaptiveDecision = {
  screenProfile: ScreenProfile
  cameraProfile: CameraProfile
  audioProfile: AudioProfile
  reason: string[]
}

export type AdaptiveTickContext = {
  screenActive: boolean
  cameraIntent: boolean
  microphoneActive: boolean
  speaking: boolean
  remoteControlActive: boolean
  cpuCeiling: CpuCeiling
}

export type AdaptiveLogger = {
  info: (message: string, detail?: unknown) => void
  warn: (message: string, detail?: unknown) => void
}

export const NETWORK_RANK: Record<NetworkState, number> = {
  excellent: 0,
  good: 1,
  constrained: 2,
  poor: 3,
  critical: 4,
}

export const NETWORK_BY_RANK: NetworkState[] = [
  'excellent',
  'good',
  'constrained',
  'poor',
  'critical',
]

export const CPU_RANK: Record<CpuState, number> = {
  normal: 0,
  constrained: 1,
  critical: 2,
}

export const CPU_BY_RANK: CpuState[] = ['normal', 'constrained', 'critical']

export const UNLIMITED_CPU_CEILING: CpuCeiling = {
  maxScreen: 'ultra',
  maxCamera: 'high',
}
