import { useState, useEffect, useRef } from 'react'
import { useMapStore } from '../store/useMapStore'
import type { Location, Route } from '../types'

interface GeocodingFeature {
  display_name: string
  lat: string
  lon: string
}

interface SidebarProps {
  onAddLocationClick: () => void
  onAddRouteClick: () => void
  onDrawManualClick: () => void
  onLocationClick: (loc: Location) => void
  onRouteClick: (route: Route) => void
  onSearchResultClick: (coords: { lat: number; lng: number }, name: string) => void
  onEditLocation: (loc: Location) => void
  onEditRoute: (route: Route) => void
  activeCategory: string | null
  onCategoryChange: (cat: string | null) => void
  onBulkAddHomeRoutes: () => void
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

export default function Sidebar({
  onAddLocationClick,
  onAddRouteClick,
  onDrawManualClick,
  onLocationClick,
  onRouteClick,
  onSearchResultClick,
  onEditLocation,
  onEditRoute,
  activeCategory,
  onCategoryChange,
  onBulkAddHomeRoutes,
}: SidebarProps) {
  const { project, viewMode, isOffline, removeLocation, removeRoute } = useMapStore()
  const [expandedSection, setExpandedSection] = useState<'locations' | 'routes' | 'both'>('locations')
  const [routesExpanded, setRoutesExpanded] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Build ordered route list: groups collapsed into one entry, standalone routes as-is
  type RouteGroup = { type: 'group'; groupId: string; routes: typeof project.routes }
  type RouteItem = { type: 'single'; route: (typeof project.routes)[0] }
  const routeItems: Array<RouteGroup | RouteItem> = []
  const seenGroups = new Set<string>()
  for (const route of project.routes) {
    if (route.groupId) {
      if (!seenGroups.has(route.groupId)) {
        seenGroups.add(route.groupId)
        routeItems.push({ type: 'group', groupId: route.groupId, routes: project.routes.filter((r) => r.groupId === route.groupId) })
      }
    } else {
      routeItems.push({ type: 'single', route })
    }
  }

  // Geocoding search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GeocodingFeature[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  const isReadOnly = viewMode === 'mymap'

  // Collect all unique categories from locations
  const allCategories = Array.from(
    new Set(
      project.locations.flatMap((loc) => loc.category ?? [])
    )
  ).sort()

  // Filtered locations list
  const filteredLocations = activeCategory
    ? project.locations.filter((loc) => loc.category?.includes(activeCategory))
    : project.locations

  // Geocoding search with debounce
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)

