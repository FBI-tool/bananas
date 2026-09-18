import { describe, expect, it } from 'vitest'
import { DEFAULT_ADAPTIVE_POLICY } from './types'
import {
  classifyInstantCpu,
  classifyInstantNetwork,
  computeDelta,
  parseStatsReport,
  updateEwma,
} from './stats'

const report = (stats: Array<Record<string, unknown>>) => ({
  forEach: (callback: (value: Record<string, unknown>) => void) => {
    for (const item of stats) callback(item)
  },
})

describe('stats sampling', () => {
  it('parses optional candidate-pair and outbound-rtp fields', () => {
    const snapshot = parseStatsReport(
      report([
        {
          type: 'candidate-pair',
          selected: true,
          currentRoundTripTime: 0.08,
          availableOutgoingBitrate: 2_000_000,
          bytesSent: 1000,
          packetsSent: 10,
          retransmittedPacketsSent: 1,
        },
        {
          type: 'outbound-rtp',
          kind: 'video',
          framesEncoded: 30,
          framesSent: 28,
          framesDropped: 2,
          totalEncodeTime: 0.6,
          framesPerSecond: 24,
          frameWidth: 1920,
          frameHeight: 1080,
          qualityLimitationReason: 'bandwidth',
          nackCount: 3,
          pliCount: 1,
        },
        {
          type: 'remote-inbound-rtp',
          packetsLost: 2,
          packetsReceived: 98,
          fractionLost: 0.02,
          jitter: 0.004,
        },
      ]),
      1000,
    )
    expect(snapshot.rttMs).toBe(80)
    expect(snapshot.availableOutgoingBitrate).toBe(2_000_000)
    expect(snapshot.framesEncoded).toBe(30)
    expect(snapshot.qualityLimitationReason).toBe('bandwidth')
    expect(snapshot.fractionLost).toBe(0.02)
  })

  it('does not throw when browser stats are missing', () => {
    expect(() => parseStatsReport(null, 1)).not.toThrow()
    expect(parseStatsReport(null, 1).at).toBe(1)
    expect(() => parseStatsReport({ forEach: () => undefined }, 2)).not.toThrow()
    expect(() =>
      parseStatsReport(
        {
          forEach: () => {
            throw new Error('stats exploded')
          },
        },
        3,
      ),
    ).not.toThrow()
  })

  it('computes deltas and EWMA without treating RTT as bandwidth', () => {
    const first = parseStatsReport(
      report([
        {
          type: 'candidate-pair',
          selected: true,
          currentRoundTripTime: 0.04,
          availableOutgoingBitrate: 5_000_000,
          bytesSent: 1000,
          packetsSent: 10,
          retransmittedPacketsSent: 0,
        },
        {
          type: 'outbound-rtp',
          kind: 'video',
          framesEncoded: 10,
          totalEncodeTime: 0.1,
          nackCount: 0,
        },
        { type: 'remote-inbound-rtp', packetsLost: 0, packetsReceived: 10 },
      ]),
      0,
    )
    const second = parseStatsReport(
      report([
        {
          type: 'candidate-pair',
          selected: true,
          currentRoundTripTime: 0.2,
          availableOutgoingBitrate: 5_000_000,
          bytesSent: 10_000,
          packetsSent: 20,
          retransmittedPacketsSent: 1,
        },
        {
          type: 'outbound-rtp',
          kind: 'video',
          framesEncoded: 20,
          totalEncodeTime: 0.3,
          nackCount: 2,
        },
        { type: 'remote-inbound-rtp', packetsLost: 1, packetsReceived: 19 },
      ]),
      1000,
    )
    const delta = computeDelta(first, second)
    expect(delta?.sendRateBps).toBe(72_000)
    expect(delta?.retransmitRate).toBeCloseTo(0.1)
    expect(delta?.encodeTimePerFrameMs).toBeCloseTo(20)
    expect(delta?.nackDelta).toBe(2)
    const ewma = updateEwma(
      {},
      { rttMs: 200, availableOutgoingBitrate: 5_000_000 },
      DEFAULT_ADAPTIVE_POLICY,
    )
    expect(ewma.rttMs).toBe(200)
    expect(ewma.availableOutgoingBitrate).toBe(5_000_000)
    expect(
      classifyInstantNetwork(
        { rttMs: 200, availableOutgoingBitrate: 5_000_000 },
        DEFAULT_ADAPTIVE_POLICY,
      ),
    ).toBe('good')
    expect(classifyInstantNetwork({ rttMs: 280, packetLoss: 0.05 }, DEFAULT_ADAPTIVE_POLICY)).toBe(
      'constrained',
    )
    expect(
      classifyInstantNetwork(
        {
          rttMs: 40,
          availableOutgoingBitrate: 8_000_000,
          requestedBitrate: 2_000_000,
          packetLoss: 0,
        },
        DEFAULT_ADAPTIVE_POLICY,
      ),
    ).toBe('excellent')
  })

  it('classifies CPU pressure independently of a healthy network', () => {
    expect(
      classifyInstantCpu(
        {
          qualityLimitationReason: 'cpu',
          encodeTimePerFrameMs: 30,
          availableOutgoingBitrate: 8_000_000,
          requestedBitrate: 2_000_000,
        },
        DEFAULT_ADAPTIVE_POLICY,
      ),
    ).toBe('constrained')
    expect(
      classifyInstantCpu(
        { encodeTimePerFrameMs: 90, availableOutgoingBitrate: 8_000_000 },
        DEFAULT_ADAPTIVE_POLICY,
      ),
    ).toBe('critical')
    expect(
      classifyInstantNetwork(
        {
          packetLoss: 0,
          rttMs: 40,
          availableOutgoingBitrate: 8_000_000,
          requestedBitrate: 2_000_000,
        },
        DEFAULT_ADAPTIVE_POLICY,
      ),
    ).toBe('excellent')
  })
})
