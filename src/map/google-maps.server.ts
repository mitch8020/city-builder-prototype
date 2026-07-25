import '@tanstack/react-start/server-only'
import { GOOGLE_MAP_SERVICE_BOUNDS } from './constants'

export { GOOGLE_MAP_SERVICE_BOUNDS } from './constants'

const GOOGLE_SESSION_ENDPOINT = 'https://tile.googleapis.com/v1/createSession'
const GOOGLE_TILE_ENDPOINT = 'https://tile.googleapis.com/v1/2dtiles'
const GOOGLE_VIEWPORT_ENDPOINT = 'https://tile.googleapis.com/tile/v1/viewport'

const WORLD_HALF = 20_037_508.342789244
const WORLD_SIZE = WORLD_HALF * 2
const EARTH_RADIUS = WORLD_HALF / Math.PI
const MIN_ZOOM = 8
const MAX_ZOOM = 18
const SESSION_REFRESH_SKEW_MS = 60_000

interface GoogleSessionResponse {
  session?: unknown
  expiry?: unknown
  tileWidth?: unknown
  tileHeight?: unknown
}

interface CachedSession {
  apiKey: string
  token: string
  expiresAt: number
}

interface PendingSession {
  apiKey: string
  request: Promise<CachedSession>
}

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

interface GoogleMapsGatewayOptions {
  fetcher?: typeof fetch
  getApiKey?: () => string | undefined
  now?: () => number
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

export class GoogleMapsGateway {
  private readonly fetcher: typeof fetch
  private readonly getApiKey: () => string | undefined
  private readonly now: () => number
  private session?: CachedSession
  private pendingSession?: PendingSession

  constructor(options: GoogleMapsGatewayOptions = {}) {
    this.fetcher =
      options.fetcher ?? ((input, init) => globalThis.fetch(input, init))
    this.getApiKey =
      options.getApiKey ?? (() => process.env.GOOGLE_MAPS_API_KEY)
    this.now = options.now ?? Date.now
  }

  async tile(coordinates: GoogleTileCoordinates, ifNoneMatch?: string | null) {
    validateTileCoordinates(coordinates)
    const headers = new Headers({ Accept: 'image/*' })
    if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch)

    const upstream = await this.withSession((session) => {
      const url = new URL(
        `${GOOGLE_TILE_ENDPOINT}/${coordinates.zoom}/${coordinates.x}/${coordinates.y}`,
      )
      url.searchParams.set('session', session.token)
      url.searchParams.set('key', session.apiKey)
      return this.fetcher(url, { headers })
    })

    if (upstream.status === 304) {
      return new Response(null, {
        status: 304,
        headers: copyUpstreamHeaders(upstream.headers),
      })
    }
    if (!upstream.ok) throw upstreamFailure(upstream)
    const contentType = upstream.headers.get('content-type')
    if (!contentType?.toLowerCase().startsWith('image/')) {
      throw new GoogleMapsGatewayError(
        502,
        'The Google map tile response was invalid.',
      )
    }

    return new Response(upstream.body, {
      status: 200,
      headers: copyUpstreamHeaders(upstream.headers),
    })
  }

  async attribution(viewport: GoogleViewport) {
    const clipped = validateAndClipViewport(viewport)
    const upstream = await this.withSession((session) => {
      const url = new URL(GOOGLE_VIEWPORT_ENDPOINT)
      url.searchParams.set('session', session.token)
      url.searchParams.set('key', session.apiKey)
      url.searchParams.set('zoom', String(clipped.zoom))
      url.searchParams.set('north', formatCoordinate(clipped.north))
      url.searchParams.set('south', formatCoordinate(clipped.south))
      url.searchParams.set('east', formatCoordinate(clipped.east))
      url.searchParams.set('west', formatCoordinate(clipped.west))
      return this.fetcher(url, {
        headers: { Accept: 'application/json' },
      })
    })

    if (!upstream.ok) throw upstreamFailure(upstream)
    const payload = (await upstream.json()) as { copyright?: unknown }
    if (typeof payload.copyright !== 'string' || !payload.copyright.trim()) {
      throw new GoogleMapsGatewayError(
        502,
        'The Google map attribution response was invalid.',
      )
    }

    const headers = copyUpstreamHeaders(upstream.headers)
    headers.set('Content-Type', 'application/json; charset=utf-8')
    if (!headers.has('Cache-Control')) {
      headers.set('Cache-Control', 'private, max-age=300')
    }
    return new Response(
      JSON.stringify({ copyright: payload.copyright.trim() }),
      { status: 200, headers },
    )
  }

