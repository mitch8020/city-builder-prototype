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

  it('filters low-confidence Metro address candidates', async () => {
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
          detail: 'StreetAddress · 91% match',
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
})
