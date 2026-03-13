import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl/dist/maplibre-gl.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '../store/useMapStore'
import type { Route } from '../types'

interface RoutePreview {
  candidates: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] }
  }>
  selectedIdx: number
}

interface MapViewProps {
  onMapClick?: (coords: { lat: number; lng: number }) => void
  onMapReady?: (map: maplibregl.Map) => void
  routePreview?: RoutePreview | null
  manualDrawPoints?: [number, number][]
}

const PREVIEW_SLOTS = 5

function applySavedRoutesToMap(map: maplibregl.Map, routes: Route[]) {
  const currentRouteIds = new Set(routes.map((r) => r.id))
  map.getStyle()?.layers?.forEach((layer) => {
    if (layer.id.startsWith('route-layer-')) {
      const routeId = layer.id.replace('route-layer-', '')
      if (!currentRouteIds.has(routeId)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id)
        if (map.getSource(`route-${routeId}`)) map.removeSource(`route-${routeId}`)
      }
    }
  })

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
  })
}

export default function MapView({ onMapClick, onMapReady, routePreview, manualDrawPoints }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const styleReadyRef = useRef(false)
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
        const onIdle = () => fitToContent(map)
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
      const onIdle = () => fitToContent(map)
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

    const existingIds = new Set(markersRef.current.keys())
    const currentIds = new Set(project.locations.map((l) => l.id))

    existingIds.forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current.get(id)?.remove()
        markersRef.current.delete(id)
      }
    })

    project.locations.forEach((loc) => {
      if (!markersRef.current.has(loc.id)) {
        const el = document.createElement('div')
        el.className = 'w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-sm cursor-pointer'
        el.style.backgroundColor = loc.color || '#3B82F6'
        el.textContent = loc.icon || loc.name.charAt(0).toUpperCase()

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([loc.coordinates.lng, loc.coordinates.lat])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(
            `<strong>${loc.name}</strong>${loc.notes ? `<br/><span class="text-sm text-gray-600">${loc.notes}</span>` : ''}`
          ))
          .addTo(map)
        markersRef.current.set(loc.id, marker)
      }
    })
  }, [project.locations])

  // ── Saved route layers ──────────────────────────────────────────────────────
  // Uses 'style.load' so layers are re-added after every setStyle call too.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const applyRoutes = () => {
      applySavedRoutesToMap(map, project.routes)
    }

    // Re-apply after every style load (initial + after setStyle)
    map.on('style.load', applyRoutes)

    // Apply immediately if the style is already ready
    if (map.isStyleLoaded()) applyRoutes()

    return () => {
      map.off('style.load', applyRoutes)
    }
  }, [project.routes]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return <div ref={mapContainer} className="w-full h-full" />
}
