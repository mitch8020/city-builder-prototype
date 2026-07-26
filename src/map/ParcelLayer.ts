import * as THREE from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import { COLORS } from './constants'
import { colorForRecord, intersectsBounds } from './map-utils'
import type {
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  WorkerLoadedResponse,
} from './types'

THREE.Mesh.prototype.raycast = acceleratedRaycast

interface ParcelChunk {
  id: string
  bounds: [number, number, number, number]
  root: THREE.Group
  groups: ParcelGroup[]
  topMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  sideMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  edgeLines: THREE.LineSegments
  triangleGroups: Uint32Array<ArrayBufferLike>
  topVertexGroups: Uint32Array<ArrayBufferLike>
  parcelTopIndexCount: number
}

export class ParcelLayer {
  readonly root = new THREE.Group()
  private readonly parcelRoot = new THREE.Group()
  private readonly selectionRoot = new THREE.Group()
  private readonly chunks = new Map<string, ParcelChunk>()
  private readonly meshChunks = new WeakMap<THREE.Object3D, ParcelChunk>()
  private readonly groupChunks = new WeakMap<ParcelGroup, ParcelChunk>()
  private readonly visibleGroupSet = new Set<ParcelGroup>()
  private readonly visibleRidCounts = new Map<number, number>()
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly groundHit = new THREE.Vector3()
  private visibleShardIds = new Set<string>()
  private selectedMesh?: THREE.Mesh
  private selectedChunk?: ParcelChunk
  private motionActive = false
  private readonly revealClock = { value: 0 }

  constructor(
    private readonly manifest: ParcelManifestV1,
    private mode: MapMode,
  ) {
    this.root.add(this.parcelRoot, this.selectionRoot)
  }

  get groups(): readonly ParcelGroup[] {
    return [...this.visibleGroupSet]
  }

  get count() {
    return this.visibleRidCounts.size
  }

  get chunkCount() {
    return this.chunks.size
  }

  get selectionLift() {
    return this.selectedMesh?.position.y ?? 0
  }

  setMode(mode: MapMode) {
    if (mode === this.mode) return
    this.mode = mode
    for (const chunk of this.chunks.values()) this.updateChunkColors(chunk)
  }

  setMotionActive(active: boolean) {
    if (active === this.motionActive) return
    this.motionActive = active
    for (const chunk of this.chunks.values()) {
      chunk.topMesh.geometry.setDrawRange(
        0,
        active ? chunk.parcelTopIndexCount : Infinity,
      )
      chunk.sideMesh.visible = !active
      chunk.edgeLines.visible = !active
    }
  }

  setVisible(shardIds: ReadonlySet<string>) {
    this.visibleShardIds = new Set(shardIds)
    for (const chunk of this.chunks.values()) {
      this.setChunkVisible(chunk, this.visibleShardIds.has(chunk.id))
    }
    this.selectionRoot.visible = Boolean(
      this.selectedChunk && this.visibleShardIds.has(this.selectedChunk.id),
    )
  }

  findByRid(rid: number) {
    for (const group of this.visibleGroupSet) {
      if (group.records.some((record) => record.rid === rid)) return group
    }
    return undefined
  }

  hitGroup(raycaster: THREE.Raycaster) {
    const groundHit = raycaster.ray.intersectPlane(
      this.groundPlane,
      this.groundHit,
    )
    const chunks = groundHit
      ? this.chunksAtPoint([
          this.manifest.projection.localOrigin[0] + groundHit.x,
          this.manifest.projection.localOrigin[1] - groundHit.z,
        ])
      : [...this.chunks.values()].filter((chunk) => chunk.root.visible)
    const meshes = chunks.map((chunk) => chunk.topMesh)
    if (meshes.length === 0) return undefined

    const hit = raycaster.intersectObjects(meshes, false).at(0)
    if (!hit || hit.faceIndex == null) return undefined
    const chunk = this.meshChunks.get(hit.object)
    if (!chunk) return undefined
    return chunk.groups[chunk.triangleGroups[hit.faceIndex]]
  }

  groupsAtPoint(point: [number, number]) {
    return this.chunksAtPoint(point).flatMap((chunk) => chunk.groups)
  }

