import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import {
  CAMERA_LIMITS,
  clampCameraTarget,
  keyboardShortcutForKey,
} from './camera-utils'
import { COLORS } from './constants'
import {
  bestParcelMatch,
  colorForRecord,
  pointInGroup,
  shardsForBounds,
} from './map-utils'
import { MetroTileManager } from './tile-manager'
import type {
  CityMapController,
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  ParcelSelectionHint,
  ParcelWorkerResponse,
  SceneStatus,
} from './types'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

export interface NashvilleSceneCallbacks {
  onSelect: (group?: ParcelGroup, rid?: number) => void
  onHover: (group?: ParcelGroup) => void
  onStatus: (status: SceneStatus) => void
  onAnchor: (anchor?: { x: number; y: number }) => void
  onModeShortcut: (mode: MapMode) => void
  onEscape: () => void
}

interface CameraTween {
  startedAt: number
  duration: number
  fromPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toPosition: THREE.Vector3
  toTarget: THREE.Vector3
}

export class NashvilleScene implements CityMapController {
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: MapControls
  private previousFrame = performance.now()
  private readonly parcelRoot = new THREE.Group()
  private readonly selectionRoot = new THREE.Group()
  private readonly raycaster = new THREE.Raycaster() as THREE.Raycaster & {
    firstHitOnly: boolean
  }
  private readonly worker: Worker
  private readonly tileManager: MetroTileManager
  private readonly keys = new Set<string>()
  private readonly homePosition: THREE.Vector3
  private readonly homeTarget = new THREE.Vector3()
  private readonly pointer = new THREE.Vector2()
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly groundHit = new THREE.Vector3()
  private readonly countyBounds: [number, number, number, number]
  private callbacks: NashvilleSceneCallbacks
  private mode: MapMode
  private selectedRid?: number
  private selectedGroup?: ParcelGroup
  private hoveredGroupId = -1
  private groups: ParcelGroup[] = []
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
  private frame = 0
  private resizeObserver: ResizeObserver
  private dataTimer?: ReturnType<typeof setTimeout>
  private tileTimer?: ReturnType<typeof setTimeout>
  private activeShardKey = ''
  private generation = 0
  private tween?: CameraTween
  private pendingSelection?: {
    point: [number, number]
    hint?: ParcelSelectionHint
  }
  private edgePan = new THREE.Vector2()
  private pointerDown?: { x: number; y: number }
  private disposed = false
  private tileAvailable = navigator.onLine

