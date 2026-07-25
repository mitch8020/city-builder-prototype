import '@tanstack/react-start/server-only'
import {
  GoogleMapsGatewayError,
  validateGoogleTileCoordinates,
  validateGoogleViewport,
} from './google-maps-contract.server'
import type {
  GoogleTileCoordinates,
  GoogleViewport,
} from './google-maps-contract.server'

export function parseGoogleTileCoordinates(params: {
  zoom?: string
  x?: string
  y?: string
}): GoogleTileCoordinates {
  const coordinates = {
    zoom: parseInteger(params.zoom),
    x: parseInteger(params.x),
    y: parseInteger(params.y),
  }
  validateGoogleTileCoordinates(coordinates)
  return coordinates
}

export function parseGoogleViewport(requestUrl: string): GoogleViewport {
  const search = new URL(requestUrl).searchParams
  return validateGoogleViewport({
    zoom: parseInteger(search.get('zoom') ?? undefined),
    north: parseNumber(search.get('north')),
    south: parseNumber(search.get('south')),
    east: parseNumber(search.get('east')),
    west: parseNumber(search.get('west')),
  })
}

export function googleMapsErrorResponse(error: unknown) {
  const failure =
    error instanceof GoogleMapsGatewayError
      ? error
      : new GoogleMapsGatewayError(
          500,
          'The Google map request could not be completed.',
        )
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  })
  if (failure.retryAfter) headers.set('Retry-After', failure.retryAfter)
  return new Response(failure.message, {
    status: failure.status,
    headers,
  })
}

function parseInteger(value: string | undefined) {
  if (value === undefined || !/^\d+$/.test(value)) return Number.NaN
  return Number(value)
}

function parseNumber(value: string | null) {
  if (value === null || !value.trim()) return Number.NaN
  return Number(value)
}
