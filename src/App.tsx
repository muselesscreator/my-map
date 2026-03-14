import { useState, useRef, useCallback, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { v4 as uuidv4 } from 'uuid'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import DirectionsPanel from './components/DirectionsPanel'
import MapView from './components/MapView'
import LocationPopover from './components/LocationPopover'
import RoutePopover from './components/RoutePopover'
import { useMapStore } from './store/useMapStore'
import type { Location, Route, RouteStep } from './types'
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

type RouteCandidate = {
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  distanceMeters: number
  durationSeconds: number
  name?: string
  steps?: RouteStep[]
}

interface RouteCandidates {
  candidates: RouteCandidate[]
  startCoords: { lat: number; lng: number }
  endCoords: { lat: number; lng: number }
  startLocationId: string | null
  endLocationId: string | null
  // Present for home↔location auto-routes — parallel array to candidates (null if that profile failed)
  returnData?: {
    candidates: Array<RouteCandidate | null>
    startCoordinates: { lat: number; lng: number }
    endCoordinates: { lat: number; lng: number }
    startLocationId: string | null
    endLocationId: string | null
  }
  groupId?: string
}

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImRkNDFiOWZjOGQ3YTRjMmQ5NzUxMjQ5YTUzYjAxNDI0IiwiaCI6Im11cm11cjY0In0='

const ROUTE_PROFILES = [
  { name: 'Driving', profile: 'driving-car' },
]

async function fetchORSRoute(
  profile: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<{ geometry: { type: 'LineString'; coordinates: [number, number][] }; distanceMeters: number; durationSeconds: number; steps: RouteStep[] }> {
  const url = `https://api.openrouteservice.org/v2/directions/${profile}?api_key=${ORS_API_KEY}&start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`
  const res = await fetch(url)
  const data = await res.json()
  if (!data.features?.[0]) throw new Error('No route')
  const feature = data.features[0]
  const routeCoords = feature.geometry.coordinates as [number, number][]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: RouteStep[] = (feature.properties.segments ?? []).flatMap((seg: any) => seg.steps ?? [])
    .filter((s: any) => s.name?.trim())
    .map((s: any) => ({
      name: s.name as string,
      geometry: { type: 'LineString' as const, coordinates: routeCoords.slice(s.way_points[0], s.way_points[1] + 1) },
    }))
  return {
    geometry: feature.geometry as { type: 'LineString'; coordinates: [number, number][] },
    distanceMeters: feature.properties.summary.distance as number,
    durationSeconds: feature.properties.summary.duration as number,
    steps,
  }
}

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
  const [editingLocation, setEditingLocation] = useState<Location | null>(null)
  const [editingRoute, setEditingRoute] = useState<Route | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [stepHighlightGeometry, setStepHighlightGeometry] = useState<{ type: 'LineString'; coordinates: [number, number][] } | null>(null)
  const [stepHighlightName, setStepHighlightName] = useState<string | null>(null)
  const [directionsMapStyle, setDirectionsMapStyle] = useState<'full' | 'mymap'>('full')
  const { project, viewMode, isOffline } = useMapStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Escape key: cancel current mode or close edit popovers
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingLocation) { setEditingLocation(null); return }
        if (editingRoute) { setEditingRoute(null); return }
        if (mode !== 'idle') {
          setMode('idle')
          setPendingCoords(null)
          setPendingName(undefined)
          setRouteStart(null)
          setRouteCandidates(null)
          setManualPoints([])
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, editingLocation, editingRoute])

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
      const groupId = uuidv4()
      if (isOffline) {
        const dist = haversineM(routeStart.coords, endCoords)
        const fwdGeom = { type: 'LineString' as const, coordinates: [[routeStart.coords.lng, routeStart.coords.lat], [endCoords.lng, endCoords.lat]] as [number, number][] }
        const bwdGeom = { type: 'LineString' as const, coordinates: [[endCoords.lng, endCoords.lat], [routeStart.coords.lng, routeStart.coords.lat]] as [number, number][] }
        setSelectedRouteIdx(0)
        setRouteCandidates({
          candidates: [{ name: 'Straight line', geometry: fwdGeom, distanceMeters: dist, durationSeconds: dist / 11 }],
          startCoords: routeStart.coords,
          endCoords,
          startLocationId: routeStart.locationId,
          endLocationId,
          returnData: {
            candidates: [{ name: 'Straight line', geometry: bwdGeom, distanceMeters: dist, durationSeconds: dist / 11 }],
            startCoordinates: endCoords,
            endCoordinates: routeStart.coords,
            startLocationId: endLocationId,
            endLocationId: routeStart.locationId,
          },
          groupId,
        })
        setMode('idle')
        setRouteStart(null)
      } else {
      setLoadingRoute(true)
      try {
        type RC = { name: string; geometry: { type: 'LineString'; coordinates: [number, number][] }; distanceMeters: number; durationSeconds: number; steps: RouteStep[] }
        const allResults = await Promise.allSettled(
          ROUTE_PROFILES.flatMap((p) => [
            fetchORSRoute(p.profile, routeStart.coords, endCoords).then((d) => ({ name: p.name, ...d })),
            fetchORSRoute(p.profile, endCoords, routeStart.coords).then((d) => ({ name: p.name, ...d })),
          ])
        )
        const fwdByProfile: Array<RC | null> = ROUTE_PROFILES.map((_, i) => {
          const r = allResults[i * 2]; return r.status === 'fulfilled' ? (r as PromiseFulfilledResult<RC>).value : null
        })
        const retByProfile: Array<RC | null> = ROUTE_PROFILES.map((_, i) => {
          const r = allResults[i * 2 + 1]; return r.status === 'fulfilled' ? (r as PromiseFulfilledResult<RC>).value : null
        })
        const candidates = fwdByProfile.filter((c): c is RC => c !== null)
        const returnCandidates = fwdByProfile.map((fwd, i) => fwd !== null ? retByProfile[i] : null).filter((_, i) => fwdByProfile[i] !== null)
        if (candidates.length > 0) {
          setSelectedRouteIdx(0)
          setRouteCandidates({
            candidates,
            startCoords: routeStart.coords,
            endCoords,
            startLocationId: routeStart.locationId,
            endLocationId,
            returnData: {
              candidates: returnCandidates,
              startCoordinates: endCoords,
              endCoordinates: routeStart.coords,
              startLocationId: endLocationId,
              endLocationId: routeStart.locationId,
            },
            groupId,
          })
        } else {
          throw new Error('All profile fetches failed')
        }
      } catch (err) {
        console.error('Route fetch failed, falling back to straight line', err)
        const dist = haversineM(routeStart.coords, endCoords)
        const fwdGeom = { type: 'LineString' as const, coordinates: [[routeStart.coords.lng, routeStart.coords.lat], [endCoords.lng, endCoords.lat]] as [number, number][] }
        const bwdGeom = { type: 'LineString' as const, coordinates: [[endCoords.lng, endCoords.lat], [routeStart.coords.lng, routeStart.coords.lat]] as [number, number][] }
        setSelectedRouteIdx(0)
        setRouteCandidates({
          candidates: [{ name: 'Straight line', geometry: fwdGeom, distanceMeters: dist, durationSeconds: dist / 11 }],
          startCoords: routeStart.coords,
          endCoords,
          startLocationId: routeStart.locationId,
          endLocationId,
          returnData: {
            candidates: [{ name: 'Straight line', geometry: bwdGeom, distanceMeters: dist, durationSeconds: dist / 11 }],
            startCoordinates: endCoords,
            endCoordinates: routeStart.coords,
            startLocationId: endLocationId,
            endLocationId: routeStart.locationId,
          },
          groupId,
        })
      } finally {
        setLoadingRoute(false)
        setMode('idle')
        setRouteStart(null)
      }
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

  const handleLocationMarkerClick = (locationId: string) => {
    if (viewMode !== 'edit' || mode !== 'idle') return
    const loc = project.locations.find((l) => l.id === locationId)
    if (!loc) return
    setPendingCoords(null)
    setEditingRoute(null)
    setEditingLocation(loc)
  }

  // Clear step highlight and reset map style when leaving directions mode
  useEffect(() => {
    if (viewMode !== 'directions') {
      setStepHighlightGeometry(null)
      setStepHighlightName(null)
      setDirectionsMapStyle('full')
    }
  }, [viewMode])

  const handleStepFocus = (geometry: { type: 'LineString'; coordinates: [number, number][] } | null, name?: string) => {
    setStepHighlightGeometry(geometry)
    setStepHighlightName(name ?? null)
    if (geometry && map) {
      const coords = geometry.coordinates
      if (coords.length === 1) {
        map.flyTo({ center: coords[0] as [number, number], zoom: 17 })
      } else if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as [number, number]),
          new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
        )
        map.fitBounds(bounds, { padding: 120, maxZoom: 18 })
      }
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

  const handleLocationSaved = async (newCoords: { lat: number; lng: number }, newName: string) => {
    // Skip if the new location is Home itself, or if offline
    if (newName.toLowerCase() === 'home' || isOffline) return

    // Find the Home location in the store (location was just added so store is up to date)
    const home = useMapStore.getState().project.locations.find(
      (l) => l.name.toLowerCase() === 'home'
    )
    if (!home) return

    // Find the newly saved location to get its ID
    const newLoc = useMapStore.getState().project.locations.find(
      (l) => l.coordinates.lat === newCoords.lat && l.coordinates.lng === newCoords.lng && l.name === newName
    )

    setLoadingRoute(true)
    try {
      const groupId = uuidv4()
      // Fetch all profiles for both directions in parallel (6 total)
      type RC = { name: string; geometry: { type: 'LineString'; coordinates: [number, number][] }; distanceMeters: number; durationSeconds: number; steps: RouteStep[] }
      const allResults = await Promise.allSettled(
        ROUTE_PROFILES.flatMap((p) => [
          fetchORSRoute(p.profile, home.coordinates, newCoords).then((d) => ({ name: p.name, ...d })),
          fetchORSRoute(p.profile, newCoords, home.coordinates).then((d) => ({ name: p.name, ...d })),
        ])
      )

      // Split results: even indices = forward, odd = return (per profile)
      const fwdByProfile: Array<RC | null> = ROUTE_PROFILES.map((_, i) => {
        const r = allResults[i * 2]; return r.status === 'fulfilled' ? (r as PromiseFulfilledResult<RC>).value : null
      })
      const retByProfile: Array<RC | null> = ROUTE_PROFILES.map((_, i) => {
        const r = allResults[i * 2 + 1]; return r.status === 'fulfilled' ? (r as PromiseFulfilledResult<RC>).value : null
      })

      const candidates = fwdByProfile.filter((c): c is RC => c !== null)
      // Return candidates aligned to the same indices as candidates (null if that profile's return failed)
      const returnCandidates = fwdByProfile.flatMap((fwd, i) => fwd !== null ? [retByProfile[i]] : [])

      if (candidates.length > 0) {
        setSelectedRouteIdx(0)
        setRouteCandidates({
          candidates,
          startCoords: home.coordinates,
          endCoords: newCoords,
          startLocationId: home.id,
          endLocationId: newLoc?.id ?? null,
          returnData: {
            candidates: returnCandidates,
            startCoordinates: newCoords,
            endCoordinates: home.coordinates,
            startLocationId: newLoc?.id ?? null,
            endLocationId: home.id,
          },
          groupId,
        })
      }
    } catch {
      // silently skip if routing fails
    } finally {
      setLoadingRoute(false)
    }
  }

  const handleBulkAddHomeRoutes = async () => {
    const state = useMapStore.getState()
    const home = state.project.locations.find((l) => l.name.toLowerCase() === 'home')
    if (!home || isOffline) return

    // Check each direction independently
    const homeToLocIds = new Set(
      state.project.routes.filter((r) => r.startLocationId === home.id && r.endLocationId).map((r) => r.endLocationId as string)
    )
    const locToHomeIds = new Set(
      state.project.routes.filter((r) => r.endLocationId === home.id && r.startLocationId).map((r) => r.startLocationId as string)
    )

    const toProcess = state.project.locations
      .filter((l) => l.id !== home.id)
      .map((loc) => ({ loc, needsFwd: !homeToLocIds.has(loc.id), needsBwd: !locToHomeIds.has(loc.id) }))
      .filter(({ needsFwd, needsBwd }) => needsFwd || needsBwd)

    if (toProcess.length === 0) return

    const fetchLeg = (fromCoords: { lat: number; lng: number }, toCoords: { lat: number; lng: number }) =>
      fetchORSRoute(ROUTE_PROFILES[0].profile, fromCoords, toCoords)

    setLoadingRoute(true)
    try {
      // Process one location at a time to avoid overwhelming public routing servers
      for (const { loc, needsFwd, needsBwd } of toProcess) {
        // Reuse existing paired route's groupId if only one direction is missing
        const existingRoute = !needsFwd
          ? state.project.routes.find((r) => r.startLocationId === home.id && r.endLocationId === loc.id)
          : !needsBwd
            ? state.project.routes.find((r) => r.startLocationId === loc.id && r.endLocationId === home.id)
            : null
        const groupId = existingRoute?.groupId ?? uuidv4()

        const [fwd, bwd] = await Promise.allSettled([
          needsFwd ? fetchLeg(home.coordinates, loc.coordinates) : Promise.reject('skipped'),
          needsBwd ? fetchLeg(loc.coordinates, home.coordinates) : Promise.reject('skipped'),
        ])

        const routesToAdd: Omit<Route, 'id' | 'createdAt'>[] = []
        if (needsFwd && fwd.status === 'fulfilled') {
          routesToAdd.push({ ...fwd.value, startLocationId: home.id, endLocationId: loc.id, startCoordinates: home.coordinates, endCoordinates: loc.coordinates, groupId })
        }
        if (needsBwd && bwd.status === 'fulfilled') {
          routesToAdd.push({ ...bwd.value, startLocationId: loc.id, endLocationId: home.id, startCoordinates: loc.coordinates, endCoordinates: home.coordinates, groupId })
        }
        if (routesToAdd.length > 0) {
          useMapStore.getState().addRoutes(routesToAdd)
        }
      }
    } finally {
      setLoadingRoute(false)
    }
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
                groupId: p.groupId,
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
        {viewMode === 'directions' ? (
          <DirectionsPanel onStepFocus={handleStepFocus} onMapStyleChange={setDirectionsMapStyle} />
        ) : (
          <Sidebar
            onAddLocationClick={() => setMode(mode === 'adding-location' ? 'idle' : 'adding-location')}
            onAddRouteClick={() => setMode(mode === 'route-start' ? 'idle' : 'route-start')}
            onDrawManualClick={() => { setMode(mode === 'drawing-route' ? 'idle' : 'drawing-route'); setManualPoints([]) }}
            onLocationClick={handleLocationClick}
            onRouteClick={handleRouteClick}
            onSearchResultClick={handleSearchResultClick}
            onEditLocation={(loc) => { setPendingCoords(null); setEditingRoute(null); setEditingLocation(loc) }}
            onEditRoute={(route) => { setRouteCandidates(null); setEditingLocation(null); setEditingRoute(route) }}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            onBulkAddHomeRoutes={handleBulkAddHomeRoutes}
          />
        )}
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
            onLocationMarkerClick={handleLocationMarkerClick}
            routePreview={routeCandidates ? { candidates: routeCandidates.candidates, selectedIdx: selectedRouteIdx } : null}
            manualDrawPoints={mode === 'drawing-route' ? manualPoints : undefined}
            activeCategory={activeCategory}
            stepHighlightGeometry={viewMode === 'directions' ? stepHighlightGeometry : null}
            stepHighlightName={viewMode === 'directions' ? stepHighlightName : null}
            directionsTileStyle={viewMode === 'directions' ? directionsMapStyle : undefined}
          />
          {pendingCoords && !editingLocation && (
            <LocationPopover
              coordinates={pendingCoords}
              onClose={() => { setPendingCoords(null); setPendingName(undefined) }}
              initialName={pendingName}
              onSaved={handleLocationSaved}
            />
          )}
          {editingLocation && (
            <LocationPopover
              coordinates={editingLocation.coordinates}
              onClose={() => setEditingLocation(null)}
              editingLocation={editingLocation}
            />
          )}
          {routeCandidates && !editingRoute && (
            <RoutePopover
              candidates={routeCandidates.candidates}
              startCoordinates={routeCandidates.startCoords}
              endCoordinates={routeCandidates.endCoords}
              startLocationId={routeCandidates.startLocationId}
              endLocationId={routeCandidates.endLocationId}
              selectedIdx={selectedRouteIdx}
              onSelectIdx={setSelectedRouteIdx}
              onClose={() => { setRouteCandidates(null); setSelectedRouteIdx(0) }}
              returnData={routeCandidates.returnData}
              groupId={routeCandidates.groupId}
            />
          )}
          {editingRoute && (
            <RoutePopover
              candidates={[{
                geometry: editingRoute.geometry,
                distanceMeters: editingRoute.distanceMeters,
                durationSeconds: editingRoute.durationSeconds,
              }]}
              startCoordinates={editingRoute.startCoordinates}
              endCoordinates={editingRoute.endCoordinates}
              startLocationId={editingRoute.startLocationId}
              endLocationId={editingRoute.endLocationId}
              selectedIdx={0}
              onSelectIdx={() => {}}
              onClose={() => setEditingRoute(null)}
              editingRoute={editingRoute}
            />
          )}
        </main>
      </div>
      <input ref={fileInputRef} type="file" accept=".json,.geojson" className="hidden" onChange={handleFileChange} />
    </div>
  )
}
