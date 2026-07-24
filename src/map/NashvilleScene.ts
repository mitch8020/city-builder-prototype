import * as THREE from 'three'
import { CameraRig } from './CameraRig'
import { keyboardShortcutForKey } from './camera-utils'
import { COLORS } from './constants'
import { bestParcelMatch, pointInGroup } from './map-utils'
import { ParcelLayer } from './ParcelLayer'
import { ParcelStream } from './ParcelStream'
import { MetroTileManager } from './tile-manager'
import type {
  CityMapController,
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  ParcelSelectionHint,
  SceneStatus,
  WorkerLoadedResponse,
} from './types'

export interface NashvilleSceneCallbacks {
  onSelect: (group?: ParcelGroup, rid?: number) => void
  onHover: (group?: ParcelGroup) => void
  onStatus: (status: SceneStatus) => void
  onAnchor: (anchor?: { x: number; y: number }) => void
  onModeShortcut: (mode: MapMode) => void
  onEscape: () => void
}

export class NashvilleScene implements CityMapController {
  private readonly scene = new THREE.Scene()
  private readonly renderer: THREE.WebGLRenderer
  private readonly cameraRig: CameraRig
  private readonly parcelLayer: ParcelLayer
  private readonly parcelStream: ParcelStream
  private previousFrame = performance.now()
  private readonly raycaster = new THREE.Raycaster() as THREE.Raycaster & {
    firstHitOnly: boolean
  }
  private readonly tileManager: MetroTileManager
  private readonly pointer = new THREE.Vector2()
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly groundHit = new THREE.Vector3()
  private readonly countyBounds: [number, number, number, number]
  private callbacks: NashvilleSceneCallbacks
  private mode: MapMode
  private selectedRid?: number
  private selectedGroup?: ParcelGroup
  private hoveredGroupId = -1
  private frame = 0
  private resizeObserver: ResizeObserver
  private dataTimer?: ReturnType<typeof setTimeout>
  private tileTimer?: ReturnType<typeof setTimeout>
  private pendingSelection?: {
    point: [number, number]
    hint?: ParcelSelectionHint
  }
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
    this.parcelLayer = new ParcelLayer(manifest, mode)
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
    const countySize = Math.max(
      manifest.projection.bounds[2] - manifest.projection.bounds[0],
      manifest.projection.bounds[3] - manifest.projection.bounds[1],
    )
    this.cameraRig = new CameraRig(canvas, {
      width,
      height,
      countyBounds: this.countyBounds,
      localOrigin: manifest.projection.localOrigin,
      onViewChange: (delay) => this.scheduleMapUpdate(delay),
    })

    this.scene.add(this.parcelLayer.root)
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

