import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Location, Route, MapProject } from '../types'

interface MapStore {
  project: MapProject
  viewMode: 'edit' | 'mymap'
  // Location actions
  addLocation: (loc: Omit<Location, 'id' | 'createdAt'>) => void
  updateLocation: (id: string, updates: Partial<Location>) => void
  removeLocation: (id: string) => void
  // Route actions
  addRoute: (route: Omit<Route, 'id' | 'createdAt'>) => void
  updateRoute: (id: string, updates: Partial<Route>) => void
  removeRoute: (id: string) => void
  // View
  setViewMode: (mode: 'edit' | 'mymap') => void
  // Import/Export
  importProject: (project: MapProject) => void
}

const defaultProject: MapProject = {
  id: uuidv4(),
  name: 'My Map',
  locations: [],
  routes: [],
  defaultCenter: { lat: 40.7128, lng: -74.006 },
  defaultZoom: 12,
}

export const useMapStore = create<MapStore>()(
  persist(
    (set) => ({
      project: defaultProject,
      viewMode: 'edit',
      addLocation: (loc) =>
        set((state) => ({
          project: {
            ...state.project,
            locations: [
              ...state.project.locations,
              { ...loc, id: uuidv4(), createdAt: new Date().toISOString() },
            ],
          },
        })),
      updateLocation: (id, updates) =>
        set((state) => ({
          project: {
            ...state.project,
            locations: state.project.locations.map((l) =>
              l.id === id ? { ...l, ...updates } : l
            ),
          },
        })),
      removeLocation: (id) =>
        set((state) => ({
          project: {
            ...state.project,
            locations: state.project.locations.filter((l) => l.id !== id),
            routes: state.project.routes.filter(
              (r) => r.startLocationId !== id && r.endLocationId !== id
            ),
          },
        })),
      addRoute: (route) =>
        set((state) => ({
          project: {
            ...state.project,
            routes: [
              ...state.project.routes,
              { ...route, id: uuidv4(), createdAt: new Date().toISOString() },
            ],
          },
        })),
      updateRoute: (id, updates) =>
        set((state) => ({
          project: {
            ...state.project,
            routes: state.project.routes.map((r) =>
              r.id === id ? { ...r, ...updates } : r
            ),
          },
        })),
      removeRoute: (id) =>
        set((state) => ({
          project: {
            ...state.project,
            routes: state.project.routes.filter((r) => r.id !== id),
          },
        })),
      setViewMode: (mode) => set({ viewMode: mode }),
      importProject: (project) => set({ project }),
    }),
    { name: 'mymap-storage' }
  )
)
