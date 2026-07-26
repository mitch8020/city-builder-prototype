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
  massing: {
    kind: 'generic',
    height: 3,
    footprintScale: 0.55,
    maximumWidth: 72,
    maximumDepth: 60,
  },
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
  projection: {
    localOrigin: [0, 0],
    bounds: [0, 0, 10, 10],
  },
  shards: [{ id: 'a', bounds: [0, 0, 10, 10] }],
  statistics: {
    appraisalQuantiles: [100_000, 250_000, 500_000, 1_000_000],
  },
} as ParcelManifestV1

const response: WorkerLoadedResponse = {
  type: 'loaded',
  generation: 1,
  shardId: 'a',
  logicalRecordCount: 1,
  groups: [group],
  parcelTopIndexCount: 3,
  topPositions: new Float32Array([0, 0, 0, 0, 0, -10, 10, 0, 0]),
  topIndices: new Uint32Array([0, 2, 1]),
  topVertexGroups: new Uint32Array([0, 0, 0]),
  topTriangleGroups: new Uint32Array([0]),
  sidePositions: new Float32Array(),
  sideIndices: new Uint32Array(),
  sideVertexGroups: new Uint32Array(),
  sideNormals: new Float32Array(),
  edgePositions: new Float32Array(),
  edgeVertexGroups: new Uint32Array(),
}

describe('ParcelLayer', () => {
  it('owns parcel meshes, selection animation, picking, and cleanup', () => {
    const layer = new ParcelLayer(manifest, 'overview')
    expect(layer.groups).toEqual([])
    layer.setMode('overview')
    layer.setMode('value')
    layer.update(1)
    layer.select(group)
    layer.setMotionActive(true)
    layer.setMotionActive(true)
    layer.install('a', response)
    layer.setVisible(new Set(['a']))

    expect(layer.count).toBe(1)
    expect(layer.chunkCount).toBe(1)
    expect(layer.findByRid(record.rid)).toBe(group)
    expect(layer.findByRid(999)).toBeUndefined()
    expect(layer.groupsAtPoint([2, 2])).toEqual([group])
    const internal = layer as unknown as {
      chunks: Map<
        string,
        {
          topMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>
          sideMesh: THREE.Mesh
          edgeLines: THREE.LineSegments
        }
      >
    }
    const chunk = internal.chunks.get('a')!
    expect(chunk.topMesh.geometry.hasAttribute('parcelDelay')).toBe(true)
    expect(chunk.topMesh.geometry.drawRange.count).toBe(3)
    expect(chunk.sideMesh.visible).toBe(false)
    expect(chunk.edgeLines.visible).toBe(false)
    layer.setMotionActive(false)
    expect(chunk.topMesh.geometry.drawRange.count).toBe(Infinity)
    expect(chunk.sideMesh.visible).toBe(true)
    expect(chunk.edgeLines.visible).toBe(true)
    layer.setMotionActive(true)
    expect(chunk.topMesh.geometry.drawRange.count).toBe(3)
    layer.setMotionActive(false)
    layer.setMode('landUse')
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader:
        '#include <common>\n#include <premultiplied_alpha_fragment>',
    }
    chunk.topMesh.material.onBeforeCompile(
      shader as never,
      {} as THREE.WebGLRenderer,
    )
    expect(shader.vertexShader).toContain('parcelDelay')
    expect(shader.fragmentShader).toContain('vParcelReveal')
    expect(chunk.topMesh.material.customProgramCacheKey()).toBe(
      'parcel-procedural-reveal-v1',
    )

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(2, 10, -2),
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
        ray: { intersectPlane: vi.fn(() => null) },
        intersectObjects: vi.fn(() => [{ faceIndex: null }]),
      } as unknown as THREE.Raycaster),
    ).toBeUndefined()
    expect(
      layer.hitGroup({
        ray: { intersectPlane: vi.fn(() => null) },
        intersectObjects: vi.fn(() => [
          { faceIndex: 0, object: new THREE.Mesh() },
        ]),
      } as unknown as THREE.Raycaster),
    ).toBeUndefined()

    layer.select(group)
    expect(layer.selectionLift).toBe(0)
    layer.update(1)
    expect(layer.selectionLift).toBeGreaterThan(0)

    layer.setMode('value')
    layer.setVisible(new Set())
    expect(layer.count).toBe(0)
    layer.setVisible(new Set(['a']))
    layer.clear()

    expect(layer.count).toBe(0)
    expect(layer.selectionLift).toBe(0)
    expect(layer.hitGroup(raycaster)).toBeUndefined()
    layer.clear()
    layer.clearSelection()
  })

  it('handles missing indices, unmatched groups, and material arrays', () => {
    const layer = new ParcelLayer(manifest, 'overview')
    layer.install('a', response)
    layer.setVisible(new Set(['a']))
    const internal = layer as unknown as {
      chunks: Map<
        string,
        {
          topMesh: THREE.Mesh<
            THREE.BufferGeometry,
            THREE.Material | THREE.Material[]
          >
          triangleGroups: Uint32Array
        }
      >
      selectedMesh?: THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >
    }
    const topMesh = internal.chunks.get('a')!.topMesh

    topMesh.geometry.setIndex(null)
    layer.select(group)
    expect(layer.selectionLift).toBe(0)

    layer.install('a', response)
    layer.setVisible(new Set(['a']))
    internal.chunks.get('a')!.triangleGroups = new Uint32Array([99])
    layer.select(group)
    expect(internal.selectedMesh).toBeDefined()
    layer.clearSelection()
    internal.chunks.get('a')!.triangleGroups = new Uint32Array([0])
    layer.select({ ...group, id: 99 })
    expect(internal.selectedMesh).toBeUndefined()
    layer.select(group)
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

    internal.chunks.get('a')!.topMesh.material = [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]
    layer.clear()
  })

  it('keeps cells incremental, registers canonical groups once, and evicts only the target cell', () => {
    const layer = new ParcelLayer(manifest, 'overview')
    layer.install('a', response)
    layer.install('b', { ...response, shardId: 'b' })
    layer.setVisible(new Set(['a', 'b']))

    expect(layer.chunkCount).toBe(2)
    expect(layer.groups).toHaveLength(1)
    expect(layer.count).toBe(1)

    layer.evict('a')
    expect(layer.chunkCount).toBe(1)
    expect(layer.count).toBe(1)
    layer.evict('missing')
    layer.clear()
  })
})
