import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { geojson as flatgeobuf } from 'flatgeobuf'
import * as shapefile from 'shapefile'
import unzipper from 'unzipper'
import {
  BASE_CELL_SIZE,
  GRID_ORIGIN,
  MIN_CELL_SIZE,
  baseCellKeys,
  cellBounds,
  childCells,
  geometryBounds,
  geometryCoordinateCount,
  intersects,
  primaryZoning,
  projectGeometry,
  quantiles,
  sourceDateFromDbfHeader,
} from './parcel-utils.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(SCRIPT_DIR, '..')
const DATA_ROOT = resolve(PROJECT_DIR, 'public', 'data', 'parcels')
const MAX_SHARD_FEATURES = 5_000
const MAX_SHARD_BYTES = 4 * 1024 * 1024
const COUNTY_BOUNDARY_URL =
  'https://maps.nashville.gov/arcgis/rest/services/HUB/HUB_Internal/MapServer/16/query?where=1%3D1&outFields=OBJECTID&returnGeometry=true&f=geojson&outSR=3857&geometryPrecision=1&maxAllowableOffset=35'

function parseArguments() {
  const inputIndex = process.argv.indexOf('--input')
  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error(
      'Usage: npm run data:build -- --input ..\\Parcels_view_....zip',
    )
  }
  return resolve(PROJECT_DIR, process.argv[inputIndex + 1])
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function extractParcelFiles(zipPath, destination) {
  const archive = await unzipper.Open.file(zipPath)
  const wanted = new Set([
    'Parcels.shp',
    'Parcels.shx',
    'Parcels.dbf',
    'Parcels.prj',
    'Parcels.cpg',
  ])

  for (const entry of archive.files) {
    const name = basename(entry.path)
    if (!wanted.has(name)) continue
    await pipeline(entry.stream(), createWriteStream(join(destination, name)))
  }

  for (const name of ['Parcels.shp', 'Parcels.dbf', 'Parcels.prj']) {
    if (!existsSync(join(destination, name))) {
      throw new Error(`The archive is missing ${name}`)
    }
  }
}

function updateCategory(map, key, label) {
  const normalizedKey = `${key ?? ''}`.trim() || 'unknown'
  const existing = map.get(normalizedKey)
  if (existing) {
    existing.count += 1
  } else {
    map.set(normalizedKey, {
      key: normalizedKey,
      label: `${label ?? ''}`.trim() || 'Not available',
      count: 1,
    })
  }
}

function normalizeRecord(properties, rid) {
  const number = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : -1
  }
  const string = (value) => `${value ?? ''}`.trim()

  return {
    rid,
    stanpar: string(properties.STANPAR),
    parId: number(properties.ParID),
    featureType: string(properties.FEATURETYP),
    floor: string(properties.FLOORNUMBE),
    address: string(properties.PropAddr),
    acres: number(properties.Acres),
    landUseCode: string(properties.LUCode),
    landUse: string(properties.LUDesc),
    zoning: primaryZoning(properties.Zoning),
    landAppraisal: number(properties.LandAppr),
    improvementAppraisal: number(properties.ImprAppr),
    totalAppraisal: number(properties.TotlAppr),
  }
}

function countUnclosedRings(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  let count = 0
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const first = ring[0]
      const last = ring.at(-1)
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        count += 1
      }
    }
  }
  return count
}

function appendCell(tempCells, key, value) {
  let cell = tempCells.get(key)
  if (!cell) {
    const path = join(tempCells.directory, `${key}.ndjson`)
    cell = { handle: openSync(path, 'a'), path, count: 0, bytes: 0 }
    tempCells.set(key, cell)
  }
  const line = `${JSON.stringify(value)}\n`
  writeSync(cell.handle, line)
  cell.count += 1
  cell.bytes += Buffer.byteLength(line)
}

