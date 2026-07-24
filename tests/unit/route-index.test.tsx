// @vitest-environment jsdom

import type { ComponentType, ReactNode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CityMapController,
  ParcelGroup,
  ParcelManifestV1,
  SearchResult,
} from '../../src/map/types'

const state = vi.hoisted(() => ({
  config: undefined as
    { component: ComponentType; validateSearch: unknown } | undefined,
  search: {
    mode: 'overview',
    parcel: undefined as string | undefined,
    parId: undefined as number | undefined,
    floor: undefined as string | undefined,
  },
  navigate: vi.fn(),
  manifest: undefined as ParcelManifestV1 | undefined,
  manifestError: '',
  mapSearchOpen: false,
  closeSearch: vi.fn(),
  setQuery: vi.fn(),
  searchError: undefined as ((message: string) => void) | undefined,
  searchSelect: undefined as ((result: SearchResult) => void) | undefined,
  searchNashville: vi.fn(),
  cycleUnit: undefined as ((direction: number) => void) | undefined,
  controller: {
    home: vi.fn(),
    zoomBy: vi.fn(),
    rotateToNorth: vi.fn(),
    tiltBy: vi.fn(),
    flyTo: vi.fn(),
    selectAt: vi.fn(),
  },
}))

const parcelGroup = vi.hoisted<ParcelGroup>(() => ({
  id: 1,
  bounds: [0, 0, 1, 1],
  center: [0.5, 0.5],
  height: 2,
  records: [
    {
      rid: 1,
      stanpar: '001',
      parId: 10,
      featureType: 'Condominium',
      floor: '3',
      address: '100 Test Street',
      acres: 1,
      landUseCode: 'RES',
      landUse: 'Residential',
      zoning: 'R6',
      landAppraisal: 1,
      improvementAppraisal: 2,
      totalAppraisal: 3,
    },
    {
      rid: 2,
      stanpar: '',
      parId: -1,
      featureType: 'Condominium',
      floor: '',
      address: '100 Test Street',
      acres: 1,
      landUseCode: 'RES',
      landUse: 'Residential',
      zoning: 'R6',
      landAppraisal: 1,
      improvementAppraisal: 2,
      totalAppraisal: 3,
    },
  ],
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ],
  },
}))

vi.mock('@tanstack/react-router', () => {
  return {
    ClientOnly: ({ children }: { children: ReactNode }) => children,
    createFileRoute:
      () => (config: { component: ComponentType; validateSearch: unknown }) => {
        state.config = config
        return { useSearch: () => state.search }
      },
    useNavigate: () => state.navigate,
  }
})

vi.mock('../../src/map/hooks/useParcelManifest', () => ({
  useParcelManifest: () => ({
    manifest: state.manifest,
    error: state.manifestError,
  }),
}))

vi.mock('../../src/map/hooks/useMapSearch', () => ({
  useMapSearch: ({
    onSelect,
    onError,
  }: {
    onSelect: (result: SearchResult) => void
    onError: (message: string) => void
  }) => {
    state.searchSelect = onSelect
    state.searchError = onError
    return {
      inputRef: { current: null },
      query: '',
      results: [
        {
          id: 'result',
          label: 'Search result',
          detail: 'Parcel',
          x: 5,
          y: 6,
          kind: 'parcel',
          parcel: '001',
          parId: 10,
        },
      ],
      searching: false,
      open: state.mapSearchOpen,
      setQuery: state.setQuery,
      changeQuery: vi.fn(),
      openSearch: vi.fn(),
      closeSearch: state.closeSearch,
      selectResult: onSelect,
    }
  },
}))

vi.mock('../../src/map/nashville-search', () => ({
  searchNashville: state.searchNashville,
}))

