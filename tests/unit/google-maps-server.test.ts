import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_MAP_SERVICE_BOUNDS,
  GoogleMapsGateway,
  GoogleMapsGatewayError,
  googleMapsErrorResponse,
  parseGoogleTileCoordinates,
  parseGoogleViewport,
} from '../../src/map/google-maps.server'
import { mercatorTileCoordinate } from '../../src/map/tile-manager'

const nashvilleTile = {
  zoom: 15,
  ...mercatorTileCoordinate(-9_660_700, 4_326_400, 15),
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function sessionResponse(
  session = 'session-token',
  expiry: unknown = '9999999999',
  tileWidth: unknown = 256,
  tileHeight: unknown = 256,
) {
  return Response.json({ session, expiry, tileWidth, tileHeight })
}

function tileResponse(
  status = 200,
  headers: Record<string, string> = {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=300',
    ETag: '"tile-etag"',
    Expires: 'tomorrow',
    'Last-Modified': 'today',
  },
) {
  return new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, {
    status,
    headers,
  })
}

describe('Google Maps request validation', () => {
  it('parses a valid Davidson County tile and rejects malformed or remote tiles', () => {
    expect(
      parseGoogleTileCoordinates({
        zoom: String(nashvilleTile.zoom),
        x: String(nashvilleTile.x),
        y: String(nashvilleTile.y),
      }),
    ).toEqual(nashvilleTile)

    for (const params of [
      {},
      { zoom: '8.5', x: '1', y: '1' },
      { zoom: '7', x: '1', y: '1' },
      { zoom: '19', x: '1', y: '1' },
      { zoom: '8', x: '-1', y: '1' },
      { zoom: '8', x: '256', y: '1' },
      { zoom: '8', x: '1', y: '256' },
    ]) {
      expect(() => parseGoogleTileCoordinates(params)).toThrow(
        GoogleMapsGatewayError,
      )
    }
    expect(() =>
      parseGoogleTileCoordinates({ zoom: '18', x: '0', y: '0' }),
    ).toThrow('outside Davidson County')
  })

  it('clips valid viewports to the service envelope and rejects invalid ones', () => {
    const viewport = parseGoogleViewport(
      'http://localhost/api/google-map/attribution?zoom=8&north=90&south=-90&east=180&west=-180',
    )
    expect(viewport.zoom).toBe(8)
    expect(viewport.north).toBeLessThan(90)
    expect(viewport.south).toBeGreaterThan(-90)
    expect(viewport.east).toBeLessThan(180)
    expect(viewport.west).toBeGreaterThan(-180)
    expect(GOOGLE_MAP_SERVICE_BOUNDS[0]).toBeLessThan(
      GOOGLE_MAP_SERVICE_BOUNDS[2],
    )

    for (const query of [
      '',
      'zoom=7&north=37&south=36&east=-86&west=-87',
      'zoom=8&north=36&south=37&east=-86&west=-87',
      'zoom=8&north=37&south=36&east=-87&west=-86',
      'zoom=8&north=91&south=36&east=-86&west=-87',
      'zoom=8&north=37&south=-91&east=-86&west=-87',
      'zoom=8&north=37&south=36&east=181&west=-87',
      'zoom=8&north=37&south=36&east=-86&west=-181',
      'zoom=8&north=x&south=36&east=-86&west=-87',
    ]) {
      expect(() =>
        parseGoogleViewport(
          `http://localhost/api/google-map/attribution?${query}`,
        ),
      ).toThrow(GoogleMapsGatewayError)
    }
    expect(() =>
      parseGoogleViewport(
        'http://localhost/api/google-map/attribution?zoom=8&north=1&south=0&east=1&west=0',
      ),
    ).toThrow('outside Davidson County')
  })
})

