import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl/dist/maplibre-gl.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '../store/useMapStore'
import type { Route } from '../types'

function getStyleTextFont(map: maplibregl.Map): string[] {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === 'symbol' && !layer.id.startsWith('route-')) {
      try {
        const font = map.getLayoutProperty(layer.id, 'text-font')
        if (Array.isArray(font) && font.length > 0) return font as string[]
      } catch { /* ignore */ }
    }
  }
  return ['Noto Sans Regular']
}

interface RoutePreview {
  candidates: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] }
  }>
  selectedIdx: number
}

interface MapViewProps {
  onMapClick?: (coords: { lat: number; lng: number }) => void
  onMapReady?: (map: maplibregl.Map) => void
  onLocationMarkerClick?: (locationId: string) => void
  routePreview?: RoutePreview | null
  manualDrawPoints?: [number, number][]
  activeCategory?: string | null
  stepHighlightGeometry?: { type: 'LineString'; coordinates: [number, number][] } | null
  stepHighlightName?: string | null
  directionsTileStyle?: 'full' | 'mymap'
}

const PREVIEW_SLOTS = 5

// In "My Map" mode, hide road/building/POI layers from the base tile style,
// leaving only geographic context (land, water, boundaries, place labels).
function hideNonEssentialLayers(map: maplibregl.Map) {
  const hideSourceLayers = new Set([
    'transportation_name',
    'poi',
    'housenumber',
    'aeroway',
  ])
  const layers = map.getStyle()?.layers ?? []
  layers.forEach((layer) => {
    // Never touch our own app layers
    if (layer.id.startsWith('route-') || layer.id.startsWith('preview-')) return
    const sourceLayer = (layer as unknown as Record<string, string>)['source-layer'] ?? ''
    if (hideSourceLayers.has(sourceLayer)) {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none') } catch { /* ignore */ }
    }
  })
}

function applySavedRoutesToMap(map: maplibregl.Map, routes: Route[]) {
  const { viewMode } = useMapStore.getState()
  const showLabels = viewMode === 'mymap'

  const currentRouteIds = new Set(routes.map((r) => r.id))
  map.getStyle()?.layers?.forEach((layer) => {
    if (layer.id.startsWith('route-layer-') || layer.id.startsWith('route-labels-layer-')) {
      const routeId = layer.id.replace('route-layer-', '').replace('route-labels-layer-', '')
      if (!currentRouteIds.has(routeId)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id)
        const sourceId = layer.id.startsWith('route-labels-layer-')
          ? `route-labels-${routeId}`
          : `route-${routeId}`
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      }
    }
  })

  const textFont = showLabels ? getStyleTextFont(map) : []

  routes.forEach((route) => {
    const sourceId = `route-${route.id}`
    const layerId = `route-layer-${route.id}`
    const sanitizedCoordinates: [number, number][] = []
    route.geometry.coordinates.forEach((point) => {
      if (!Array.isArray(point) || point.length < 2) return
      const lng = Number(point[0])
      const lat = Number(point[1])
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return
      sanitizedCoordinates.push([lng, lat])
    })
    if (sanitizedCoordinates.length < 2) return
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: sanitizedCoordinates },
      },
    })
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': route.color || '#EF4444',
        'line-width': 4,
        'line-opacity': 0.8,
      },
    })

    // Street name labels along each step segment (My Map mode only)
    const labelsSourceId = `route-labels-${route.id}`
    const labelsLayerId = `route-labels-layer-${route.id}`
    if (map.getLayer(labelsLayerId)) map.removeLayer(labelsLayerId)
    if (map.getSource(labelsSourceId)) map.removeSource(labelsSourceId)

    if (showLabels && route.steps && route.steps.length > 0) {
      map.addSource(labelsSourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: route.steps.map((step) => ({
            type: 'Feature' as const,
            properties: { name: step.name },
            geometry: step.geometry,
          })),
        },
      })
      map.addLayer({
        id: labelsLayerId,
        type: 'symbol',
        source: labelsSourceId,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': textFont,
          'text-size': 11,
          'symbol-spacing': 200,
          'text-max-angle': 30,
          'text-padding': 2,
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      })
    }
  })
}