  private async withSession(
    request: (session: CachedSession) => Promise<Response>,
  ) {
    let session = await this.getSession()
    let response = await request(session)
    if (response.status !== 401 && response.status !== 403) return response

    session = await this.getSession(true)
    response = await request(session)
    return response
  }

  private async getSession(forceRefresh = false) {
    const apiKey = this.requireApiKey()
    if (forceRefresh) this.session = undefined

    if (
      this.session?.apiKey === apiKey &&
      this.session.expiresAt > this.now() + SESSION_REFRESH_SKEW_MS
    ) {
      return this.session
    }
    if (this.pendingSession?.apiKey === apiKey) {
      return this.pendingSession.request
    }

    const request = this.createSession(apiKey).finally(() => {
      if (this.pendingSession?.request === request) {
        this.pendingSession = undefined
      }
    })
    this.pendingSession = { apiKey, request }
    return request
  }

  private async createSession(apiKey: string) {
    const url = new URL(GOOGLE_SESSION_ENDPOINT)
    url.searchParams.set('key', apiKey)
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mapType: 'roadmap',
        language: 'en-US',
        region: 'US',
      }),
    })
    if (!response.ok) {
      throw new GoogleMapsGatewayError(
        response.status === 429 ? 503 : 502,
        'Google Maps could not start a map session.',
        response.headers.get('retry-after') ?? undefined,
      )
    }

    const payload = (await response.json()) as GoogleSessionResponse
    const expirySeconds = Number(payload.expiry)
    if (
      typeof payload.session !== 'string' ||
      !payload.session ||
      !Number.isFinite(expirySeconds) ||
      expirySeconds <= 0 ||
      payload.tileWidth !== 256 ||
      payload.tileHeight !== 256
    ) {
      throw new GoogleMapsGatewayError(
        502,
        'Google Maps returned an invalid map session.',
      )
    }

    this.session = {
      apiKey,
      token: payload.session,
      expiresAt: expirySeconds * 1000,
    }
    return this.session
  }

  private requireApiKey() {
    const apiKey = this.getApiKey()?.trim()
    if (!apiKey) {
      throw new GoogleMapsGatewayError(
        503,
        'Google Maps is not configured for this deployment.',
      )
    }
    return apiKey
  }
}

export const googleMapsGateway = new GoogleMapsGateway()

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
  validateTileCoordinates(coordinates)
  return coordinates
}

export function parseGoogleViewport(requestUrl: string): GoogleViewport {
  const search = new URL(requestUrl).searchParams
  return validateAndClipViewport({
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

function validateTileCoordinates(coordinates: GoogleTileCoordinates) {
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

function validateAndClipViewport(viewport: GoogleViewport): GoogleViewport {
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

function mercatorTileBounds(x: number, y: number, zoom: number) {
  const tileSize = WORLD_SIZE / 2 ** zoom
  const minX = -WORLD_HALF + x * tileSize
  const maxX = minX + tileSize
  const maxY = WORLD_HALF - y * tileSize
  const minY = maxY - tileSize
  return [minX, minY, maxX, maxY] as const
}

function mercatorToLngLat(x: number, y: number) {
  return [
    (x / WORLD_HALF) * 180,
    (Math.atan(Math.sinh(y / EARTH_RADIUS)) * 180) / Math.PI,
  ] as const
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

function formatCoordinate(value: number) {
  return value.toFixed(6)
}

function copyUpstreamHeaders(source: Headers) {
  const headers = new Headers()
  for (const name of [
    'cache-control',
    'content-type',
    'etag',
    'expires',
    'last-modified',
  ]) {
    const value = source.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

function upstreamFailure(response: Response) {
  const retryAfter = response.headers.get('retry-after') ?? undefined
  if (response.status === 429) {
    return new GoogleMapsGatewayError(
      503,
      'Google Maps is temporarily rate limited.',
      retryAfter,
    )
  }
  if (response.status === 404) {
    return new GoogleMapsGatewayError(
      404,
      'The requested Google map content was not found.',
    )
  }
  return new GoogleMapsGatewayError(
    502,
    'Google Maps could not complete the map request.',
    retryAfter,
  )
}