describe('Google Maps server gateway', () => {
  it('uses the runtime environment and global fetch defaults', async () => {
    const previousKey = process.env.GOOGLE_MAPS_API_KEY
    process.env.GOOGLE_MAPS_API_KEY = 'runtime-key'
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(tileResponse())
    vi.stubGlobal('fetch', fetcher)
    try {
      const gateway = new GoogleMapsGateway({ now: () => 1 })
      expect((await gateway.tile(nashvilleTile)).status).toBe(200)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      if (previousKey === undefined) {
        delete process.env.GOOGLE_MAPS_API_KEY
      } else {
        process.env.GOOGLE_MAPS_API_KEY = previousKey
      }
    }
  })

  it('shares a server-only session, proxies cache headers, and sanitizes attribution', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/createSession')) {
          expect(init?.method).toBe('POST')
          expect(init?.body).toContain('"mapType":"roadmap"')
          return sessionResponse()
        }
        if (url.pathname.includes('/2dtiles/')) {
          expect(url.searchParams.get('key')).toBe('server-secret')
          expect(url.searchParams.get('session')).toBe('session-token')
          return tileResponse()
        }
        expect(url.pathname).toBe('/tile/v1/viewport')
        expect(url.searchParams.get('north')).toMatch(/^-?\d+\.\d{6}$/)
        return Response.json(
          { copyright: '  Map data ©2026 Google  ' },
          { headers: { ETag: '"attribution"' } },
        )
      },
    )
    const gateway = new GoogleMapsGateway({
      fetcher: fetcher,
      getApiKey: () => ' server-secret ',
      now: () => 1,
    })

    const [first, second] = await Promise.all([
      gateway.tile(nashvilleTile),
      gateway.tile(nashvilleTile),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, max-age=300')
    expect(first.headers.get('etag')).toBe('"tile-etag"')
    expect(first.headers.get('expires')).toBe('tomorrow')
    expect(first.headers.get('last-modified')).toBe('today')
    expect((await first.arrayBuffer()).byteLength).toBe(3)
    expect(
      fetcher.mock.calls.filter(([input]) =>
        String(input).includes('createSession'),
      ),
    ).toHaveLength(1)

    const attribution = await gateway.attribution({
      zoom: 15,
      north: 90,
      south: -90,
      east: 180,
      west: -180,
    })
    expect(await attribution.json()).toEqual({
      copyright: 'Map data ©2026 Google',
    })
    expect(attribution.headers.get('cache-control')).toBe(
      'private, max-age=300',
    )
    expect(attribution.headers.get('etag')).toBe('"attribution"')
  })

  it('forwards conditional tile requests and 304 responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockImplementationOnce(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(new Headers(init?.headers).get('if-none-match')).toBe(
            '"known"',
          )
          return tileResponse(304, { ETag: '"known"' })
        },
      )
    const gateway = new GoogleMapsGateway({
      fetcher: fetcher as typeof fetch,
      getApiKey: () => 'key',
    })
    const response = await gateway.tile(nashvilleTile, '"known"')
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"known"')
  })

  it('refreshes an expiring session and a rotated key', async () => {
    let now = 0
    let apiKey = 'first-key'
    let sessionNumber = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/createSession')) {
        sessionNumber += 1
        return sessionResponse(`session-${sessionNumber}`, '120')
      }
      return tileResponse()
    })
    const gateway = new GoogleMapsGateway({
      fetcher: fetcher,
      getApiKey: () => apiKey,
      now: () => now,
    })

    await gateway.tile(nashvilleTile)
    await gateway.tile(nashvilleTile)
    expect(sessionNumber).toBe(1)
    now = 70_000
    await gateway.tile(nashvilleTile)
    expect(sessionNumber).toBe(2)
    apiKey = 'second-key'
    await gateway.tile(nashvilleTile)
    expect(sessionNumber).toBe(3)
  })

  it('does not let an older key request clear a newer pending session', async () => {
    let apiKey = 'first-key'
    let resolveFirst: ((response: Response) => void) | undefined
    const firstSession = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/createSession')) {
        if (url.searchParams.get('key') === 'first-key') return firstSession
        return sessionResponse('second-session')
      }
      return tileResponse()
    })
    const gateway = new GoogleMapsGateway({
      fetcher: fetcher,
      getApiKey: () => apiKey,
    })

    const first = gateway.tile(nashvilleTile)
    apiKey = 'second-key'
    await gateway.tile(nashvilleTile)
    resolveFirst?.(sessionResponse('first-session'))
    await first
    expect(
      fetcher.mock.calls.filter(([input]) =>
        String(input).includes('createSession'),
      ),
    ).toHaveLength(2)
  })

  it('refreshes once after Google rejects an active session', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse('first'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(sessionResponse('second'))
      .mockResolvedValueOnce(tileResponse())
    const gateway = new GoogleMapsGateway({
      fetcher: fetcher as typeof fetch,
      getApiKey: () => 'key',
    })
    expect((await gateway.tile(nashvilleTile)).status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('fails safely when the key or Google session is unavailable', async () => {
    await expect(
      new GoogleMapsGateway({ getApiKey: () => ' ' }).tile(nashvilleTile),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Google Maps is not configured for this deployment.',
    })

    for (const response of [
      sessionResponse('', '9999999999'),
      sessionResponse('session', 'not-a-time'),
      sessionResponse('session', '0'),
      sessionResponse('session', '9999999999', 512),
      sessionResponse('session', '9999999999', 256, 512),
    ]) {
      const gateway = new GoogleMapsGateway({
        fetcher: vi.fn(async () => response.clone()) as unknown as typeof fetch,
        getApiKey: () => 'key',
      })
      await expect(gateway.tile(nashvilleTile)).rejects.toMatchObject({
        status: 502,
        message: 'Google Maps returned an invalid map session.',
      })
    }

    for (const status of [429, 500]) {
      const gateway = new GoogleMapsGateway({
        fetcher: vi.fn(
          async () =>
            new Response(null, {
              status,
              headers: { 'Retry-After': '10' },
            }),
        ) as unknown as typeof fetch,
        getApiKey: () => 'key',
      })
      await expect(gateway.tile(nashvilleTile)).rejects.toMatchObject({
        status: status === 429 ? 503 : 502,
        message: 'Google Maps could not start a map session.',
        retryAfter: '10',
      })
    }

    const noRetryHeader = new GoogleMapsGateway({
      fetcher: vi.fn(
        async () => new Response(null, { status: 500 }),
      ) as unknown as typeof fetch,
      getApiKey: () => 'key',
    })
    await expect(noRetryHeader.tile(nashvilleTile)).rejects.toMatchObject({
      retryAfter: undefined,
    })
  })

  it('maps upstream tile and attribution failures to safe responses', async () => {
    async function gatewayFor(response: Response) {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(response)
      return new GoogleMapsGateway({
        fetcher: fetcher as typeof fetch,
        getApiKey: () => 'key',
      })
    }

    await expect(
      (
        await gatewayFor(
          new Response('not an image', {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      ).tile(nashvilleTile),
    ).rejects.toThrow('tile response was invalid')

    for (const [status, expectedStatus, message] of [
      [429, 503, 'temporarily rate limited'],
      [404, 404, 'content was not found'],
      [500, 502, 'could not complete'],
    ] as const) {
      await expect(
        (
          await gatewayFor(
            new Response(null, {
              status,
              headers: { 'Retry-After': '5' },
            }),
          )
        ).tile(nashvilleTile),
      ).rejects.toMatchObject({
        status: expectedStatus,
        message: expect.stringContaining(message),
      })
    }

    await expect(
      (await gatewayFor(new Response(null, { status: 500 }))).attribution({
        zoom: 15,
        north: 37,
        south: 36,
        east: -86,
        west: -87,
      }),
    ).rejects.toThrow('could not complete')

    for (const copyright of [undefined, '', 42]) {
      await expect(
        (await gatewayFor(Response.json({ copyright }))).attribution({
          zoom: 15,
          north: 37,
          south: 36,
          east: -86,
          west: -87,
        }),
      ).rejects.toThrow('attribution response was invalid')
    }

    const cachedAttribution = await (
      await gatewayFor(
        Response.json(
          { copyright: 'Map data ©2026 Google' },
          { headers: { 'Cache-Control': 'private, max-age=60' } },
        ),
      )
    ).attribution({
      zoom: 15,
      north: 37,
      south: 36,
      east: -86,
      west: -87,
    })
    expect(cachedAttribution.headers.get('cache-control')).toBe(
      'private, max-age=60',
    )
  })

  it('renders known and unknown gateway errors without leaking internals', async () => {
    const known = googleMapsErrorResponse(
      new GoogleMapsGatewayError(503, 'Temporarily unavailable.', '12'),
    )
    expect(known.status).toBe(503)
    expect(known.headers.get('retry-after')).toBe('12')
    expect(known.headers.get('cache-control')).toBe('no-store')
    expect(await known.text()).toBe('Temporarily unavailable.')

    const unknown = googleMapsErrorResponse(new Error('secret failure'))
    expect(unknown.status).toBe(500)
    expect(await unknown.text()).toBe(
      'The Google map request could not be completed.',
    )
  })
})
