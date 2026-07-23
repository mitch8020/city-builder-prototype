import {
  ClientOnly,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CityMap } from '../map/CityMap'
import {
  DesktopGuard,
  HoverCard,
  LegendPanel,
  ManifestErrorScreen,
  MapFooter,
  MapLoading,
  MapToast,
  MapTopbar,
  SurveyTether,
  UnsupportedScreen,
  ZoomInvitation,
} from '../map/components/MapChrome'
import {
  CameraRail,
  ControlsModal,
  ModeRibbon,
} from '../map/components/MapControls'
import { MapSearch } from '../map/components/MapSearch'
import { ParcelInspector } from '../map/components/ParcelInspector'
import { LANDMARKS } from '../map/constants'
import { groupPrimaryRecord } from '../map/map-utils'
import { landmarkSuggestions, searchNashville } from '../map/nashville-search'
import type {
  CityMapController,
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  SceneStatus,
  SearchResult,
} from '../map/types'
import { mapSearchSchema, parcelManifestSchema } from '../map/validation'

export const Route = createFileRoute('/')({
  validateSearch: mapSearchSchema,
  component: NashvilleApp,
})

const INITIAL_STATUS: SceneStatus = {
  phase: 'starting',
  message: 'Preparing Davidson County',
  visibleParcels: 0,
  onlineTiles: true,
}

