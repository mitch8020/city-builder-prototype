import type { MapMode, SearchResult } from './types'

export const COLORS = {
  ink: '#17343b',
  river: '#4b9fb8',
  limestone: '#f2ebdd',
  sage: '#7fa66a',
  gold: '#f2c14e',
  coral: '#e66a5b',
  white: '#fffdf8',
  slate: '#59737a',
  night: '#10252b',
} as const

export const MODE_DETAILS: Record<
  MapMode,
  { label: string; shortLabel: string; description: string; shortcut: string }
> = {
  overview: {
    label: 'City overview',
    shortLabel: 'Overview',
    description: 'A quiet civic model of the county.',
    shortcut: '1',
  },
  landUse: {
    label: 'Land use',
    shortLabel: 'Land use',
    description: 'Color parcels by their recorded use.',
    shortcut: '2',
  },
  zoning: {
    label: 'Base zoning',
    shortLabel: 'Zoning',
    description: 'Compare recorded zoning districts.',
    shortcut: '3',
  },
  value: {
    label: 'Appraised value',
    shortLabel: 'Value',
    description: 'View total appraisal by county quantile.',
    shortcut: '4',
  },
}

export const METRO_BASEMAP =
  'https://maps.nashville.gov/arcgis/rest/services/Basemaps/NashvilleBasemapMuted/MapServer'
export const METRO_GEOCODER =
  'https://maps.nashville.gov/arcgis/rest/services/Locators/LocNashComp/GeocodeServer/findAddressCandidates'
export const METRO_PARCELS =
  'https://maps.nashville.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query'
export const METRO_VIEWER = 'https://maps.nashville.gov/ParcelViewer/'

export const LANDMARKS: SearchResult[] = [
  {
    id: 'landmark-downtown',
    label: 'Downtown Nashville',
    detail: 'Broadway & 5th Avenue',
    x: -9_660_484,
    y: 4_323_032,
    kind: 'landmark',
  },
  {
    id: 'landmark-east',
    label: 'East Nashville',
    detail: 'Five Points',
    x: -9_657_500,
    y: 4_325_004,
    kind: 'landmark',
  },
  {
    id: 'landmark-music-row',
    label: 'Music Row',
    detail: '16th Avenue South',
    x: -9_661_586,
    y: 4_321_529,
    kind: 'landmark',
  },
  {
    id: 'landmark-opry',
    label: 'Opryland',
    detail: 'Music Valley',
    x: -9_650_353,
    y: 4_329_776,
    kind: 'landmark',
  },
  {
    id: 'landmark-airport',
    label: 'Nashville International Airport',
    detail: 'BNA',
    x: -9_648_884,
    y: 4_318_014,
    kind: 'landmark',
  },
]

export const LAND_USE_COLORS = [
  '#7fa66a',
  '#5e9db0',
  '#e7b75e',
  '#d88970',
  '#8c82ad',
  '#65a58e',
  '#b58b62',
  '#7891b2',
]

export const ZONING_COLORS = [
  '#6f9f7a',
  '#70a9b8',
  '#e5b964',
  '#dc826f',
  '#9b86b4',
  '#7b98bd',
  '#b4936f',
  '#66a397',
]

export const VALUE_COLORS = [
  '#d9e5d1',
  '#a9cfbf',
  '#70b4b2',
  '#4b8fa8',
  '#385f83',
]
