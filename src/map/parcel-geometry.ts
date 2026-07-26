import earcut from 'earcut'
import { parcelMassing, PARCEL_SLAB_HEIGHT } from './parcel-massing'
import type { ParcelFeature, ParcelGroup, WorkerGeometryPayload } from './types'

const MINIMUM_MASSING_EDGE = 2
const MASSING_FIT_ATTEMPTS = 8
const SEGMENT_EPSILON = 1e-7

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

function ringArea(ring: number[][]) {
  let area = 0
  const openRing = ringWithoutClosingPoint(ring)
  for (let index = 0; index < openRing.length; index += 1) {
    const current = openRing[index]
    const next = openRing[(index + 1) % openRing.length]
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) / 2
}

function pointInRing(point: [number, number], ring: number[][]) {
  let inside = false
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current, current += 1
  ) {
    const [xi, yi] = ring[current]
    const [xj, yj] = ring[previous]
    const crosses =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function pointInPolygon(point: [number, number], polygon: number[][][]) {
  return (
    pointInRing(point, polygon[0]) &&
    !polygon.slice(1).some((hole) => pointInRing(point, hole))
  )
}

function crossProduct(
  start: [number, number],
  end: [number, number],
  point: [number, number],
) {
  return (
    (end[0] - start[0]) * (point[1] - start[1]) -
    (end[1] - start[1]) * (point[0] - start[0])
  )
}

function pointOnSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const outsideDistance = Math.max(
    0,
    Math.min(start[0], end[0]) - point[0],
    point[0] - Math.max(start[0], end[0]),
    Math.min(start[1], end[1]) - point[1],
    point[1] - Math.max(start[1], end[1]),
  )
  return (
    Math.max(outsideDistance, Math.abs(crossProduct(start, end, point))) <=
    SEGMENT_EPSILON
  )
}

function segmentsIntersect(
  firstStart: [number, number],
  firstEnd: [number, number],
  secondStart: [number, number],
  secondEnd: [number, number],
) {
  const firstSideStart = crossProduct(firstStart, firstEnd, secondStart)
  const firstSideEnd = crossProduct(firstStart, firstEnd, secondEnd)
  const secondSideStart = crossProduct(secondStart, secondEnd, firstStart)
  const secondSideEnd = crossProduct(secondStart, secondEnd, firstEnd)
  if (
    ((firstSideStart > SEGMENT_EPSILON && firstSideEnd < -SEGMENT_EPSILON) ||
      (firstSideStart < -SEGMENT_EPSILON && firstSideEnd > SEGMENT_EPSILON)) &&
    ((secondSideStart > SEGMENT_EPSILON && secondSideEnd < -SEGMENT_EPSILON) ||
      (secondSideStart < -SEGMENT_EPSILON && secondSideEnd > SEGMENT_EPSILON))
  ) {
    return true
  }
  return (
    pointOnSegment(secondStart, firstStart, firstEnd) ||
    pointOnSegment(secondEnd, firstStart, firstEnd) ||
    pointOnSegment(firstStart, secondStart, secondEnd) ||
    pointOnSegment(firstEnd, secondStart, secondEnd)
  )
}

function ringIntersectsFootprint(
  ring: number[][],
  footprint: [number, number][],
) {
  const openRing = ringWithoutClosingPoint(ring) as [number, number][]
  for (let ringIndex = 0; ringIndex < openRing.length; ringIndex += 1) {
    const ringStart = openRing[ringIndex]
    const ringEnd = openRing[(ringIndex + 1) % openRing.length]
    for (
      let footprintIndex = 0;
      footprintIndex < footprint.length;
      footprintIndex += 1
    ) {
      if (
        segmentsIntersect(
          ringStart,
          ringEnd,
          footprint[footprintIndex],
          footprint[(footprintIndex + 1) % footprint.length],
        )
      ) {
        return true
      }
    }
  }
  return false
}

function footprintFitsPolygon(
  polygon: number[][][],
  footprint: [number, number][],
) {
  if (polygon.some((ring) => ringIntersectsFootprint(ring, footprint))) {
    return false
  }
  return !polygon
    .slice(1)
    .some((hole) =>
      ringWithoutClosingPoint(hole).some((point) =>
        pointInRing(point as [number, number], footprint),
      ),
    )
}

