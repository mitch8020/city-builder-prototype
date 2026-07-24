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
import { useMapSearch } from '../map/hooks/useMapSearch'
import { useParcelManifest } from '../map/hooks/useParcelManifest'
import { groupPrimaryRecord } from '../map/map-utils'
import { searchNashville } from '../map/nashville-search'
import type {
  CityMapController,
  MapMode,
  ParcelGroup,
  SceneStatus,
  SearchResult,
} from '../map/types'
import { mapSearchSchema } from '../map/validation'

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
  const shareResolvedRef = useRef(false)
  const anchorUpdateRef = useRef({ time: 0, x: 0, y: 0 })
  const { manifest, error: manifestError } = useParcelManifest()
  const [selectedGroup, setSelectedGroup] = useState<ParcelGroup>()
  const [selectedRid, setSelectedRid] = useState<number>()
  const [hoveredGroup, setHoveredGroup] = useState<ParcelGroup>()
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [helpOpen, setHelpOpen] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number }>()
  const [toast, setToast] = useState('')
  const selectSearchResult = useCallback((result: SearchResult) => {
    mapRef.current?.selectAt(result.x, result.y, {
      address: result.label,
      parcel: result.parcel,
      parId: result.parId,
    })
  }, [])
  const mapSearch = useMapSearch({
    onSelect: selectSearchResult,
    onError: setToast,
  })

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
    if (mapSearch.open) {
      mapSearch.closeSearch()
      return
    }
    if (selectedGroup) handleSelect(undefined)
  }, [
    handleSelect,
    helpOpen,
    mapSearch.closeSearch,
    mapSearch.open,
    selectedGroup,
  ])

  const handleUnsupported = useCallback(() => setUnsupported(true), [])

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
        mapSearch.setQuery(result.label)
        mapRef.current?.selectAt(result.x, result.y, {
          address: result.label,
          parcel: result.parcel,
          parId: result.parId,
        })
      })
      .catch(() => setToast('That shared parcel could not be restored.'))
  }, [manifest, mapSearch.setQuery, search.parcel, search.parId])

  const cycleUnit = (group: ParcelGroup, rid: number, direction: number) => {
    const current = group.records.findIndex((record) => record.rid === rid)
    const next =
      (current + direction + group.records.length) % group.records.length
    const record = group.records[next]
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
            mapSearch.closeSearch()
            setHelpOpen(true)
          }}
          search={
            <MapSearch
              query={mapSearch.query}
              results={mapSearch.results}
              searching={mapSearch.searching}
              open={mapSearch.open}
              inputRef={mapSearch.inputRef}
              onQueryChange={mapSearch.changeQuery}
              onOpen={mapSearch.openSearch}
              onClose={mapSearch.closeSearch}
              onSelect={mapSearch.selectResult}
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
            onCycleUnit={(direction) =>
              cycleUnit(selectedGroup, selectedRid, direction)
            }
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