    this.parcelStream = new ParcelStream(manifest, {
      onProgress: (message) => this.publishLoadingStatus(message),
      onLoaded: (response) => this.installParcelResponse(response),
      onError: (message) => this.publishError(message),
    })

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
    this.parcelLayer.setMode(mode)
  }

  setSelectedRid(rid?: number) {
    this.selectedRid = rid
    if (rid === undefined) {
      this.selectedGroup = undefined
      this.parcelLayer.clearSelection()
      this.callbacks.onAnchor(undefined)
      return
    }
    const group = this.parcelLayer.findByRid(rid)
    if (group) this.selectGroup(group, rid, false)
  }

  home() {
    this.cameraRig.home()
    this.pendingSelection = undefined
  }

  zoomBy(factor: number) {
    this.cameraRig.zoomBy(factor)
  }

  rotateToNorth() {
    this.cameraRig.rotateToNorth()
  }

  tiltBy(radians: number) {
    this.cameraRig.tiltBy(radians)
  }

  flyTo(x: number, y: number, distance = 1_800) {
    const target = this.absoluteToLocal(x, y)
    this.cameraRig.flyTo(target, distance, 900)
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
    this.parcelStream.dispose()
    this.cameraRig.dispose()
    this.tileManager.dispose()
    this.parcelLayer.clear()
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
      this.cameraRig.setEdgePan(0, 0)
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
        visibleParcels: this.parcelLayer.count,
        onlineTiles: this.tileAvailable,
      })
    })
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
    this.cameraRig.setKey(key, true)
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.cameraRig.setKey(event.key.toLowerCase(), false)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const edge = 28
    const edgePanX =
      event.clientX - rect.left < edge
        ? -1
        : rect.right - event.clientX < edge
          ? 1
          : 0
    const edgePanY =
      event.clientY - rect.top < edge
        ? 1
        : rect.bottom - event.clientY < edge
          ? -1
          : 0
    this.cameraRig.setEdgePan(edgePanX, edgePanY)
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
    if (!this.parcelLayer.count) return undefined
    this.raycaster.setFromCamera(this.pointer, this.cameraRig.camera)
    const hitGroup = this.parcelLayer.hitGroup(this.raycaster)
    if (hitGroup) return hitGroup

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
    for (const group of this.parcelLayer.groups) {
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
    this.cameraRig.update(delta)
    this.parcelLayer.update(delta)
    this.updateAnchor()
    this.renderer.render(this.scene, this.cameraRig.camera)
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
      this.raycaster.setFromCamera(
        new THREE.Vector2(x, y),
        this.cameraRig.camera,
      )
      const point = this.raycaster.ray.intersectPlane(
        plane,
        new THREE.Vector3(),
      )
      if (point) localPoints.push(point)
    }
    if (localPoints.length < 2) {
      const distance = this.cameraRig.distance
      localPoints.push(
        this.cameraRig.target.clone().addScalar(-distance),
        this.cameraRig.target.clone().addScalar(distance),
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
    const distance = this.cameraRig.distance
    if (distance > 7_500) {
      if (this.parcelStream.cancel()) {
        this.clearParcels()
      }
      this.publishStatus()
      return
    }

    const bounds = this.viewBounds()
    const shardCount = this.parcelStream.load(bounds)
    if (shardCount === undefined) return
    this.publishLoadingStatus(
      `Loading ${shardCount} map ${shardCount === 1 ? 'cell' : 'cells'}`,
    )
  }

  private installParcelResponse(response: WorkerLoadedResponse) {
    this.parcelLayer.install(response)
    if (this.pendingSelection) {
      const pending = this.pendingSelection
      const candidates = this.parcelLayer.groups.filter((candidate) =>
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

  private publishLoadingStatus(message: string) {
    this.callbacks.onStatus({
      phase: 'loading-parcels',
      message,
      visibleParcels: this.parcelLayer.count,
      onlineTiles: this.tileAvailable,
    })
  }

  private publishError(message: string) {
    this.callbacks.onStatus({
      phase: 'error',
      message,
      visibleParcels: this.parcelLayer.count,
      onlineTiles: this.tileAvailable,
    })
  }

  private selectGroup(group: ParcelGroup, rid: number, publish: boolean) {
    this.selectedRid = rid
    this.selectedGroup = group
    this.parcelLayer.select(group)
    if (publish) this.callbacks.onSelect(group, rid)
  }

  private updateAnchor() {
    if (!this.selectedGroup) return
    const local = this.absoluteToLocal(
      this.selectedGroup.center[0],
      this.selectedGroup.center[1],
    )
    local.y = this.selectedGroup.height + this.parcelLayer.selectionLift + 2
    local.project(this.cameraRig.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x = rect.left + ((local.x + 1) / 2) * rect.width
    const y = rect.top + ((1 - local.y) / 2) * rect.height
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.callbacks.onAnchor({ x, y })
    }
  }

  private clearParcels() {
    this.parcelLayer.clear()
  }

  private publishStatus() {
    const distance = this.cameraRig.distance
    this.callbacks.onStatus({
      phase:
        distance > 7_500
          ? 'zoom-to-parcels'
          : this.parcelLayer.count
            ? 'parcels-ready'
            : 'loading-parcels',
      message:
        distance > 7_500
          ? 'Move closer to reveal parcel boundaries'
          : this.parcelLayer.count
            ? `${this.parcelLayer.count.toLocaleString()} visible footprints`
            : 'Loading parcel fabric',
      visibleParcels: this.parcelLayer.count,
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
    this.cameraRig.resize(width, height)
    this.renderer.setSize(width, height, false)
    this.scheduleMapUpdate(0)
  }
}
