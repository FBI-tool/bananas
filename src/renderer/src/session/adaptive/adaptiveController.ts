import {
  AUDIO_PROFILE,
  CAMERA_PROFILES,
  SCREEN_PROFILES,
  clampCameraToCeiling,
  clampScreenToCeiling,
  demoteCamera,
  demoteScreen,
  formatProfileSummary,
  getCameraProfile,
  getScreenProfile,
  requestedMediaBudgetBps,
} from './qualityProfiles'
import {
  classifyInstantCpu,
  classifyInstantNetwork,
  computeDelta,
  isCpuEmergency,
  isNetworkEmergency,
  parseStatsReport,
  updateEwma,
  type EwmaState,
  type RawStatsSnapshot,
} from './stats'
import {
  CPU_BY_RANK,
  CPU_RANK,
  DEFAULT_ADAPTIVE_POLICY,
  NETWORK_BY_RANK,
  NETWORK_RANK,
  UNLIMITED_CPU_CEILING,
  type AdaptiveDecision,
  type AdaptiveLogger,
  type AdaptivePolicy,
  type AdaptiveTickContext,
  type CpuState,
  type LinkHealth,
  type NetworkState,
} from './types'

export type HysteresisState = {
  network: NetworkState
  cpu: CpuState
  worseNetwork: number
  worseCpu: number
  networkGoodSince: number | null
  cpuGoodSince: number | null
  lastNetworkUpgradeAt: number | null
  lastCpuUpgradeAt: number | null
}

export const initialHysteresis = (): HysteresisState => ({
  network: 'good',
  cpu: 'normal',
  worseNetwork: 0,
  worseCpu: 0,
  networkGoodSince: null,
  cpuGoodSince: null,
  lastNetworkUpgradeAt: null,
  lastCpuUpgradeAt: null,
})

export const stepHysteresis = (
  state: HysteresisState,
  instantNetwork: NetworkState,
  instantCpu: CpuState,
  now: number,
  policy: AdaptivePolicy,
  emergency: { network: boolean; cpu: boolean },
): HysteresisState => {
  const next: HysteresisState = { ...state }

  if (emergency.network) {
    next.network = 'critical'
    next.worseNetwork = 0
    next.networkGoodSince = null
  } else {
    const current = NETWORK_RANK[next.network]
    const target = NETWORK_RANK[instantNetwork]
    if (target > current) {
      next.worseNetwork += 1
      next.networkGoodSince = null
      if (next.worseNetwork >= policy.downgradeConsecutive) {
        next.network = NETWORK_BY_RANK[current + 1] ?? next.network
        next.worseNetwork = 0
      }
    } else if (target < current) {
      next.worseNetwork = 0
      if (next.networkGoodSince === null) next.networkGoodSince = now
      const held = now - next.networkGoodSince >= policy.upgradeHoldMs
      const cooled =
        next.lastNetworkUpgradeAt === null ||
        now - next.lastNetworkUpgradeAt >= policy.upgradeCooldownMs
      if (held && cooled) {
        next.network = NETWORK_BY_RANK[current - 1] ?? next.network
        next.lastNetworkUpgradeAt = now
        next.networkGoodSince = now
      }
    } else {
      next.worseNetwork = 0
      next.networkGoodSince = null
    }
  }

  if (emergency.cpu) {
    next.cpu = 'critical'
    next.worseCpu = 0
    next.cpuGoodSince = null
  } else {
    const current = CPU_RANK[next.cpu]
    const target = CPU_RANK[instantCpu]
    if (target > current) {
      next.worseCpu += 1
      next.cpuGoodSince = null
      if (next.worseCpu >= policy.downgradeConsecutive) {
        next.cpu = CPU_BY_RANK[current + 1] ?? next.cpu
        next.worseCpu = 0
      }
    } else if (target < current) {
      next.worseCpu = 0
      if (next.cpuGoodSince === null) next.cpuGoodSince = now
      const held = now - next.cpuGoodSince >= policy.upgradeHoldMs
      const cooled =
        next.lastCpuUpgradeAt === null || now - next.lastCpuUpgradeAt >= policy.upgradeCooldownMs
      if (held && cooled) {
        next.cpu = CPU_BY_RANK[current - 1] ?? next.cpu
        next.lastCpuUpgradeAt = now
        next.cpuGoodSince = now
      }
    } else {
      next.worseCpu = 0
      next.cpuGoodSince = null
    }
  }

  return next
}