vi.mock('../../src/map/CityMap', async () => {
  const React = await import('react')
  return {
    CityMap: React.forwardRef(
      (
        props: {
          onSelect: (group?: ParcelGroup, rid?: number) => void
          onHover: (group?: ParcelGroup) => void
          onStatus: (status: {
            phase: 'zoom-to-parcels'
            message: string
            visibleParcels: number
            onlineTiles: boolean
          }) => void
          onAnchor: (anchor?: { x: number; y: number }) => void
          onModeShortcut: (mode: 'value') => void
          onEscape: () => void
          onUnsupported: () => void
        },
        ref: React.ForwardedRef<CityMapController>,
      ) => {
        React.useImperativeHandle(ref, () => state.controller)
        return (
          <div data-testid="city-map">
            <button onClick={() => props.onSelect(parcelGroup, 1)}>
              select
            </button>
            <button onClick={() => props.onSelect(parcelGroup, 2)}>
              select-second
            </button>
            <button onClick={() => props.onSelect(undefined)}>clear</button>
            <button onClick={() => props.onHover(parcelGroup)}>hover</button>
            <button onClick={() => props.onAnchor({ x: 10, y: 20 })}>
              anchor
            </button>
            <button onClick={() => props.onAnchor({ x: 10.5, y: 20.5 })}>
              anchor-near
            </button>
            <button onClick={() => props.onAnchor(undefined)}>
              clear-anchor
            </button>
            <button
              onClick={() =>
                props.onStatus({
                  phase: 'zoom-to-parcels',
                  message: 'Zoom',
                  visibleParcels: 0,
                  onlineTiles: true,
                })
              }
            >
              zoom-status
            </button>
            <button onClick={() => props.onModeShortcut('value')}>mode</button>
            <button onClick={props.onEscape}>escape-map</button>
            <button onClick={props.onUnsupported}>unsupported</button>
          </div>
        )
      },
    ),
  }
})

vi.mock('../../src/map/components/ParcelInspector', () => ({
  ParcelInspector: ({
    onClose,
    onCycleUnit,
    onCopyLink,
  }: {
    onClose: () => void
    onCycleUnit: (direction: number) => void
    onCopyLink: () => void
  }) => {
    state.cycleUnit = onCycleUnit
    return (
      <aside>
        Selected parcel
        <button onClick={onClose}>Close parcel details</button>
        <button onClick={() => onCycleUnit(-1)}>
          Previous condominium unit
        </button>
        <button onClick={() => onCycleUnit(1)}>Next condominium unit</button>
        <button onClick={onCopyLink}>Copy map link</button>
      </aside>
    )
  },
}))

await import('../../src/routes/index')

const App = () => {
  if (!state.config) throw new Error('Route component was not captured')
  const Component = state.config.component
  return <Component />
}

const manifest = {
  source: { date: '2026-05-12' },
  projection: { bounds: [0, 0, 1, 1] },
  statistics: {
    appraisalQuantiles: [1, 2, 3, 4],
    landUse: [],
    zoning: [],
  },
} as unknown as ParcelManifestV1