export default function MapView({ onMapClick, onMapReady, onLocationMarkerClick, routePreview, manualDrawPoints, activeCategory, stepHighlightGeometry, stepHighlightName, directionsTileStyle }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const styleReadyRef = useRef(false)
  const prevDirectionsTileStyleRef = useRef<'full' | 'mymap' | undefined>(undefined)
  const onLocationMarkerClickRef = useRef(onLocationMarkerClick)
  onLocationMarkerClickRef.current = onLocationMarkerClick
  const { project, viewMode } = useMapStore()

  // ── Map creation ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const { project: initialProject } = useMapStore.getState()
    const home = initialProject.locations.find((l) => l.name.toLowerCase() === 'home')
    const center: [number, number] = home
      ? [home.coordinates.lng, home.coordinates.lat]
      : [initialProject.defaultCenter.lng, initialProject.defaultCenter.lat]

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: viewMode === 'mymap'
        ? 'https://tiles.openfreemap.org/styles/positron'
        : 'https://tiles.openfreemap.org/styles/liberty',
      center,
      zoom: initialProject.defaultZoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.once('load', () => {
      if (onMapReady) onMapReady(map)
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()
      styleReadyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── viewMode: style switching + fitToContent for "My Map" ───────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!styleReadyRef.current) {
      // First run for this map instance — style is already correct from constructor.
      // Just handle fitBounds for mymap once the map is idle.
      styleReadyRef.current = true
      if (viewMode === 'mymap') {
        const onIdle = () => { hideNonEssentialLayers(map); fitToContent(map) }
        map.once('idle', onIdle)
        return () => { map.off('idle', onIdle) }
      }
      return
    }

    // viewMode actually changed — switch the style
    const targetStyle = viewMode === 'mymap'
      ? 'https://tiles.openfreemap.org/styles/positron'
      : 'https://tiles.openfreemap.org/styles/liberty'

    map.setStyle(targetStyle)

    const reapplySavedRoutesOnIdle = () => {
      const latestRoutes = useMapStore.getState().project.routes
      applySavedRoutesToMap(map, latestRoutes)
    }
    map.once('idle', reapplySavedRoutesOnIdle)

    if (viewMode === 'mymap') {
      const onIdle = () => { hideNonEssentialLayers(map); fitToContent(map) }
      map.once('idle', onIdle)
      return () => { map.off('idle', onIdle); map.off('idle', reapplySavedRoutesOnIdle) }
    }
    return () => { map.off('idle', reapplySavedRoutesOnIdle) }
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function fitToContent(map: maplibregl.Map) {
    const coords: [number, number][] = []
    project.locations.forEach((loc) => coords.push([loc.coordinates.lng, loc.coordinates.lat]))
    project.routes.forEach((route) => {
      route.geometry.coordinates.forEach((c) => coords.push(c as [number, number]))
    })
    if (coords.length > 0) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      )
      map.fitBounds(bounds, { padding: 60, maxZoom: 16 })
    }
  }

  // ── Directions tile style toggle ─────────────────────────────────────────────
  useEffect(() => {
    const prev = prevDirectionsTileStyleRef.current
    prevDirectionsTileStyleRef.current = directionsTileStyle
    // Only switch when toggling between 'full' and 'mymap' (both non-undefined)
    if (!prev || !directionsTileStyle) return
    const map = mapRef.current
    if (!map) return
    const style = directionsTileStyle === 'mymap'
      ? 'https://tiles.openfreemap.org/styles/positron'
      : 'https://tiles.openfreemap.org/styles/liberty'
    map.setStyle(style)
    const reapply = () => {
      const latestRoutes = useMapStore.getState().project.routes
      applySavedRoutesToMap(map, latestRoutes)
    }
    map.once('idle', reapply)
    return () => { map.off('idle', reapply) }
  }, [directionsTileStyle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle map click ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !onMapClick) return
    const handler = (e: maplibregl.MapMouseEvent) => {
      onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    }
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [onMapClick])

  // ── Location markers (DOM elements — survive style changes) ─────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove all existing markers so they are fully recreated on every update.
    // This keeps markers in sync if a location's name, color, or icon changes.
    markersRef.current.forEach((m) => m.remove())
    markersRef.current.clear()

    project.locations.forEach((loc) => {
      if (!markersRef.current.has(loc.id)) {
        const wrapper = document.createElement('div')
        wrapper.className = 'flex flex-col items-center cursor-pointer'
        wrapper.style.transform = 'translateX(-50%)'

        const el = document.createElement('div')
        el.style.cssText = `
          width: 46px;
          height: 46px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.25);
          background-color: ${loc.color || '#3B82F6'};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          user-select: none;
        `
        el.textContent = loc.icon || loc.name.charAt(0).toUpperCase()

        const label = document.createElement('div')
        label.className = 'mt-1 px-1.5 py-0.5 rounded text-xs font-semibold text-gray-900 whitespace-nowrap pointer-events-none'
        label.style.cssText = 'background: rgba(255,255,255,0.92); box-shadow: 0 1px 3px rgba(0,0,0,0.25); font-size: 12px; line-height: 1.4;'
        label.textContent = loc.name

        wrapper.appendChild(el)
        wrapper.appendChild(label)

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation()
          onLocationMarkerClickRef.current?.(loc.id)
        })

        const marker = new maplibregl.Marker({ element: wrapper, anchor: 'top' })
          .setLngLat([loc.coordinates.lng, loc.coordinates.lat])
          .addTo(map)
        markersRef.current.set(loc.id, marker)
      }
    })
  }, [project.locations])

  // ── Marker visibility (category filter) ─────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    const homeId = project.locations.find((l) => l.name.toLowerCase() === 'home')?.id
    project.locations.forEach((loc) => {
      const marker = markersRef.current.get(loc.id)
      if (!marker) return
      const visible = !activeCategory || loc.id === homeId || (loc.category?.includes(activeCategory) ?? false)
      marker.getElement().style.display = visible ? '' : 'none'
    })
  }, [project.locations, activeCategory])

  // ── Saved route layers ──────────────────────────────────────────────────────
  // Uses 'style.load' so layers are re-added after every setStyle call too.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const applyRoutes = () => {
      let visibleRoutes = project.routes
      if (activeCategory) {
        const visibleLocIds = new Set(
          project.locations
            .filter((l) => l.name.toLowerCase() === 'home' || (l.category?.includes(activeCategory) ?? false))
            .map((l) => l.id)
        )
        visibleRoutes = project.routes.filter(
          (r) => r.startLocationId !== null && r.endLocationId !== null &&
            visibleLocIds.has(r.startLocationId) && visibleLocIds.has(r.endLocationId)
        )
      }
      applySavedRoutesToMap(map, visibleRoutes)
    }

    // Re-apply after every style load (initial + after setStyle)
    map.on('style.load', applyRoutes)

    // Apply immediately if the style is already ready
    if (map.isStyleLoaded()) applyRoutes()

    return () => {
      map.off('style.load', applyRoutes)
    }
  }, [project.routes, project.locations, activeCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Route candidate preview ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const isAlive = () => mapRef.current === map && map.isStyleLoaded()

    const clearPreviews = () => {
      if (!isAlive()) return
      for (let i = 0; i < PREVIEW_SLOTS; i++) {
        if (map.getLayer(`preview-${i}`)) map.removeLayer(`preview-${i}`)
        if (map.getSource(`preview-${i}`)) map.removeSource(`preview-${i}`)
      }
    }

    const draw = () => {
      if (!isAlive()) return
      clearPreviews()
      if (!routePreview) return
      routePreview.candidates.forEach((c, i) => {
        map.addSource(`preview-${i}`, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: c.geometry },
        })
        map.addLayer({
          id: `preview-${i}`,
          type: 'line',
          source: `preview-${i}`,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': i === routePreview.selectedIdx ? '#2563EB' : '#94A3B8',
            'line-width': i === routePreview.selectedIdx ? 5 : 3,
            'line-opacity': 0.85,
          },
        })
      })
      const coords = routePreview.candidates[0]?.geometry.coordinates
      if (coords && coords.length > 0) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as [number, number]),
          new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
        )
        map.fitBounds(bounds, { padding: 80 })
      }
    }

    if (map.isStyleLoaded()) draw()
    else map.once('idle', draw)

    return () => {
      map.off('idle', draw)
      clearPreviews()
    }
  }, [routePreview]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual draw preview ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const isAlive = () => mapRef.current === map && map.isStyleLoaded()
    const SOURCE = 'preview-drawing'
    const LAYER = 'preview-drawing'

    const draw = () => {
      if (!isAlive()) return
      if (!manualDrawPoints || manualDrawPoints.length < 2) {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER)
        if (map.getSource(SOURCE)) map.removeSource(SOURCE)
        return
      }
      const geojson = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: manualDrawPoints },
      }
      if (map.getSource(SOURCE)) {
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource).setData(geojson)
      } else {
        map.addSource(SOURCE, { type: 'geojson', data: geojson })
        map.addLayer({
          id: LAYER,
          type: 'line',
          source: SOURCE,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#10B981', 'line-width': 4, 'line-opacity': 0.85 },
        })
      }
    }

    if (map.isStyleLoaded()) draw()
    else map.once('idle', draw)

    return () => { map.off('idle', draw) }
  }, [manualDrawPoints])

  // ── Step highlight (directions mode) ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const SOURCE = 'step-highlight'
    const LAYER = 'step-highlight'
    const LABEL_SOURCE = 'step-highlight-label'
    const LABEL_LAYER = 'step-highlight-label'

    const draw = () => {
      if (!map.isStyleLoaded()) return
      if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER)
      if (map.getSource(LABEL_SOURCE)) map.removeSource(LABEL_SOURCE)
      if (map.getLayer(LAYER)) map.removeLayer(LAYER)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
      if (!stepHighlightGeometry || stepHighlightGeometry.coordinates.length < 1) return
      map.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: stepHighlightGeometry },
      })
      map.addLayer({
        id: LAYER,
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FBBF24', 'line-width': 7, 'line-opacity': 0.9 },
      })
      if (stepHighlightName) {
        map.addSource(LABEL_SOURCE, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: { name: stepHighlightName },
            geometry: stepHighlightGeometry,
          },
        })
        map.addLayer({
          id: LABEL_LAYER,
          type: 'symbol',
          source: LABEL_SOURCE,
          layout: {
            'symbol-placement': 'line',
            'text-field': ['get', 'name'],
            'text-font': getStyleTextFont(map),
            'text-size': 13,
            'symbol-spacing': 150,
            'text-max-angle': 30,
          },
          paint: {
            'text-color': '#92400e',
            'text-halo-color': '#fef3c7',
            'text-halo-width': 2,
          },
        })
      }
    }

    if (map.isStyleLoaded()) draw()
    else map.once('idle', draw)

    return () => {
      map.off('idle', draw)
      if (map.isStyleLoaded()) {
        if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER)
        if (map.getSource(LABEL_SOURCE)) map.removeSource(LABEL_SOURCE)
        if (map.getLayer(LAYER)) map.removeLayer(LAYER)
        if (map.getSource(SOURCE)) map.removeSource(SOURCE)
      }
    }
  }, [stepHighlightGeometry, stepHighlightName])

  return <div ref={mapContainer} className="w-full h-full" />
}
