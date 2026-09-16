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
