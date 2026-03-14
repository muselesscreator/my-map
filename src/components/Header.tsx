import { useMapStore } from '../store/useMapStore'

interface HeaderProps {
  onExportPNG: () => void
  onExportGeoJSON: () => void
  onImportGeoJSON: () => void
}

export default function Header({ onExportPNG, onExportGeoJSON, onImportGeoJSON }: HeaderProps) {
  const { project, viewMode, setViewMode, isOffline, setOffline } = useMapStore()

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm h-12 shrink-0">
      <h1 className="text-lg font-bold text-gray-800">{project.name}</h1>
      <div className="flex items-center gap-3">
        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          <button
            onClick={() => setViewMode('edit')}
            className={`px-3 py-1 ${viewMode === 'edit' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            Edit
          </button>
          <button
            onClick={() => setViewMode('mymap')}
            className={`px-3 py-1 ${viewMode === 'mymap' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            My Map
          </button>
          <button
            onClick={() => setViewMode('directions')}
            className={`px-3 py-1 ${viewMode === 'directions' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            Directions
          </button>
        </div>
        {/* Offline toggle */}
        <button
          onClick={() => setOffline(!isOffline)}
          className={`px-3 py-1 text-sm rounded border font-medium transition-colors ${
            isOffline
              ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
          title={isOffline ? 'Switch to online mode' : 'Switch to offline mode'}
        >
          {isOffline ? 'Offline' : 'Online'}
        </button>
        {/* Export dropdown */}
        <div className="flex gap-2 text-sm">
          <button onClick={onExportPNG} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
            Export PNG
          </button>
          <button onClick={onExportGeoJSON} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
            Export GeoJSON
          </button>
          <button onClick={onImportGeoJSON} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
            Import
          </button>
          <button onClick={() => window.print()} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
            Print
          </button>
        </div>
      </div>
    </header>
  )
}