const SCREEN_FOR_NETWORK: Record<NetworkState, keyof typeof SCREEN_PROFILES> = {
  excellent: 'ultra',
  good: 'high',
  constrained: 'medium',
  poor: 'low',
  critical: 'survival',
}

const CAMERA_FOR_NETWORK: Record<NetworkState, keyof typeof CAMERA_PROFILES> = {
  excellent: 'high',
  good: 'medium',
  constrained: 'low',
  poor: 'survival',
  critical: 'suspended',
}

const CAMERA_NO_SCREEN: Record<NetworkState, keyof typeof CAMERA_PROFILES> = {
  excellent: 'high',
  good: 'high',
  constrained: 'medium',
  poor: 'low',
  critical: 'suspended',
}

export const allocateProfiles = (input: {
  network: NetworkState
  cpu: CpuState
  screenActive: boolean
  cameraIntent: boolean
  microphoneActive: boolean
  speaking: boolean
  remoteControlActive: boolean
  cpuCeiling?: AdaptiveTickContext['cpuCeiling']
}): AdaptiveDecision => {
  const reasons: string[] = [`network:${input.network}`, `cpu:${input.cpu}`]
  const audio = AUDIO_PROFILE
  reasons.push('audio:protected')

  let screenId = input.screenActive ? SCREEN_FOR_NETWORK[input.network] : 'survival'
  let cameraId = input.cameraIntent
    ? (input.screenActive ? CAMERA_FOR_NETWORK : CAMERA_NO_SCREEN)[input.network]
    : 'suspended'

  if (input.speaking && input.cameraIntent && cameraId !== 'suspended') {
    cameraId = demoteCamera(cameraId)
    reasons.push('speech:camera-yield')
  }
  if (input.remoteControlActive && input.cameraIntent && cameraId !== 'suspended') {
    cameraId = demoteCamera(cameraId)
    reasons.push('remote-control:camera-yield')
  }

  if (input.cpu === 'constrained') {
    if (input.cameraIntent) cameraId = demoteCamera(cameraId)
    if (input.screenActive && screenId === 'ultra') screenId = 'high'
    reasons.push('cpu:reduce-video')
  }
  if (input.cpu === 'critical') {
    if (input.cameraIntent) cameraId = 'suspended'
    if (input.screenActive) screenId = demoteScreen(screenId, screenId === 'survival' ? 0 : 1)
    if (
      input.screenActive &&
      SCREEN_PROFILES[screenId].maxHeight &&
      SCREEN_PROFILES[screenId].maxHeight > 720
    ) {
      screenId = 'low'
    }
    reasons.push('cpu:critical-video')
  }

  const ceiling = input.cpuCeiling ?? UNLIMITED_CPU_CEILING
  screenId = clampScreenToCeiling(screenId, ceiling)
  cameraId = clampCameraToCeiling(cameraId, ceiling)
  if (ceiling.maxScreen !== 'ultra' || ceiling.maxCamera !== 'high') reasons.push('cpu-ceiling')

  if (!input.screenActive) screenId = 'survival'
  if (!input.cameraIntent) cameraId = 'suspended'

  let screen = getScreenProfile(screenId)
  if (input.remoteControlActive && input.screenActive && screenId !== 'survival') {
    screen = { ...screen, maxFramerate: Math.min(screen.maxFramerate, 20) }
    reasons.push('remote-control:screen-fps')
  }

  return {
    screenProfile: screen,
    cameraProfile: getCameraProfile(cameraId),
    audioProfile: audio,
    reason: reasons,
  }
}

export type AdaptiveHistoryEntry = {
  at: number
  network: NetworkState
  cpu: CpuState
  decision: AdaptiveDecision
}

export type AdaptiveControllerOptions = {
  id: string
  collectStats: () => Promise<unknown>
  applyDisplayProfile: (profile: AdaptiveDecision['screenProfile']) => Promise<boolean | void>
  applyCameraProfile: (profile: AdaptiveDecision['cameraProfile']) => Promise<boolean | void>
  applyAudioProfile: (profile: AdaptiveDecision['audioProfile']) => Promise<boolean | void>
  getContext: () => AdaptiveTickContext
  policy?: AdaptivePolicy
  logger?: AdaptiveLogger
  now?: () => number
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void
  onAfterTick?: () => void
}

