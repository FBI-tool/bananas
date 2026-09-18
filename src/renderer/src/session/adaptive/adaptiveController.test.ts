import { describe, expect, it, vi } from 'vitest'
import {
  AdaptiveController,
  allocateProfiles,
  initialHysteresis,
  stepHysteresis,
} from './adaptiveController'
import { DEFAULT_ADAPTIVE_POLICY, UNLIMITED_CPU_CEILING } from './types'
import type { AdaptiveTickContext } from './types'
import type { CameraProfile, ScreenProfile } from './types'

const fullMedia = {
  screenActive: true,
  cameraIntent: true,
  microphoneActive: true,
  speaking: false,
  remoteControlActive: false,
  cpuCeiling: UNLIMITED_CPU_CEILING,
}

const policy = DEFAULT_ADAPTIVE_POLICY

describe('allocateProfiles', () => {
  it('gives excellent connections high screen, high camera, and protected audio', () => {
    const decision = allocateProfiles({ network: 'excellent', cpu: 'normal', ...fullMedia })
    expect(decision.audioProfile.id).toBe('protected')
    expect(decision.screenProfile.id).toBe('ultra')
    expect(decision.cameraProfile.id).toBe('high')
    expect(decision.cameraProfile.active).toBe(true)
  })

  it('degrades camera before screen when bandwidth drops', () => {
    const excellent = allocateProfiles({ network: 'excellent', cpu: 'normal', ...fullMedia })
    const good = allocateProfiles({ network: 'good', cpu: 'normal', ...fullMedia })
    expect(good.cameraProfile.id).not.toBe(excellent.cameraProfile.id)
    expect(good.screenProfile.id).toBe('high')
    expect(good.cameraProfile.id).toBe('medium')
    const constrained = allocateProfiles({ network: 'constrained', cpu: 'normal', ...fullMedia })
    expect(constrained.screenProfile.id).toBe('medium')
    expect(constrained.cameraProfile.id).toBe('low')
  })

  it('suspends camera under sustained poor / critical bandwidth', () => {
    const poor = allocateProfiles({ network: 'poor', cpu: 'normal', ...fullMedia })
    expect(poor.cameraProfile.id).toBe('survival')
    expect(poor.screenProfile.id).toBe('low')
    const critical = allocateProfiles({ network: 'critical', cpu: 'normal', ...fullMedia })
    expect(critical.cameraProfile.id).toBe('suspended')
    expect(critical.cameraProfile.active).toBe(false)
    expect(critical.screenProfile.id).toBe('survival')
    expect(critical.audioProfile.id).toBe('protected')
  })

  it('keeps audio protected and yields camera first while speaking', () => {
    const quiet = allocateProfiles({ network: 'good', cpu: 'normal', ...fullMedia })
    const talking = allocateProfiles({
      network: 'good',
      cpu: 'normal',
      ...fullMedia,
      speaking: true,
    })
    expect(talking.audioProfile.id).toBe('protected')
    expect(talking.cameraProfile.id).not.toBe(quiet.cameraProfile.id)
    expect(talking.screenProfile.id).toBe(quiet.screenProfile.id)
  })

  it('gives leftover video budget to camera when no screen is shared', () => {
    const decision = allocateProfiles({
      network: 'good',
      cpu: 'normal',
      ...fullMedia,
      screenActive: false,
    })
    expect(decision.audioProfile.id).toBe('protected')
    expect(decision.cameraProfile.id).toBe('high')
  })

  it('lets screen use the video budget when camera is off', () => {
    const decision = allocateProfiles({
      network: 'excellent',
      cpu: 'normal',
      ...fullMedia,
      cameraIntent: false,
    })
    expect(decision.screenProfile.id).toBe('ultra')
    expect(decision.cameraProfile.id).toBe('suspended')
    expect(decision.cameraProfile.active).toBe(false)
  })

  it('yields camera earlier during remote control and keeps screen readable', () => {
    const idle = allocateProfiles({ network: 'good', cpu: 'normal', ...fullMedia })
    const controlling = allocateProfiles({
      network: 'good',
      cpu: 'normal',
      ...fullMedia,
      remoteControlActive: true,
    })
    expect(controlling.cameraProfile.id).not.toBe(idle.cameraProfile.id)
    expect(controlling.screenProfile.id).toBe('high')
    expect(controlling.screenProfile.maxFramerate).toBeLessThanOrEqual(20)
    expect(controlling.screenProfile.maxHeight).toBe(1440)
  })

  it('reduces video complexity under CPU pressure without touching audio', () => {
    const healthy = allocateProfiles({ network: 'excellent', cpu: 'normal', ...fullMedia })
    const cpu = allocateProfiles({ network: 'excellent', cpu: 'constrained', ...fullMedia })
    expect(cpu.audioProfile.id).toBe('protected')
    expect(cpu.cameraProfile.id).not.toBe(healthy.cameraProfile.id)
    const criticalCpu = allocateProfiles({ network: 'excellent', cpu: 'critical', ...fullMedia })
    expect(criticalCpu.cameraProfile.id).toBe('suspended')
    expect(criticalCpu.audioProfile.id).toBe('protected')
    expect(criticalCpu.screenProfile.id).not.toBe('ultra')
  })

  it('does not change user camera intent when adaptively suspending camera', () => {
    const intent = true
    const decision = allocateProfiles({
      network: 'critical',
      cpu: 'normal',
      ...fullMedia,
      cameraIntent: intent,
    })
    expect(intent).toBe(true)
    expect(decision.cameraProfile.active).toBe(false)
  })

  it('applies a global CPU ceiling to peer profiles', () => {
    const decision = allocateProfiles({
      network: 'excellent',
      cpu: 'normal',
      ...fullMedia,
      cpuCeiling: { maxScreen: 'medium', maxCamera: 'low' },
    })
    expect(decision.screenProfile.id).toBe('medium')
    expect(decision.cameraProfile.id).toBe('low')
  })
})

