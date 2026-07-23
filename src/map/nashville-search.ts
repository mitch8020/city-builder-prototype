import { LANDMARKS, METRO_GEOCODER, METRO_PARCELS } from './constants'
import type { SearchResult } from './types'
import { geocoderResponseSchema, metroParcelResponseSchema } from './validation'

const MIN_QUERY_LENGTH = 2
const MAX_RESULTS = 7
const MAX_METRO_RESULTS = 6
const MIN_ADDRESS_SCORE = 70

interface NashvilleSearchOptions {
  signal?: AbortSignal
  fetcher?: typeof fetch
}

export function landmarkSuggestions(value: string): SearchResult[] {
  if (!value.trim()) return LANDMARKS.slice(0, 3)

  const query = value.toLowerCase()
  return LANDMARKS.filter((item) => item.label.toLowerCase().includes(query))
}

export async function searchNashville(
  value: string,
  options: NashvilleSearchOptions = {},
): Promise<SearchResult[]> {
  const query = value.trim()
  if (query.length < MIN_QUERY_LENGTH) return []

  const localResults = searchLandmarks(query)
  const parcelId = parcelIdFromQuery(query)

  if (localResults.length > 0 && !isParcelQuery(query, parcelId)) {
    return localResults
  }

  const remoteResults = parcelId
    ? await searchParcels(query, parcelId, options)
    : isParcelNumber(query)
      ? await searchParcels(query, undefined, options)
      : await searchAddresses(query, options)

  return [...remoteResults, ...localResults].slice(0, MAX_RESULTS)
}

function searchLandmarks(query: string) {
  const normalizedQuery = query.toLowerCase()
  return LANDMARKS.filter((result) =>
    `${result.label} ${result.detail}`.toLowerCase().includes(normalizedQuery),
  ).slice(0, MAX_RESULTS)
}

function parcelIdFromQuery(query: string) {
  return /^parId:(\d+)$/i.exec(query)?.[1]
}

function isParcelNumber(query: string) {
  return /^[\d\s-]+$/.test(query) && query.replaceAll(/\D/g, '').length >= 8
}

function isParcelQuery(query: string, parcelId?: string) {
  return Boolean(parcelId) || isParcelNumber(query)
}

async function searchParcels(
  query: string,
  parcelId: string | undefined,
  { signal, fetcher = fetch }: NashvilleSearchOptions,
) {
  const where = parcelId
    ? `ParID=${parcelId}`
    : `APN='${query.replaceAll("'", "''")}'`
  const parameters = new URLSearchParams({
    where,
    outFields: 'APN,ParID,PropAddr',
    returnGeometry: 'true',
    outSR: '3857',
    resultRecordCount: String(MAX_METRO_RESULTS),
    f: 'geojson',
  })
  const response = await fetcher(`${METRO_PARCELS}?${parameters}`, { signal })

  if (!response.ok) throw new Error('Parcel search is unavailable')

  const collection = metroParcelResponseSchema.parse(await response.json())
  return collection.features.map((feature) => {
    const [x, y] = geometryCenter(feature.geometry.coordinates)
    return {
      id: `parcel-${feature.properties.ParID || feature.properties.APN || 'result'}`,
      label: `${feature.properties.PropAddr || 'Parcel'}`,
      detail: `Parcel ${feature.properties.APN || query}`.trim(),
      x,
      y,
      kind: 'parcel' as const,
      parcel: `${feature.properties.APN || ''}` || undefined,
      parId: Number.isFinite(Number(feature.properties.ParID))
        ? Number(feature.properties.ParID)
        : undefined,
    }
  })
}

async function searchAddresses(
  query: string,
  { signal, fetcher = fetch }: NashvilleSearchOptions,
) {
  const parameters = new URLSearchParams({
    SingleLine: query,
    outFields: 'Match_addr,Addr_type',
    outSR: '3857',
    maxLocations: String(MAX_METRO_RESULTS),
    f: 'json',
  })
  const response = await fetcher(`${METRO_GEOCODER}?${parameters}`, { signal })

  if (!response.ok) throw new Error('Address search is unavailable')

  const data = geocoderResponseSchema.parse(await response.json())
  return data.candidates
    .filter(
      (
        candidate,
      ): candidate is typeof candidate & {
        location: { x: number; y: number }
      } => candidate.score >= MIN_ADDRESS_SCORE && Boolean(candidate.location),
    )
    .map((candidate) => ({
      id: `address-${candidate.location.x}-${candidate.location.y}`,
      label: candidate.address,
      detail: `${candidate.attributes?.Addr_type || 'Nashville address'} · ${Math.round(candidate.score)}% match`,
      x: candidate.location.x,
      y: candidate.location.y,
      kind: 'address' as const,
    }))
}

function geometryCenter(coordinatesValue: unknown) {
  const coordinates: number[][] = []
  const visit = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      coordinates.push(value as number[])
      return
    }
    if (Array.isArray(value)) value.forEach(visit)
  }

  visit(coordinatesValue)
  if (!coordinates.length) return [0, 0] as const

  const xs = coordinates.map((point) => point[0])
  const ys = coordinates.map((point) => point[1])
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ] as const
}
