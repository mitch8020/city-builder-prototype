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

const GOOGLE_SESSION_ENDPOINT = 'https://tile.googleapis.com/v1/createSession'
const GOOGLE_TILE_ENDPOINT = 'https://tile.googleapis.com/v1/2dtiles'
const GOOGLE_VIEWPORT_ENDPOINT = 'https://tile.googleapis.com/tile/v1/viewport'
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

interface GoogleMapsGatewayOptions {
  fetcher?: typeof fetch
  getApiKey?: () => string | undefined
  now?: () => number
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
    validateGoogleTileCoordinates(coordinates)
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
    const clipped = validateGoogleViewport(viewport)
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
