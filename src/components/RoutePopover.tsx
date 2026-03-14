import { useState } from 'react'
import { useMapStore } from '../store/useMapStore'
import type { Route, RouteStep } from '../types'

interface RouteCandidate {
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  distanceMeters: number
  durationSeconds: number
  name?: string
  steps?: RouteStep[]
}

interface RoutePopoverProps {
  candidates: RouteCandidate[]
  startCoordinates: { lat: number; lng: number }
  endCoordinates: { lat: number; lng: number }
  startLocationId: string | null
  endLocationId: string | null
  selectedIdx: number
  onSelectIdx: (i: number) => void
  onClose: () => void
  editingRoute?: Route
  // For home↔location round-trip routes
  returnData?: {
    candidates: Array<RouteCandidate | null>
    startCoordinates: { lat: number; lng: number }
    endCoordinates: { lat: number; lng: number }
    startLocationId: string | null
    endLocationId: string | null
  }
  groupId?: string
}

const COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899']

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}
function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

export default function RoutePopover({
  candidates, startCoordinates, endCoordinates,
  startLocationId, endLocationId, selectedIdx, onSelectIdx, onClose, editingRoute,
  returnData, groupId,
}: RoutePopoverProps) {
  const { addRoute, updateRoute, project } = useMapStore()
  const fromName = startLocationId ? project.locations.find(l => l.id === startLocationId)?.name : null
  const toName = endLocationId ? project.locations.find(l => l.id === endLocationId)?.name : null
  const defaultLabel = !editingRoute && (fromName || toName)
    ? [fromName, toName].filter(Boolean).join(' to ')
    : ''
  const [label, setLabel] = useState(editingRoute?.label || defaultLabel)
  const [color, setColor] = useState(editingRoute?.color || '#EF4444')
  const [notes, setNotes] = useState(editingRoute?.notes || '')
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set([0]))

  const toggleChecked = (i: number) => {
    setCheckedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(i)) { next.delete(i) } else { next.add(i) }
      return next
    })
  }

  const handleSave = () => {
    const baseLabel = label.trim() || undefined
    const indices = Array.from(checkedIndices).sort()
    if (editingRoute) {
      const selected = candidates[selectedIdx]
      updateRoute(editingRoute.id, {
        label: baseLabel,
        startLocationId,
        endLocationId,
        startCoordinates,
        endCoordinates,
        geometry: selected.geometry,
        distanceMeters: selected.distanceMeters,
        durationSeconds: selected.durationSeconds,
        color,
        notes: notes.trim() || undefined,
        steps: selected.steps,
      })
    } else {
      const multi = indices.length > 1
      for (const i of indices) {
        const c = candidates[i]
        const suffix = c.name ?? `Route ${i + 1}`
        addRoute({
          label: baseLabel && multi ? `${baseLabel} (${suffix})` : baseLabel,
          startLocationId,
          endLocationId,
          startCoordinates,
          endCoordinates,
          geometry: c.geometry,
          distanceMeters: c.distanceMeters,
          durationSeconds: c.durationSeconds,
          color,
          notes: notes.trim() || undefined,
          steps: c.steps,
          groupId,
        })
        // Save the paired return route if present
        if (returnData) {
          const rc = returnData.candidates[i]
          if (rc) {
            const returnLabel = baseLabel ? `${baseLabel} (return)` : undefined
            addRoute({
              label: multi ? (returnLabel ? `${returnLabel} (${suffix})` : undefined) : returnLabel,
              startLocationId: returnData.startLocationId,
              endLocationId: returnData.endLocationId,
              startCoordinates: returnData.startCoordinates,
              endCoordinates: returnData.endCoordinates,
              geometry: rc.geometry,
              distanceMeters: rc.distanceMeters,
              durationSeconds: rc.durationSeconds,
              color,
              notes: notes.trim() || undefined,
              steps: rc.steps,
              groupId,
            })
          }
        }
      }
    }
    onClose()
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">{editingRoute ? 'Edit Route' : 'Save Route'}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>

      {(fromName || toName) && (
        <div className="mb-3 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-700 font-medium truncate">
          {fromName ?? '?'} {returnData ? '↔' : '→'} {toName ?? '?'}
        </div>
      )}

      {/* Route alternatives */}
      {candidates.length > 1 && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-2">
            Routes — check to save, click to preview
          </label>
          <div className="space-y-1">
            {candidates.map((c, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                  selectedIdx === i ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => onSelectIdx(i)}
              >
                <input
                  type="checkbox"
                  checked={checkedIndices.has(i)}
                  onChange={() => toggleChecked(i)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-blue-600 shrink-0"
                />
                <span className="flex-1">
                  {c.name ?? `Route ${i + 1}`}: {formatDistance(c.distanceMeters)} · {formatDuration(c.durationSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="e.g. School run"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-gray-800' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!editingRoute && checkedIndices.size === 0}
          className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {!editingRoute && checkedIndices.size > 1 ? `Save ${checkedIndices.size} Routes` : 'Save Route'}
        </button>
      </div>
    </div>
  )
}
