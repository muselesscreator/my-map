import { useState, useEffect } from 'react'
import { useMapStore } from '../store/useMapStore'

interface OsrmStep {
  name: string
  distance: number
  duration: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  maneuver: {
    type: string
    modifier?: string
    location: [number, number]
  }
}

interface DirectionsResult {
  steps: OsrmStep[]
  distanceMeters: number
  durationSeconds: number
  profile: string
}

interface DirectionsPanelProps {
  onStepFocus: (geometry: { type: 'LineString'; coordinates: [number, number][] } | null, name?: string) => void
  onMapStyleChange: (style: 'full' | 'mymap') => void
}

const ROUTE_PROFILES = [
  { name: 'Driving', url: 'https://router.project-osrm.org/route/v1/driving/' },
  { name: 'Walking', url: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' },
  { name: 'Cycling', url: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike/' },
]

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function getBearing(from: [number, number], to: [number, number]): number {
  const lat1 = from[1] * Math.PI / 180
  const lat2 = to[1] * Math.PI / 180
  const dLng = (to[0] - from[0]) * Math.PI / 180
  return Math.atan2(
    Math.sin(dLng) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  ) * 180 / Math.PI
}

function classifyTurn(inBearing: number, outBearing: number): { type: string; modifier: string } {
  let angle = outBearing - inBearing
  while (angle > 180) angle -= 360
  while (angle < -180) angle += 360
  if (Math.abs(angle) > 150) return { type: 'turn', modifier: 'uturn' }
  if (angle < -100) return { type: 'turn', modifier: 'sharp left' }
  if (angle < -45)  return { type: 'turn', modifier: 'left' }
  if (angle < -20)  return { type: 'turn', modifier: 'slight left' }
  if (angle >  150) return { type: 'turn', modifier: 'uturn' }
  if (angle >  100) return { type: 'turn', modifier: 'sharp right' }
  if (angle >   45) return { type: 'turn', modifier: 'right' }
  if (angle >   20) return { type: 'turn', modifier: 'slight right' }
  return { type: 'new name', modifier: 'straight' }
}

function formatInstruction(type: string, modifier: string | undefined, name: string): string {
  switch (type) {
    case 'depart': return name ? `Start on ${name}` : 'Depart'
    case 'arrive': return name ? `Arrive at destination on ${name}` : 'Arrive at destination'
    case 'turn': {
      const dir = modifier === 'left' ? 'Turn left'
        : modifier === 'right' ? 'Turn right'
        : modifier === 'sharp left' ? 'Turn sharp left'
        : modifier === 'sharp right' ? 'Turn sharp right'
        : modifier === 'slight left' ? 'Bear left'
        : modifier === 'slight right' ? 'Bear right'
        : modifier === 'uturn' ? 'Make a U-turn'
        : 'Turn'
      return name ? `${dir} onto ${name}` : dir
    }
    case 'new name': return name ? `Continue onto ${name}` : 'Continue'
    case 'continue': return name ? `Continue on ${name}` : 'Continue'
    case 'merge': return name ? `Merge onto ${name}` : 'Merge'
    case 'on ramp': return name ? `Take the ramp onto ${name}` : 'Take the ramp'
    case 'off ramp': return name ? `Take the exit onto ${name}` : 'Take the exit'
    case 'fork': {
      const side = modifier?.includes('left') ? 'Keep left' : modifier?.includes('right') ? 'Keep right' : 'Take the fork'
      return name ? `${side} onto ${name}` : side
    }
    case 'end of road': {
      const dir = modifier === 'left' ? 'Turn left' : modifier === 'right' ? 'Turn right' : 'Turn'
      return name ? `${dir} onto ${name}` : dir
    }
    case 'roundabout':
    case 'rotary': return name ? `Enter roundabout, exit onto ${name}` : 'Enter roundabout'
    case 'exit roundabout':
    case 'exit rotary': return name ? `Exit roundabout onto ${name}` : 'Exit roundabout'
    default: return name ? `Continue on ${name}` : 'Continue'
  }
}

function getManeuverIcon(type: string, modifier?: string): string {
  if (type === 'depart') return '▶'
  if (type === 'arrive') return '★'
  if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') return '↻'
  if (type === 'fork') return modifier?.includes('left') ? '↖' : '↗'
  if (modifier === 'uturn') return '↩'
  if (modifier === 'sharp left' || modifier === 'left') return '←'
  if (modifier === 'sharp right' || modifier === 'right') return '→'
  if (modifier === 'slight left') return '↖'
  if (modifier === 'slight right') return '↗'
  return '↑'
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

export default function DirectionsPanel({ onStepFocus, onMapStyleChange }: DirectionsPanelProps) {
  const { project, isOffline } = useMapStore()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [profile, setProfile] = useState(0)
  const [result, setResult] = useState<DirectionsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeStepIdx, setActiveStepIdx] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [mapView, setMapView] = useState<'full' | 'mymap'>('full')

  const handleMapViewChange = (view: 'full' | 'mymap') => {
    setMapView(view)
    onMapStyleChange(view)
  }

  const locations = project.locations

  // In offline mode, filter each dropdown to only locations connected by a saved route (directional)
  const reachableFromFrom: Set<string> | null = isOffline && fromId
    ? new Set(
        project.routes
          .filter((r) => r.startLocationId === fromId)
          .map((r) => r.endLocationId)
          .filter((id): id is string => id !== null)
      )
    : null

  const reachableFromTo: Set<string> | null = isOffline && toId
    ? new Set(
        project.routes
          .filter((r) => r.endLocationId === toId)
          .map((r) => r.startLocationId)
          .filter((id): id is string => id !== null)
      )
    : null

  const toOptions = reachableFromFrom ? locations.filter((l) => reachableFromFrom.has(l.id)) : locations
  const fromOptions = reachableFromTo ? locations.filter((l) => reachableFromTo.has(l.id)) : locations

  // Clear toId if it's no longer valid after fromId changes
  useEffect(() => {
    if (reachableFromFrom && toId && !reachableFromFrom.has(toId)) {
      setToId('')
    }
  }, [fromId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear fromId if it's no longer valid after toId changes
  useEffect(() => {
    if (reachableFromTo && fromId && !reachableFromTo.has(fromId)) {
      setFromId('')
    }
  }, [toId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fromId || !toId || fromId === toId) {
      setResult(null)
      setActiveStepIdx(-1)
      onStepFocus(null)
      return
    }
    fetchDirections()
  }, [fromId, toId, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // When results load, focus step 0
  useEffect(() => {
    if (result && result.steps.length > 0) {
      setActiveStepIdx(0)
      onStepFocus(result.steps[0].geometry, result.steps[0].name)
    }
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchDirections() {
    const from = locations.find((l) => l.id === fromId)
    const to = locations.find((l) => l.id === toId)
    if (!from || !to) return

    if (isOffline) {
      const savedRoute = project.routes.find(
        (r) => r.startLocationId === fromId && r.endLocationId === toId
      )

      if (savedRoute?.steps && savedRoute.steps.length > 0) {
        const routeSteps = savedRoute.steps
        const steps: OsrmStep[] = routeSteps.map((step, i) => {
          const coords = step.geometry.coordinates
          const firstCoord = coords[0] as [number, number]
          // Compute distance along this step's geometry
          let stepDist = 0
          for (let j = 1; j < coords.length; j++) {
            stepDist += haversineM(
              { lat: coords[j - 1][1], lng: coords[j - 1][0] },
              { lat: coords[j][1], lng: coords[j][0] }
            )
          }
          const isFirst = i === 0
          const isLast = i === routeSteps.length - 1
          // Derive turn direction from bearing change at junction between step i-1 and step i
          let maneuverType = 'continue'
          let maneuverModifier: string | undefined
          if (isFirst) {
            maneuverType = 'depart'
          } else if (isLast) {
            maneuverType = 'arrive'
          } else {
            const prevCoords = routeSteps[i - 1].geometry.coordinates
            if (prevCoords.length >= 2 && coords.length >= 2) {
              const inBearing = getBearing(
                prevCoords[prevCoords.length - 2] as [number, number],
                prevCoords[prevCoords.length - 1] as [number, number]
              )
              const outBearing = getBearing(
                coords[0] as [number, number],
                coords[1] as [number, number]
              )
              const turn = classifyTurn(inBearing, outBearing)
              maneuverType = turn.type
              maneuverModifier = turn.modifier
            }
          }
          return {
            name: step.name,
            distance: stepDist,
            duration: stepDist / 11,
            geometry: step.geometry,
            maneuver: { type: maneuverType, modifier: maneuverModifier, location: firstCoord },
          }
        })
        setResult({
          steps,
          distanceMeters: savedRoute.distanceMeters,
          durationSeconds: savedRoute.durationSeconds,
          profile: 'Saved route',
        })
      } else {
        // Saved route exists but has no step data — use its geometry as a single step
        const coords = savedRoute
          ? savedRoute.geometry.coordinates
          : [[from.coordinates.lng, from.coordinates.lat], [to.coordinates.lng, to.coordinates.lat]] as [number, number][]
        const dist = savedRoute?.distanceMeters ?? haversineM(from.coordinates, to.coordinates)
        setResult({
          steps: [
            {
              name: from.name,
              distance: dist,
              duration: savedRoute?.durationSeconds ?? dist / 11,
              geometry: { type: 'LineString', coordinates: coords as [number, number][] },
              maneuver: { type: 'depart', location: coords[0] as [number, number] },
            },
            {
              name: to.name,
              distance: 0,
              duration: 0,
              geometry: { type: 'LineString', coordinates: [coords[coords.length - 1], coords[coords.length - 1]] as [number, number][] },
              maneuver: { type: 'arrive', location: coords[coords.length - 1] as [number, number] },
            },
          ],
          distanceMeters: dist,
          durationSeconds: savedRoute?.durationSeconds ?? dist / 11,
          profile: 'Saved route',
        })
      }
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setActiveStepIdx(-1)
    onStepFocus(null)

    try {
      const p = ROUTE_PROFILES[profile]
      const coord = `${from.coordinates.lng},${from.coordinates.lat};${to.coordinates.lng},${to.coordinates.lat}?geometries=geojson&overview=full&steps=true`
      const res = await fetch(`${p.url}${coord}`)
      const data = await res.json()
      if (!data.routes?.[0]) throw new Error('No route found')

      const route = data.routes[0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const steps: OsrmStep[] = (route.legs ?? []).flatMap((leg: any) => leg.steps ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((s: any) => s.geometry?.coordinates?.length > 0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((s: any) => ({
          name: (s.name as string) || '',
          distance: s.distance as number,
          duration: s.duration as number,
          geometry: s.geometry as OsrmStep['geometry'],
          maneuver: s.maneuver as OsrmStep['maneuver'],
        }))

      setResult({
        steps,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        profile: p.name,
      })
    } catch {
      setError('Could not fetch directions. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleStepClick = (idx: number) => {
    setActiveStepIdx(idx)
    const step = result?.steps[idx]
    if (step) onStepFocus(step.geometry, step.name)
  }

  const handleSwap = () => {
    const prev = fromId
    setFromId(toId)
    setToId(prev)
  }

  const goPrev = () => {
    if (activeStepIdx > 0) handleStepClick(activeStepIdx - 1)
  }

  const goNext = () => {
    if (!result) return
    const next = activeStepIdx < 0 ? 0 : activeStepIdx + 1
    if (next < result.steps.length) handleStepClick(next)
  }

  return (
    <aside className="w-72 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Directions</span>
      </div>

      {/* From / To selectors */}
      <div className="p-3 border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-green-600 font-bold w-5 text-center shrink-0">A</span>
              <select
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
              >
                <option value="">From…</option>
                {fromOptions.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-500 font-bold w-5 text-center shrink-0">B</span>
              <select
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                disabled={isOffline && !!fromId && toOptions.length === 0}
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <option value="">
                  {isOffline && fromId && toOptions.length === 0 ? 'No saved routes from here' : 'To…'}
                </option>
                {toOptions.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleSwap}
            disabled={!fromId && !toId}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-300 hover:bg-gray-50 text-gray-600 disabled:opacity-40 shrink-0 text-lg"
            title="Swap from/to"
          >
            ⇅
          </button>
        </div>

        {/* Profile tabs */}
        {!isOffline && (
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
            {ROUTE_PROFILES.map((p, i) => (
              <button
                key={i}
                onClick={() => setProfile(i)}
                className={`flex-1 py-1 transition-colors ${profile === i ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {/* Map view toggle */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
          {(['full', 'mymap'] as const).map((v) => (
            <button
              key={v}
              onClick={() => handleMapViewChange(v)}
              className={`flex-1 py-1 transition-colors ${mapView === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {v === 'full' ? 'Full Map' : 'My Map'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / error / summary */}
      {loading && (
        <div className="p-4 text-sm text-gray-500 text-center">Fetching directions…</div>
      )}
      {error && !loading && (
        <div className="px-3 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}
      {result && !loading && (
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between shrink-0">
          <span className="text-sm font-semibold text-blue-800">
            {formatDistance(result.distanceMeters)} · {formatDuration(result.durationSeconds)}
          </span>
          <span className="text-xs text-blue-600">{result.profile}</span>
        </div>
      )}

      {/* Steps list */}
      {result && !loading && (
        <div className="flex flex-col overflow-hidden flex-1">
          <ul className="overflow-y-auto flex-1">
            {result.steps.map((step, i) => (
              <li
                key={i}
                onClick={() => handleStepClick(i)}
                className={`flex items-start gap-2 px-3 py-2.5 border-b border-gray-100 cursor-pointer transition-colors ${
                  activeStepIdx === i ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5 font-bold ${
                    activeStepIdx === i ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {getManeuverIcon(step.maneuver.type, step.maneuver.modifier)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm leading-snug ${activeStepIdx === i ? 'font-semibold text-blue-800' : 'text-gray-800'}`}>
                    {formatInstruction(step.maneuver.type, step.maneuver.modifier, step.name)}
                  </div>
                  {step.distance > 10 && (
                    <div className="text-xs text-gray-400 mt-0.5">{formatDistance(step.distance)}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Prev / Next navigation */}
          <div className="p-3 border-t border-gray-200 flex items-center gap-2 shrink-0">
            <button
              onClick={goPrev}
              disabled={activeStepIdx <= 0}
              className="flex-1 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-400 w-16 text-center shrink-0">
              {activeStepIdx >= 0 ? `${activeStepIdx + 1} / ${result.steps.length}` : '—'}
            </span>
            <button
              onClick={goNext}
              disabled={result ? activeStepIdx >= result.steps.length - 1 : true}
              className="flex-1 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !result && !error && (
        <div className="p-6 text-xs text-gray-400 text-center">
          Select a from and to location to get directions
        </div>
      )}
    </aside>
  )
}
