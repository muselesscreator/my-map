export interface Location {
  id: string
  name: string
  coordinates: { lat: number; lng: number }
  category?: string[]
  icon?: string
  color?: string
  address?: string
  notes?: string
  createdAt: string
}

export interface RouteStep {
  name: string
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

export interface Route {
  id: string
  label?: string
  startLocationId: string | null
  endLocationId: string | null
  startCoordinates: { lat: number; lng: number }
  endCoordinates: { lat: number; lng: number }
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  distanceMeters: number
  durationSeconds: number
  color?: string
  notes?: string
  steps?: RouteStep[]
  groupId?: string
  createdAt: string
}

export interface MapProject {
  id: string
  name: string
  locations: Location[]
  routes: Route[]
  defaultCenter: { lat: number; lng: number }
  defaultZoom: number
}
