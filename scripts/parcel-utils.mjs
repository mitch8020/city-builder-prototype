import proj4 from 'proj4'

export const SOURCE_CRS = 'EPSG:2274'
export const WEB_CRS = 'EPSG:3857'
export const BASE_CELL_SIZE = 2048
export const MIN_CELL_SIZE = 256
export const GRID_ORIGIN = [-9_700_000, 4_290_000]

proj4.defs(
  SOURCE_CRS,
  '+proj=lcc +lat_0=34.33333333333334 +lon_0=-86 +lat_1=35.25 +lat_2=36.416666666666664 +x_0=600000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs',
)

export function projectCoordinate(coordinate) {
  const projected = proj4(SOURCE_CRS, WEB_CRS, coordinate)
  if (!Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
    throw new Error(`Projection produced an invalid coordinate: ${coordinate}`)
  }
  return projected
}

export function closeRing(ring) {
  if (ring.length === 0) return ring
  const first = ring[0]
  const last = ring.at(-1)
  if (first[0] === last[0] && first[1] === last[1]) return ring
  return [...ring, [...first]]
}

export function projectGeometry(geometry) {
  if (!geometry) return null

  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) =>
        closeRing(ring.map(projectCoordinate)),
      ),
    }
  }

  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => closeRing(ring.map(projectCoordinate))),
      ),
    }
  }

  throw new Error(`Unsupported parcel geometry type: ${geometry.type}`)
}

export function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]

  const visitRing = (ring) => {
    for (const coordinate of ring) {
      bounds[0] = Math.min(bounds[0], coordinate[0])
      bounds[1] = Math.min(bounds[1], coordinate[1])
      bounds[2] = Math.max(bounds[2], coordinate[0])
      bounds[3] = Math.max(bounds[3], coordinate[1])
    }
  }

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(visitRing)
  } else {
    geometry.coordinates.forEach((polygon) => polygon.forEach(visitRing))
  }

  if (bounds.some((value) => !Number.isFinite(value))) {
    throw new Error('Geometry has no finite bounds')
  }

  return bounds
}

export function geometryCoordinateCount(geometry) {
  if (!geometry) return 0
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.reduce(
    (total, polygon) =>
      total + polygon.reduce((ringTotal, ring) => ringTotal + ring.length, 0),
    0,
  )
}

export function intersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

export function baseCellKeys(bounds) {
  const minX = Math.floor((bounds[0] - GRID_ORIGIN[0]) / BASE_CELL_SIZE)
  const maxX = Math.floor((bounds[2] - GRID_ORIGIN[0]) / BASE_CELL_SIZE)
  const minY = Math.floor((bounds[1] - GRID_ORIGIN[1]) / BASE_CELL_SIZE)
  const maxY = Math.floor((bounds[3] - GRID_ORIGIN[1]) / BASE_CELL_SIZE)
  const keys = []

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) keys.push(`${x}-${y}`)
  }

  return keys
}

export function cellBounds(key, size = BASE_CELL_SIZE) {
  const [x, y] = key.split('-').map(Number)
  const minX = GRID_ORIGIN[0] + x * BASE_CELL_SIZE
  const minY = GRID_ORIGIN[1] + y * BASE_CELL_SIZE
  return [minX, minY, minX + size, minY + size]
}

export function childCells(parentBounds, idPrefix) {
  const size = (parentBounds[2] - parentBounds[0]) / 2
  return [
    {
      id: `${idPrefix}-0`,
      bounds: [
        parentBounds[0],
        parentBounds[1],
        parentBounds[0] + size,
        parentBounds[1] + size,
      ],
    },
    {
      id: `${idPrefix}-1`,
      bounds: [
        parentBounds[0] + size,
        parentBounds[1],
        parentBounds[2],
        parentBounds[1] + size,
      ],
    },
    {
      id: `${idPrefix}-2`,
      bounds: [
        parentBounds[0],
        parentBounds[1] + size,
        parentBounds[0] + size,
        parentBounds[3],
      ],
    },
    {
      id: `${idPrefix}-3`,
      bounds: [
        parentBounds[0] + size,
        parentBounds[1] + size,
        parentBounds[2],
        parentBounds[3],
      ],
    },
  ]
}

export function quantiles(values, cuts = [0.2, 0.4, 0.6, 0.8]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return cuts.map(() => 0)
  return cuts.map((cut) => sorted[Math.floor((sorted.length - 1) * cut)])
}

export function primaryZoning(value) {
  const text = `${value ?? ''}`.trim()
  if (!text) return ''
  return text.split(/[;,/]/)[0].trim()
}

export function sourceDateFromDbfHeader(header) {
  return `${1900 + header[1]}-${String(header[2]).padStart(2, '0')}-${String(
    header[3],
  ).padStart(2, '0')}`
}
