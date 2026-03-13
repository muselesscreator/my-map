import { useState, useRef, useCallback, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { v4 as uuidv4 } from 'uuid'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import LocationPopover from './components/LocationPopover'
import RoutePopover from './components/RoutePopover'
import { useMapStore } from './store/useMapStore'
import type { Location, Route } from './types'
import { saveAs } from 'file-saver'

type AppMode = 'idle' | 'adding-location' | 'route-start' | 'route-end' | 'drawing-route'

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function snapToLocation(coords: { lat: number; lng: number }, locations: { id: string; coordinates: { lat: number; lng: number } }[], thresholdM = 80) {
  let best: typeof locations[0] | null = null
  let bestDist = thresholdM
  for (const loc of locations) {
    const d = haversineM(coords, loc.coordinates)
    if (d < bestDist) { bestDist = d; best = loc }
  }
  return best
}

interface RouteCandidates {
  candidates: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] }
    distanceMeters: number
    durationSeconds: number
    name?: string
  }>
  startCoords: { lat: number; lng: number }
  endCoords: { lat: number; lng: number }
  startLocationId: string | null
  endLocationId: string | null
}

const ROUTE_PROFILES = [
  { name: 'Driving', url: 'https://router.project-osrm.org/route/v1/driving/' },
  { name: 'Walking', url: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' },
  { name: 'Cycling', url: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike/' },
]

export default function App() {
  const [mode, setMode] = useState<AppMode>('idle')
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [pendingName, setPendingName] = useState<string | undefined>(undefined)
  const [routeStart, setRouteStart] = useState<{ coords: { lat: number; lng: number }; locationId: string | null } | null>(null)
  const [routeCandidates, setRouteCandidates] = useState<RouteCandidates | null>(null)
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0)
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [manualPoints, setManualPoints] = useState<[number, number][]>([])
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const { project, viewMode } = useMapStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Escape key: cancel current mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode !== 'idle') {
        setMode('idle')
        setPendingCoords(null)
        setPendingName(undefined)
        setRouteStart(null)
        setRouteCandidates(null)
        setManualPoints([])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode])

  // Finish manual drawing and open RoutePopover
  const finishDrawing = useCallback(() => {
    if (manualPoints.length < 2) {
      setMode('idle')
      setManualPoints([])
      return
    }
    let dist = 0
    for (let i = 1; i < manualPoints.length; i++) {
      dist += haversineM(
        { lat: manualPoints[i - 1][1], lng: manualPoints[i - 1][0] },
        { lat: manualPoints[i][1], lng: manualPoints[i][0] }
      )
    }
    setRouteCandidates({
      candidates: [{
        geometry: { type: 'LineString', coordinates: manualPoints },
        distanceMeters: dist,
        durationSeconds: dist / 11,
      }],
      startCoords: { lat: manualPoints[0][1], lng: manualPoints[0][0] },
      endCoords: { lat: manualPoints[manualPoints.length - 1][1], lng: manualPoints[manualPoints.length - 1][0] },
      startLocationId: null,
      endLocationId: null,
    })
    setSelectedRouteIdx(0)
    setMode('idle')
    setManualPoints([])
  }, [manualPoints])

  const handleMapClick = useCallback(async (coords: { lat: number; lng: number }) => {
    if (viewMode === 'mymap') return

    if (mode === 'adding-location') {
      setPendingCoords(coords)
      setPendingName(undefined)
      setMode('idle')
    } else if (mode === 'route-start') {
      const snap = snapToLocation(coords, project.locations)
      setRouteStart({ coords: snap?.coordinates ?? coords, locationId: snap?.id ?? null })
      setMode('route-end')
    } else if (mode === 'route-end' && routeStart) {
      const snap = snapToLocation(coords, project.locations)
      const endCoords = snap?.coordinates ?? coords
      const endLocationId = snap?.id ?? null
      setLoadingRoute(true)
      try {
        const coord = `${routeStart.coords.lng},${routeStart.coords.lat};${endCoords.lng},${endCoords.lat}?geometries=geojson&overview=full`
        const results = await Promise.allSettled(
          ROUTE_PROFILES.map(async (p) => {
            const res = await fetch(`${p.url}${coord}`)
            const data = await res.json()
            if (!data.routes?.[0]) throw new Error('No route')
            return {
              name: p.name,
              geometry: data.routes[0].geometry as { type: 'LineString'; coordinates: [number, number][] },
              distanceMeters: data.routes[0].distance as number,
              durationSeconds: data.routes[0].duration as number,
            }
          })
        )
        const candidates = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<{ name: string; geometry: { type: 'LineString'; coordinates: [number, number][] }; distanceMeters: number; durationSeconds: number }>).value)
        if (candidates.length > 0) {
          setSelectedRouteIdx(0)
          setRouteCandidates({
            candidates,
            startCoords: routeStart.coords,
            endCoords,
            startLocationId: routeStart.locationId,
            endLocationId,
          })
        } else {
          throw new Error('All profile fetches failed')
        }
      } catch (err) {
        console.error('Route fetch failed, falling back to straight line', err)
        const dist = haversineM(routeStart.coords, endCoords)
        setSelectedRouteIdx(0)
        setRouteCandidates({
          candidates: [{
            name: 'Straight line',
            geometry: {
              type: 'LineString',
              coordinates: [
                [routeStart.coords.lng, routeStart.coords.lat],
                [endCoords.lng, endCoords.lat],
              ],
            },
            distanceMeters: dist,
            durationSeconds: dist / 11,
          }],
          startCoords: routeStart.coords,
          endCoords,
          startLocationId: routeStart.locationId,
          endLocationId,
        })
      } finally {
        setLoadingRoute(false)
        setMode('idle')
        setRouteStart(null)
      }
    } else if (mode === 'drawing-route') {
      setManualPoints((pts) => [...pts, [coords.lng, coords.lat]])
    } else if (mode === 'idle') {
      setPendingCoords(coords)
      setPendingName(undefined)
    }
  }, [mode, routeStart, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLocationClick = (loc: Location) => {
    if (mode === 'route-start') {
      setRouteStart({ coords: loc.coordinates, locationId: loc.id })
      setMode('route-end')
    } else if (mode === 'route-end' && routeStart) {
      handleMapClick(loc.coordinates)
    } else if (map) {
      map.flyTo({ center: [loc.coordinates.lng, loc.coordinates.lat], zoom: 15 })
    }
  }

  const handleRouteClick = (route: Route) => {
    if (!map) return
    const coords = route.geometry.coordinates as [number, number][]
    if (coords.length === 0) return
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    )
    map.fitBounds(bounds, { padding: 60 })
  }

  const handleSearchResultClick = (coords: { lat: number; lng: number }, name: string) => {
    if (map) {
      map.flyTo({ center: [coords.lng, coords.lat], zoom: 15 })
    }
    setPendingCoords(coords)
    setPendingName(name)
  }

  const handleExportPNG = () => {
    const canvas = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${project.name}.png`)
    })
  }

  const handleExportGeoJSON = () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        ...project.locations.map((loc) => ({
          type: 'Feature',
          properties: { ...loc, coordinates: undefined },
          geometry: { type: 'Point', coordinates: [loc.coordinates.lng, loc.coordinates.lat] },
        })),
        ...project.routes.map((route) => ({
          type: 'Feature',
          properties: { ...route, geometry: undefined },
          geometry: route.geometry,
        })),
      ],
    }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
    saveAs(blob, `${project.name}.geojson`)
  }

  const handleImportGeoJSON = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (data.locations && data.routes) {
          // Native MapProject format
          useMapStore.getState().importProject(data)
        } else if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
          // Standard GeoJSON FeatureCollection — reconstruct MapProject
          const locations: Location[] = []
          const routes: Route[] = []
          for (const feature of data.features) {
            const p = feature.properties ?? {}
            if (feature.geometry?.type === 'Point') {
              locations.push({
                id: p.id ?? uuidv4(),
                name: p.name ?? 'Unnamed',
                coordinates: {
                  lat: feature.geometry.coordinates[1],
                  lng: feature.geometry.coordinates[0],
                },
                category: p.category,
                icon: p.icon,
                color: p.color,
                address: p.address,
                notes: p.notes,
                createdAt: p.createdAt ?? new Date().toISOString(),
              })
            } else if (feature.geometry?.type === 'LineString') {
              const coords = feature.geometry.coordinates as [number, number][]
              routes.push({
                id: p.id ?? uuidv4(),
                label: p.label,
                startLocationId: p.startLocationId ?? null,
                endLocationId: p.endLocationId ?? null,
                startCoordinates: p.startCoordinates ?? { lat: coords[0][1], lng: coords[0][0] },
                endCoordinates: p.endCoordinates ?? {
                  lat: coords[coords.length - 1][1],
                  lng: coords[coords.length - 1][0],
                },
                geometry: feature.geometry,
                distanceMeters: p.distanceMeters ?? 0,
                durationSeconds: p.durationSeconds ?? 0,
                color: p.color,
                notes: p.notes,
                createdAt: p.createdAt ?? new Date().toISOString(),
              })
            }
          }
          const current = useMapStore.getState().project
          useMapStore.getState().importProject({ ...current, locations, routes })
        } else {
          alert('Import format not recognized. Please import a previously exported MyMap GeoJSON or a native MapProject file.')
        }
      } catch {
        alert('Failed to parse file.')
      }
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  const getCursorClass = () => {
    if (mode === 'route-start' || mode === 'route-end' || mode === 'drawing-route') return 'cursor-crosshair'
    if (mode === 'adding-location') return 'cursor-cell'
    return ''
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Header
        onExportPNG={handleExportPNG}
        onExportGeoJSON={handleExportGeoJSON}
        onImportGeoJSON={handleImportGeoJSON}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onAddLocationClick={() => setMode(mode === 'adding-location' ? 'idle' : 'adding-location')}
          onAddRouteClick={() => setMode(mode === 'route-start' ? 'idle' : 'route-start')}
          onDrawManualClick={() => { setMode(mode === 'drawing-route' ? 'idle' : 'drawing-route'); setManualPoints([]) }}
          onLocationClick={handleLocationClick}
          onRouteClick={handleRouteClick}
          onSearchResultClick={handleSearchResultClick}
        />
        <main className={`flex-1 relative ${getCursorClass()}`}>
          {/* Mode indicator */}
          {mode !== 'idle' && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-black/70 text-white text-sm px-4 py-2 rounded-full flex items-center gap-3 ${mode === 'drawing-route' ? '' : 'pointer-events-none'}`}>
              {mode === 'adding-location' && <span>Click map to place location</span>}
              {mode === 'route-start' && <span>Click start point for route</span>}
              {mode === 'route-end' && <span>Click end point for route</span>}
              {mode === 'drawing-route' && (
                <>
                  <span>Click to add waypoints ({manualPoints.length} pt{manualPoints.length !== 1 ? 's' : ''})</span>
                  {manualPoints.length >= 2 && (
                    <button
                      onClick={finishDrawing}
                      className="bg-green-500 hover:bg-green-400 text-white text-xs px-2.5 py-0.5 rounded-full font-medium"
                    >
                      Finish
                    </button>
                  )}
                </>
              )}
              <span className="opacity-50 text-xs">(Esc to cancel)</span>
            </div>
          )}
          {loadingRoute && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-black/70 text-white text-sm px-4 py-2 rounded-full">
              Fetching route...
            </div>
          )}
          <MapView
            onMapClick={handleMapClick}
            onMapReady={setMap}
            routePreview={routeCandidates ? { candidates: routeCandidates.candidates, selectedIdx: selectedRouteIdx } : null}
            manualDrawPoints={mode === 'drawing-route' ? manualPoints : undefined}
          />
          {pendingCoords && (
            <LocationPopover
              coordinates={pendingCoords}
              onClose={() => { setPendingCoords(null); setPendingName(undefined) }}
              initialName={pendingName}
            />
          )}
          {routeCandidates && (
            <RoutePopover
              candidates={routeCandidates.candidates}
              startCoordinates={routeCandidates.startCoords}
              endCoordinates={routeCandidates.endCoords}
              startLocationId={routeCandidates.startLocationId}
              endLocationId={routeCandidates.endLocationId}
              selectedIdx={selectedRouteIdx}
              onSelectIdx={setSelectedRouteIdx}
              onClose={() => { setRouteCandidates(null); setSelectedRouteIdx(0) }}
            />
          )}
        </main>
      </div>
      <input ref={fileInputRef} type="file" accept=".json,.geojson" className="hidden" onChange={handleFileChange} />
    </div>
  )
}
