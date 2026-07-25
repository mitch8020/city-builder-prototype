import { expect, it, vi } from 'vitest'

interface RouteConfig {
  server: {
    handlers: {
      GET: (context: {
        params: Record<string, string>
        request: Request
      }) => Promise<Response>
    }
  }
}

const routes = vi.hoisted(() => new Map<string, RouteConfig>())
const doubles = vi.hoisted(() => ({
  parseTile: vi.fn(() => ({ zoom: 15, x: 1, y: 2 })),
  parseViewport: vi.fn(() => ({
    zoom: 15,
    north: 37,
    south: 36,
    east: -86,
    west: -87,
  })),
  tile: vi.fn(async () => new Response('tile')),
  attribution: vi.fn(async () => Response.json({ copyright: 'Map data' })),
  errorResponse: vi.fn(() => new Response('safe error', { status: 418 })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: RouteConfig) => {
    routes.set(path, config)
    return { options: config }
  },
}))

vi.mock('../../src/map/google-maps.server', () => ({
  googleMapsGateway: {
    tile: doubles.tile,
    attribution: doubles.attribution,
  },
  parseGoogleTileCoordinates: doubles.parseTile,
  parseGoogleViewport: doubles.parseViewport,
  googleMapsErrorResponse: doubles.errorResponse,
}))

await import('../../src/routes/api/google-map/tiles/$zoom/$x/$y')
await import('../../src/routes/api/google-map/attribution')

it('routes safe tile and attribution requests through the server gateway', async () => {
  const tileHandler = routes.get('/api/google-map/tiles/$zoom/$x/$y')!.server
    .handlers.GET
  const attributionHandler = routes.get('/api/google-map/attribution')!.server
    .handlers.GET

  const tileRequest = new Request(
    'http://localhost/api/google-map/tiles/15/1/2',
    { headers: { 'If-None-Match': '"etag"' } },
  )
  expect(
    await (
      await tileHandler({
        params: { zoom: '15', x: '1', y: '2' },
        request: tileRequest,
      })
    ).text(),
  ).toBe('tile')
  expect(doubles.parseTile).toHaveBeenCalledWith({
    zoom: '15',
    x: '1',
    y: '2',
  })
  expect(doubles.tile).toHaveBeenCalledWith({ zoom: 15, x: 1, y: 2 }, '"etag"')

  const attributionRequest = new Request(
    'http://localhost/api/google-map/attribution?zoom=15',
  )
  expect(
    await (
      await attributionHandler({
        params: {},
        request: attributionRequest,
      })
    ).json(),
  ).toEqual({ copyright: 'Map data' })
  expect(doubles.parseViewport).toHaveBeenCalledWith(attributionRequest.url)
  expect(doubles.attribution).toHaveBeenCalledWith({
    zoom: 15,
    north: 37,
    south: 36,
    east: -86,
    west: -87,
  })

  const failure = new Error('invalid')
  doubles.parseTile.mockImplementationOnce(() => {
    throw failure
  })
  doubles.parseViewport.mockImplementationOnce(() => {
    throw failure
  })
  expect(
    (
      await tileHandler({
        params: {},
        request: tileRequest,
      })
    ).status,
  ).toBe(418)
  expect(
    (
      await attributionHandler({
        params: {},
        request: attributionRequest,
      })
    ).status,
  ).toBe(418)
  expect(doubles.errorResponse).toHaveBeenCalledTimes(2)
  expect(doubles.errorResponse).toHaveBeenCalledWith(failure)
})