beforeEach(() => {
  state.search.mode = 'overview'
  state.search.parcel = undefined
  state.search.parId = undefined
  state.search.floor = undefined
  state.manifest = undefined
  state.manifestError = ''
  state.mapSearchOpen = false
  state.navigate.mockReset()
  state.navigate.mockImplementation((options) => {
    if (typeof options.search === 'function') options.search(state.search)
  })
  state.closeSearch.mockReset()
  state.setQuery.mockReset()
  state.searchNashville.mockReset()
  state.cycleUnit = undefined
  for (const method of Object.values(state.controller)) {
    if ('mockReset' in method) method.mockReset()
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Nashville route orchestration', () => {
  it('renders loading and manifest-error states', () => {
    const loading = render(<App />)
    expect(loading.container.textContent).toContain('Preparing Nashville')
    loading.unmount()

    state.manifestError = 'Broken package'
    const failed = render(<App />)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.click(failed.getByText(/Try loading/))
    consoleError.mockRestore()
  })

  it('connects selection, search, camera, anchor, mode, toast, and help flows', async () => {
    vi.useFakeTimers()
    state.manifest = manifest
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    state.mapSearchOpen = true
    const view = render(<App />)

    fireEvent.click(view.getByText('escape-map'))
    fireEvent.click(view.getByText('Search result'))
    state.mapSearchOpen = false
    fireEvent.click(view.getByText('anchor'))
    fireEvent.click(view.getByText('escape-map'))
    expect(state.controller.selectAt).toHaveBeenCalledWith(
      5,
      6,
      expect.objectContaining({ parId: 10 }),
    )
    fireEvent.click(view.getByText('mode'))
    fireEvent.click(view.getByText('select'))
    expect(view.container.textContent).toContain('Selected parcel')
    fireEvent.click(view.getByText('Close parcel details'))
    fireEvent.click(view.getByText('select'))
    fireEvent.click(view.getByText('Next condominium unit'))
    fireEvent.click(view.getByText('Previous condominium unit'))
    fireEvent.click(view.getByText('select-second'))
    fireEvent.click(view.getByText('select'))
    fireEvent.click(view.getByText(/Copy map link/))
    await act(() => Promise.resolve())
    expect(view.container.textContent).toContain('Parcel link copied')

    fireEvent.click(view.getByText('anchor'))
    clock.mockReturnValue(110)
    fireEvent.click(view.getByText('anchor-near'))
    clock.mockReturnValue(200)
    fireEvent.click(view.getByText('anchor-near'))
    fireEvent.click(view.getByText('clear-anchor'))
    fireEvent.click(view.getByText('hover'))

    fireEvent.click(view.getByText('zoom-status'))
    fireEvent.click(view.getByText(/Parcel fabric appears/))
    expect(state.controller.flyTo).toHaveBeenCalled()

    fireEvent.click(view.getByLabelText('Open map controls'))
    expect(state.closeSearch).toHaveBeenCalled()
    fireEvent.click(view.getByText('escape-map'))
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.click(view.getByLabelText('Open map controls'))
    fireEvent.click(view.getByText('Return to the map'))

    act(() => state.searchError?.('Offline'))
    expect(view.container.textContent).toContain('Offline')
    await act(() => vi.advanceTimersByTimeAsync(3_600))
    expect(view.container.textContent).not.toContain('Offline')

    fireEvent.click(view.getByText('clear'))
    fireEvent.click(view.getByText('unsupported'))
    expect(view.container.textContent).toContain('This map needs WebGL 2')
  })

  it('handles search Escape, selected Escape, and clipboard denial', async () => {
    state.manifest = manifest
    state.mapSearchOpen = true
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const view = render(<App />)
    fireEvent.click(view.getByText('escape-map'))
    expect(state.closeSearch).toHaveBeenCalledOnce()
    state.mapSearchOpen = false

    fireEvent.click(view.getByText('select'))
    fireEvent.click(view.getByText(/Copy map link/))
    await act(() => Promise.resolve())
    expect(view.container.textContent).toContain('Could not copy')
    fireEvent.click(view.getByText('escape-map'))
  })

  it.each([
    {
      name: 'a matching parcel',
      result: () =>
        Promise.resolve([
          {
            id: 'address',
            label: 'Address first',
            detail: 'Address',
            x: 1,
            y: 2,
            kind: 'address' as const,
          },
          {
            id: 'parcel',
            label: 'Parcel match',
            detail: 'Parcel',
            x: 3,
            y: 4,
            kind: 'parcel' as const,
            parcel: '001',
          },
        ]),
      message: '',
      parId: undefined,
      expectedLabel: 'Parcel match',
      expectedPoint: [3, 4],
    },
    {
      name: 'an address fallback',
      result: () =>
        Promise.resolve([
          {
            id: 'address',
            label: 'Address only',
            detail: 'Address',
            x: 7,
            y: 8,
            kind: 'address' as const,
          },
        ]),
      message: '',
      parId: 10,
      expectedLabel: 'Address only',
      expectedPoint: [7, 8],
    },
    {
      name: 'no matches',
      result: () => Promise.resolve([]),
      message: 'could not be located',
      parId: 10,
      expectedLabel: '',
      expectedPoint: [0, 0],
    },
    {
      name: 'a transport failure',
      result: () => Promise.reject(new Error('offline')),
      message: 'could not be restored',
      parId: 10,
      expectedLabel: '',
      expectedPoint: [0, 0],
    },
  ])(
    'restores shared links for $name',
    async ({ result, message, parId, expectedLabel, expectedPoint }) => {
      state.manifest = manifest
      state.search.parcel = '001'
      state.search.parId = parId
      const pending = result()
      state.searchNashville.mockReturnValue(pending)
      const view = render(<App />)

      await act(async () => {
        await pending.catch(() => undefined)
      })
      if (message) expect(view.container.textContent).toContain(message)
      else {
        expect(state.setQuery).toHaveBeenCalledWith(expectedLabel)
        expect(state.controller.selectAt).toHaveBeenCalledWith(
          expectedPoint[0],
          expectedPoint[1],
          expect.any(Object),
        )
      }
    },
  )
})
