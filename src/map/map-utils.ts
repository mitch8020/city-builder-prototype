import type {
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  ParcelRecord,
  ParcelSelectionHint,
  ParcelShard,
} from './types'
import {
  COLORS,
  LAND_USE_COLORS,
  VALUE_COLORS,
  ZONING_COLORS,
} from './constants'

export function intersectsBounds(a: readonly number[], b: readonly number[]) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

export function shardsForBounds(
  shards: ParcelShard[],
  bounds: [number, number, number, number],
) {
  return shards.filter((shard) => intersectsBounds(shard.bounds, bounds))
}

export function stableBucket(value: string, length: number) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % length
}

export function colorForRecord(
  record: ParcelRecord,
  mode: MapMode,
  manifest: ParcelManifestV1,
) {
  if (mode === 'landUse') {
    if (!record.landUseCode) return '#b6c1bc'
    return LAND_USE_COLORS[
      stableBucket(record.landUseCode, LAND_USE_COLORS.length)
    ]
  }
  if (mode === 'zoning') {
    if (!record.zoning) return '#b6c1bc'
    return ZONING_COLORS[stableBucket(record.zoning, ZONING_COLORS.length)]
  }
  if (mode === 'value') {
    const value = record.totalAppraisal
    if (value < 0) return '#b6c1bc'
    const index = manifest.statistics.appraisalQuantiles.findIndex(
      (cut) => value <= cut,
    )
    return VALUE_COLORS[index === -1 ? VALUE_COLORS.length - 1 : index]
  }
  if (record.featureType.toLowerCase().includes('open')) return COLORS.sage
  if (record.featureType.toLowerCase().includes('common')) return '#9fb6a2'
  if (record.featureType.toLowerCase().includes('cond')) return '#b8c9cc'
  return '#d9d4c8'
}

export function formatCurrency(value: number) {
  if (!Number.isFinite(value) || value < 0) return 'Not available'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatAcres(value: number) {
  if (!Number.isFinite(value) || value < 0) return 'Not available'
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 10 ? 2 : 1,
  }).format(value)} ac`
}

export function displayValue(value: string | number) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0
      ? new Intl.NumberFormat('en-US').format(value)
      : 'Not available'
  }
  return value.trim() || 'Not available'
}

export function tooltipDetail(record: ParcelRecord, mode: MapMode) {
  if (mode === 'landUse') {
    return `Land use: ${displayValue(record.landUse)}`
  }
  if (mode === 'zoning') {
    return `Zoning: ${displayValue(record.zoning)}`
  }
  if (mode === 'value') {
    return `Appraised value: ${formatCurrency(record.totalAppraisal)}`
  }
  return `${displayValue(record.featureType)} · ${formatAcres(record.acres)}`
}

export function groupPrimaryRecord(group: ParcelGroup, selectedRid?: number) {
  return (
    group.records.find((record) => record.rid === selectedRid) ??
    group.records[0]
  )
}

export function groupAnchor(group: ParcelGroup): [number, number] {
  const footprint = group.massing.footprint
  if (!footprint?.length) return group.center
  const total = footprint.reduce(
    ([x, y], [pointX, pointY]) => [x + pointX, y + pointY],
    [0, 0],
  )
  return [total[0] / footprint.length, total[1] / footprint.length]
}

export function legendForMode(mode: MapMode, manifest: ParcelManifestV1) {
  if (mode === 'value') {
    const cuts = manifest.statistics.appraisalQuantiles
    const labels = [
      `Up to ${formatCompactCurrency(cuts[0])}`,
      `${formatCompactCurrency(cuts[0])}–${formatCompactCurrency(cuts[1])}`,
      `${formatCompactCurrency(cuts[1])}–${formatCompactCurrency(cuts[2])}`,
      `${formatCompactCurrency(cuts[2])}–${formatCompactCurrency(cuts[3])}`,
      `Over ${formatCompactCurrency(cuts[3])}`,
    ]
    return labels.map((label, index) => ({
      label,
      color: VALUE_COLORS[index],
    }))
  }

  if (mode === 'landUse' || mode === 'zoning') {
    const source =
      mode === 'landUse'
        ? manifest.statistics.landUse
        : manifest.statistics.zoning
    const colors = mode === 'landUse' ? LAND_USE_COLORS : ZONING_COLORS
    return source.slice(0, 6).map((category) => ({
      label: category.label,
      color:
        colors[
          stableBucket(
            category.key,
            mode === 'landUse' ? LAND_USE_COLORS.length : ZONING_COLORS.length,
          )
        ],
    }))
  }

  return [
    { label: 'Parcel fabric', color: '#d9d4c8' },
    { label: 'Open space', color: COLORS.sage },
    { label: 'Condominium', color: '#b8c9cc' },
  ]
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function pointInRing(point: [number, number], ring: number[][]) {
  let inside = false
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current, current += 1
  ) {
    const [xi, yi] = ring[current]
    const [xj, yj] = ring[previous]
    const crosses =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function pointInPolygon(point: [number, number], polygon: number[][][]) {
  if (!pointInRing(point, polygon[0])) return false
  return !polygon.slice(1).some((hole) => pointInRing(point, hole))
}

export function pointInGroup(point: [number, number], group: ParcelGroup) {
  if (
    !intersectsBounds([point[0], point[1], point[0], point[1]], group.bounds)
  ) {
    return false
  }
  const polygons =
    group.geometry.type === 'Polygon'
      ? [group.geometry.coordinates]
      : group.geometry.coordinates
  return polygons.some((polygon) => pointInPolygon(point, polygon))
}

export function bestParcelMatch(
  candidates: ParcelGroup[],
  hint?: ParcelSelectionHint,
) {
  if (candidates.length === 0) return undefined
  const address = normalizeAddressRoot(hint?.address)
  let best: { group: ParcelGroup; rid: number; score: number } | undefined

  for (const group of candidates) {
    for (const record of group.records) {
      let score = 0
      if (hint?.parId !== undefined && record.parId === hint.parId) score += 100
      if (hint?.parcel && record.stanpar === hint.parcel) score += 80
      if (address && normalizeAddressRoot(record.address) === address)
        score += 40
      if (!best || score > best.score) {
        best = { group, rid: record.rid, score }
      }
    }
  }
  return best
}

export function normalizeAddressRoot(value?: string) {
  return `${value ?? ''}`
    .toUpperCase()
    .replace(/,\s*\d{5}(?:-\d{4})?$/, '')
    .replace(/\s+(?:#|APT|UNIT)\s*\w+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}
