export type ElementRect = {
  left: number
  top: number
  width: number
  height: number
}

export type NormalizedPoint = {
  x: number
  y: number
}

/** Visible picture inside an object-fit: contain video, after CSS translate and scale. */
export const videoContentBox = (
  rect: ElementRect,
  videoWidth: number,
  videoHeight: number,
): ElementRect => {
  const videoW = videoWidth > 0 ? videoWidth : rect.width
  const videoH = videoHeight > 0 ? videoHeight : rect.height
  if (!videoW || !videoH || !rect.width || !rect.height) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }
  const scale = Math.min(rect.width / videoW, rect.height / videoH)
  const width = videoW * scale
  const height = videoH * scale
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  }
}

export const pointInVideoContent = (
  clientX: number,
  clientY: number,
  rect: ElementRect,
  videoWidth: number,
  videoHeight: number,
  opts?: { clamp?: boolean },
): NormalizedPoint | null => {
  const box = videoContentBox(rect, videoWidth, videoHeight)
  if (!box.width || !box.height) return null
  let x = (clientX - box.left) / box.width
  let y = (clientY - box.top) / box.height
  if (opts?.clamp) {
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    }
  }
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}
