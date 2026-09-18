import type { AdaptivePolicy, CpuState, NetworkState } from './types'
import { NETWORK_BY_RANK, NETWORK_RANK } from './types'

export type RawStatsSnapshot = {
  at: number
  rttMs?: number
  availableOutgoingBitrate?: number
  bytesSent?: number
  packetsSent?: number
  retransmittedPacketsSent?: number
  retransmittedBytesSent?: number
  packetsLost?: number
  packetsReceivedRemote?: number
  fractionLost?: number
  jitterMs?: number
  framesEncoded?: number
  framesSent?: number
  framesDropped?: number
  frameWidth?: number
  frameHeight?: number
  framesPerSecond?: number
  totalEncodeTime?: number
  qualityLimitationReason?: string
  nackCount?: number
  pliCount?: number
  firCount?: number
  targetBitrate?: number
  iceConnectionState?: string
  connectionState?: string
}

export type StatsDelta = {
  intervalMs: number
  sendRateBps?: number
  packetsSent?: number
  retransmitRate?: number
  packetLoss?: number
  framesEncoded?: number
  framesSent?: number
  framesDropped?: number
  encodeTimePerFrameMs?: number
  nackDelta?: number
  pliDelta?: number
  firDelta?: number
  qualityLimitationReason?: string
  fps?: number
}

export type EwmaState = {
  rttMs?: number
  rttBaselineMs?: number
  packetLoss?: number
  availableOutgoingBitrate?: number
  encodeTimePerFrameMs?: number
  retransmitRate?: number
  sendRateBps?: number
}

type StatsRecord = Record<string, unknown>

