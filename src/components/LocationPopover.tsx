import { useState, useEffect } from 'react'
import { useMapStore } from '../store/useMapStore'
import type { Location } from '../types'

interface LocationPopoverProps {
  coordinates: { lat: number; lng: number }
  onClose: () => void
  editingLocation?: Location
  initialName?: string
}

const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

export default function LocationPopover({ coordinates, onClose, editingLocation, initialName }: LocationPopoverProps) {
  const { addLocation, updateLocation } = useMapStore()
  const [name, setName] = useState(editingLocation?.name || initialName || '')
  const [category, setCategory] = useState(editingLocation?.category?.join(', ') || '')
  const [icon, setIcon] = useState(editingLocation?.icon || '')
  const [color, setColor] = useState(editingLocation?.color || '#3B82F6')
  const [notes, setNotes] = useState(editingLocation?.notes || '')
  const [address, setAddress] = useState(editingLocation?.address || '')
  const [addressLoading, setAddressLoading] = useState(false)

  useEffect(() => {
    if (editingLocation?.address) return // already have it
    setAddressLoading(true)
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${coordinates.lat}&lon=${coordinates.lng}&format=json`,
      { headers: { 'User-Agent': 'myMap-personal-app/1.0' } }
    )
      .then((r) => r.json())
      .then((d) => { if (d.display_name) setAddress(d.display_name) })
      .catch(() => {})
      .finally(() => setAddressLoading(false))
  }, [coordinates.lat, coordinates.lng, editingLocation?.address])

  const handleSave = () => {
    if (!name.trim()) return
    const data = {
      name: name.trim(),
      coordinates,
      address: address.trim() || undefined,
      category: category ? category.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
      icon: icon.trim() || undefined,
      color,
      notes: notes.trim() || undefined,
    }
    if (editingLocation) {
      updateLocation(editingLocation.id, data)
    } else {
      addLocation(data)
    }
    onClose()
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">{editingLocation ? 'Edit Location' : 'New Location'}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>

      {(address || addressLoading) && (
        <div className="mb-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
          {addressLoading ? (
            <p className="text-xs text-gray-400 italic">Looking up address...</p>
          ) : (
            <p className="text-xs text-gray-500 leading-snug">{address}</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="e.g. Dr. Chen's Office"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Categories (comma-separated)</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Medical, Food, School"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Icon (emoji)</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🏥"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
          <div className="flex gap-2 flex-wrap">
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
          disabled={!name.trim()}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  )
}
