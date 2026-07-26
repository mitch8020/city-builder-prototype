import { describe, expect, it, vi } from 'vitest'
import { METRO_GEOCODER, METRO_PARCELS } from '../../src/map/constants'
import {
  landmarkSuggestions,
  searchNashville,
} from '../../src/map/nashville-search'

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Nashville search', () => {
  it('keeps the default and filtered landmark suggestions local', async () => {
    expect(landmarkSuggestions('')).toHaveLength(3)
    expect(landmarkSuggestions('East')).toMatchObject([
      { label: 'East Nashville', kind: 'landmark' },
    ])

    const fetcher = vi.fn(() => {
      throw new Error('Landmark search should not call Metro')
    }) as unknown as typeof fetch

    await expect(
      searchNashville('Music Row', { fetcher }),
    ).resolves.toMatchObject([{ label: 'Music Row', kind: 'landmark' }])
    expect(fetcher).not.toHaveBeenCalled()
    await expect(searchNashville(' ')).resolves.toEqual([])
  })

  it('maps Metro parcel records and derives a geometry center', async () => {
    let requestedUrl = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input)
      return jsonResponse({
        features: [
          {
            properties: {
              APN: '123456789',
              ParID: 42,
              PropAddr: '100 TEST ST',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 2],
                  [10, 2],
                  [10, 18],
                  [0, 18],
                  [0, 2],
                ],
              ],
            },
          },
        ],
      })
    }) as unknown as typeof fetch

    await expect(
      searchNashville('123456789', { fetcher }),
    ).resolves.toMatchObject([
      {
        label: '100 TEST ST',
        parcel: '123456789',
        parId: 42,
        x: 5,
        y: 10,
        kind: 'parcel',
      },
    ])

    const url = new URL(requestedUrl)
    expect(`${url.origin}${url.pathname}`).toBe(METRO_PARCELS)
    expect(url.searchParams.get('where')).toBe("APN='123456789'")
    expect(url.searchParams.get('returnGeometry')).toBe('true')
  })

  it('uses parcel IDs from shared links without treating them as addresses', async () => {
    let requestedUrl = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input)
      return jsonResponse({ features: [] })
    }) as unknown as typeof fetch

    await searchNashville('parId:479400', { fetcher })

    expect(requestedUrl.startsWith(METRO_PARCELS)).toBe(true)
    expect(new URL(requestedUrl).searchParams.get('where')).toBe('ParID=479400')
  })

  it('filters, deduplicates, and humanizes Metro address candidates', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input).startsWith(METRO_GEOCODER)).toBe(true)
      return jsonResponse({
        candidates: [
          {
            address: '100 Broadway, Nashville, Tennessee',
            score: 91.4,
            location: { x: -100, y: 200 },
            attributes: { Addr_type: 'StreetAddress' },
          },
          {
            address: '100 BROADWAY NASHVILLE TENNESSEE',
            score: 90,
            location: { x: -101, y: 201 },
            attributes: { Addr_type: 'StreetAddress' },
          },
          {
            address: 'Broadway, Somewhere Else',
            score: 69,
            location: { x: 0, y: 0 },
            attributes: { Addr_type: 'StreetName' },
          },
        ],
      })
    }) as unknown as typeof fetch

    await expect(searchNashville('100 Broadway', { fetcher })).resolves.toEqual(
      [
        {
          id: 'address--100-200',
          label: '100 Broadway, Nashville, Tennessee',
          detail: 'Street address · 91% match',
          x: -100,
          y: 200,
          kind: 'address',
        },
      ],
    )
  })

  it('reports Metro transport failures with a search-specific error', async () => {
    const fetcher = vi.fn(
      async () => new Response(undefined, { status: 503 }),
    ) as unknown as typeof fetch

    await expect(searchNashville('100 Broadway', { fetcher })).rejects.toThrow(
      'Address search is unavailable',
    )
  })

  it('reports parcel transport failures separately', async () => {
    const fetcher = vi.fn(
      async () => new Response(undefined, { status: 503 }),
    ) as unknown as typeof fetch

    await expect(searchNashville('123456789', { fetcher })).rejects.toThrow(
      'Parcel search is unavailable',
    )
  })

  it('uses safe parcel fallbacks for sparse Metro records', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        features: [
          {
            properties: {},
            geometry: { type: 'Polygon', coordinates: null },
          },
        ],
      }),
    ) as unknown as typeof fetch

    await expect(searchNashville('123456789', { fetcher })).resolves.toEqual([
      {
        id: 'parcel-result',
        label: 'Parcel',
        detail: 'Parcel 123456789',
        x: 0,
        y: 0,
        kind: 'parcel',
        parcel: undefined,
        parId: undefined,
      },
    ])
  })

  it('formats alternate Metro address types for people', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            address: 'Broadway',
            score: 88,
            location: { x: 1, y: 2 },
            attributes: { Addr_type: 'Street_Name' },
          },
          {
            address: 'Nashville',
            score: 85,
            location: { x: 3, y: 4 },
            attributes: { Addr_type: ' ' },
          },
        ],
      }),
    ) as unknown as typeof fetch

    await expect(
      searchNashville('Broadway area', { fetcher }),
    ).resolves.toEqual([
      expect.objectContaining({ detail: 'Street name · 88% match' }),
      expect.objectContaining({ detail: 'Nashville address · 85% match' }),
    ])
  })

  it('uses the global fetch default and address detail fallback', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            address: 'Nashville',
            score: 70,
            location: { x: 1, y: 2 },
          },
          {
            address: 'No geometry',
            score: 100,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    await expect(searchNashville('Nashville address')).resolves.toEqual([
      {
        id: 'address-1-2',
        label: 'Nashville',
        detail: 'Nashville address · 70% match',
        x: 1,
        y: 2,
        kind: 'address',
      },
    ])
    vi.unstubAllGlobals()
  })
})