type StatsReportLike = {
  forEach: (callback: (value: StatsRecord, id?: string) => void) => void
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const pickSelectedPair = (records: StatsRecord[]): StatsRecord | undefined => {
  const pairs = records.filter((item) => item.type === 'candidate-pair')
  return (
    pairs.find((item) => item.selected === true) ??
    pairs.find((item) => item.nominated === true && item.state === 'succeeded') ??
    pairs.find((item) => item.state === 'succeeded') ??
    pairs[0]
  )
}

const sumOptional = (values: Array<number | undefined>): number | undefined => {
  const present = values.filter((value): value is number => value !== undefined)
  if (!present.length) return undefined
  return present.reduce((total, value) => total + value, 0)
}

const maxOptional = (values: Array<number | undefined>): number | undefined => {
  const present = values.filter((value): value is number => value !== undefined)
  if (!present.length) return undefined
  return Math.max(...present)
}

export const parseStatsReport = (
  report: StatsReportLike | null | undefined,
  at: number,
  connection?: { iceConnectionState?: string; connectionState?: string },
): RawStatsSnapshot => {
  const snapshot: RawStatsSnapshot = {
    at,
    iceConnectionState: connection?.iceConnectionState,
    connectionState: connection?.connectionState,
  }
  if (!report || typeof report.forEach !== 'function') return snapshot

  const records: StatsRecord[] = []
  try {
    report.forEach((value) => {
      if (value && typeof value === 'object') records.push(value)
    })
  } catch {
    return snapshot
  }

  const pair = pickSelectedPair(records)
  if (pair) {
    const rttSeconds = asNumber(pair.currentRoundTripTime)
    snapshot.rttMs =
      rttSeconds !== undefined ? rttSeconds * 1000 : asNumber(pair.currentRoundTripTime)
    snapshot.availableOutgoingBitrate = asNumber(pair.availableOutgoingBitrate)
    snapshot.bytesSent = asNumber(pair.bytesSent)
    snapshot.packetsSent = asNumber(pair.packetsSent)
    snapshot.retransmittedPacketsSent = asNumber(pair.retransmittedPacketsSent)
    snapshot.retransmittedBytesSent = asNumber(pair.retransmittedBytesSent)
  }

  const outbound = records.filter((item) => item.type === 'outbound-rtp')
  const videoOut = outbound.filter((item) => item.kind === 'video' || item.mediaType === 'video')
  const videoStats = videoOut.length ? videoOut : outbound

  snapshot.bytesSent =
    snapshot.bytesSent ?? sumOptional(outbound.map((item) => asNumber(item.bytesSent)))
  snapshot.packetsSent =
    snapshot.packetsSent ?? sumOptional(outbound.map((item) => asNumber(item.packetsSent)))
  snapshot.retransmittedPacketsSent =
    snapshot.retransmittedPacketsSent ??
    sumOptional(outbound.map((item) => asNumber(item.retransmittedPacketsSent)))
  snapshot.framesEncoded = sumOptional(videoStats.map((item) => asNumber(item.framesEncoded)))
  snapshot.framesSent = sumOptional(videoStats.map((item) => asNumber(item.framesSent)))
  snapshot.framesDropped = sumOptional(videoStats.map((item) => asNumber(item.framesDropped)))
  snapshot.totalEncodeTime = sumOptional(videoStats.map((item) => asNumber(item.totalEncodeTime)))
  snapshot.nackCount = sumOptional(videoStats.map((item) => asNumber(item.nackCount)))
  snapshot.pliCount = sumOptional(videoStats.map((item) => asNumber(item.pliCount)))
  snapshot.firCount = sumOptional(videoStats.map((item) => asNumber(item.firCount)))
  snapshot.targetBitrate = sumOptional(videoStats.map((item) => asNumber(item.targetBitrate)))
  snapshot.framesPerSecond = maxOptional(videoStats.map((item) => asNumber(item.framesPerSecond)))
  snapshot.frameWidth = maxOptional(videoStats.map((item) => asNumber(item.frameWidth)))
  snapshot.frameHeight = maxOptional(videoStats.map((item) => asNumber(item.frameHeight)))
  snapshot.qualityLimitationReason =
    videoStats.find((item) => asString(item.qualityLimitationReason) === 'cpu')?.[
      'qualityLimitationReason'
    ] !== undefined
      ? 'cpu'
      : asString(
          videoStats.find((item) => asString(item.qualityLimitationReason))
            ?.qualityLimitationReason,
        )

  const remoteInbound = records.filter((item) => item.type === 'remote-inbound-rtp')
  snapshot.packetsLost = sumOptional(remoteInbound.map((item) => asNumber(item.packetsLost)))
  snapshot.packetsReceivedRemote = sumOptional(
    remoteInbound.map((item) => asNumber(item.packetsReceived)),
  )
  snapshot.fractionLost = maxOptional(remoteInbound.map((item) => asNumber(item.fractionLost)))
  const jitterSeconds = maxOptional(remoteInbound.map((item) => asNumber(item.jitter)))
  snapshot.jitterMs = jitterSeconds !== undefined ? jitterSeconds * 1000 : undefined
  if (snapshot.rttMs === undefined) {
    const remoteRtt = maxOptional(remoteInbound.map((item) => asNumber(item.roundTripTime)))
    if (remoteRtt !== undefined) snapshot.rttMs = remoteRtt * 1000
  }

  return snapshot
}

const rate = (delta: number | undefined, intervalMs: number): number | undefined => {
  if (delta === undefined || intervalMs <= 0) return undefined
  return delta / (intervalMs / 1000)
}

export const computeDelta = (
  prev: RawStatsSnapshot | null,
  next: RawStatsSnapshot,
): StatsDelta | null => {
  if (!prev) return null
  const intervalMs = Math.max(1, next.at - prev.at)
  const packetsSent = diff(prev.packetsSent, next.packetsSent)
  const retransmitted = diff(prev.retransmittedPacketsSent, next.retransmittedPacketsSent)
  const packetsLost = diff(prev.packetsLost, next.packetsLost)
  const framesEncoded = diff(prev.framesEncoded, next.framesEncoded)
  const encodeTime = diff(prev.totalEncodeTime, next.totalEncodeTime)
  const lost = packetsLost ?? 0
  const sent = packetsSent ?? 0
  const remoteReceived = diff(prev.packetsReceivedRemote, next.packetsReceivedRemote) ?? sent
  const lossDenom = lost + remoteReceived
  const packetLoss =
    next.fractionLost ??
    (lossDenom > 0
      ? Math.max(0, lost / lossDenom)
      : sent > 0 && packetsLost !== undefined
        ? lost / sent
        : undefined)

  return {
    intervalMs,
    sendRateBps: rate(diff(prev.bytesSent, next.bytesSent), intervalMs)
      ? rate(diff(prev.bytesSent, next.bytesSent), intervalMs)! * 8
      : undefined,
    packetsSent,
    retransmitRate:
      packetsSent && packetsSent > 0 && retransmitted !== undefined
        ? retransmitted / packetsSent
        : undefined,
    packetLoss,
    framesEncoded,
    framesSent: diff(prev.framesSent, next.framesSent),
    framesDropped: diff(prev.framesDropped, next.framesDropped),
    encodeTimePerFrameMs:
      framesEncoded && framesEncoded > 0 && encodeTime !== undefined
        ? (encodeTime / framesEncoded) * 1000
        : undefined,
    nackDelta: diff(prev.nackCount, next.nackCount),
    pliDelta: diff(prev.pliCount, next.pliCount),
    firDelta: diff(prev.firCount, next.firCount),
    qualityLimitationReason: next.qualityLimitationReason,
    fps: next.framesPerSecond,
  }
}

const diff = (prev: number | undefined, next: number | undefined): number | undefined => {
  if (prev === undefined || next === undefined) return undefined
  return Math.max(0, next - prev)
}

const blend = (
  prev: number | undefined,
  sample: number | undefined,
  alpha: number,
): number | undefined => {
  if (sample === undefined) return prev
  if (prev === undefined) return sample
  return prev * (1 - alpha) + sample * alpha
}

export const updateEwma = (
  prev: EwmaState,
  sample: {
    rttMs?: number
    packetLoss?: number
    availableOutgoingBitrate?: number
    encodeTimePerFrameMs?: number
    retransmitRate?: number
    sendRateBps?: number
  },
  policy: AdaptivePolicy,
): EwmaState => {
  const rttMs = blend(prev.rttMs, sample.rttMs, policy.ewmaAlpha)
  let rttBaselineMs = prev.rttBaselineMs
  if (sample.rttMs !== undefined) {
    rttBaselineMs =
      rttBaselineMs === undefined
        ? sample.rttMs
        : Math.min(
            sample.rttMs,
            blend(rttBaselineMs, sample.rttMs, policy.rttBaselineAlpha) ?? sample.rttMs,
          )
  }
  return {
    rttMs,
    rttBaselineMs,
    packetLoss: blend(prev.packetLoss, sample.packetLoss, policy.ewmaAlpha),
    availableOutgoingBitrate: blend(
      prev.availableOutgoingBitrate,
      sample.availableOutgoingBitrate,
      policy.ewmaAlpha,
    ),
    encodeTimePerFrameMs: blend(
      prev.encodeTimePerFrameMs,
      sample.encodeTimePerFrameMs,
      policy.ewmaAlpha,
    ),
    retransmitRate: blend(prev.retransmitRate, sample.retransmitRate, policy.ewmaAlpha),
    sendRateBps: blend(prev.sendRateBps, sample.sendRateBps, policy.ewmaAlpha),
  }
}

export const isNetworkEmergency = (
  metrics: { packetLoss?: number; rttMs?: number },
  policy: AdaptivePolicy,
): boolean => {
  if (metrics.packetLoss !== undefined && metrics.packetLoss >= policy.emergencyLoss) return true
  if (metrics.rttMs !== undefined && metrics.rttMs >= policy.emergencyRttMs) return true
  return false
}

export const isCpuEmergency = (
  metrics: { encodeTimePerFrameMs?: number; qualityLimitationReason?: string },
  policy: AdaptivePolicy,
): boolean => {
  if (
    metrics.encodeTimePerFrameMs !== undefined &&
    metrics.encodeTimePerFrameMs >= policy.emergencyEncodeMs
  ) {
    return true
  }
  return false
}

const worseNetwork = (left: NetworkState, right: NetworkState): NetworkState =>
  NETWORK_RANK[left] >= NETWORK_RANK[right] ? left : right

export const classifyInstantNetwork = (
  metrics: {
    packetLoss?: number
    rttMs?: number
    rttBaselineMs?: number
    availableOutgoingBitrate?: number
    requestedBitrate?: number
    retransmitRate?: number
    nackDelta?: number
    pliDelta?: number
    sendRateBps?: number
  },
  policy: AdaptivePolicy,
): NetworkState => {
  let state: NetworkState = 'excellent'
  const loss = metrics.packetLoss
  const rtt = metrics.rttMs
  const rise =
    metrics.rttMs !== undefined && metrics.rttBaselineMs && metrics.rttBaselineMs > 0
      ? metrics.rttMs / metrics.rttBaselineMs
      : undefined
  const avail = metrics.availableOutgoingBitrate
  const requested = metrics.requestedBitrate
  const availRatio =
    avail !== undefined && requested && requested > 0 ? avail / requested : undefined
  const sendRatio =
    metrics.sendRateBps !== undefined && requested && requested > 0
      ? metrics.sendRateBps / requested
      : undefined

  if (loss !== undefined) {
    if (loss >= policy.lossPoor) state = worseNetwork(state, 'poor')
    else if (loss >= policy.lossConstrained) state = worseNetwork(state, 'constrained')
    else if (loss >= policy.lossGood) state = worseNetwork(state, 'good')
    else if (loss >= policy.lossExcellent) state = worseNetwork(state, 'good')
  }
  if (rtt !== undefined) {
    if (rtt >= policy.rttPoorMs) state = worseNetwork(state, 'poor')
    else if (rtt >= policy.rttConstrainedMs) state = worseNetwork(state, 'constrained')
    else if (rtt >= policy.rttGoodMs) state = worseNetwork(state, 'good')
    else if (rtt >= policy.rttExcellentMs) state = worseNetwork(state, 'good')
  }
  if (rise !== undefined) {
    if (rise >= policy.rttRisePoor) state = worseNetwork(state, 'poor')
    else if (rise >= policy.rttRiseConstrained) state = worseNetwork(state, 'constrained')
  }
  if (availRatio !== undefined) {
    if (availRatio <= policy.availRatioCritical) state = worseNetwork(state, 'critical')
    else if (availRatio <= policy.availRatioPoor) state = worseNetwork(state, 'poor')
    else if (availRatio <= policy.availRatioConstrained) state = worseNetwork(state, 'constrained')
  }
  if (metrics.retransmitRate !== undefined) {
    if (metrics.retransmitRate >= policy.retransmitPoor) state = worseNetwork(state, 'poor')
    else if (metrics.retransmitRate >= policy.retransmitConstrained)
      state = worseNetwork(state, 'constrained')
  }
  if (metrics.nackDelta !== undefined && metrics.nackDelta >= policy.nackBurstConstrained) {
    state = worseNetwork(state, 'constrained')
  }
  if (metrics.pliDelta !== undefined && metrics.pliDelta >= policy.pliBurstConstrained) {
    state = worseNetwork(state, 'constrained')
  }
  if (sendRatio !== undefined && sendRatio < policy.availRatioConstrained) {
    state = worseNetwork(state, 'constrained')
  }
  if (isNetworkEmergency({ packetLoss: loss, rttMs: rtt }, policy)) return 'critical'
  if (loss !== undefined && loss >= policy.lossPoor && (rtt ?? 0) >= policy.rttConstrainedMs) {
    state = worseNetwork(state, 'critical')
  }
  return NETWORK_BY_RANK[NETWORK_RANK[state]] ?? state
}

export const classifyInstantCpu = (
  metrics: {
    qualityLimitationReason?: string
    encodeTimePerFrameMs?: number
    fps?: number
    targetFps?: number
    framesDropped?: number
    framesEncoded?: number
    availableOutgoingBitrate?: number
    requestedBitrate?: number
  },
  policy: AdaptivePolicy,
): CpuState => {
  const encode = metrics.encodeTimePerFrameMs
  const cpuLimited = metrics.qualityLimitationReason === 'cpu'
  const networkOk =
    metrics.availableOutgoingBitrate === undefined ||
    metrics.requestedBitrate === undefined ||
    metrics.requestedBitrate <= 0 ||
    metrics.availableOutgoingBitrate >= metrics.requestedBitrate * 0.8
  const fpsLow =
    metrics.targetFps !== undefined &&
    metrics.fps !== undefined &&
    metrics.targetFps > 0 &&
    metrics.fps < metrics.targetFps * policy.fpsRatioConstrained &&
    networkOk
  const droppedRatio =
    metrics.framesDropped !== undefined &&
    metrics.framesEncoded !== undefined &&
    metrics.framesEncoded + metrics.framesDropped > 0
      ? metrics.framesDropped / (metrics.framesEncoded + metrics.framesDropped)
      : undefined

  if (isCpuEmergency({ encodeTimePerFrameMs: encode }, policy)) return 'critical'
  if (encode !== undefined && encode >= policy.encodeCriticalMs) return 'critical'
  if (
    cpuLimited ||
    (encode !== undefined && encode >= policy.encodeConstrainedMs) ||
    fpsLow ||
    (droppedRatio !== undefined && droppedRatio >= policy.droppedFrameRatioConstrained)
  ) {
    return 'constrained'
  }
  return 'normal'
}
