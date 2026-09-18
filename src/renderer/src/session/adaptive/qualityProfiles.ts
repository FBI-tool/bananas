import type {
  AudioProfile,
  CameraProfile,
  CameraProfileId,
  CpuCeiling,
  ScreenProfile,
  ScreenProfileId,
} from './types'

export const SCREEN_IDS: ScreenProfileId[] = ['ultra', 'high', 'medium', 'low', 'survival']
export const CAMERA_IDS: CameraProfileId[] = ['high', 'medium', 'low', 'survival', 'suspended']

export const SCREEN_PROFILES: Record<ScreenProfileId, ScreenProfile> = {
  ultra: {
    id: 'ultra',
    maxHeight: null,
    maxFramerate: 60,
    maxBitrate: 8_000_000,
    degradationPreference: 'maintain-resolution',
  },
  high: {
    id: 'high',
    maxHeight: 1440,
    maxFramerate: 30,
    maxBitrate: 4_000_000,
    degradationPreference: 'maintain-resolution',
  },
  medium: {
    id: 'medium',
    maxHeight: 1080,
    maxFramerate: 24,
    maxBitrate: 1_500_000,
    degradationPreference: 'maintain-resolution',
  },
  low: {
    id: 'low',
    maxHeight: 720,
    maxFramerate: 15,
    maxBitrate: 800_000,
    degradationPreference: 'maintain-resolution',
  },
  survival: {
    id: 'survival',
    maxHeight: 480,
    maxFramerate: 8,
    maxBitrate: 400_000,
    degradationPreference: 'maintain-resolution',
  },
}

export const CAMERA_PROFILES: Record<CameraProfileId, CameraProfile> = {
  high: {
    id: 'high',
    maxHeight: 1080,
    maxFramerate: 30,
    maxBitrate: 1_500_000,
    active: true,
    degradationPreference: 'maintain-framerate',
  },
  medium: {
    id: 'medium',
    maxHeight: 720,
    maxFramerate: 24,
    maxBitrate: 800_000,
    active: true,
    degradationPreference: 'maintain-framerate',
  },
  low: {
    id: 'low',
    maxHeight: 480,
    maxFramerate: 15,
    maxBitrate: 350_000,
    active: true,
    degradationPreference: 'maintain-framerate',
  },
  survival: {
    id: 'survival',
    maxHeight: 360,
    maxFramerate: 10,
    maxBitrate: 150_000,
    active: true,
    degradationPreference: 'maintain-framerate',
  },
  suspended: {
    id: 'suspended',
    maxHeight: 360,
    maxFramerate: 10,
    maxBitrate: 0,
    active: false,
    degradationPreference: 'maintain-framerate',
  },
}

export const AUDIO_PROFILE: AudioProfile = {
  id: 'protected',
  maxBitrate: 40_000,
  priority: 'high',
}

export const getScreenProfile = (id: ScreenProfileId): ScreenProfile => SCREEN_PROFILES[id]
export const getCameraProfile = (id: CameraProfileId): CameraProfile => CAMERA_PROFILES[id]

export const scaleResolutionDownBy = (
  sourceHeight: number | undefined,
  maxHeight: number | null,
): number => {
  if (!maxHeight || !sourceHeight || sourceHeight <= maxHeight) return 1
  return Math.max(1, sourceHeight / maxHeight)
}

export const worseScreen = (left: ScreenProfileId, right: ScreenProfileId): ScreenProfileId =>
  SCREEN_IDS.indexOf(left) >= SCREEN_IDS.indexOf(right) ? left : right

export const worseCamera = (left: CameraProfileId, right: CameraProfileId): CameraProfileId =>
  CAMERA_IDS.indexOf(left) >= CAMERA_IDS.indexOf(right) ? left : right

export const demoteScreen = (id: ScreenProfileId, steps = 1): ScreenProfileId =>
  SCREEN_IDS[Math.min(SCREEN_IDS.length - 1, SCREEN_IDS.indexOf(id) + steps)] ?? 'survival'

export const demoteCamera = (id: CameraProfileId, steps = 1): CameraProfileId =>
  CAMERA_IDS[Math.min(CAMERA_IDS.length - 1, CAMERA_IDS.indexOf(id) + steps)] ?? 'suspended'

export const clampScreenToCeiling = (id: ScreenProfileId, ceiling: CpuCeiling): ScreenProfileId =>
  worseScreen(id, ceiling.maxScreen)

export const clampCameraToCeiling = (id: CameraProfileId, ceiling: CpuCeiling): CameraProfileId =>
  worseCamera(id, ceiling.maxCamera)

export const requestedMediaBudgetBps = (input: {
  screenActive: boolean
  cameraIntent: boolean
  screen: ScreenProfile
  camera: CameraProfile
  audio: AudioProfile
  controlHeadroomBps: number
  microphoneActive: boolean
}): number => {
  let budget = input.controlHeadroomBps
  if (input.microphoneActive) budget += input.audio.maxBitrate
  if (input.screenActive) budget += input.screen.maxBitrate
  if (input.cameraIntent && input.camera.active) budget += input.camera.maxBitrate
  return budget
}

export const formatProfileSummary = (
  screen: ScreenProfile,
  camera: CameraProfile,
  audio: AudioProfile,
): string => {
  const screenRes = screen.maxHeight ? `${screen.maxHeight}p` : 'native'
  const cameraLabel = camera.active
    ? `${camera.maxHeight ?? 'src'}p/${camera.maxFramerate}/${Math.round(camera.maxBitrate / 1000)}kbps`
    : 'suspended'
  return `screen=${screenRes}/${screen.maxFramerate}/${Math.round(screen.maxBitrate / 1000)}kbps camera=${cameraLabel} audio=${audio.id}`
}
