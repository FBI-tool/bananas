import { describe, expect, it } from 'vitest'
import { isLinux, linuxGpuCliArgs } from './linuxGpuFlags'

describe('linuxGpuCliArgs', () => {
  it('enables transparent visuals so overlay windows can be click-through', () => {
    const args = linuxGpuCliArgs({ wayland: false, vaapi: false })
    if (!isLinux) {
      expect(args).toEqual([])
      return
    }
    expect(args).toContain('--enable-transparent-visuals')
  })
})
