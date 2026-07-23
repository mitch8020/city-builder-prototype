import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geojson as flatgeobuf } from 'flatgeobuf'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..')
const PUBLIC_DIRECTORY = resolve(PROJECT_DIRECTORY, 'public')
const MANIFEST_PATH = resolve(
  PUBLIC_DIRECTORY,
  'data',
  'parcels',
  'manifest.json',
)

const ALLOWED_PROPERTY_KEYS = [
  'acres',
  'address',
  'featureType',
  'floor',
  'improvementAppraisal',
  'landAppraisal',
  'landUse',
  'landUseCode',
  'parId',
  'rid',
  'stanpar',
  'totalAppraisal',
  'zoning',
].sort()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sameKeys(properties) {
  const keys = Object.keys(properties).sort()
  return (
    keys.length === ALLOWED_PROPERTY_KEYS.length &&
    keys.every((key, index) => key === ALLOWED_PROPERTY_KEYS[index])
  )
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  const recordIds = new Set()
  let references = 0
  let bytes = 0

  for (const [index, shard] of manifest.shards.entries()) {
    const path = resolve(PUBLIC_DIRECTORY, `.${shard.url}`)
    assert(
      path.startsWith(PUBLIC_DIRECTORY),
      `Shard ${shard.id} resolves outside public`,
    )

    const encoded = await readFile(path)
    assert(
      encoded.byteLength === shard.byteLength,
      `Shard ${shard.id} byte length differs from the manifest`,
    )
    bytes += encoded.byteLength

    let shardFeatures = 0
    for await (const feature of flatgeobuf.deserialize(
      new Uint8Array(encoded),
    )) {
      assert(
        feature.properties && sameKeys(feature.properties),
        `Shard ${shard.id} record ${shardFeatures} contains a non-public field`,
      )
      assert(
        feature.geometry?.type === 'Polygon' ||
          feature.geometry?.type === 'MultiPolygon',
        `Shard ${shard.id} record ${shardFeatures} has invalid geometry`,
      )
      const rid = Number(feature.properties.rid)
      assert(
        Number.isInteger(rid) && rid >= 0,
        `Shard ${shard.id} record ${shardFeatures} has an invalid rid`,
      )
      recordIds.add(rid)
      shardFeatures += 1
    }

    assert(
      shardFeatures === shard.featureCount,
      `Shard ${shard.id} feature count differs from the manifest`,
    )
    references += shardFeatures

    if ((index + 1) % 100 === 0 || index + 1 === manifest.shards.length) {
      console.log(`Audited ${index + 1} of ${manifest.shards.length} shards`)
    }
  }

  assert(
    references === manifest.validation.shardRecordReferences,
    'Shard reference total differs from the manifest',
  )
  assert(
    recordIds.size === manifest.validation.deduplicatedRecordCount,
    'De-duplicated record total differs from the manifest',
  )
  assert(
    recordIds.size === manifest.source.recordCount,
    'Public record total differs from the source count',
  )

  console.log(
    `Sanitized parcel audit passed: ${recordIds.size.toLocaleString()} records, ` +
      `${references.toLocaleString()} shard references, ` +
      `${(bytes / 1024 / 1024).toFixed(1)} MiB`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
