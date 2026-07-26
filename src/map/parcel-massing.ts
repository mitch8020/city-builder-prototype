import type { ParcelMassing, ParcelMassingKind, ParcelRecord } from './types'

export const PARCEL_SLAB_HEIGHT = 0.8
export const MAXIMUM_MASSING_HEIGHT = 84

const VENUE_PARCEL_IDS = new Set([128_247, 129_537, 402_333])

const LAND_USE_KINDS: Record<string, ParcelMassingKind> = {
  '001': 'none',
  '002': 'civic',
  '003': 'civic',
  '004': 'civic',
  '005': 'civic',
  '006': 'civic',
  '007': 'civic',
  '008': 'civic',
  '010': 'none',
  '011': 'residential',
  '012': 'residential',
  '013': 'residential',
  '014': 'residential',
  '015': 'condominium',
  '016': 'residential',
  '017': 'condominium',
  '018': 'residential',
  '019': 'residential',
  '020': 'none',
  '021': 'commercial',
  '022': 'commercial',
  '023': 'commercial',
  '024': 'commercial',
  '025': 'commercial',
  '026': 'commercial',
  '027': 'commercial',
  '028': 'commercial',
  '029': 'commercial',
  '030': 'none',
  '031': 'commercial',
  '032': 'commercial',
  '033': 'tower',
  '034': 'commercial',
  '035': 'tower',
  '036': 'condominium',
  '037': 'condominium',
  '038': 'condominium',
  '039': 'tower',
  '041': 'commercial',
  '042': 'commercial',
  '043': 'commercial',
  '044': 'commercial',
  '045': 'commercial',
  '046': 'commercial',
  '047': 'commercial',
  '048': 'none',
  '049': 'commercial',
  '051': 'commercial',
  '052': 'commercial',
  '053': 'commercial',
  '054': 'event',
  '055': 'utility',
  '056': 'event',
  '057': 'none',
  '058': 'commercial',
  '059': 'commercial',
  '061': 'none',
  '062': 'condominium',
  '063': 'industrial',
  '064': 'industrial',
  '065': 'industrial',
  '066': 'industrial',
  '067': 'none',
  '069': 'event',
  '070': 'none',
  '071': 'industrial',
  '072': 'industrial',
  '073': 'industrial',
  '074': 'industrial',
  '075': 'commercial',
  '076': 'industrial',
  '077': 'industrial',
  '078': 'none',
  '080': 'none',
  '081': 'residential',
  '082': 'residential',
  '085': 'industrial',
  '086': 'condominium',
  '088': 'residential',
  '089': 'residential',
  '090': 'none',
  '091': 'civic',
  '092': 'residential',
  '093': 'civic',
  '094': 'civic',
  '095': 'condominium',
  '096': 'civic',
  '097': 'civic',
  '098': 'event',
  '099': 'civic',
  '80M': 'none',
}

export const MAPPED_LAND_USE_CODES = Object.freeze(Object.keys(LAND_USE_KINDS))

interface MassingProfile {
  minimumHeight: number
  fallbackHeight: number
  maximumHeight: number
  footprintScale: number
  maximumWidth: number
  maximumDepth: number
}

const MASSING_PROFILES: Record<
  Exclude<ParcelMassingKind, 'none'>,
  MassingProfile
