import { describe, expect, it } from 'vitest'
import { pointInVideoContent, videoContentBox } from './videoContentPoint'

describe('video content box', () => {
  it('letterboxes a 16:9 picture inside a taller fullscreen element', () => {
    const rect = { left: 0, top: 0, width: 1920, height: 1200 }
    expect(videoContentBox(rect, 1920, 1080)).toEqual({
      left: 0,
      top: 60,
      width: 1920,
      height: 1080,
    })
    expect(pointInVideoContent(960, 600, rect, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 })
    expect(pointInVideoContent(960, 10, rect, 1920, 1080)).toBeNull()
  })

  it('uses the full element when the picture aspect matches', () => {
    const rect = { left: 0, top: 0, width: 800, height: 450 }
    expect(videoContentBox(rect, 800, 450)).toEqual(rect)
    expect(pointInVideoContent(400, 225, rect, 800, 450)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('reads a translated and scaled element rect from its visual box', () => {
    const rect = { left: 100, top: 40, width: 200, height: 100 }
    expect(pointInVideoContent(200, 90, rect, 200, 100)).toEqual({ x: 0.5, y: 0.5 })
    expect(pointInVideoContent(100, 40, rect, 200, 100)).toEqual({ x: 0, y: 0 })
  })
})
