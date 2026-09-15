export const isLinux = process.platform === 'linux'

export const isWaylandSession = (): boolean =>
  isLinux && (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY))

const WAYLAND_DISABLE_FEATURES = [
  'Vulkan',
  'VulkanFromANGLE',
  'DefaultANGLEVulkan',
  'SkiaGraphite',
  'SkiaGraphiteDawn',
  'WebGPU',
]

const VAAPI_ENABLE_FEATURES = [
  'AcceleratedVideoDecodeLinuxGL',
  'AcceleratedVideoDecodeLinuxZeroCopyGL',
  'AcceleratedVideoEncoder',
  'VaapiIgnoreDriverChecks',
]

export const linuxGpuCliArgs = (opts: { wayland: boolean; vaapi: boolean }): string[] => {
  if (!isLinux) return []

  const args: string[] = []
  const enableFeatures: string[] = []
  const disableFeatures: string[] = []

  if (opts.wayland) {
    args.push(
      '--use-gl=angle',
      '--use-angle=gles',
      '--use-vulkan=disabled',
      '--disable-vulkan',
      '--no-zygote',
    )
    disableFeatures.push(...WAYLAND_DISABLE_FEATURES)
  }

  if (opts.vaapi) {
    args.push('--ignore-gpu-blocklist')
    enableFeatures.push(...VAAPI_ENABLE_FEATURES)
  }

  if (enableFeatures.length > 0) {
    args.push(`--enable-features=${enableFeatures.join(',')}`)
  }
  if (disableFeatures.length > 0) {
    args.push(`--disable-features=${disableFeatures.join(',')}`)
  }

  return args
}