> = {
  residential: {
    minimumHeight: 5,
    fallbackHeight: 5,
    maximumHeight: 9,
    footprintScale: 0.44,
    maximumWidth: 26,
    maximumDepth: 20,
  },
  condominium: {
    minimumHeight: 10,
    fallbackHeight: 10,
    maximumHeight: 28,
    footprintScale: 0.56,
    maximumWidth: 72,
    maximumDepth: 60,
  },
  commercial: {
    minimumHeight: 9,
    fallbackHeight: 9,
    maximumHeight: 22,
    footprintScale: 0.62,
    maximumWidth: 90,
    maximumDepth: 78,
  },
  industrial: {
    minimumHeight: 8,
    fallbackHeight: 8,
    maximumHeight: 18,
    footprintScale: 0.74,
    maximumWidth: 140,
    maximumDepth: 110,
  },
  civic: {
    minimumHeight: 12,
    fallbackHeight: 12,
    maximumHeight: 24,
    footprintScale: 0.66,
    maximumWidth: 110,
    maximumDepth: 92,
  },
  event: {
    minimumHeight: 18,
    fallbackHeight: 18,
    maximumHeight: 24,
    footprintScale: 0.82,
    maximumWidth: 180,
    maximumDepth: 140,
  },
  tower: {
    minimumHeight: 18,
    fallbackHeight: 36,
    maximumHeight: MAXIMUM_MASSING_HEIGHT,
    footprintScale: 0.34,
    maximumWidth: 50,
    maximumDepth: 44,
  },
  utility: {
    minimumHeight: 45,
    fallbackHeight: 45,
    maximumHeight: 55,
    footprintScale: 0.16,
    maximumWidth: 14,
    maximumDepth: 14,
  },
  generic: {
    minimumHeight: 8,
    fallbackHeight: 8,
    maximumHeight: 16,
    footprintScale: 0.55,
    maximumWidth: 72,
    maximumDepth: 60,
  },
}

const KIND_PRIORITY: ParcelMassingKind[] = [
  'tower',
  'event',
  'utility',
  'condominium',
  'industrial',
  'civic',
  'commercial',
  'residential',
  'none',
]

export function highestRecordedFloor(records: ParcelRecord[]) {
  let highest: number | undefined
  for (const record of records) {
    if (!record.featureType.toLowerCase().includes('multistory')) continue
    const value = record.floor.trim()
    if (!/^\d+$/.test(value)) continue
    const floor = Number(value)
    if (floor > 0 && (highest === undefined || floor > highest)) {
      highest = floor
    }
  }
  return highest
}

function classifiedKind(records: ParcelRecord[], highestFloor?: number) {
  if (records.some(({ parId }) => VENUE_PARCEL_IDS.has(parId))) return 'event'
  if (highestFloor !== undefined && highestFloor >= 8) return 'tower'

  const kinds = new Set(
    records.map(({ landUseCode }) => LAND_USE_KINDS[landUseCode.trim()]),
  )
  const kind = KIND_PRIORITY.find((candidate) => kinds.has(candidate))
  if (highestFloor !== undefined && (kind === undefined || kind === 'none')) {
    return 'condominium'
  }
  if (kind !== undefined) return kind
  return records.some(({ improvementAppraisal }) => improvementAppraisal > 0)
    ? 'generic'
    : 'none'
}

function appraisalLift(records: ParcelRecord[]) {
  const improvement = Math.max(
    0,
    ...records.map(({ improvementAppraisal }) =>
      Number.isFinite(improvementAppraisal) ? improvementAppraisal : 0,
    ),
  )
  return Math.max(0, Math.log10(improvement + 1) - 5) * 2.5
}

export function parcelMassing(records: ParcelRecord[]): ParcelMassing {
  const highestFloor = highestRecordedFloor(records)
  const kind = classifiedKind(records, highestFloor)
  if (kind === 'none') {
    return {
      kind,
      height: PARCEL_SLAB_HEIGHT,
      footprintScale: 0,
      maximumWidth: 0,
      maximumDepth: 0,
    }
  }

  const profile = MASSING_PROFILES[kind]
  const requestedHeight =
    highestFloor === undefined
      ? profile.fallbackHeight + appraisalLift(records)
      : 4 + highestFloor * 1.35
  return {
    kind,
    height: Math.min(
      profile.maximumHeight,
      Math.max(profile.minimumHeight, requestedHeight),
    ),
    footprintScale: profile.footprintScale,
    maximumWidth: profile.maximumWidth,
    maximumDepth: profile.maximumDepth,
  }
}
