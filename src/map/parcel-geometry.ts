import earcut from 'earcut'
import { parcelHeight } from './map-utils'
import type { ParcelFeature, ParcelGroup, WorkerGeometryPayload } from './types'

function ringWithoutClosingPoint(ring: number[][]) {
  if (ring.length < 2) return ring
  const first = ring[0]
  const last = ring.at(-1)
  return first[0] === last?.[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring
}

function featureBounds(feature: ParcelFeature) {
  const bounds: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ]
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        bounds[0] = Math.min(bounds[0], x)
        bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x)
        bounds[3] = Math.max(bounds[3], y)
      }
    }
  }
  return bounds
}

export function groupParcelFeatures(features: ParcelFeature[]) {
  const byGeometry = new Map<string, ParcelGroup>()

  for (const feature of features) {
    const key = `${feature.geometry.type}:${JSON.stringify(
      feature.geometry.coordinates,
    )}`
    const existing = byGeometry.get(key)
    if (existing) {
      existing.records.push(feature.properties)
      existing.height = Math.max(
        existing.height,
        parcelHeight(feature.properties),
      )
      continue
    }
    const bounds = featureBounds(feature)
    byGeometry.set(key, {
      id: byGeometry.size,
      bounds,
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      height: parcelHeight(feature.properties),
      records: [feature.properties],
      geometry: feature.geometry,
    })
  }

  return [...byGeometry.values()]
}

export function groupsOwnedByBounds(
  groups: ParcelGroup[],
  bounds: [number, number, number, number],
  countyBounds: [number, number, number, number],
) {
  const ownsMaximumX = bounds[2] >= countyBounds[2]
  const ownsMaximumY = bounds[3] >= countyBounds[3]
  return groups
    .filter(
      ({ center }) =>
        center[0] >= bounds[0] &&
        (center[0] < bounds[2] || (ownsMaximumX && center[0] <= bounds[2])) &&
        center[1] >= bounds[1] &&
        (center[1] < bounds[3] || (ownsMaximumY && center[1] <= bounds[3])),
    )
    .map((group, id) => ({ ...group, id }))
}

export function buildParcelGeometry(
  groups: ParcelGroup[],
  origin: [number, number],
): WorkerGeometryPayload {
  const topPositions: number[] = []
  const topIndices: number[] = []
  const topVertexGroups: number[] = []
  const topTriangleGroups: number[] = []
  const sidePositions: number[] = []
  const sideIndices: number[] = []
  const sideVertexGroups: number[] = []
  const sideNormals: number[] = []
  const edgePositions: number[] = []
  const edgeVertexGroups: number[] = []

  for (const group of groups) {
    const polygons =
      group.geometry.type === 'Polygon'
        ? [group.geometry.coordinates]
        : group.geometry.coordinates

    for (const polygon of polygons) {
      const flattened: number[] = []
      const holes: number[] = []
      const rings = polygon.map(ringWithoutClosingPoint)
      let coordinateCount = 0

      rings.forEach((ring, ringIndex) => {
        if (ringIndex > 0) holes.push(coordinateCount)
        for (const [absoluteX, absoluteY] of ring) {
          flattened.push(absoluteX - origin[0], -(absoluteY - origin[1]))
          coordinateCount += 1
        }
      })

      const vertexOffset = topPositions.length / 3
      for (let index = 0; index < flattened.length; index += 2) {
        topPositions.push(flattened[index], group.height, flattened[index + 1])
        topVertexGroups.push(group.id)
      }

      const triangles = earcut(flattened, holes, 2)
      for (let index = 0; index < triangles.length; index += 3) {
        topIndices.push(
          vertexOffset + triangles[index],
          vertexOffset + triangles[index + 2],
          vertexOffset + triangles[index + 1],
        )
        topTriangleGroups.push(group.id)
      }

      for (const ring of rings) {
        for (let index = 0; index < ring.length; index += 1) {
          const current = ring[index]
          const next = ring[(index + 1) % ring.length]
          const ax = current[0] - origin[0]
          const az = -(current[1] - origin[1])
          const bx = next[0] - origin[0]
          const bz = -(next[1] - origin[1])
          const sideOffset = sidePositions.length / 3
          const length = Math.hypot(bx - ax, bz - az) || 1
          const normalX = -(bz - az) / length
          const normalZ = (bx - ax) / length

          sidePositions.push(
            ax,
            0.3,
            az,
            bx,
            0.3,
            bz,
            bx,
            group.height,
            bz,
            ax,
            group.height,
            az,
          )
          sideVertexGroups.push(group.id, group.id, group.id, group.id)
          sideNormals.push(
            normalX,
            0,
            normalZ,
            normalX,
            0,
            normalZ,
            normalX,
            0,
            normalZ,
            normalX,
            0,
            normalZ,
          )
          sideIndices.push(
            sideOffset,
            sideOffset + 1,
            sideOffset + 2,
            sideOffset,
            sideOffset + 2,
            sideOffset + 3,
          )
          edgePositions.push(
            ax,
            group.height + 0.12,
            az,
            bx,
            group.height + 0.12,
            bz,
          )
          edgeVertexGroups.push(group.id, group.id)
        }
      }
    }
  }

  return {
    topPositions: Float32Array.from(topPositions),
    topIndices: Uint32Array.from(topIndices),
    topVertexGroups: Uint32Array.from(topVertexGroups),
    topTriangleGroups: Uint32Array.from(topTriangleGroups),
    sidePositions: Float32Array.from(sidePositions),
    sideIndices: Uint32Array.from(sideIndices),
    sideVertexGroups: Uint32Array.from(sideVertexGroups),
    sideNormals: Float32Array.from(sideNormals),
    edgePositions: Float32Array.from(edgePositions),
    edgeVertexGroups: Uint32Array.from(edgeVertexGroups),
    groups,
  }
}