  constructor(
    private readonly container: HTMLDivElement,
    private readonly manifest: ParcelManifestV1,
    mode: MapMode,
    callbacks: NashvilleSceneCallbacks,
  ) {
    this.mode = mode
    this.callbacks = callbacks
    this.countyBounds = manifest.projection.bounds
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    if (!context) throw new Error('WEBGL2_UNAVAILABLE')

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      antialias: true,
    })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.append(canvas)

    this.scene.background = new THREE.Color('#bcd8dc')
    this.scene.fog = new THREE.FogExp2('#c7dde0', 0.000012)
    this.camera = new THREE.PerspectiveCamera(34, width / height, 5, 220_000)
    const countySize = Math.max(
      manifest.projection.bounds[2] - manifest.projection.bounds[0],
      manifest.projection.bounds[3] - manifest.projection.bounds[1],
    )
    this.homePosition = new THREE.Vector3(
      countySize * 0.68,
      countySize * 1.12,
      countySize * 0.94,
    )
    this.camera.position.copy(this.homePosition)

    this.controls = new MapControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = CAMERA_LIMITS.minimumDistance
    this.controls.maxDistance = countySize * 1.75
    this.controls.minPolarAngle = CAMERA_LIMITS.minimumTiltRadians
    this.controls.maxPolarAngle = CAMERA_LIMITS.maximumTiltRadians
    this.controls.screenSpacePanning = false
    this.controls.target.copy(this.homeTarget)
    this.controls.update()

    this.scene.add(this.parcelRoot, this.selectionRoot)
    this.addEnvironment(countySize)
    void this.addOverview()
    this.tileManager = new MetroTileManager(
      manifest.projection.localOrigin,
      (available) => {
        if (this.tileAvailable === available) return
        this.tileAvailable = available
        this.publishStatus()
      },
    )
    this.scene.add(this.tileManager.group)

    this.worker = new Worker(new URL('./parcel.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<ParcelWorkerResponse>) =>
      this.handleWorkerMessage(event.data)
    this.worker.onerror = (event) => {
      this.callbacks.onStatus({
        phase: 'error',
        message: `Parcel worker failed: ${event.message}`,
        visibleParcels: this.groups.length,
        onlineTiles: this.tileAvailable,
      })
    }
    this.worker.onmessageerror = () => {
      this.callbacks.onStatus({
        phase: 'error',
        message: 'Parcel worker returned an unreadable response.',
        visibleParcels: this.groups.length,
        onlineTiles: this.tileAvailable,
      })
    }

    this.raycaster.firstHitOnly = true
    this.bindEvents(canvas)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.callbacks.onStatus({
      phase: 'overview',
      message: 'County view ready',
      visibleParcels: 0,
      onlineTiles: this.tileAvailable,
    })
    this.scheduleMapUpdate(0)
    this.animate()
  }

  updateCallbacks(callbacks: NashvilleSceneCallbacks) {
    this.callbacks = callbacks
  }

  setMode(mode: MapMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.updateParcelColors()
  }

  setSelectedRid(rid?: number) {
    this.selectedRid = rid
    if (rid === undefined) {
      this.selectedGroup = undefined
      this.clearSelectionMesh()
      this.callbacks.onAnchor(undefined)
      return
    }
    const group = this.groups.find((candidate) =>
      candidate.records.some((record) => record.rid === rid),
    )
    if (group) this.selectGroup(group, rid, false)
  }

  home() {
    this.tweenCamera(this.homeTarget, this.homePosition.length(), 800, true)
    this.pendingSelection = undefined
  }

  zoomBy(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    )
    offset.setLength(distance)
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.scheduleMapUpdate()
  }

  rotateToNorth() {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const horizontal = Math.hypot(offset.x, offset.z)
    offset.x = 0
    offset.z = horizontal
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.scheduleMapUpdate()
  }

  tiltBy(radians: number) {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + radians,
      this.controls.minPolarAngle,
      this.controls.maxPolarAngle,
    )
    offset.setFromSpherical(spherical)
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.scheduleMapUpdate()
  }

  flyTo(x: number, y: number, distance = 1_800) {
    const target = this.absoluteToLocal(x, y)
    this.tweenCamera(target, distance, 900)
  }

  selectAt(x: number, y: number, hint?: ParcelSelectionHint) {
    this.pendingSelection = { point: [x, y], hint }
    this.flyTo(x, y, 1_400)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    clearTimeout(this.dataTimer)
    clearTimeout(this.tileTimer)
    this.resizeObserver.disconnect()
    this.worker.terminate()
    this.controls.dispose()
    this.tileManager.dispose()
    this.clearParcels()
    this.clearSelectionMesh()
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    this.renderer.domElement.removeEventListener(
      'pointermove',
      this.handlePointerMove,
    )
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.handlePointerDown,
    )
    this.renderer.domElement.removeEventListener(
      'pointerup',
      this.handlePointerUp,
    )
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private addEnvironment(countySize: number) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(countySize * 1.8, countySize * 1.8),
      new THREE.MeshStandardMaterial({
        color: COLORS.limestone,
        roughness: 0.94,
        metalness: 0,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.4
    ground.receiveShadow = true
    ground.name = 'Limestone county table'
    this.scene.add(ground)

    const grid = new THREE.GridHelper(
      countySize * 1.45,
      36,
      '#8da5a0',
      '#c9c2b5',
    )
    const materials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material]
    materials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.16
      material.depthWrite = false
    })
    grid.position.y = -0.1
    this.scene.add(grid)

    const hemi = new THREE.HemisphereLight('#eaf8fa', '#a59a83', 0.85)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff7df', 1.6)
    sun.position.set(-28_000, 52_000, 20_000)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -18_000
    sun.shadow.camera.right = 18_000
    sun.shadow.camera.top = 18_000
    sun.shadow.camera.bottom = -18_000
    this.scene.add(sun)
  }

  private async addOverview() {
    try {
      const response = await fetch(this.manifest.overviewUrl)
      if (!response.ok) return
      const collection = await response.json()
      const positions: number[] = []
      for (const feature of collection.features ?? []) {
        const geometry = feature.geometry
        const polygons =
          geometry?.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry?.type === 'MultiPolygon'
              ? geometry.coordinates
              : []
        for (const polygon of polygons) {
          for (const ring of polygon) {
            for (let index = 0; index < ring.length - 1; index += 1) {
              const start = this.absoluteToLocal(ring[index][0], ring[index][1])
              const end = this.absoluteToLocal(
                ring[index + 1][0],
                ring[index + 1][1],
              )
              positions.push(start.x, 0.5, start.z, end.x, 0.5, end.z)
            }
          }
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      )
      const boundary = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: COLORS.ink,
          transparent: true,
          opacity: 0.55,
        }),
      )
      boundary.name = 'Davidson County boundary'
      this.scene.add(boundary)
    } catch {
      // The parcel fabric remains usable without the small overview file.
    }
  }

  private bindEvents(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointerleave', () => {
      this.edgePan.set(0, 0)
      if (this.hoveredGroupId !== -1) {
        this.hoveredGroupId = -1
        this.callbacks.onHover(undefined)
      }
    })
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.callbacks.onStatus({
        phase: 'error',
        message: 'The 3D map lost its graphics context. Reload to restore it.',
        visibleParcels: this.groups.length,
        onlineTiles: this.tileAvailable,
      })
    })
    this.controls.addEventListener('change', () => this.scheduleMapUpdate())
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (
      target?.matches('input, textarea, select') ||
      target?.isContentEditable
    ) {
      return
    }
    const key = event.key.toLowerCase()
    const shortcut = keyboardShortcutForKey(key)
    if (shortcut?.type === 'home') {
      event.preventDefault()
      this.home()
      return
    }
    if (shortcut?.type === 'escape') {
      this.callbacks.onEscape()
      return
    }
    if (shortcut?.type === 'mode') {
      this.callbacks.onModeShortcut(shortcut.mode)
      return
    }
    this.keys.add(key)
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase())
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const edge = 28
    this.edgePan.x =
      event.clientX - rect.left < edge
        ? -1
        : rect.right - event.clientX < edge
          ? 1
          : 0
    this.edgePan.y =
      event.clientY - rect.top < edge
        ? 1
        : rect.bottom - event.clientY < edge
          ? -1
          : 0
    if (event.buttons === 0) this.pickHover()
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY }
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (!this.pointerDown) return
    const distance = Math.hypot(
      event.clientX - this.pointerDown.x,
      event.clientY - this.pointerDown.y,
    )
    this.pointerDown = undefined
    if (distance > 5) return
    const group = this.pickGroup()
    if (group) {
      this.selectGroup(group, group.records[0].rid, true)
    } else {
      this.callbacks.onSelect(undefined)
    }
  }

  private pickHover() {
    const group = this.pickGroup()
    const id = group?.id ?? -1
    if (id === this.hoveredGroupId) return
    this.hoveredGroupId = id
    this.renderer.domElement.style.cursor = group ? 'pointer' : 'grab'
    this.callbacks.onHover(group)
  }

  private pickGroup() {
    if (!this.topMesh) return undefined
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.topMesh, false)
    if (hits.length > 0) {
      const hit = hits[0]
      if (hit.faceIndex != null) {
        return this.groups[this.triangleGroups[hit.faceIndex]]
      }
    }

    // Some integrated-GPU drivers return no BVH hit for very large indexed
    // buffers. Retain fast BVH picking as the primary path, then use the
    // packaged polygon geometry as a deterministic spatial fallback.
    const groundHit = this.raycaster.ray.intersectPlane(
      this.groundPlane,
      this.groundHit,
    )
    if (!groundHit) return undefined
    const origin = this.manifest.projection.localOrigin
    const point: [number, number] = [
      origin[0] + groundHit.x,
      origin[1] - groundHit.z,
    ]
    let best: ParcelGroup | undefined
    for (const group of this.groups) {
      if (!pointInGroup(point, group)) continue
      if (
        !best ||
        group.records.length > best.records.length ||
        (group.records.length === best.records.length &&
          group.height > best.height)
      ) {
        best = group
      }
    }
    return best
  }

  private animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    const now = performance.now()
    const delta = Math.min((now - this.previousFrame) / 1000, 0.05)
    this.previousFrame = now
    this.applyCameraTween()
    this.applyKeyboard(delta)
    this.clampCameraTarget()
    this.controls.update()
    this.updateSelectionLift(delta)
    this.updateAnchor()
    this.renderer.render(this.scene, this.camera)
  }

  private applyKeyboard(delta: number) {
    if (this.tween) return
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = offset.length()
    const forward = this.controls.target
      .clone()
      .sub(this.camera.position)
      .setY(0)
      .normalize()
    const right = new THREE.Vector3().crossVectors(
      forward,
      new THREE.Vector3(0, 1, 0),
    )
    const direction = new THREE.Vector3()
    if (this.keys.has('w') || this.keys.has('arrowup')) direction.add(forward)
    if (this.keys.has('s') || this.keys.has('arrowdown')) direction.sub(forward)
    if (this.keys.has('d') || this.keys.has('arrowright')) direction.add(right)
    if (this.keys.has('a') || this.keys.has('arrowleft')) direction.sub(right)
    direction
      .addScaledVector(right, this.edgePan.x)
      .addScaledVector(forward, this.edgePan.y)
    if (direction.lengthSq() > 0) {
      const speed = THREE.MathUtils.clamp(distance * 0.55, 240, 10_000)
      direction.normalize().multiplyScalar(speed * delta)
      this.camera.position.add(direction)
      this.controls.target.add(direction)
      this.scheduleMapUpdate()
    }
    if (this.keys.has('q') || this.keys.has('e')) {
      const sign = this.keys.has('q') ? 1 : -1
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), sign * delta * 1.15)
      this.camera.position.copy(this.controls.target).add(offset)
      this.scheduleMapUpdate()
    }
    if (this.keys.has('z') || this.keys.has('x')) {
      const factor = this.keys.has('z') ? 1 - delta : 1 + delta
      this.zoomBy(factor)
    }
    if (this.keys.has('home') || this.keys.has('end')) {
      this.tiltBy((this.keys.has('home') ? -1 : 1) * delta * 0.65)
    }
  }

  private tweenCamera(
    target: THREE.Vector3,
    distance: number,
    duration: number,
    useHomePosition = false,
  ) {
    const offset = useHomePosition
      ? this.homePosition.clone()
      : this.camera.position
          .clone()
          .sub(this.controls.target)
          .setLength(distance)
    this.tween = {
      startedAt: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: target.clone().add(offset),
      toTarget: target.clone(),
    }
  }

  private applyCameraTween() {
    if (!this.tween) return
    const elapsed =
      (performance.now() - this.tween.startedAt) / this.tween.duration
    const progress = THREE.MathUtils.clamp(elapsed, 0, 1)
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - (-2 * progress + 2) ** 3 / 2
    this.camera.position.lerpVectors(
      this.tween.fromPosition,
      this.tween.toPosition,
      eased,
    )
    this.controls.target.lerpVectors(
      this.tween.fromTarget,
      this.tween.toTarget,
      eased,
    )
    if (progress >= 1) {
      this.tween = undefined
      this.scheduleMapUpdate(0)
    }
  }

  private clampCameraTarget() {
    const origin = this.manifest.projection.localOrigin
    const clamped = clampCameraTarget(
      this.controls.target.x,
      this.controls.target.z,
      this.countyBounds,
      origin,
    )
    const dx = clamped.x - this.controls.target.x
    const dz = clamped.z - this.controls.target.z
    if (dx || dz) {
      this.controls.target.x = clamped.x
      this.controls.target.z = clamped.z
      this.camera.position.x += dx
      this.camera.position.z += dz
    }
  }

  private scheduleMapUpdate(delay = 160) {
    clearTimeout(this.dataTimer)
    clearTimeout(this.tileTimer)
    this.dataTimer = setTimeout(() => this.updateParcelWindow(), delay)
    this.tileTimer = setTimeout(() => this.updateTiles(), Math.min(delay, 90))
  }

  private viewBounds() {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const localPoints: THREE.Vector3[] = []
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera)
      const point = this.raycaster.ray.intersectPlane(
        plane,
        new THREE.Vector3(),
      )
      if (point) localPoints.push(point)
    }
    if (localPoints.length < 2) {
      const distance = this.camera.position.distanceTo(this.controls.target)
      localPoints.push(
        this.controls.target.clone().addScalar(-distance),
        this.controls.target.clone().addScalar(distance),
      )
    }
    const origin = this.manifest.projection.localOrigin
    const xValues = localPoints.map((point) => point.x + origin[0])
    const yValues = localPoints.map((point) => origin[1] - point.z)
    const bounds: [number, number, number, number] = [
      Math.min(...xValues),
      Math.min(...yValues),
      Math.max(...xValues),
      Math.max(...yValues),
    ]
    const expandX = (bounds[2] - bounds[0]) * 0.12
    const expandY = (bounds[3] - bounds[1]) * 0.12
    return [
      bounds[0] - expandX,
      bounds[1] - expandY,
      bounds[2] + expandX,
      bounds[3] + expandY,
    ] as [number, number, number, number]
  }

  private updateTiles() {
    const bounds = this.viewBounds()
    const metersPerPixel =
      Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) /
      Math.max(this.container.clientWidth, this.container.clientHeight)
    this.tileManager.update(bounds, metersPerPixel)
  }

  private updateParcelWindow() {
    const distance = this.camera.position.distanceTo(this.controls.target)
    if (distance > 7_500) {
      if (this.activeShardKey) {
        this.activeShardKey = ''
        this.generation += 1
        this.worker.postMessage({
          type: 'cancel',
          generation: this.generation,
        })
        this.clearParcels()
      }
      this.publishStatus()
      return
    }

    const bounds = this.viewBounds()
    const shards = shardsForBounds(this.manifest.shards, bounds)
    const shardKey = shards
      .map((shard) => shard.id)
      .sort()
      .join('|')
    if (!shardKey || shardKey === this.activeShardKey) return
    this.activeShardKey = shardKey
    this.generation += 1
    this.callbacks.onStatus({
      phase: 'loading-parcels',
      message: `Loading ${shards.length} map ${
        shards.length === 1 ? 'cell' : 'cells'
      }`,
      visibleParcels: this.groups.length,
      onlineTiles: this.tileAvailable,
    })
    this.worker.postMessage({
      type: 'load',
      generation: this.generation,
      urls: shards.map((shard) => shard.url),
      origin: this.manifest.projection.localOrigin,
    })
  }

  private handleWorkerMessage(response: ParcelWorkerResponse) {
    if (response.generation !== this.generation) return
    if (response.type === 'progress') {
      this.callbacks.onStatus({
        phase: 'loading-parcels',
        message: response.message,
        visibleParcels: this.groups.length,
        onlineTiles: this.tileAvailable,
      })
      return
    }
    if (response.type === 'error') {
      this.callbacks.onStatus({
        phase: 'error',
        message: response.message,
        visibleParcels: this.groups.length,
        onlineTiles: this.tileAvailable,
      })
      return
    }
    this.installParcelGeometry(response)
    if (this.pendingSelection) {
      const pending = this.pendingSelection
      const candidates = this.groups.filter((candidate) =>
        pointInGroup(pending.point, candidate),
      )
      const match = bestParcelMatch(candidates, pending.hint)
      if (match) this.selectGroup(match.group, match.rid, true)
      this.pendingSelection = undefined
    } else if (this.selectedRid !== undefined) {
      this.setSelectedRid(this.selectedRid)
    }
    this.publishStatus()
  }

  private installParcelGeometry(
    response: Extract<ParcelWorkerResponse, { type: 'loaded' }>,
  ) {
    this.clearParcels()
    this.groups = response.groups
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
    this.updateParcelColors()
  }

  private updateParcelColors() {
    if (!this.topMesh || !this.sideMesh) return
    const write = (
      attribute: THREE.BufferAttribute,
      vertexGroups: Uint32Array,
      darken: number,
    ) => {
      const color = new THREE.Color()
      for (let vertex = 0; vertex < vertexGroups.length; vertex += 1) {
        const group = this.groups[vertexGroups[vertex]]
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

  private selectGroup(group: ParcelGroup, rid: number, publish: boolean) {
    this.selectedRid = rid
    this.selectedGroup = group
    this.buildSelectionMesh(group)
    if (publish) this.callbacks.onSelect(group, rid)
  }

  private buildSelectionMesh(group: ParcelGroup) {
    this.clearSelectionMesh()
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

  private updateSelectionLift(delta: number) {
    if (!this.selectedMesh) return
    const target = Number(this.selectedMesh.userData.targetLift ?? 0)
    this.selectedMesh.position.y = THREE.MathUtils.damp(
      this.selectedMesh.position.y,
      target,
      7,
      delta,
    )
  }

  private updateAnchor() {
    if (!this.selectedGroup) return
    const local = this.absoluteToLocal(
      this.selectedGroup.center[0],
      this.selectedGroup.center[1],
    )
    local.y =
      this.selectedGroup.height + (this.selectedMesh?.position.y ?? 0) + 2
    local.project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x = rect.left + ((local.x + 1) / 2) * rect.width
    const y = rect.top + ((1 - local.y) / 2) * rect.height
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.callbacks.onAnchor({ x, y })
    }
  }

  private clearParcels() {
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
    this.groups = []
    this.triangleGroups = new Uint32Array()
    this.topVertexGroups = new Uint32Array()
    this.sideVertexGroups = new Uint32Array()
    this.clearSelectionMesh()
  }

  private clearSelectionMesh() {
    if (!this.selectedMesh) return
    this.selectionRoot.remove(this.selectedMesh)
    this.selectedMesh.geometry.dispose()
    const materials = Array.isArray(this.selectedMesh.material)
      ? this.selectedMesh.material
      : [this.selectedMesh.material]
    materials.forEach((material) => material.dispose())
    this.selectedMesh = undefined
  }

  private publishStatus() {
    const distance = this.camera.position.distanceTo(this.controls.target)
    this.callbacks.onStatus({
      phase:
        distance > 7_500
          ? 'zoom-to-parcels'
          : this.groups.length
            ? 'parcels-ready'
            : 'loading-parcels',
      message:
        distance > 7_500
          ? 'Move closer to reveal parcel boundaries'
          : this.groups.length
            ? `${this.groups.length.toLocaleString()} visible footprints`
            : 'Loading parcel fabric',
      visibleParcels: this.groups.length,
      onlineTiles: this.tileAvailable,
    })
  }

  private absoluteToLocal(x: number, y: number) {
    return new THREE.Vector3(
      x - this.manifest.projection.localOrigin[0],
      0,
      -(y - this.manifest.projection.localOrigin[1]),
    )
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.scheduleMapUpdate(0)
  }
}