function loadCell(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function toFeatureCollection(items) {
  return {
    type: 'FeatureCollection',
    features: items.map((item) => item.feature),
  }
}

function writeShard({
  id,
  bounds,
  items,
  outputDirectory,
  publicPrefix,
  manifestShards,
  warnings,
  validationState,
}) {
  const encoded = flatgeobuf.serialize(toFeatureCollection(items), 3857)
  const size = bounds[2] - bounds[0]
  const overLimit =
    encoded.byteLength > MAX_SHARD_BYTES || items.length > MAX_SHARD_FEATURES

  if (overLimit && size / 2 >= MIN_CELL_SIZE) {
    for (const child of childCells(bounds, id)) {
      const childItems = items.filter((item) =>
        intersects(item.bounds, child.bounds),
      )
      if (childItems.length === 0) continue
      writeShard({
        id: child.id,
        bounds: child.bounds,
        items: childItems,
        outputDirectory,
        publicPrefix,
        manifestShards,
        warnings,
        validationState,
      })
    }
    return
  }

  if (overLimit) {
    warnings.push(
      `${id} reached the minimum shard size with ${items.length} features and ${encoded.byteLength} bytes`,
    )
  }

  const fileName = `${id}.fgb`
  writeFileSync(join(outputDirectory, fileName), encoded)
  validationState.shardRecordReferences += items.length
  for (const item of items) {
    validationState.rids.add(item.feature.properties.rid)
  }
  manifestShards.push({
    id,
    bounds: bounds.map((value) => Math.round(value * 100) / 100),
    featureCount: items.length,
    byteLength: encoded.byteLength,
    url: `${publicPrefix}/cells/${fileName}`,
  })
}

async function loadCountyOverview(bounds) {
  try {
    const response = await fetch(COUNTY_BOUNDARY_URL, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    if (!geojson.features?.length) throw new Error('No boundary features')
    return { ...geojson, source: 'Metro GIS Davidson County boundary' }
  } catch (error) {
    console.warn(`County boundary download failed: ${error}`)
    return {
      type: 'FeatureCollection',
      source: 'Parcel extent fallback',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Davidson County extent' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [bounds[0], bounds[1]],
                [bounds[2], bounds[1]],
                [bounds[2], bounds[3]],
                [bounds[0], bounds[3]],
                [bounds[0], bounds[1]],
              ],
            ],
          },
        },
      ],
    }
  }
}

