// @vitest-environment jsdom

import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NashvilleScene } from '../../src/map/NashvilleScene'
import type {
  ParcelGroup,
  ParcelManifestV1,
  WorkerLoadedResponse,
} from '../../src/map/types'

const doubles = vi.hoisted(() => ({
  rigs: [] as unknown[],
  layers: [] as unknown[],
  streams: [] as unknown[],
  interactions: [] as unknown[],
  tiles: [] as unknown[],
  renderers: [] as unknown[],
  resize: undefined as (() => void) | undefined,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>()
  class WebGLRenderer {
    domElement: HTMLCanvasElement
    shadowMap = { enabled: false, type: 0 }
    outputColorSpace = ''
    toneMapping = 0
    toneMappingExposure = 0
    setSize = vi.fn()
    setPixelRatio = vi.fn()
    render = vi.fn()
    dispose = vi.fn()
    constructor(options: { canvas: HTMLCanvasElement }) {
      this.domElement = options.canvas
      doubles.renderers.push(this)
    }
  }
  return { ...actual, WebGLRenderer }
})

vi.mock('../../src/map/CameraRig', async () => {
  const Three = await vi.importActual<typeof THREE>('three')
  return {
    CameraRig: class {
      camera = new Three.PerspectiveCamera(34, 1, 1, 100_000)
      target = new Three.Vector3()
      distance = 8_000
      home = vi.fn()
      zoomBy = vi.fn()
      rotateToNorth = vi.fn()
      tiltBy = vi.fn()
      flyTo = vi.fn()
      update = vi.fn()
      resize = vi.fn()
      dispose = vi.fn()
      constructor(
        _canvas: HTMLCanvasElement,
        readonly options: {
          onViewChange: (delay?: number, settled?: boolean) => void
        },
      ) {
        this.camera.position.set(0, 1_000, 1_000)
        this.camera.lookAt(0, 0, 0)
        this.camera.updateMatrixWorld()
        this.camera.updateProjectionMatrix()
        doubles.rigs.push(this)
      }
    },
  }
})

vi.mock('../../src/map/ParcelLayer', async () => {
  const Three = await vi.importActual<typeof THREE>('three')
  return {
    ParcelLayer: class {
      root = new Three.Group()
      groups: ParcelGroup[] = []
      countOverride?: number
      selectionLift = 0
      setMode = vi.fn()
      findByRid = vi.fn()
      clearSelection = vi.fn()
      select = vi.fn()
      hitGroup = vi.fn()
      install = vi.fn((response: WorkerLoadedResponse) => {
        this.groups = response.groups
      })
      update = vi.fn()
      clear = vi.fn(() => {
        this.groups = []
      })
      get count() {
        return this.countOverride ?? this.groups.length
      }
      constructor() {
        doubles.layers.push(this)
      }
    },
  }
})

vi.mock('../../src/map/ParcelStream', () => ({
  ParcelStream: class {
    isLoading = false
    load = vi.fn()
    cancel = vi.fn()
    dispose = vi.fn()
    constructor(
      _manifest: ParcelManifestV1,
      readonly handlerCallbacks: Record<string, (value: unknown) => void>,
    ) {
      doubles.streams.push(this)
    }
  },
}))

vi.mock('../../src/map/MapInteractions', () => ({
  MapInteractions: class {
    dispose = vi.fn()
    constructor(
      _canvas: HTMLCanvasElement,
      _rig: unknown,
      readonly handlerCallbacks: Record<
        string,
        (...args: unknown[]) => unknown
      >,
    ) {
      doubles.interactions.push(this)
    }
  },
}))

vi.mock('../../src/map/tile-manager', async () => {
  const Three = await vi.importActual<typeof THREE>('three')
  return {
    MetroTileManager: class {
      group = new Three.Group()
      update = vi.fn()
      dispose = vi.fn()
      constructor(
        _origin: [number, number],
        readonly availability: (available: boolean) => void,
      ) {
        doubles.tiles.push(this)
      }
    },
  }
})

const group = {
  id: 1,
  bounds: [0, 0, 10, 10],
  center: [5, 5],
  height: 2,
  records: [
    {
      rid: 1,
      stanpar: '001',
      parId: 1,
      featureType: 'Parcel',
      floor: '',
      address: 'Test',
      acres: 1,
      landUseCode: 'RES',
      landUse: 'Residential',
      zoning: 'R6',
      landAppraisal: 1,
      improvementAppraisal: 1,
      totalAppraisal: 2,
    },
  ],
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [0, 10],
        [0, 0],
      ],
    ],
  },
} as ParcelGroup