describe('hysteresis', () => {
  it('ignores a single bad sample unless it is an emergency', () => {
    const start = initialHysteresis()
    const one = stepHysteresis(start, 'poor', 'normal', 1000, policy, {
      network: false,
      cpu: false,
    })
    expect(one.network).toBe('good')
    const emergency = stepHysteresis(start, 'critical', 'normal', 1000, policy, {
      network: true,
      cpu: false,
    })
    expect(emergency.network).toBe('critical')
  })

  it('downgrades after sustained bad samples', () => {
    let state = initialHysteresis()
    for (let i = 1; i <= policy.downgradeConsecutive; i++) {
      state = stepHysteresis(state, 'poor', 'normal', i * 1000, policy, {
        network: false,
        cpu: false,
      })
    }
    expect(state.network).toBe('constrained')
  })

  it('does not upgrade immediately when the link recovers', () => {
    let state = initialHysteresis()
    state = {
      ...state,
      network: 'constrained',
    }
    const recovered = stepHysteresis(state, 'excellent', 'normal', 5000, policy, {
      network: false,
      cpu: false,
    })
    expect(recovered.network).toBe('constrained')
  })

  it('upgrades one step after a stable recovery hold', () => {
    let state = initialHysteresis()
    state = { ...state, network: 'constrained' }
    state = stepHysteresis(state, 'excellent', 'normal', 0, policy, { network: false, cpu: false })
    state = stepHysteresis(state, 'excellent', 'normal', policy.upgradeHoldMs, policy, {
      network: false,
      cpu: false,
    })
    expect(state.network).toBe('good')
  })
})

const context = (overrides?: Partial<AdaptiveTickContext>): AdaptiveTickContext => ({
  ...fullMedia,
  ...overrides,
})

const fakeLink = () => {
  const applied = {
    screen: [] as ScreenProfile[],
    camera: [] as CameraProfile[],
    audio: [] as string[],
  }
  return {
    applied,
    collectStats: vi.fn(async () => null),
    applyDisplayProfile: vi.fn(async (profile: ScreenProfile) => {
      applied.screen.push(profile)
    }),
    applyCameraProfile: vi.fn(async (profile: CameraProfile) => {
      applied.camera.push(profile)
    }),
    applyAudioProfile: vi.fn(async () => {
      applied.audio.push('protected')
    }),
  }
}

describe('AdaptiveController', () => {
  it('does not crash when getStats is empty and still protects audio', async () => {
    const link = fakeLink()
    const controller = new AdaptiveController({
      id: 'peer-a',
      collectStats: link.collectStats,
      applyDisplayProfile: link.applyDisplayProfile,
      applyCameraProfile: link.applyCameraProfile,
      applyAudioProfile: link.applyAudioProfile,
      getContext: () => context(),
    })
    const decision = await controller.tick()
    expect(decision?.audioProfile.id).toBe('protected')
    expect(controller.getHealth().network).toBe('good')
  })

  it('keeps peer congestion local to that controller', async () => {
    const report = (available: number, loss: number) => ({
      forEach: (callback: (value: Record<string, unknown>) => void) => {
        callback({
          type: 'candidate-pair',
          selected: true,
          currentRoundTripTime: 0.04,
          availableOutgoingBitrate: available,
          bytesSent: 10_000,
          packetsSent: 100,
        })
        callback({
          type: 'remote-inbound-rtp',
          fractionLost: loss,
          packetsLost: Math.round(loss * 100),
          packetsReceived: 100,
        })
      },
    })
    const make = (id: string, stats: () => unknown) => {
      const link = fakeLink()
      return new AdaptiveController({
        id,
        collectStats: async () => stats(),
        applyDisplayProfile: link.applyDisplayProfile,
        applyCameraProfile: link.applyCameraProfile,
        applyAudioProfile: link.applyAudioProfile,
        getContext: () => context(),
      })
    }
    const peerA = make('a', () => report(400_000, 0.12))
    const peerB = make('b', () => report(8_000_000, 0))
    for (let i = 0; i < 4; i++) {
      await peerA.tick()
      await peerB.tick()
    }
    expect(peerA.getHealth().network).not.toBe('excellent')
    expect(peerA.getLastDecision()?.cameraProfile.id).not.toBe('high')
    expect(peerB.getHealth().network).toBe('good')
    expect(peerB.getLastDecision()?.screenProfile.id).toBe('high')
  })

  it('swallows setParameters failures without breaking the tick', async () => {
    const controller = new AdaptiveController({
      id: 'peer-a',
      collectStats: async () => null,
      applyDisplayProfile: async () => {
        throw new Error('setParameters failed')
      },
      applyCameraProfile: async () => undefined,
      applyAudioProfile: async () => undefined,
      getContext: () => context(),
      logger: { info: vi.fn(), warn: vi.fn() },
    })
    await expect(controller.tick()).resolves.toBeTruthy()
  })
})
