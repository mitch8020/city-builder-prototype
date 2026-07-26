import type { Feature, MultiPolygon, Polygon } from 'geojson'

export type MapMode = 'overview' | 'landUse' | 'zoning' | 'value'

export interface ParcelRecord {
  rid: number
  stanpar: string
  parId: number
  featureType: string
  floor: string
  address: string
  acres: number
  landUseCode: string
  landUse: string
  zoning: string
  landAppraisal: number
  improvementAppraisal: number
  totalAppraisal: number
}

export interface ParcelCategory {
  key: string
  label: string
  count: number
}

export interface ParcelShard {
  id: string
  bounds: [number, number, number, number]
  featureCount: number
  byteLength: number
  url: string
}

export interface ParcelManifestV1 {
  schemaVersion: 1
  source: {
    name: string
    date: string
    epsg: 2274
    recordCount: number
    checksumSha256: string
    attribution: string
  }
  projection: {
    epsg: 3857
    localOrigin: [number, number]
    bounds: [number, number, number, number]
    baseCellSizeMeters: number
    minimumCellSizeMeters: number
    gridOrigin: [number, number]
  }
  overviewUrl: string
  shards: ParcelShard[]
  statistics: {
    appraisalQuantiles: [number, number, number, number]
    landUse: ParcelCategory[]
    zoning: ParcelCategory[]
    featureTypes: ParcelCategory[]
    missingAddress: number
    missingLandUse: number
    missingZoning: number
  }
  validation: {
    repairedRings: number
    sourceCoordinateCount: number
    projectedCoordinateCount: number
    simplifiedCoordinateCount: number
    shardRecordReferences: number
    deduplicatedRecordCount: number
    warnings: string[]
    generatedAt: string
  }
}

export type ParcelMassingKind =
  | 'none'
  | 'residential'
  | 'condominium'
  | 'commercial'
  | 'industrial'
  | 'civic'
  | 'event'
  | 'tower'
  | 'utility'
  | 'generic'

export interface ParcelMassing {
  kind: ParcelMassingKind
  height: number
  footprintScale: number
  maximumWidth: number
  maximumDepth: number
  footprint?: [number, number][]
}

export interface ParcelGroup {
  id: number
  bounds: [number, number, number, number]
  center: [number, number]
  height: number
  massing: ParcelMassing
  records: ParcelRecord[]
  geometry: Polygon | MultiPolygon
}

export interface SceneStatus {
  phase:
    | 'starting'
    | 'overview'
    | 'zoom-to-parcels'
    | 'loading-parcels'
    | 'parcels-ready'
    | 'error'
  message: string
  visibleParcels: number
  onlineTiles: boolean
  basemapCopyright?: string
}

export interface SearchResult {
  id: string
  label: string
  detail: string
  x: number
  y: number
  kind: 'address' | 'parcel' | 'landmark'
  parcel?: string
  parId?: number
}

export interface ParcelSelectionHint {
  address?: string
  parcel?: string
  parId?: number
}

export interface WorkerLoadRequest {
  type: 'load'
  generation: number
  shard: Pick<ParcelShard, 'id' | 'url' | 'bounds'>
  origin: [number, number]
  countyBounds: [number, number, number, number]
}

export interface WorkerCancelRequest {
  type: 'cancel'
  generation: number
}

export type ParcelWorkerRequest = WorkerLoadRequest | WorkerCancelRequest

export interface WorkerGeometryPayload {
  parcelTopIndexCount: number
  topPositions: Float32Array
  topIndices: Uint32Array
  topVertexGroups: Uint32Array
  topTriangleGroups: Uint32Array
  sidePositions: Float32Array
  sideIndices: Uint32Array
  sideVertexGroups: Uint32Array
  sideNormals: Float32Array
  edgePositions: Float32Array
  edgeVertexGroups: Uint32Array
  groups: ParcelGroup[]
}

export interface WorkerLoadedResponse extends WorkerGeometryPayload {
  type: 'loaded'
  generation: number
  shardId: string
  logicalRecordCount: number
}

export interface WorkerErrorResponse {
  type: 'error'
  generation: number
  shardId: string
  message: string
}

export interface WorkerProgressResponse {
  type: 'progress'
  generation: number
  shardId: string
  message: string
}

export type ParcelWorkerResponse =
  WorkerLoadedResponse | WorkerErrorResponse | WorkerProgressResponse

export type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelRecord>

export interface CityMapController {
  home: () => void
  zoomBy: (factor: number) => void
  rotateToNorth: () => void
  tiltBy: (radians: number) => void
  flyTo: (x: number, y: number, distance?: number) => void
  selectAt: (x: number, y: number, hint?: ParcelSelectionHint) => void
}
