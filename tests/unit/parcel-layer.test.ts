import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ParcelLayer } from '../../src/map/ParcelLayer'
import type {
  ParcelGroup,
  ParcelManifestV1,
  ParcelRecord,
  WorkerLoadedResponse,
} from '../../src/map/types'

const record: ParcelRecord = {
  rid: 7,
  stanpar: '00100000100',
  parId: 70,
  featureType: 'Parcel',
  floor: '',
  address: '100 TEST ST',
  acres: 0.25,
  landUseCode: 'RES',
  landUse: 'Residential',
  zoning: 'R6',
  landAppraisal: 100_000,
  improvementAppraisal: 200_000,
  totalAppraisal: 300_000,
}

const group: ParcelGroup = {
  id: 0,
  bounds: [0, 0, 10, 10],
  center: [5, 5],
  height: 3,
  records: [record],
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
}

const manifest = {
  statistics: {
    appraisalQuantiles: [100_000, 250_000, 500_000, 1_000_000],
  },
} as ParcelManifestV1

const response: WorkerLoadedResponse = {
  type: 'loaded',
  generation: 1,
  logicalRecordCount: 1,
  groups: [group],
  topPositions: new Float32Array([0, 0, 0, 0, 0, 10, 10, 0, 0]),
  topIndices: new Uint32Array([0, 1, 2]),
  topVertexGroups: new Uint32Array([0, 0, 0]),
  topTriangleGroups: new Uint32Array([0]),
  sidePositions: new Float32Array(),
  sideIndices: new Uint32Array(),
  sideVertexGroups: new Uint32Array(),
  edgePositions: new Float32Array(),
}

describe('ParcelLayer', () => {
  it('owns parcel meshes, selection animation, picking, and cleanup', () => {
    const layer = new ParcelLayer(manifest, 'overview')
    expect(layer.groups).toEqual([])
    layer.setMode('overview')
    layer.setMode('value')
    layer.update(1)
    layer.select(group)
    layer.install(response)

    expect(layer.count).toBe(1)
    expect(layer.findByRid(record.rid)).toBe(group)

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(2, 10, 2),
      new THREE.Vector3(0, -1, 0),
    )
    expect(layer.hitGroup(raycaster)).toBe(group)
    expect(
      layer.hitGroup(
        new THREE.Raycaster(
          new THREE.Vector3(100, 10, 100),
          new THREE.Vector3(0, -1, 0),
        ),
      ),
    ).toBeUndefined()
    expect(
      layer.hitGroup({
        intersectObject: vi.fn(() => [{ faceIndex: null }]),
      } as unknown as THREE.Raycaster),
    ).toBeUndefined()

    layer.select(group)
    expect(layer.selectionLift).toBe(0)
    layer.update(1)
    expect(layer.selectionLift).toBeGreaterThan(0)

    layer.setMode('value')
    layer.clear()

    expect(layer.count).toBe(0)
    expect(layer.selectionLift).toBe(0)
    expect(layer.hitGroup(raycaster)).toBeUndefined()
    layer.clear()
    layer.clearSelection()
  })

  it('handles missing indices, unmatched groups, and material arrays', () => {
    const layer = new ParcelLayer(manifest, 'overview')
    layer.install(response)
    const internal = layer as unknown as {
      topMesh: THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >
      selectedMesh?: THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >
    }

    internal.topMesh.geometry.setIndex(null)
    layer.select(group)
    expect(layer.selectionLift).toBe(0)

    layer.install(response)
    layer.select({ ...group, id: 99 })
    expect(internal.selectedMesh).toBeDefined()
    if (!internal.selectedMesh) throw new Error('Selection was not created')
    internal.selectedMesh.userData.targetLift = undefined
    internal.selectedMesh.material = [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]
    layer.update(1)
    expect(layer.selectionLift).toBe(0)
    layer.clearSelection()

    internal.topMesh.material = [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]
    layer.clear()
  })
})
