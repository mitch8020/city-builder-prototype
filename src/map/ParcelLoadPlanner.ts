import { intersectsBounds, shardsForBounds } from './map-utils'
import type { ParcelManifestV1, ParcelShard } from './types'

export type MapBounds = [number, number, number, number]
export type MapVelocity = [number, number]

export interface ParcelLoadPlan {
  viewportShards: ParcelShard[]
  targetShards: ParcelShard[]
  shardKey: string
  failureKey: string
}

const PREFETCH_MARGIN_CELLS = 1
const LOOKAHEAD_SECONDS = 2.25
const MAX_LOOKAHEAD_CELLS = 6

export function createParcelLoadPlan(
  manifest: ParcelManifestV1,
  bounds: MapBounds,
  velocity: MapVelocity,
): ParcelLoadPlan {
  const viewportShards = shardsForBounds(manifest.shards, bounds)
  const targetBounds = prefetchBounds(
    bounds,
    velocity,
    manifest.projection.baseCellSizeMeters,
  )
  const targetShards = shardsForBounds(manifest.shards, targetBounds)
  const shardKey = targetShards
    .map((shard) => shard.id)
    .sort()
    .join('|')
  const scaleStep = manifest.projection.baseCellSizeMeters / 8
  const failureKey = `${shardKey}#${Math.round(
    (bounds[2] - bounds[0]) / scaleStep,
  )}x${Math.round((bounds[3] - bounds[1]) / scaleStep)}`
  return { viewportShards, targetShards, shardKey, failureKey }
}

export function prioritizeParcelShards(
  shards: ParcelShard[],
  bounds: MapBounds,
  velocity: MapVelocity,
) {
  const viewCenter = centerOf(bounds)
  const predictedCenter: readonly [number, number] = [
    viewCenter[0] + velocity[0] * LOOKAHEAD_SECONDS,
    viewCenter[1] + velocity[1] * LOOKAHEAD_SECONDS,
  ]
  return [...shards].sort((a, b) => {
    const aVisible = intersectsBounds(a.bounds, bounds) ? 0 : 1
    const bVisible = intersectsBounds(b.bounds, bounds) ? 0 : 1
    if (aVisible !== bVisible) return aVisible - bVisible
    const aCenter = centerOf(a.bounds)
    const bCenter = centerOf(b.bounds)
    return (
      Math.hypot(
        aCenter[0] - predictedCenter[0],
        aCenter[1] - predictedCenter[1],
      ) -
      Math.hypot(
        bCenter[0] - predictedCenter[0],
        bCenter[1] - predictedCenter[1],
      )
    )
  })
}

function prefetchBounds(
  bounds: MapBounds,
  velocity: MapVelocity,
  cellSize: number,
): MapBounds {
  const margin = cellSize * PREFETCH_MARGIN_CELLS
  const maxLookahead = cellSize * MAX_LOOKAHEAD_CELLS
  const lookaheadX = clamp(
    velocity[0] * LOOKAHEAD_SECONDS,
    -maxLookahead,
    maxLookahead,
  )
  const lookaheadY = clamp(
    velocity[1] * LOOKAHEAD_SECONDS,
    -maxLookahead,
    maxLookahead,
  )

  return [
    bounds[0] - margin + Math.min(0, lookaheadX),
    bounds[1] - margin + Math.min(0, lookaheadY),
    bounds[2] + margin + Math.max(0, lookaheadX),
    bounds[3] + margin + Math.max(0, lookaheadY),
  ]
}

function centerOf(bounds: MapBounds) {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as const
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}