async function main() {
  const input = parseArguments()
  if (!existsSync(input)) throw new Error(`Input archive not found: ${input}`)

  const temporary = join(
    tmpdir(),
    `nashville-parcels-${Date.now()}-${process.pid}`,
  )
  const extracted = join(temporary, 'source')
  const cellTemp = join(temporary, 'cells')
  mkdirSync(extracted, { recursive: true })
  mkdirSync(cellTemp, { recursive: true })

  console.log(`Reading ${input}`)
  await extractParcelFiles(input, extracted)

  const dbfHandle = openSync(join(extracted, 'Parcels.dbf'), 'r')
  const dbfHeader = Buffer.alloc(32)
  readSync(dbfHandle, dbfHeader, 0, dbfHeader.length, 0)
  closeSync(dbfHandle)
  const sourceDate = sourceDateFromDbfHeader(dbfHeader)
  const versionDirectory = resolve(DATA_ROOT, sourceDate)
  const outputCells = join(versionDirectory, 'cells')

  if (!versionDirectory.startsWith(DATA_ROOT)) {
    throw new Error('Refusing to write parcel data outside public/data/parcels')
  }
  rmSync(versionDirectory, { recursive: true, force: true })
  mkdirSync(outputCells, { recursive: true })

  const source = await shapefile.open(
    join(extracted, 'Parcels.shp'),
    join(extracted, 'Parcels.dbf'),
    { encoding: 'utf-8' },
  )

  const tempCells = new Map()
  tempCells.directory = cellTemp
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const landUse = new Map()
  const zoning = new Map()
  const featureTypes = new Map()
  const appraisalValues = []
  let missingAddress = 0
  let missingLandUse = 0
  let missingZoning = 0
  let repairedRings = 0
  let sourceCoordinateCount = 0
  let projectedCoordinateCount = 0
  let rid = 0

  while (true) {
    const result = await source.read()
    if (result.done) break
    repairedRings += countUnclosedRings(result.value.geometry)
    sourceCoordinateCount += geometryCoordinateCount(result.value.geometry)
    const projected = projectGeometry(result.value.geometry)
    if (!projected) throw new Error(`Record ${rid} has no geometry`)
    projectedCoordinateCount += geometryCoordinateCount(projected)

    const featureBounds = geometryBounds(projected)

    bounds[0] = Math.min(bounds[0], featureBounds[0])
    bounds[1] = Math.min(bounds[1], featureBounds[1])
    bounds[2] = Math.max(bounds[2], featureBounds[2])
    bounds[3] = Math.max(bounds[3], featureBounds[3])

    const properties = normalizeRecord(result.value.properties, rid)
    if (!properties.address) missingAddress += 1
    if (!properties.landUseCode) missingLandUse += 1
    if (!properties.zoning) missingZoning += 1
    updateCategory(landUse, properties.landUseCode, properties.landUse)
    updateCategory(zoning, properties.zoning, properties.zoning)
    updateCategory(featureTypes, properties.featureType, properties.featureType)
    if (properties.totalAppraisal >= 0) {
      appraisalValues.push(properties.totalAppraisal)
    }

    const item = {
      bounds: featureBounds,
      feature: {
        type: 'Feature',
        properties,
        geometry: projected,
      },
    }

    for (const key of baseCellKeys(featureBounds)) {
      appendCell(tempCells, key, item)
    }

    rid += 1
    if (rid % 25_000 === 0) console.log(`Processed ${rid.toLocaleString()}`)
  }

  for (const cell of tempCells.values()) closeSync(cell.handle)
  console.log(`Finalizing ${tempCells.size} base cells`)

  const manifestShards = []
  const warnings = []
  const validationState = {
    rids: new Set(),
    shardRecordReferences: 0,
  }
  const publicPrefix = `/data/parcels/${sourceDate}`
  for (const [key, cell] of tempCells) {
    writeShard({
      id: key,
      bounds: cellBounds(key),
      items: loadCell(cell.path),
      outputDirectory: outputCells,
      publicPrefix,
      manifestShards,
      warnings,
      validationState,
    })
  }

  manifestShards.sort((a, b) => a.id.localeCompare(b.id))
  const center = [
    Math.round((bounds[0] + bounds[2]) / 2 / 100) * 100,
    Math.round((bounds[1] + bounds[3]) / 2 / 100) * 100,
  ]
  const overview = await loadCountyOverview(bounds)
  writeFileSync(
    join(versionDirectory, 'overview.json'),
    JSON.stringify(overview),
  )

  const categories = (map) =>
    [...map.values()].sort((a, b) => b.count - a.count)
  const manifest = {
    schemaVersion: 1,
    source: {
      name: basename(input),
      date: sourceDate,
      epsg: 2274,
      recordCount: rid,
      checksumSha256: await sha256(input),
      attribution: 'Metro GIS, Nashville and Davidson County',
    },
    projection: {
      epsg: 3857,
      localOrigin: center,
      bounds: bounds.map((value) => Math.round(value * 100) / 100),
      baseCellSizeMeters: BASE_CELL_SIZE,
      minimumCellSizeMeters: MIN_CELL_SIZE,
      gridOrigin: GRID_ORIGIN,
    },
    overviewUrl: `${publicPrefix}/overview.json`,
    shards: manifestShards,
    statistics: {
      appraisalQuantiles: quantiles(appraisalValues),
      landUse: categories(landUse),
      zoning: categories(zoning),
      featureTypes: categories(featureTypes),
      missingAddress,
      missingLandUse,
      missingZoning,
    },
    validation: {
      repairedRings,
      sourceCoordinateCount,
      projectedCoordinateCount,
      simplifiedCoordinateCount: 0,
      shardRecordReferences: validationState.shardRecordReferences,
      deduplicatedRecordCount: validationState.rids.size,
      warnings,
      generatedAt: new Date().toISOString(),
    },
  }

  writeFileSync(
    join(DATA_ROOT, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
  rmSync(temporary, { recursive: true, force: true })

  console.log(
    `Wrote ${rid.toLocaleString()} records across ${manifestShards.length.toLocaleString()} shards`,
  )
  if (rid !== 286_458) {
    throw new Error(`Expected 286,458 source records, received ${rid}`)
  }
  if (validationState.rids.size !== rid) {
    throw new Error(
      `Shard deduplication retained ${validationState.rids.size} of ${rid} records`,
    )
  }
  if (projectedCoordinateCount !== sourceCoordinateCount + repairedRings) {
    throw new Error('Projection changed the source coordinate count')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
