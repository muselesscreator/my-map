# MyMap — Personal Map Builder

## Core Concept

A web app for creating a personal, curated map showing only the locations and routes you care about. "Your city, stripped down to what matters to you."

---

## User Workflows

### 1. Explore & Select Locations

- App loads a standard interactive map (Mapbox GL JS or Leaflet + OpenStreetMap tiles)
- User clicks any point on the map to drop a pin
- A popover appears to capture metadata:
  - **Name** (required) — e.g., "Dr. Chen's Office"
  - **Category** (optional, user-defined tags) — e.g., "Medical", "Food", "School"
  - **Icon** (optional) — pick from a small icon set or emoji
  - **Color** (optional) — for visual grouping
  - **Notes** (optional) — freeform text
- User can also search by address/place name (geocoding) and save the result as a location
- Saved locations appear as pins on the map and in a sidebar list

### 2. Find & Save Routes

- User selects two saved locations (or clicks two arbitrary points) to enter "route mode"
- App queries a routing engine (OSRM or Mapbox Directions API) and displays 1–3 route options on the map
- Each route shows: distance, estimated drive time, and the road names involved
- User can select one or more routes to save, with optional metadata:
  - **Label** — e.g., "School run", "Shortcut to grocery store"
  - **Color** — for distinguishing overlapping routes
  - **Notes**
- Saved routes render as colored polylines on the personal map

### 3. View Personal Map

- A toggle (or dedicated view) hides the base map's labels/features and shows **only**:
  - Saved location pins (with names/icons)
  - Saved route lines (with labels)
  - A minimal base layer (land/water outlines, no clutter) — or optionally a fully blank canvas
- This is the "your map" view — the whole point of the app

### 4. Pan / Zoom / Print / Export

- Standard map interactions: pan, zoom, pinch on mobile
- **Print**: browser print with a print-optimized CSS layout (hide sidebar, scale map to page)
- **Export**:
  - PNG/SVG — render the current map viewport as an image (html-to-canvas or Mapbox `map.getCanvas()`)
  - GeoJSON — export all saved data as a standard GeoJSON file (locations as Points, routes as LineStrings with properties)
  - Import GeoJSON — reload a previously exported dataset

---

## Data Model

```typescript
interface Location {
  id: string            // uuid
  name: string
  coordinates: { lat: number; lng: number }
  category?: string[]
  icon?: string
  color?: string
  notes?: string
  createdAt: string     // ISO date
}

interface Route {
  id: string            // uuid
  label?: string
  startLocationId: string | null   // null if arbitrary point
  endLocationId: string | null
  startCoordinates: { lat: number; lng: number }
  endCoordinates: { lat: number; lng: number }
  geometry: GeoJSON.LineString     // the actual road path
  distanceMeters: number
  durationSeconds: number
  color?: string
  notes?: string
  createdAt: string     // ISO date
}

interface MapProject {
  id: string            // uuid
  name: string
  locations: Location[]
  routes: Route[]
  defaultCenter: { lat: number; lng: number }
  defaultZoom: number
}
```

---

## Architecture

### Frontend-Only (V1)

No backend needed initially. All data lives in the browser.

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Map renderer** | Mapbox GL JS | Vector tiles, custom styles, built-in geocoding + directions APIs, canvas export |
| **Framework** | React + Vite | Fast dev, component model fits sidebar + map split |
| **State** | Zustand | Lightweight, persist middleware for localStorage |
| **Persistence** | localStorage / IndexedDB | No account needed, data stays on device |
| **Routing engine** | Mapbox Directions API (free tier: 100k req/mo) | Returns multiple route alternatives with geometry |
| **Export** | `map.getCanvas().toDataURL()` for PNG, manual GeoJSON serialization | No server needed |
| **Styling** | Tailwind CSS | Utility-first, matches rapid prototyping |

### Key Libraries

- `mapbox-gl` — map rendering
- `@mapbox/mapbox-gl-geocoder` — address search
- `zustand` + `zustand/middleware` (persist) — state + localStorage sync
- `file-saver` — trigger file downloads for export
- `html-to-image` (optional) — higher quality image export

---

## UI Layout