function largestPolygon(geometry: ParcelFeature['geometry']) {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.reduce<number[][][] | undefined>((largest, polygon) => {
    const area =
      ringArea(polygon[0]) -
      polygon.slice(1).reduce((total, hole) => total + ringArea(hole), 0)
    const largestArea = largest
      ? ringArea(largest[0]) -
        largest.slice(1).reduce((total, hole) => total + ringArea(hole), 0)
      : -Infinity
    return area > largestArea ? polygon : largest
  }, undefined)
}

function dominantAxis(ring: number[][]) {
  let axis: [number, number] = [1, 0]
  let longest = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    const dx = next[0] - current[0]
    const dy = next[1] - current[1]
    const length = Math.hypot(dx, dy)
    if (length > longest) {
      longest = length
      axis = [dx / length, dy / length]
    }
  }
  return axis
}

function largestTriangleCenter(polygon: number[][][]) {
  const flattened: number[] = []
  const holes: number[] = []
  let coordinateCount = 0
  for (const [ringIndex, sourceRing] of polygon.entries()) {
    const ring = ringWithoutClosingPoint(sourceRing)
    if (ringIndex > 0) holes.push(coordinateCount)
    for (const point of ring) {
      flattened.push(point[0], point[1])
      coordinateCount += 1
    }
  }
  const triangles = earcut(flattened, holes, 2)
  let largestArea = -1
  let center: [number, number] | undefined
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] * 2
    const b = triangles[index + 1] * 2
    const c = triangles[index + 2] * 2
    const area = Math.abs(
      (flattened[b] - flattened[a]) * (flattened[c + 1] - flattened[a + 1]) -
        (flattened[c] - flattened[a]) * (flattened[b + 1] - flattened[a + 1]),
    )
    if (area > largestArea) {
      largestArea = area
      center = [
        (flattened[a] + flattened[b] + flattened[c]) / 3,
        (flattened[a + 1] + flattened[b + 1] + flattened[c + 1]) / 3,
      ]
    }
  }
  return center
}

function massingCorners(
  center: [number, number],
  axis: [number, number],
  width: number,
  depth: number,
) {
  const perpendicular: [number, number] = [-axis[1], axis[0]]
  const halfWidth = width / 2
  const halfDepth = depth / 2
  return [
    [
      center[0] - axis[0] * halfWidth - perpendicular[0] * halfDepth,
      center[1] - axis[1] * halfWidth - perpendicular[1] * halfDepth,
    ],
    [
      center[0] + axis[0] * halfWidth - perpendicular[0] * halfDepth,
      center[1] + axis[1] * halfWidth - perpendicular[1] * halfDepth,
    ],
    [
      center[0] + axis[0] * halfWidth + perpendicular[0] * halfDepth,
      center[1] + axis[1] * halfWidth + perpendicular[1] * halfDepth,
    ],
    [
      center[0] - axis[0] * halfWidth + perpendicular[0] * halfDepth,
      center[1] - axis[1] * halfWidth + perpendicular[1] * halfDepth,
    ],
  ] as [number, number][]
}

function fittedMassingCorners(
  polygon: number[][][],
  center: [number, number],
  axis: [number, number],
  width: number,
  depth: number,
) {
  const corners = massingCorners(center, axis, width, depth)
  const samples = [center, ...corners]
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]
    const next = corners[(index + 1) % corners.length]
    samples.push([(current[0] + next[0]) / 2, (current[1] + next[1]) / 2])
  }
  return samples.every((point) => pointInPolygon(point, polygon)) &&
    footprintFitsPolygon(polygon, corners)
    ? corners
    : undefined
}