    if (!searchQuery.trim() || isOffline) {
      setSearchResults([])
      return
    }

    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const home = project.locations.find((l) => l.name.toLowerCase() === 'home')
        const bias = home
          ? `&viewbox=${home.coordinates.lng - 0.5},${home.coordinates.lat + 0.5},${home.coordinates.lng + 0.5},${home.coordinates.lat - 0.5}&bounded=0`
          : ''
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery.trim())}&format=json&limit=5${bias}`
        const res = await fetch(url, { headers: { 'User-Agent': 'myMap-personal-app/1.0' } })
        const data = await res.json()
        setSearchResults(data ?? [])
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 350)

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearchResultClick = (feature: GeocodingFeature) => {
    const lat = parseFloat(feature.lat)
    const lng = parseFloat(feature.lon)
    onSearchResultClick({ lat, lng }, feature.display_name)
    setSearchQuery('')
    setSearchResults([])
  }

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">

      {/* Geocoding search */}
      <div ref={searchContainerRef} className="p-2 border-b border-gray-200 relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={isOffline ? 'Search unavailable offline' : 'Search for a place...'}
          disabled={isOffline}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs">...</div>
        )}
        {searchResults.length > 0 && (
          <ul className="absolute left-2 right-2 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
            {searchResults.map((feature, index) => (
              <li
                key={index}
                className="px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                onMouseDown={() => handleSearchResultClick(feature)}
              >
                {feature.display_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Locations section */}
      <div className="flex flex-col overflow-hidden flex-1">
        <div
          className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 cursor-pointer select-none"
          onClick={() => setExpandedSection(expandedSection === 'locations' ? 'both' : 'locations')}
        >
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Locations ({filteredLocations.length}{activeCategory ? ` / ${project.locations.length}` : ''})
          </span>
        </div>

        {/* Category filter pills */}
        {allCategories.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-gray-100">
            <button
              onClick={() => onCategoryChange(null)}
              className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                activeCategory === null
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              All
            </button>
            {allCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => onCategoryChange(activeCategory === cat ? null : cat)}
                className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <ul className="overflow-y-auto flex-1">
          {filteredLocations.map((loc) => (
            <li
              key={loc.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 group"
              onClick={() => onLocationClick(loc)}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: loc.color || '#3B82F6' }}
              >
                {loc.icon || loc.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{loc.name}</div>
                {loc.category && loc.category.length > 0 && (
                  <div className="text-xs text-gray-500 truncate">{loc.category.join(', ')}</div>
                )}
              </div>
              {!isReadOnly && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditLocation(loc) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 text-xs px-1"
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeLocation(loc.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1"
                    title="Remove"
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
          {filteredLocations.length === 0 && (
            <li className="px-3 py-4 text-xs text-gray-400 text-center">
              {activeCategory
                ? `No locations in "${activeCategory}"`
                : 'Click the map to add locations'}
            </li>
          )}
        </ul>
      </div>

      {/* Routes section */}
      <div className={`flex flex-col border-t border-gray-200 ${routesExpanded ? 'flex-1 overflow-hidden' : 'shrink-0'}`}>
        <div
          className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 cursor-pointer select-none"
          onClick={() => setRoutesExpanded((v) => !v)}
        >
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Routes ({project.routes.length})
          </span>
          <span className="text-gray-400 text-xs">{routesExpanded ? '▲' : '▼'}</span>
        </div>
        {routesExpanded && <ul className="overflow-y-auto flex-1">
          {routeItems.map((item) => {
            if (item.type === 'group') {
              const { groupId, routes } = item
              const isExpanded = expandedGroups.has(groupId)
              // Use first route's endpoints to label the group (e.g. Home ↔ Gym)
              const r0 = routes[0]
              const nameA = r0.startLocationId ? project.locations.find(l => l.id === r0.startLocationId)?.name : null
              const nameB = r0.endLocationId ? project.locations.find(l => l.id === r0.endLocationId)?.name : null
              const groupLabel = r0.label || (nameA && nameB ? `${nameA} ↔ ${nameB}` : 'Route group')
              return (
                <li key={groupId} className="border-b border-gray-100">
                  {/* Group header */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer group"
                    onClick={() => toggleGroup(groupId)}
                  >
                    <div
                      className="w-1 h-8 rounded shrink-0"
                      style={{ backgroundColor: r0.color || '#EF4444' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{groupLabel}</div>
                      <div className="text-xs text-gray-500">{routes.length} legs</div>
                    </div>
                    <span className="text-gray-400 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
                    {!isReadOnly && (
                      <button
                        onClick={(e) => { e.stopPropagation(); routes.forEach((r) => removeRoute(r.id)) }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1"
                        title="Remove group"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {/* Expanded legs */}
                  {isExpanded && (
                    <ul className="bg-gray-50">
                      {routes.map((route) => {
                        const from = route.startLocationId ? project.locations.find(l => l.id === route.startLocationId)?.name : null
                        const to = route.endLocationId ? project.locations.find(l => l.id === route.endLocationId)?.name : null
                        return (
                          <li
                            key={route.id}
                            className="flex items-center gap-2 pl-6 pr-3 py-2 hover:bg-gray-100 cursor-pointer border-t border-gray-100 group"
                            onClick={() => onRouteClick(route)}
                          >
                            <div className="flex-1 min-w-0">
                              {(from || to) && (
                                <div className="text-xs text-blue-600 truncate">{from ?? '?'} → {to ?? '?'}</div>
                              )}
                              <div className="text-xs text-gray-500">
                                {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
                              </div>
                            </div>
                            {!isReadOnly && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onEditRoute(route) }}
                                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 text-xs px-1"
                                  title="Edit"
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeRoute(route.id) }}
                                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1"
                                  title="Remove"
                                >
                                  ✕
                                </button>
                              </>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            }

            // Single (ungrouped) route
            const { route } = item
            const from = route.startLocationId ? project.locations.find(l => l.id === route.startLocationId)?.name : null
            const to = route.endLocationId ? project.locations.find(l => l.id === route.endLocationId)?.name : null
            return (
              <li
                key={route.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 group"
                onClick={() => onRouteClick(route)}
              >
                <div
                  className="w-1 h-8 rounded shrink-0"
                  style={{ backgroundColor: route.color || '#EF4444' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{route.label || 'Unnamed route'}</div>
                  {(from || to) && (
                    <div className="text-xs text-blue-600 truncate">{from ?? '?'} → {to ?? '?'}</div>
                  )}
                  <div className="text-xs text-gray-500">
                    {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
                  </div>
                </div>
                {!isReadOnly && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditRoute(route) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 text-xs px-1"
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeRoute(route.id) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            )
          })}
          {project.routes.length === 0 && (
            <li className="px-3 py-4 text-xs text-gray-400 text-center">
              No routes saved yet
            </li>
          )}
        </ul>}
      </div>

      {/* Action buttons */}
      {!isReadOnly && (
        <div className="p-3 border-t border-gray-200 flex flex-col gap-2">
          <button
            onClick={onAddLocationClick}
            className="w-full py-2 px-3 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium"
          >
            + Add Location
          </button>
          <button
            onClick={onAddRouteClick}
            className="w-full py-2 px-3 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium"
          >
            + Route (auto)
          </button>
          <button
            onClick={onDrawManualClick}
            className="w-full py-2 px-3 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 font-medium"
          >
            ✏ Draw Route
          </button>
          {(() => {
            const home = project.locations.find((l) => l.name.toLowerCase() === 'home')
            if (!home) return null
            const homeToLocIds = new Set(project.routes.filter((r) => r.startLocationId === home.id && r.endLocationId).map((r) => r.endLocationId as string))
            const locToHomeIds = new Set(project.routes.filter((r) => r.endLocationId === home.id && r.startLocationId).map((r) => r.startLocationId as string))
            const missingLegs = project.locations
              .filter((l) => l.id !== home.id)
              .reduce((n, l) => n + (!homeToLocIds.has(l.id) ? 1 : 0) + (!locToHomeIds.has(l.id) ? 1 : 0), 0)
            return (
              <button
                onClick={onBulkAddHomeRoutes}
                disabled={isOffline || missingLegs === 0}
                className="w-full py-2 px-3 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                title={missingLegs === 0 ? 'All home routes exist' : `Add ${missingLegs} missing home route leg${missingLegs !== 1 ? 's' : ''}`}
              >
                ⇄ Route All from Home{missingLegs > 0 ? ` (${missingLegs})` : ''}
              </button>
            )
          })()}
        </div>
      )}
    </aside>
  )
}