```
+---------------------------------------------------+
|  Header: [Project Name]    [View: Edit | My Map]   |
|                             [Export v] [Print]      |
+----------+----------------------------------------+
| Sidebar  |                                        |
|          |                                        |
| [Search] |         MAP CANVAS                     |
|          |                                        |
| Locations|    (click to add pin)                   |
|  - Home  |    (select 2 pins for routing)         |
|  - Work  |                                        |
|  - Gym   |                                        |
|          |                                        |
| Routes   |                                        |
|  - Commute|                                       |
|  - School|                                        |
|    run   |                                        |
|          |                                        |
| [+ Add]  |                                        |
+----------+----------------------------------------+
```

**"My Map" view** replaces the rich base map with a minimal/blank style and shows only saved data.

---

## Interaction Details

### Adding a Location
1. Click map -> marker appears at click point
2. Popover opens inline (anchored to marker)
3. User fills in name (required), optional fields
4. "Save" adds to sidebar list + persists to storage
5. "Cancel" removes the temporary marker

### Creating a Route
1. User clicks "Add Route" button, or selects two locations from sidebar
2. Map enters route mode — click or select start and end points
3. API returns route alternatives, rendered as dashed lines
4. User clicks a route line to select it -> it becomes solid
5. Popover for label/color/notes -> "Save Route"
6. Multiple alternatives can be saved independently

### Personal Map View
- Toggle switch in header: "Edit" <-> "My Map"
- "My Map" swaps the Mapbox style to a minimal vector style (land = light gray, water = light blue, no labels, no roads)
- Only saved locations and routes render on top
- Sidebar becomes read-only (list view, click to pan)

---

## Export Formats

| Format | What's included | Use case |
|--------|----------------|----------|
| **PNG** | Rasterized map viewport as-is | Sharing, embedding |
| **SVG** | Vector export of pins + routes (no base map) | Print-quality, editing in design tools |
| **GeoJSON** | All locations + routes with metadata | Backup, import into other tools, reload later |
| **PDF** | Print-optimized layout with legend | Physical printout |

---

## Implementation Plan

### Phase 1: Foundation
- [ ] Initialize Vite + React + TypeScript project
- [ ] Add Tailwind CSS
- [ ] Set up Mapbox GL JS with a default map view
- [ ] Create basic layout: header, sidebar, map canvas
- [ ] Set up Zustand store with localStorage persistence

### Phase 2: Locations
- [ ] Click-to-add-pin interaction on map
- [ ] Location popover form (name, category, icon, color, notes)
- [ ] Sidebar location list with CRUD
- [ ] Geocoding search bar (address -> pin)
- [ ] Click sidebar item to pan/zoom to location

### Phase 3: Routes
- [ ] Route mode: select two points (pins or arbitrary clicks)
- [ ] Mapbox Directions API integration — fetch + display alternatives
- [ ] Route selection interaction (click to pick)
- [ ] Save route with metadata (label, color, notes)
- [ ] Sidebar route list with CRUD
- [ ] Click sidebar route to fit map bounds to it

### Phase 4: Personal Map View
- [ ] "My Map" toggle — switch to minimal Mapbox style
- [ ] Render only saved locations + routes on minimal base
- [ ] Read-only sidebar in "My Map" mode
- [ ] Auto-fit bounds to all saved data on toggle

### Phase 5: Export & Print
- [ ] PNG export via `map.getCanvas().toDataURL()`
- [ ] GeoJSON export (serialize locations + routes)
- [ ] GeoJSON import (file picker -> load into store)
- [ ] Print CSS (hide sidebar, scale map)
- [ ] SVG export (optional stretch)

### Phase 6: Polish
- [ ] Category filtering (show/hide by tag)
- [ ] Color picker for locations and routes
- [ ] Icon selector for location pins
- [ ] Responsive layout for mobile
- [ ] Keyboard shortcuts (Escape to cancel, etc.)

---

## Future Considerations (V2+)

- **Accounts + cloud sync** — optional sign-in to sync across devices
- **Multiple projects** — maintain separate maps (e.g., "My Neighborhood", "Vacation Trip")
- **Shared maps** — generate a shareable link (read-only)
- **Offline support** — service worker + cached tiles for offline viewing
- **Custom base maps** — let user choose style (satellite, terrain, dark mode)
- **Waypoints** — multi-stop routes, not just A->B
- **Annotations** — draw areas/polygons (e.g., "my neighborhood")
- **Mobile PWA** — installable, GPS integration for "add current location"