  install(shardId: string, response: WorkerLoadedResponse) {
    this.evict(shardId)
    const root = new THREE.Group()
    root.name = `Parcel cell ${shardId}`
    root.visible = false
    const revealOrigin = this.revealClock.value
    const groupDelays = Float32Array.from(response.groups, ({ center }) => {
      const value =
        Math.sin(center[0] * 0.000_127 + center[1] * 0.000_311) * 43_758.5453
      return (value - Math.floor(value)) * 0.5
    })

    const topGeometry = new THREE.BufferGeometry()
    topGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(response.topPositions, 3),
    )
    topGeometry.setIndex(new THREE.BufferAttribute(response.topIndices, 1))
    topGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        new Float32Array(response.topPositions.length),
        3,
      ),
    )
    topGeometry.setAttribute(
      'parcelDelay',
      this.revealDelays(response.topVertexGroups, groupDelays),
    )
    const topMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
    this.addProceduralReveal(topMaterial, revealOrigin)
    const topMesh = new THREE.Mesh(topGeometry, topMaterial)
    topMesh.name = `Parcel tops ${shardId}`
    topGeometry.setDrawRange(
      0,
      this.motionActive ? response.parcelTopIndexCount : Infinity,
    )

    const sideGeometry = new THREE.BufferGeometry()
    sideGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(response.sidePositions, 3),
    )
    sideGeometry.setIndex(new THREE.BufferAttribute(response.sideIndices, 1))
    sideGeometry.setAttribute(
      'parcelDelay',
      this.revealDelays(response.sideVertexGroups, groupDelays),
    )
    sideGeometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(response.sideNormals, 3),
    )
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.slate,
      roughness: 0.95,
    })
    this.addProceduralReveal(sideMaterial, revealOrigin)
    const sideMesh = new THREE.Mesh(sideGeometry, sideMaterial)
    sideMesh.visible = !this.motionActive
    const edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(response.edgePositions, 3),
    )
    edgeGeometry.setAttribute(
      'parcelDelay',
      this.revealDelays(response.edgeVertexGroups, groupDelays),
    )
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: '#536a69',
      transparent: true,
      opacity: 0.62,
    })
    this.addProceduralReveal(edgeMaterial, revealOrigin)
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial)
    edgeLines.visible = !this.motionActive

    const chunk: ParcelChunk = {
      id: shardId,
      bounds:
        this.manifest.shards.find((shard) => shard.id === shardId)?.bounds ??
        this.manifest.projection.bounds,
      root,
      groups: response.groups,
      topMesh,
      sideMesh,
      edgeLines,
      triangleGroups: response.topTriangleGroups,
      topVertexGroups: response.topVertexGroups,
      parcelTopIndexCount: response.parcelTopIndexCount,
    }
    for (const group of chunk.groups) this.groupChunks.set(group, chunk)
    this.meshChunks.set(topMesh, chunk)
    root.add(sideMesh, topMesh, edgeLines)
    this.parcelRoot.add(root)
    this.chunks.set(shardId, chunk)
    this.updateChunkColors(chunk)
    this.setChunkVisible(chunk, this.visibleShardIds.has(shardId))
  }

  evict(shardId: string) {
    const chunk = this.chunks.get(shardId)
    if (!chunk) return
    if (this.selectedChunk === chunk) this.clearSelection()
    this.setChunkVisible(chunk, false)
    this.parcelRoot.remove(chunk.root)
    this.disposeObject(chunk.topMesh)
    this.disposeObject(chunk.sideMesh)
    this.disposeObject(chunk.edgeLines)
    this.chunks.delete(shardId)
  }

  select(group: ParcelGroup) {
    this.clearSelection()
    const chunk = this.groupChunks.get(group)
    if (!chunk) return

    const positions = chunk.topMesh.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute
    const index = chunk.topMesh.geometry.index
    if (!index) return

    const selectedPositions: number[] = []
    for (
      let triangle = 0;
      triangle < chunk.triangleGroups.length;
      triangle += 1
    ) {
      if (chunk.triangleGroups[triangle] !== group.id) continue
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = index.getX(triangle * 3 + corner)
        selectedPositions.push(
          positions.getX(vertex),
          positions.getY(vertex) + 0.25,
          positions.getZ(vertex),
        )
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(selectedPositions, 3),
    )
    geometry.computeVertexNormals()
    this.selectedMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: COLORS.gold,
        emissive: '#6d4a00',
        emissiveIntensity: 0.22,
        roughness: 0.7,
        transparent: true,
        opacity: 0.98,
        side: THREE.DoubleSide,
      }),
    )
    this.selectedMesh.castShadow = true
    this.selectedMesh.userData.targetLift = 6
    this.selectedMesh.position.y = 0
    this.selectedChunk = chunk
    this.selectionRoot.visible = chunk.root.visible
    this.selectionRoot.add(this.selectedMesh)
  }

  update(delta: number, nowSeconds = this.revealClock.value + delta) {
    this.revealClock.value = nowSeconds
    if (!this.selectedMesh) return

    const target = Number(this.selectedMesh.userData.targetLift ?? 0)
    this.selectedMesh.position.y = THREE.MathUtils.damp(
      this.selectedMesh.position.y,
      target,
      7,
      delta,
    )
  }

  clear() {
    for (const shardId of [...this.chunks.keys()]) this.evict(shardId)
    this.visibleShardIds.clear()
    this.visibleGroupSet.clear()
    this.visibleRidCounts.clear()
    this.clearSelection()
  }

  clearSelection() {
    if (!this.selectedMesh) {
      this.selectedChunk = undefined
      return
    }

    this.selectionRoot.remove(this.selectedMesh)
    this.disposeObject(this.selectedMesh)
    this.selectedMesh = undefined
    this.selectedChunk = undefined
  }

  private setChunkVisible(chunk: ParcelChunk, visible: boolean) {
    if (chunk.root.visible === visible) return
    chunk.root.visible = visible
    for (const group of chunk.groups) {
      const rid = group.records[0].rid
      if (visible) {
        this.visibleGroupSet.add(group)
        this.visibleRidCounts.set(
          rid,
          (this.visibleRidCounts.get(rid) ?? 0) + 1,
        )
      } else {
        this.visibleGroupSet.delete(group)
        const references = this.visibleRidCounts.get(rid)! - 1
        if (references > 0) this.visibleRidCounts.set(rid, references)
        else this.visibleRidCounts.delete(rid)
      }
    }
  }

  private chunksAtPoint(point: [number, number]) {
    const pointBounds = [point[0], point[1], point[0], point[1]]
    return [...this.chunks.values()].filter(
      (chunk) =>
        chunk.root.visible && intersectsBounds(chunk.bounds, pointBounds),
    )
  }

  private updateChunkColors(chunk: ParcelChunk) {
    const groupColors = new Float32Array(chunk.groups.length * 3)
    const color = new THREE.Color()
    for (const group of chunk.groups) {
      color.set(colorForRecord(group.records[0], this.mode, this.manifest))
      const offset = group.id * 3
      groupColors[offset] = color.r
      groupColors[offset + 1] = color.g
      groupColors[offset + 2] = color.b
    }
    const write = (attribute: THREE.BufferAttribute) => {
      for (let vertex = 0; vertex < vertexGroups.length; vertex += 1) {
        const offset = vertexGroups[vertex] * 3
        attribute.setXYZ(
          vertex,
          groupColors[offset],
          groupColors[offset + 1],
          groupColors[offset + 2],
        )
      }
      attribute.needsUpdate = true
    }

    const vertexGroups = chunk.topVertexGroups
    write(chunk.topMesh.geometry.getAttribute('color') as THREE.BufferAttribute)
  }

  private revealDelays(
    vertexGroups: Uint32Array<ArrayBufferLike>,
    groupDelays: Float32Array,
  ) {
    return new THREE.BufferAttribute(
      Float32Array.from(vertexGroups, (groupId) => groupDelays[groupId]),
      1,
    )
  }

  private addProceduralReveal(material: THREE.Material, origin: number) {
    const revealOrigin = { value: origin }
    material.onBeforeCompile = (shader) => {
      shader.uniforms.parcelTime = this.revealClock
      shader.uniforms.parcelOrigin = revealOrigin
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float parcelDelay;
uniform float parcelTime;
uniform float parcelOrigin;
varying float vParcelReveal;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vParcelReveal = smoothstep(
  parcelOrigin + parcelDelay,
  parcelOrigin + parcelDelay + 0.42,
  parcelTime
);
transformed.y = mix(0.3, transformed.y, vParcelReveal);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vParcelReveal;`,
        )
        .replace(
          '#include <premultiplied_alpha_fragment>',
          `if (vParcelReveal < 0.01) discard;
#include <premultiplied_alpha_fragment>`,
        )
    }
    material.customProgramCacheKey = () => 'parcel-procedural-reveal-v1'
  }

  private disposeObject(object: THREE.Mesh | THREE.LineSegments) {
    object.geometry.dispose()
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    materials.forEach((material) => material.dispose())
  }
}
