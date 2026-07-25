import '@tanstack/react-start/server-only'
import { GOOGLE_MAP_SERVICE_BOUNDS } from './constants'
import { mercatorTileBounds, mercatorToLngLat } from './web-mercator'

const MIN_ZOOM = 8
const MAX_ZOOM = 18

export interface GoogleTileCoordinates {
  zoom: number
  x: number
  y: number
}

export interface GoogleViewport {
  zoom: number
  north: number
  south: number
  east: number
  west: number
}

export class GoogleMapsGatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message)
    this.name = 'GoogleMapsGatewayError'
  }
}

export function validateGoogleTileCoordinates(
  coordinates: GoogleTileCoordinates,
) {
  const { zoom, x, y } = coordinates
  const maximumCoordinate = 2 ** zoom - 1
  if (
    !Number.isInteger(zoom) ||
    zoom < MIN_ZOOM ||
    zoom > MAX_ZOOM ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x > maximumCoordinate ||
    y > maximumCoordinate
  ) {
    throw new GoogleMapsGatewayError(
      400,
      'The requested Google map tile is invalid.',
    )
  }

  const bounds = mercatorTileBounds(x, y, zoom)
  if (!boundsIntersect(bounds, GOOGLE_MAP_SERVICE_BOUNDS)) {
    throw new GoogleMapsGatewayError(
      404,
      'The requested Google map tile is outside Davidson County.',
    )
  }
}

export function validateGoogleViewport(
  viewport: GoogleViewport,
): GoogleViewport {
  const { zoom, north, south, east, west } = viewport
  if (
    !Number.isInteger(zoom) ||
    zoom < MIN_ZOOM ||
    zoom > MAX_ZOOM ||
    !Number.isFinite(north) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(west) ||
    north <= south ||
    east <= west ||
    north > 90 ||
    south < -90 ||
    east > 180 ||
    west < -180
  ) {
    throw new GoogleMapsGatewayError(
      400,
      'The requested Google map viewport is invalid.',
    )
  }

  const [allowedWest, allowedSouth] = mercatorToLngLat(
    GOOGLE_MAP_SERVICE_BOUNDS[0],
    GOOGLE_MAP_SERVICE_BOUNDS[1],
  )
  const [allowedEast, allowedNorth] = mercatorToLngLat(
    GOOGLE_MAP_SERVICE_BOUNDS[2],
    GOOGLE_MAP_SERVICE_BOUNDS[3],
  )
  const clipped = {
    zoom,
    north: Math.min(north, allowedNorth),
    south: Math.max(south, allowedSouth),
    east: Math.min(east, allowedEast),
    west: Math.max(west, allowedWest),
  }
  if (clipped.north <= clipped.south || clipped.east <= clipped.west) {
    throw new GoogleMapsGatewayError(
      404,
      'The requested Google map viewport is outside Davidson County.',
    )
  }
  return clipped
}

function boundsIntersect(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
) {
  return !(
    left[2] < right[0] ||
    left[0] > right[2] ||
    left[3] < right[1] ||
    left[1] > right[3]
  )
}
