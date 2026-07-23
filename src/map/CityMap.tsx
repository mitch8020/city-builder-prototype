import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { NashvilleScene } from './NashvilleScene'
import type { NashvilleSceneCallbacks } from './NashvilleScene'
import type { CityMapController, MapMode, ParcelManifestV1 } from './types'

interface CityMapProps extends NashvilleSceneCallbacks {
  manifest: ParcelManifestV1
  mode: MapMode
  selectedRid?: number
  onUnsupported: () => void
}

export const CityMap = forwardRef<CityMapController, CityMapProps>(
  function CityMap(
    {
      manifest,
      mode,
      selectedRid,
      onSelect,
      onHover,
      onStatus,
      onAnchor,
      onModeShortcut,
      onEscape,
      onUnsupported,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null)
    const sceneRef = useRef<NashvilleScene | undefined>(undefined)

    useImperativeHandle(
      ref,
      () => ({
        home: () => sceneRef.current?.home(),
        zoomBy: (factor) => sceneRef.current?.zoomBy(factor),
        rotateToNorth: () => sceneRef.current?.rotateToNorth(),
        tiltBy: (radians) => sceneRef.current?.tiltBy(radians),
        flyTo: (x, y, distance) => sceneRef.current?.flyTo(x, y, distance),
        selectAt: (x, y, hint) => sceneRef.current?.selectAt(x, y, hint),
      }),
      [],
    )

    useEffect(() => {
      if (!hostRef.current) return

      try {
        sceneRef.current = new NashvilleScene(hostRef.current, manifest, mode, {
          onSelect,
          onHover,
          onStatus,
          onAnchor,
          onModeShortcut,
          onEscape,
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'WEBGL2_UNAVAILABLE') {
          onUnsupported()
          return
        }
        throw error
      }

      return () => {
        sceneRef.current?.dispose()
        sceneRef.current = undefined
      }
    }, [manifest, onUnsupported])

    useEffect(() => {
      sceneRef.current?.updateCallbacks({
        onSelect,
        onHover,
        onStatus,
        onAnchor,
        onModeShortcut,
        onEscape,
      })
    }, [onAnchor, onEscape, onHover, onModeShortcut, onSelect, onStatus])

    useEffect(() => {
      sceneRef.current?.setMode(mode)
    }, [mode])

    useEffect(() => {
      sceneRef.current?.setSelectedRid(selectedRid)
    }, [selectedRid])

    return <div className="map-canvas" ref={hostRef} aria-hidden="true" />
  },
)