function NashvilleApp() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  const mapRef = useRef<CityMapController | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchAbortRef = useRef<AbortController | undefined>(undefined)
  const shareResolvedRef = useRef(false)
  const anchorUpdateRef = useRef({ time: 0, x: 0, y: 0 })
  const [manifest, setManifest] = useState<ParcelManifestV1>()
  const [manifestError, setManifestError] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<ParcelGroup>()
  const [selectedRid, setSelectedRid] = useState<number>()
  const [hoveredGroup, setHoveredGroup] = useState<ParcelGroup>()
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [helpOpen, setHelpOpen] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number }>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/parcels/manifest.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Manifest returned ${response.status}`)
        return response.json()
      })
      .then((data: unknown) => {
        const parsed = parcelManifestSchema.parse(data)
        if (parsed.source.recordCount !== 286_458) {
          throw new Error('The parcel manifest failed validation')
        }
        setManifest(parsed)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setManifestError(
          'The packaged parcel snapshot is unavailable or invalid.',
        )
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3_600)
    return () => clearTimeout(timer)
  }, [toast])

  const setMode = useCallback(
    (mode: MapMode) => {
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, mode }),
      })
    },
    [navigate],
  )

  const handleSelect = useCallback(
    (group?: ParcelGroup, rid?: number) => {
      setSelectedGroup(group)
      setSelectedRid(rid)
      if (!group || rid === undefined) {
        setAnchor(undefined)
        void navigate({
          replace: true,
          search: (previous) => ({
            ...previous,
            parcel: undefined,
            parId: undefined,
            floor: undefined,
          }),
        })
        return
      }
      const record = groupPrimaryRecord(group, rid)
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          parcel: record.stanpar || undefined,
          parId: record.parId >= 0 ? record.parId : undefined,
          floor: record.floor || undefined,
        }),
      })
    },
    [navigate],
  )

  const handleAnchor = useCallback((next?: { x: number; y: number }) => {
    if (!next) {
      setAnchor(undefined)
      return
    }
    const now = performance.now()
    const previous = anchorUpdateRef.current
    if (
      now - previous.time < 45 &&
      Math.hypot(next.x - previous.x, next.y - previous.y) < 2
    ) {
      return
    }
    anchorUpdateRef.current = { time: now, x: next.x, y: next.y }
    setAnchor(next)
  }, [])

  const handleEscape = useCallback(() => {
    if (helpOpen) {
      setHelpOpen(false)
      return
    }
    if (searchOpen) {
      setSearchOpen(false)
      return
    }
    if (selectedGroup) handleSelect(undefined)
  }, [handleSelect, helpOpen, searchOpen, selectedGroup])

  const handleUnsupported = useCallback(() => setUnsupported(true), [])

  useEffect(() => {
    searchAbortRef.current?.abort()
    if (query.trim().length < 2) {
      setResults(landmarkSuggestions(query))
      setSearching(false)
      return
    }
    setResults([])
    setSearching(true)
    const controller = new AbortController()
    searchAbortRef.current = controller
    const timer = setTimeout(() => {
      searchNashville(query, { signal: controller.signal })
        .then(setResults)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return
          setResults(landmarkSuggestions(query))
          setToast('Metro search is offline. Landmark jumps still work.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 260)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.key !== '/' ||
        target?.matches('input, textarea, select') ||
        target?.isContentEditable
      ) {
        return
      }
      event.preventDefault()
      setSearchOpen(true)
      if (!query) setResults(landmarkSuggestions(query))
      searchInputRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [query])

  useEffect(() => {
    if (
      !manifest ||
      !search.parcel ||
      shareResolvedRef.current ||
      !mapRef.current
    ) {
      return
    }
    shareResolvedRef.current = true
    searchNashville(
      search.parId !== undefined ? `parId:${search.parId}` : search.parcel,
    )
      .then((matches) => {
        if (matches.length === 0) {
          setToast('That shared parcel could not be located.')
          return
        }
        const result =
          matches.find((match) => match.kind === 'parcel') || matches[0]
        setQuery(result.label)
        mapRef.current?.selectAt(result.x, result.y, {
          address: result.label,
          parcel: result.parcel,
          parId: result.parId,
        })
      })
      .catch(() => setToast('That shared parcel could not be restored.'))
  }, [manifest, search.parcel, search.parId])

  const selectResult = (result: SearchResult) => {
    setQuery(result.label)
    setSearching(false)
    setSearchOpen(false)
    mapRef.current?.selectAt(result.x, result.y, {
      address: result.label,
      parcel: result.parcel,
      parId: result.parId,
    })
  }

  const cycleUnit = (direction: number) => {
    if (!selectedGroup || selectedRid === undefined) return
    const current = selectedGroup.records.findIndex(
      (record) => record.rid === selectedRid,
    )
    const next =
      (current + direction + selectedGroup.records.length) %
      selectedGroup.records.length
    const record = selectedGroup.records[next]
    setSelectedRid(record.rid)
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        parcel: record.stanpar || undefined,
        parId: record.parId >= 0 ? record.parId : undefined,
        floor: record.floor || undefined,
      }),
    })
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setToast('Parcel link copied')
    } catch {
      setToast('Could not copy the link. Copy it from the address bar.')
    }
  }

  if (unsupported) return <UnsupportedScreen />
  if (manifestError) {
    return (
      <ManifestErrorScreen
        message={manifestError}
        onRetry={() => window.location.reload()}
      />
    )
  }

  const hasSelection = Boolean(selectedGroup && selectedRid !== undefined)

  return (
    <main className="city-app">
      <DesktopGuard />

      <div className="desktop-experience">
        <div className="map-stage">
          {manifest ? (
            <ClientOnly fallback={<MapLoading />}>
              <CityMap
                ref={mapRef}
                manifest={manifest}
                mode={search.mode}
                selectedRid={selectedRid}
                onSelect={handleSelect}
                onHover={setHoveredGroup}
                onStatus={setStatus}
                onAnchor={handleAnchor}
                onModeShortcut={setMode}
                onEscape={handleEscape}
                onUnsupported={handleUnsupported}
              />
            </ClientOnly>
          ) : (
            <MapLoading />
          )}
        </div>

        <MapTopbar
          manifest={manifest}
          status={status}
          onOpenControls={() => {
            setSearchOpen(false)
            setHelpOpen(true)
          }}
          search={
            <MapSearch
              query={query}
              results={results}
              searching={searching}
              open={searchOpen}
              inputRef={searchInputRef}
              onQueryChange={(value) => {
                setQuery(value)
                setSearchOpen(true)
                if (value.trim().length < 2) {
                  setResults(landmarkSuggestions(value))
                  setSearching(false)
                } else {
                  setResults([])
                  setSearching(true)
                }
              }}
              onOpen={() => {
                setSearchOpen(true)
                if (!query) setResults(landmarkSuggestions(query))
              }}
              onClose={() => setSearchOpen(false)}
              onSelect={selectResult}
            />
          }
        />

        <LegendPanel manifest={manifest} mode={search.mode} />
        <CameraRail mapRef={mapRef} inspectorOpen={hasSelection} />

        {selectedGroup && selectedRid !== undefined && (
          <ParcelInspector
            group={selectedGroup}
            selectedRid={selectedRid}
            onClose={() => handleSelect(undefined)}
            onCycleUnit={cycleUnit}
            onCopyLink={() => void copyLink()}
          />
        )}

        {anchor && hasSelection && <SurveyTether anchor={anchor} />}
        {hoveredGroup && !hasSelection && (
          <HoverCard group={hoveredGroup} mode={search.mode} />
        )}

        <ModeRibbon mode={search.mode} onModeChange={setMode} />
        <MapFooter status={status} />

        {status.phase === 'zoom-to-parcels' && (
          <ZoomInvitation
            onActivate={() => {
              const downtown = LANDMARKS[0]
              mapRef.current?.flyTo(downtown.x, downtown.y, 2_400)
            }}
          />
        )}

        {helpOpen && <ControlsModal onClose={() => setHelpOpen(false)} />}
        {toast && <MapToast message={toast} />}
      </div>
    </main>
  )
}