function fitMassingFootprint(
  geometry: ParcelFeature['geometry'],
  footprintScale: number,
  maximumWidth: number,
  maximumDepth: number,
) {
  const polygon = largestPolygon(geometry)
  const ring = polygon ? ringWithoutClosingPoint(polygon[0]) : []
  if (!polygon || ring.length < 3) return undefined

  const axis = dominantAxis(ring)
  const perpendicular: [number, number] = [-axis[1], axis[0]]
  const along = ring.map(([x, y]) => x * axis[0] + y * axis[1])
  const across = ring.map(
    ([x, y]) => x * perpendicular[0] + y * perpendicular[1],
  )
  const minimumAlong = Math.min(...along)
  const maximumAlong = Math.max(...along)
  const minimumAcross = Math.min(...across)
  const maximumAcross = Math.max(...across)
  const orientedCenter: [number, number] = [
    axis[0] * ((minimumAlong + maximumAlong) / 2) +
      perpendicular[0] * ((minimumAcross + maximumAcross) / 2),
    axis[1] * ((minimumAlong + maximumAlong) / 2) +
      perpendicular[1] * ((minimumAcross + maximumAcross) / 2),
  ]
  const center = pointInPolygon(orientedCenter, polygon)
    ? orientedCenter
    : largestTriangleCenter(polygon)
  if (!center) return undefined

  let width = Math.min(
    (maximumAlong - minimumAlong) * footprintScale,
    maximumWidth,
  )
  let depth = Math.min(
    (maximumAcross - minimumAcross) * footprintScale,
    maximumDepth,
  )
  for (let attempt = 0; attempt < MASSING_FIT_ATTEMPTS; attempt += 1) {
    if (width < MINIMUM_MASSING_EDGE || depth < MINIMUM_MASSING_EDGE) {
      return undefined
    }
    const corners = fittedMassingCorners(polygon, center, axis, width, depth)
    if (corners) return corners
    width *= 0.78
    depth *= 0.78
  }
  return undefined
}

export function groupParcelFeatures(features: ParcelFeature[]) {
  const byGeometry = new Map<string, Omit<ParcelGroup, 'height' | 'massing'>>()

  for (const feature of features) {
    const key = `${feature.geometry.type}:${JSON.stringify(
      feature.geometry.coordinates,
    )}`
    const existing = byGeometry.get(key)
    if (existing) {
      existing.records.push(feature.properties)
      continue
    }
    const bounds = featureBounds(feature)
    byGeometry.set(key, {
      id: byGeometry.size,
      bounds,
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      records: [feature.properties],
      geometry: feature.geometry,
    })
  }

  return [...byGeometry.values()].map((group): ParcelGroup => {
    const massing = parcelMassing(group.records)
    const footprint =
      massing.kind === 'none'
        ? undefined
        : fitMassingFootprint(
            group.geometry,
            massing.footprintScale,
            massing.maximumWidth,
            massing.maximumDepth,
          )
    const resolvedMassing = footprint
      ? { ...massing, footprint }
      : {
          kind: 'none' as const,
          height: PARCEL_SLAB_HEIGHT,
          footprintScale: 0,
          maximumWidth: 0,
          maximumDepth: 0,
        }
    return {
      ...group,
      height: resolvedMassing.height,
      massing: resolvedMassing,
    }
  })
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

  const addSideRing = (
    ring: number[][],
    bottom: number,
    top: number,
    groupId: number,
  ) => {
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
        bottom,
        az,
        bx,
        bottom,
        bz,
        bx,
        top,
        bz,
        ax,
        top,
        az,
      )
      sideVertexGroups.push(groupId, groupId, groupId, groupId)
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
      edgePositions.push(ax, top + 0.12, az, bx, top + 0.12, bz)
      edgeVertexGroups.push(groupId, groupId)
    }
  }

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
        topPositions.push(
          flattened[index],
          PARCEL_SLAB_HEIGHT,
          flattened[index + 1],
        )
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
        addSideRing(ring, 0.3, PARCEL_SLAB_HEIGHT, group.id)
      }
    }
  }

  const parcelTopIndexCount = topIndices.length
  for (const group of groups) {
    const footprint = group.massing.footprint
    if (footprint) {
      const topOffset = topPositions.length / 3
      for (const [absoluteX, absoluteY] of footprint) {
        topPositions.push(
          absoluteX - origin[0],
          group.height,
          -(absoluteY - origin[1]),
        )
        topVertexGroups.push(group.id)
      }
      topIndices.push(
        topOffset,
        topOffset + 2,
        topOffset + 1,
        topOffset,
        topOffset + 3,
        topOffset + 2,
      )
      topTriangleGroups.push(group.id, group.id)
      addSideRing(footprint, PARCEL_SLAB_HEIGHT, group.height, group.id)
    }
  }

  return {
    parcelTopIndexCount,
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