const response = {
  type: 'loaded',
  generation: 1,
  logicalRecordCount: 1,
  groups: [group],
  topPositions: new Float32Array(),
  topIndices: new Uint32Array(),
  topVertexGroups: new Uint32Array(),
  topTriangleGroups: new Uint32Array(),
  sidePositions: new Float32Array(),
  sideIndices: new Uint32Array(),
  sideVertexGroups: new Uint32Array(),
  edgePositions: new Float32Array(),
} as WorkerLoadedResponse

const manifest = {
  overviewUrl: '/overview.json',
  projection: {
    bounds: [0, 0, 100, 50],
    localOrigin: [0, 0],
  },
} as ParcelManifestV1

function callbacks() {
  return {
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onStatus: vi.fn(),
    onAnchor: vi.fn(),
    onModeShortcut: vi.fn(),
    onEscape: vi.fn(),
  }
}

interface Internals {
  disposed: boolean
  selectedGroup?: ParcelGroup
  selectedRid?: number
  settledUpdatePending: boolean
  pendingSelection?: {
    point: [number, number]
    hint?: { parId?: number }
    destinationRequested?: boolean
  }
  callbacks: ReturnType<typeof callbacks>
  raycaster: {
    setFromCamera: ReturnType<typeof vi.fn>
    ray: { intersectPlane: ReturnType<typeof vi.fn> }
  }
  addOverview: () => Promise<void>
  pickGroup: (pointer: THREE.Vector2) => ParcelGroup | undefined
  animate: () => void
  scheduleMapUpdate: (delay?: number, viewSettled?: boolean) => void
  viewBounds: () => [number, number, number, number]
  updateTiles: () => void
  updateParcelWindow: (viewSettled?: boolean) => void
  installParcelResponse: (value: WorkerLoadedResponse) => void
  publishStatus: () => void
  updateAnchor: () => void
  resize: () => void
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const list of [
    doubles.rigs,
    doubles.layers,
    doubles.streams,
    doubles.interactions,
    doubles.tiles,
    doubles.renderers,
  ]) {
    list.length = 0
  }
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        doubles.resize = callback
      }
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as WebGL2RenderingContext,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [0, 0],
                      [1, 1],
                    ],
                  ],
                },
              },
              {
                geometry: {
                  type: 'MultiPolygon',
                  coordinates: [
                    [
                      [
                        [0, 0],
                        [1, 1],
                      ],
                    ],
                  ],
                },
              },
              { geometry: { type: 'Point', coordinates: [] } },
            ],
          }),
        ),
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NashvilleScene', () => {
  it('reports missing WebGL2', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const container = document.createElement('div')
    expect(
      () => new NashvilleScene(container, manifest, 'overview', callbacks()),
    ).toThrow('WEBGL2_UNAVAILABLE')
  })

  it('coordinates rendering, loading, picking, selection, status, and cleanup', async () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 0 },
      clientHeight: { value: 0 },
    })
    const initial = callbacks()
    const scene = new NashvilleScene(container, manifest, 'overview', initial)
    const internal = scene as unknown as Internals
    const rig = doubles.rigs[0] as {
      distance: number
      target: THREE.Vector3
      camera: THREE.PerspectiveCamera
      options: {
        onViewChange: (delay?: number, settled?: boolean) => void
      }
      home: ReturnType<typeof vi.fn>
      zoomBy: ReturnType<typeof vi.fn>
      rotateToNorth: ReturnType<typeof vi.fn>
      tiltBy: ReturnType<typeof vi.fn>
      flyTo: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      resize: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
    }
    const layer = doubles.layers[0] as {
      groups: ParcelGroup[]
      countOverride?: number
      selectionLift: number
      setMode: ReturnType<typeof vi.fn>
      findByRid: ReturnType<typeof vi.fn>
      clearSelection: ReturnType<typeof vi.fn>
      select: ReturnType<typeof vi.fn>
      hitGroup: ReturnType<typeof vi.fn>
      install: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      clear: ReturnType<typeof vi.fn>
      count: number
    }
    const stream = doubles.streams[0] as {
      handlerCallbacks: Record<string, (value: unknown) => void>
      isLoading: boolean
      load: ReturnType<typeof vi.fn>
      cancel: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
    }
    const interaction = doubles.interactions[0] as {
      handlerCallbacks: Record<string, (...args: unknown[]) => unknown>
      dispose: ReturnType<typeof vi.fn>
    }
    const tiles = doubles.tiles[0] as {
      availability: (available: boolean) => void
      update: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
    }

    await internal.addOverview()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(undefined, { status: 503 }),
    )
    await internal.addOverview()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    await internal.addOverview()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({})))
    await internal.addOverview()

    const updated = callbacks()
    scene.updateCallbacks(updated)
    scene.setMode('overview')
    scene.setMode('value')
    expect(layer.setMode).toHaveBeenCalledWith('value')
    scene.setSelectedRid(undefined)
    layer.findByRid.mockReturnValue(group)
    scene.setSelectedRid(1)
    layer.findByRid.mockReturnValue(undefined)
    scene.setSelectedRid(99)

    scene.home()
    scene.zoomBy(2)
    scene.rotateToNorth()
    scene.tiltBy(0.2)
    scene.flyTo(10, 20)
    scene.selectAt(10, 20, { parId: 1 })
    expect(rig.flyTo).toHaveBeenCalled()

    tiles.availability(navigator.onLine)
    tiles.availability(!navigator.onLine)
    stream.handlerCallbacks.onProgress('Loading')
    stream.handlerCallbacks.onError('Broken')
    stream.handlerCallbacks.onLoaded(response)
    interaction.handlerCallbacks.onHover(group)
    interaction.handlerCallbacks.onEscape()
    interaction.handlerCallbacks.onModeShortcut('zoning')
    interaction.handlerCallbacks.onContextLost()
    interaction.handlerCallbacks.onSelect(undefined)
    interaction.handlerCallbacks.onSelect(group)
    interaction.handlerCallbacks.onHome()
    interaction.handlerCallbacks.pickGroup(new THREE.Vector2())

    layer.groups = []
    expect(internal.pickGroup(new THREE.Vector2())).toBeUndefined()
    const outside = {
      ...group,
      id: 2,
      bounds: [20, 20, 30, 30],
      center: [25, 25],
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [20, 20],
            [30, 20],
            [20, 30],
            [20, 20],
          ],
        ],
      },
    } as ParcelGroup
    const moreRecords = {
      ...group,
      id: 3,
      records: [...group.records, { ...group.records[0], rid: 2 }],
      height: 1,
    }
    const shorter = { ...moreRecords, id: 4, height: 0 }
    const taller = { ...moreRecords, id: 5, height: 4 }
    layer.groups = [outside, group, moreRecords, shorter, taller]
    layer.hitGroup.mockReturnValue(group)
    expect(internal.pickGroup(new THREE.Vector2())).toBe(group)
    layer.hitGroup.mockReturnValue(undefined)
    internal.raycaster = {
      setFromCamera: vi.fn(),
      ray: { intersectPlane: vi.fn().mockReturnValue(null) },
    }
    expect(internal.pickGroup(new THREE.Vector2())).toBeUndefined()
    layer.countOverride = 1
    layer.groups = []
    internal.raycaster.ray.intersectPlane.mockImplementation(
      (_plane, target: THREE.Vector3) => target.set(2, 0, -2),
    )
    expect(internal.pickGroup(new THREE.Vector2())).toBeUndefined()
    layer.countOverride = undefined
    layer.groups = [outside, group, moreRecords, shorter, taller]
    internal.raycaster.ray.intersectPlane.mockImplementation(
      (_plane, target: THREE.Vector3) => target.set(2, 0, -2),
    )
    expect(internal.pickGroup(new THREE.Vector2())).toBe(taller)

    internal.raycaster.ray.intersectPlane
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockImplementation((_plane, target: THREE.Vector3) =>
        target.set(1, 0, 1),
      )
    expect(internal.viewBounds()).toHaveLength(4)
    internal.raycaster.ray.intersectPlane.mockReturnValue(null)
    expect(internal.viewBounds()).toHaveLength(4)
    internal.updateTiles()
    expect(tiles.update).toHaveBeenCalled()

    rig.distance = 8_000
    stream.cancel.mockReturnValueOnce(false).mockReturnValueOnce(true)
    internal.updateParcelWindow()
    internal.updateParcelWindow()
    rig.distance = 1_000
    stream.load
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
    internal.updateParcelWindow()
    internal.updateParcelWindow()
    internal.updateParcelWindow()

    internal.pendingSelection = {
      point: [50, 50],
      destinationRequested: false,
    }
    stream.isLoading = false
    stream.load.mockReturnValueOnce(undefined)
    internal.updateParcelWindow(true)
    expect(internal.pendingSelection).toBeUndefined()
    internal.pendingSelection = {
      point: [50, 50],
      destinationRequested: false,
    }
    stream.isLoading = true
    stream.load.mockReturnValueOnce(undefined)
    internal.updateParcelWindow(true)
    expect(internal.pendingSelection).toMatchObject({
      destinationRequested: true,
    })
    internal.installParcelResponse(response)
    expect(internal.pendingSelection).toBeUndefined()
    internal.pendingSelection = {
      point: [50, 50],
      destinationRequested: true,
    }
    stream.handlerCallbacks.onError('Destination failed')
    expect(internal.pendingSelection).toBeUndefined()
    stream.isLoading = false

    internal.pendingSelection = { point: [2, 2], hint: { parId: 1 } }
    layer.groups = [group]
    internal.installParcelResponse(response)
    updated.onSelect.mockClear()
    scene.selectAt(2, 2, { parId: 1 })
    expect(internal.pendingSelection).toBeUndefined()
    expect(updated.onSelect).toHaveBeenCalledWith(group, 1)
    internal.pendingSelection = { point: [22, 22] }
    interaction.handlerCallbacks.onSelect(group)
    expect(internal.pendingSelection).toBeUndefined()
    internal.pendingSelection = { point: [22, 22] }
    interaction.handlerCallbacks.onSelect(undefined)
    expect(internal.pendingSelection).toBeUndefined()
    internal.pendingSelection = { point: [22, 22] }
    scene.setSelectedRid(1)
    expect(internal.pendingSelection).toBeUndefined()
    internal.pendingSelection = { point: [22, 22] }
    scene.setSelectedRid(undefined)
    expect(internal.pendingSelection).toBeUndefined()
    internal.pendingSelection = { point: [22, 22] }
    internal.installParcelResponse(response)
    expect(internal.pendingSelection).toEqual({ point: [22, 22] })
    internal.installParcelResponse({ ...response, groups: [outside] })
    expect(internal.pendingSelection).toBeUndefined()
    expect(updated.onSelect).toHaveBeenLastCalledWith(outside, 1)
    internal.pendingSelection = undefined
    internal.selectedRid = 1
    layer.findByRid.mockReturnValue(group)
    internal.installParcelResponse(response)
    internal.selectedRid = undefined
    internal.installParcelResponse(response)

    rig.distance = 8_000
    internal.publishStatus()
    rig.distance = 1_000
    layer.groups = [group]
    internal.publishStatus()
    layer.groups = []
    internal.publishStatus()

    internal.selectedGroup = undefined
    internal.updateAnchor()
    internal.selectedGroup = group
    layer.selectionLift = 1
    const renderer = doubles.renderers[0] as {
      domElement: HTMLCanvasElement
      render: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
    }
    vi.spyOn(renderer.domElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    } as DOMRect)
    internal.updateAnchor()
    vi.spyOn(renderer.domElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: Number.NaN,
      height: 100,
    } as DOMRect)
    internal.updateAnchor()

    internal.disposed = false
    internal.animate()
    internal.disposed = true
    internal.animate()
    internal.disposed = false
    internal.scheduleMapUpdate()
    vi.runAllTimers()
    doubles.resize?.()
    expect(internal.settledUpdatePending).toBe(false)
    rig.options.onViewChange(0, true)
    internal.scheduleMapUpdate()
    expect(internal.settledUpdatePending).toBe(true)
    vi.runAllTimers()
    expect(internal.settledUpdatePending).toBe(false)
    doubles.resize?.()
    vi.runAllTimers()

    scene.dispose()
    expect(stream.dispose).toHaveBeenCalled()
    expect(interaction.dispose).toHaveBeenCalled()
    expect(rig.dispose).toHaveBeenCalled()
    expect(tiles.dispose).toHaveBeenCalled()
    expect(renderer.dispose).toHaveBeenCalled()
  })
})