export class AdaptiveController {
  id: string
  private readonly opts: AdaptiveControllerOptions
  private readonly policy: AdaptivePolicy
  private timer: ReturnType<typeof setInterval> | number | null = null
  private prevSnapshot: RawStatsSnapshot | null = null
  private ewma: EwmaState = {}
  private hysteresis = initialHysteresis()
  private lastDecision: AdaptiveDecision | null = null
  private lastHealth: LinkHealth
  private history: AdaptiveHistoryEntry[] = []
  private ticking = false
  private started = false

  constructor(opts: AdaptiveControllerOptions) {
    this.opts = opts
    this.id = opts.id
    this.policy = opts.policy ?? DEFAULT_ADAPTIVE_POLICY
    this.lastHealth = {
      network: this.hysteresis.network,
      cpu: this.hysteresis.cpu,
      speaking: false,
      remoteControlActive: false,
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    const interval = this.opts.setIntervalFn ?? setInterval
    this.timer = interval(() => {
      void this.tick()
    }, this.policy.sampleIntervalMs)
    void this.tick()
  }

  stop(): void {
    this.started = false
    if (this.timer !== null) {
      const clear = this.opts.clearIntervalFn ?? clearInterval
      clear(this.timer as ReturnType<typeof setInterval>)
      this.timer = null
    }
  }

  getHealth(): LinkHealth {
    return this.lastHealth
  }

  getLastDecision(): AdaptiveDecision | null {
    return this.lastDecision
  }

  getHistory(): AdaptiveHistoryEntry[] {
    return [...this.history]
  }

  async tick(): Promise<AdaptiveDecision | null> {
    if (this.ticking) return this.lastDecision
    this.ticking = true
    try {
      return await this.runTick()
    } catch (error) {
      this.opts.logger?.warn(`peer=${this.id} tick failed`, error)
      return this.lastDecision
    } finally {
      this.ticking = false
    }
  }

  private async runTick(): Promise<AdaptiveDecision | null> {
    const now = this.opts.now?.() ?? Date.now()
    const context = this.opts.getContext()
    let report: unknown = null
    try {
      report = await this.opts.collectStats()
    } catch (error) {
      this.opts.logger?.warn(`peer=${this.id} getStats failed`, error)
    }

    const snapshot = parseStatsReport(
      report && typeof report === 'object' && 'forEach' in report
        ? (report as { forEach: (callback: (value: Record<string, unknown>) => void) => void })
        : null,
      now,
    )
    const delta = computeDelta(this.prevSnapshot, snapshot)
    this.prevSnapshot = snapshot
    this.ewma = updateEwma(
      this.ewma,
      {
        rttMs: snapshot.rttMs,
        packetLoss: delta?.packetLoss,
        availableOutgoingBitrate: snapshot.availableOutgoingBitrate,
        encodeTimePerFrameMs: delta?.encodeTimePerFrameMs,
        retransmitRate: delta?.retransmitRate,
        sendRateBps: delta?.sendRateBps,
      },
      this.policy,
    )

    const requestedBitrate = this.lastDecision
      ? requestedMediaBudgetBps({
          screenActive: context.screenActive,
          cameraIntent: context.cameraIntent,
          screen: this.lastDecision.screenProfile,
          camera: this.lastDecision.cameraProfile,
          audio: this.lastDecision.audioProfile,
          controlHeadroomBps: this.policy.controlHeadroomBps,
          microphoneActive: context.microphoneActive,
        })
      : undefined

    const metrics = {
      packetLoss: this.ewma.packetLoss,
      rttMs: this.ewma.rttMs,
      rttBaselineMs: this.ewma.rttBaselineMs,
      availableOutgoingBitrate: this.ewma.availableOutgoingBitrate,
      requestedBitrate,
      retransmitRate: this.ewma.retransmitRate,
      nackDelta: delta?.nackDelta,
      pliDelta: delta?.pliDelta,
      sendRateBps: this.ewma.sendRateBps,
      qualityLimitationReason: snapshot.qualityLimitationReason ?? delta?.qualityLimitationReason,
      encodeTimePerFrameMs: this.ewma.encodeTimePerFrameMs,
      fps: delta?.fps ?? snapshot.framesPerSecond,
      targetFps:
        this.lastDecision?.screenProfile.maxFramerate ??
        this.lastDecision?.cameraProfile.maxFramerate,
      framesDropped: delta?.framesDropped,
      framesEncoded: delta?.framesEncoded,
    }

    const instantNetwork = classifyInstantNetwork(metrics, this.policy)
    const instantCpu = classifyInstantCpu(metrics, this.policy)
    const emergency = {
      network: isNetworkEmergency(metrics, this.policy),
      cpu: isCpuEmergency(metrics, this.policy),
    }
    const previous = this.hysteresis
    this.hysteresis = stepHysteresis(
      this.hysteresis,
      instantNetwork,
      instantCpu,
      now,
      this.policy,
      emergency,
    )

    const decision = allocateProfiles({
      network: this.hysteresis.network,
      cpu: this.hysteresis.cpu,
      screenActive: context.screenActive,
      cameraIntent: context.cameraIntent,
      microphoneActive: context.microphoneActive,
      speaking: context.speaking,
      remoteControlActive: context.remoteControlActive,
      cpuCeiling: context.cpuCeiling,
    })

    this.lastHealth = {
      network: this.hysteresis.network,
      cpu: this.hysteresis.cpu,
      rttMs: this.ewma.rttMs,
      packetLoss: this.ewma.packetLoss,
      availableOutgoingBitrate: this.ewma.availableOutgoingBitrate,
      retransmitRate: this.ewma.retransmitRate,
      speaking: context.speaking,
      remoteControlActive: context.remoteControlActive,
    }

    const changed =
      !this.lastDecision ||
      this.lastDecision.screenProfile.id !== decision.screenProfile.id ||
      this.lastDecision.screenProfile.maxFramerate !== decision.screenProfile.maxFramerate ||
      this.lastDecision.cameraProfile.id !== decision.cameraProfile.id ||
      this.lastDecision.audioProfile.maxBitrate !== decision.audioProfile.maxBitrate ||
      previous.network !== this.hysteresis.network ||
      previous.cpu !== this.hysteresis.cpu

    if (changed) {
      try {
        if (context.screenActive) await this.opts.applyDisplayProfile(decision.screenProfile)
      } catch (error) {
        this.opts.logger?.warn(`peer=${this.id} display profile failed`, error)
      }
      try {
        if (context.cameraIntent || this.lastDecision?.cameraProfile.active) {
          await this.opts.applyCameraProfile(decision.cameraProfile)
        }
      } catch (error) {
        this.opts.logger?.warn(`peer=${this.id} camera profile failed`, error)
      }
      try {
        if (context.microphoneActive) await this.opts.applyAudioProfile(decision.audioProfile)
      } catch (error) {
        this.opts.logger?.warn(`peer=${this.id} audio profile failed`, error)
      }

      if (previous.network !== this.hysteresis.network || this.lastDecision) {
        const loss =
          this.ewma.packetLoss !== undefined ? `${(this.ewma.packetLoss * 100).toFixed(1)}%` : 'n/a'
        const rtt = this.ewma.rttMs !== undefined ? `${Math.round(this.ewma.rttMs)}ms` : 'n/a'
        const available =
          this.ewma.availableOutgoingBitrate !== undefined
            ? `${(this.ewma.availableOutgoingBitrate / 1_000_000).toFixed(1)}Mbps`
            : 'n/a'
        this.opts.logger?.info(
          `peer=${this.id} ${previous.network} -> ${this.hysteresis.network}`,
          `reason=loss:${loss}, rtt:${rtt}, available:${available}\n${formatProfileSummary(
            decision.screenProfile,
            decision.cameraProfile,
            decision.audioProfile,
          )}`,
        )
      }
    }

    this.lastDecision = decision
    this.history.push({
      at: now,
      network: this.hysteresis.network,
      cpu: this.hysteresis.cpu,
      decision,
    })
    if (this.history.length > this.policy.historyLimit) {
      this.history = this.history.slice(-this.policy.historyLimit)
    }
    this.opts.onAfterTick?.()
    return decision
  }
}
