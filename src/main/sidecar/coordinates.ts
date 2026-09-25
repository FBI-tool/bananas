import type { NormalizedPoint, OverlaySource, Rect } from './protocol'

export type MappedPoint = {
  x: number
  y: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export const clampNormalized = (point: NormalizedPoint): NormalizedPoint => ({
  x: clamp01(point.x),
  y: clamp01(point.y),
})

const rotateNormalized = (point: NormalizedPoint, rotation: number): NormalizedPoint => {
  const turns = ((rotation % 360) + 360) % 360
  if (turns === 90) return { x: point.y, y: 1 - point.x }
  if (turns === 180) return { x: 1 - point.x, y: 1 - point.y }
  if (turns === 270) return { x: 1 - point.y, y: point.x }
  return point
}

export const mapNormalizedToSource = (
  point: NormalizedPoint,
  source: OverlaySource,
): MappedPoint => {
  const normalized = rotateNormalized(clampNormalized(point), source.rotation)
  return {
    x: source.bounds.x + normalized.x * source.bounds.width,
    y: source.bounds.y + normalized.y * source.bounds.height,
  }
}

export const orientNormalized = (point: NormalizedPoint, rotation: number): NormalizedPoint =>
  rotateNormalized(clampNormalized(point), rotation)

/** Electron DIP bounds times scaleFactor, including a non-zero origin. */
export const physicalBoundsForSource = (source: OverlaySource): Rect => {
  const scale = source.scaleFactor > 0 ? source.scaleFactor : 1
  return {
    x: source.bounds.x * scale,
    y: source.bounds.y * scale,
    width: source.bounds.width * scale,
    height: source.bounds.height * scale,
  }
}

export const mapNormalizedToPhysical = (
  point: NormalizedPoint,
  source: OverlaySource,
): MappedPoint => {
  const normalized = rotateNormalized(clampNormalized(point), source.rotation)
  const rect = physicalBoundsForSource(source)
  return {
    x: rect.x + normalized.x * rect.width,
    y: rect.y + normalized.y * rect.height,
  }
}

const pixelSpan = (size: number): number => (size > 1 ? size - 1 : 0)

/** 0 and 1 land on the first and last pixel of the rectangle. */
export const mapNormalizedIntoRect = (point: NormalizedPoint, rect: Rect): MappedPoint => {
  const normalized = clampNormalized(point)
  return {
    x: rect.x + normalized.x * pixelSpan(rect.width),
    y: rect.y + normalized.y * pixelSpan(rect.height),
  }
}

/**
 * Window rectangle in the pointer-pixel space of the display.
 * `capture` is DIP in the same space as `bounds`. The scale is the display's
 * physical size divided by its DIP size, so a window on a display with a
 * negative origin stays on that display. Without `capture`, the result is the
 * display itself.
 */
export const physicalCaptureRect = (source: OverlaySource): Rect => {
  const display = physicalBoundsForSource(source)
  const capture = source.capture ?? source.bounds
  const dipW = source.bounds.width > 0 ? source.bounds.width : 1
  const dipH = source.bounds.height > 0 ? source.bounds.height : 1
  const rx = display.width / dipW
  const ry = display.height / dipH
  return {
    x: display.x + (capture.x - source.bounds.x) * rx,
    y: display.y + (capture.y - source.bounds.y) * ry,
    width: capture.width * rx,
    height: capture.height * ry,
  }
}

/** Normalized picture point mapped into the shared window, or the display when there is no window. */
export const mapNormalizedToCapture = (
  point: NormalizedPoint,
  source: OverlaySource,
): MappedPoint => {
  const normalized = rotateNormalized(clampNormalized(point), source.rotation)
  return mapNormalizedIntoRect(normalized, physicalCaptureRect(source))
}

export const displayMatchesSource = (displayId: string, source: OverlaySource): boolean =>
  displayId === source.displayId || displayId === source.sourceId

export const pickSourceForCursor = (
  sources: OverlaySource[],
  preferredId: string | undefined,
): OverlaySource | null => {
  if (sources.length === 0) return null
  if (preferredId) {
    const match = sources.find(
      (source) => source.displayId === preferredId || source.sourceId === preferredId,
    )
    if (match) return match
  }
  return sources[0] ?? null
}

export const scaleRect = (bounds: Rect, scaleFactor: number): Rect => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width * scaleFactor,
  height: bounds.height * scaleFactor,
})
