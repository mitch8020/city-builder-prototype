import * as THREE from 'three'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import { COLORS } from './constants'
import { colorForRecord } from './map-utils'
import type {
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  WorkerLoadedResponse,
} from './types'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

export class ParcelLayer {
  readonly root = new THREE.Group()
  private readonly parcelRoot = new THREE.Group()
  private readonly selectionRoot = new THREE.Group()
  private parcelGroups: ParcelGroup[] = []
  private topMesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private sideMesh?: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >
  private edgeLines?: THREE.LineSegments
  private triangleGroups: Uint32Array<ArrayBufferLike> = new Uint32Array()
  private topVertexGroups: Uint32Array<ArrayBufferLike> = new Uint32Array()
  private sideVertexGroups: Uint32Array<ArrayBufferLike> = new Uint32Array()
  private selectedMesh?: THREE.Mesh

  constructor(
    private readonly manifest: ParcelManifestV1,
    private mode: MapMode,
  ) {
    this.root.add(this.parcelRoot, this.selectionRoot)
  }

  get groups(): readonly ParcelGroup[] {
    return this.parcelGroups
  }

  get count() {
    return this.parcelGroups.length
  }

  get selectionLift() {
    return this.selectedMesh?.position.y ?? 0
  }

  setMode(mode: MapMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.updateColors()
  }

  findByRid(rid: number) {
    return this.parcelGroups.find((group) =>
      group.records.some((record) => record.rid === rid),
    )
  }

  hitGroup(raycaster: THREE.Raycaster) {
    if (!this.topMesh) return undefined

    const hits = raycaster.intersectObject(this.topMesh, false)
    if (hits.length === 0) return undefined
    const hit = hits[0]
    if (hit.faceIndex == null) return undefined

    return this.parcelGroups[this.triangleGroups[hit.faceIndex]]
  }

  install(response: WorkerLoadedResponse) {
    this.clear()
    this.parcelGroups = response.groups
    this.triangleGroups = response.topTriangleGroups
    this.topVertexGroups = response.topVertexGroups
    this.sideVertexGroups = response.sideVertexGroups

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
    topGeometry.computeVertexNormals()
    topGeometry.computeBoundsTree()
    const topMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
    this.topMesh = new THREE.Mesh(topGeometry, topMaterial)
    this.topMesh.castShadow = true
    this.topMesh.receiveShadow = true
    this.topMesh.name = 'Visible parcel tops'

    const sideGeometry = new THREE.BufferGeometry()
    sideGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(response.sidePositions, 3),
    )
    sideGeometry.setIndex(new THREE.BufferAttribute(response.sideIndices, 1))
    sideGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        new Float32Array(response.sidePositions.length),
        3,
      ),
    )
    sideGeometry.computeVertexNormals()
    this.sideMesh = new THREE.Mesh(
      sideGeometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
      }),
    )
    this.sideMesh.castShadow = true

    const edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(response.edgePositions, 3),
    )
    this.edgeLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: '#536a69',
        transparent: true,
        opacity: 0.62,
      }),
    )

    this.parcelRoot.add(this.sideMesh, this.topMesh, this.edgeLines)
    this.updateColors()
  }

  select(group: ParcelGroup) {
    this.clearSelection()
    if (!this.topMesh) return

    const positions = this.topMesh.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute
    const index = this.topMesh.geometry.index
    if (!index) return

    const selectedPositions: number[] = []
    for (
      let triangle = 0;
      triangle < this.triangleGroups.length;
      triangle += 1
    ) {
      if (this.triangleGroups[triangle] !== group.id) continue
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
    this.selectionRoot.add(this.selectedMesh)
  }

  update(delta: number) {
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
    for (const object of [this.topMesh, this.sideMesh, this.edgeLines]) {
      if (!object) continue
      this.parcelRoot.remove(object)
      object.geometry.dispose()
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      materials.forEach((material) => material.dispose())
    }

    this.topMesh = undefined
    this.sideMesh = undefined
    this.edgeLines = undefined
    this.parcelGroups = []
    this.triangleGroups = new Uint32Array()
    this.topVertexGroups = new Uint32Array()
    this.sideVertexGroups = new Uint32Array()
    this.clearSelection()
  }

  clearSelection() {
    if (!this.selectedMesh) return

    this.selectionRoot.remove(this.selectedMesh)
    this.selectedMesh.geometry.dispose()
    const materials = Array.isArray(this.selectedMesh.material)
      ? this.selectedMesh.material
      : [this.selectedMesh.material]
    materials.forEach((material) => material.dispose())
    this.selectedMesh = undefined
  }

  private updateColors() {
    if (!this.topMesh || !this.sideMesh) return

    const write = (
      attribute: THREE.BufferAttribute,
      vertexGroups: Uint32Array,
      darken: number,
    ) => {
      const color = new THREE.Color()
      for (let vertex = 0; vertex < vertexGroups.length; vertex += 1) {
        const group = this.parcelGroups[vertexGroups[vertex]]
        const value = colorForRecord(group.records[0], this.mode, this.manifest)
        color.set(value).multiplyScalar(darken)
        attribute.setXYZ(vertex, color.r, color.g, color.b)
      }
      attribute.needsUpdate = true
    }

    write(
      this.topMesh.geometry.getAttribute('color') as THREE.BufferAttribute,
      this.topVertexGroups,
      1,
    )
    write(
      this.sideMesh.geometry.getAttribute('color') as THREE.BufferAttribute,
      this.sideVertexGroups,
      0.72,
    )
  }
}
