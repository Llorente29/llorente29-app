import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'

// Dashboard placeholder
export function DashboardPage() {
  const { staff, tasks, incidents, locations } = useApp()
  const working = staff.filter(e => e.clockEntries[0]?.type === 'entrada').length
  const pending = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length
  const openInc = incidents.filter(i => i.status !== 'resuelta').length

  const stats = [
    { label: 'Locales activos', val: locations.filter(l => l.active).length, color: 'bg-teal-50 text-teal-700' },
    { label: 'Empleados activos', val: staff.filter(e => e.active).length, color: 'bg-emerald-50 text-emerald-700' },
    { label: 'Trabajando ahora', val: working, color: 'bg-blue-50 text-blue-700' },
    { label: 'Tareas pendientes', val: pending, color: pending > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-700' },
    { label: 'Incidencias abiertas', val: openInc, color: openInc > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Dashboard</h1>
        <p className="text-sm text-gray-500">Resumen general de tu negocio</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`p-4 rounded-xl border ${s.color}`}>
            <p className="text-3xl font-bold">{s.val}</p>
            <p className="text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>
      {locations.length === 0 && (
        <Card className="p-6">
          <p className="font-medium">Empieza creando un local</p>
          <p className="text-sm text-gray-500 mt-1">Ve a Locales en el menú para añadir tu primer local.</p>
        </Card>
      )}
    </div>
  )
}

// Placeholder for pages not yet migrated
function PlaceholderPage({ title, icon, description }: { title: string; icon: string; description: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>{title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
      <Card className="p-12 text-center">
        <p className="text-4xl mb-4">{icon}</p>
        <p className="font-medium text-gray-700">Módulo en migración</p>
        <p className="text-sm text-gray-400 mt-1">Esta sección estará disponible en breve.</p>
      </Card>
    </div>
  )
}

export function TasksPage() { return <PlaceholderPage title="Tareas" icon="✅" description="Gestión de tareas operativas" /> }
export function ScheduledPage() { return <PlaceholderPage title="Tareas Programadas" icon="📅" description="Tareas recurrentes y programadas" /> }
export function TemplatesPage() { return <PlaceholderPage title="Plantillas" icon="📋" description="Plantillas de tareas" /> }
export function IncidentsPage() { return <PlaceholderPage title="Incidencias" icon="⚠️" description="Registro de incidencias" /> }
export function AuditsPage() { return <PlaceholderPage title="Auditorías" icon="🔍" description="Auditorías y controles de calidad" /> }
export function HistoryPage() { return <PlaceholderPage title="Historial" icon="📜" description="Historial de registros" /> }
export function TSpoonPage() { return <PlaceholderPage title="Fichas Técnicas" icon="🧪" description="Fichas técnicas de productos" /> }
export function InventoryPage() { return <PlaceholderPage title="Inventario" icon="📦" description="Control de inventario semanal" /> }
export function TSpoonSettingsPage() { return <PlaceholderPage title="Configuración de Avisos" icon="🔔" description="Configura las notificaciones" /> }

export function LocationsPage() {
  const { locations, setLocations } = useApp()

  function addLocation() {
    setLocations(prev => [...prev, {
      id: `loc-${Date.now()}`,
      name: 'Nuevo local',
      address: '',
      phone: '',
      active: true,
    }])
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Locales</h1>
          <p className="text-sm text-gray-500">{locations.length} locales registrados</p>
        </div>
        <button onClick={addLocation} className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700">
          + Nuevo local
        </button>
      </div>
      <div className="space-y-3">
        {locations.length === 0 ? (
          <Card className="p-8 text-center"><p className="text-gray-500">Sin locales. Añade uno arriba.</p></Card>
        ) : locations.map(loc => (
          <Card key={loc.id} className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase font-medium">Nombre</label>
                <input
                  value={loc.name}
                  onChange={e => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, name: e.target.value } : l))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase font-medium">Dirección</label>
                <input
                  value={loc.address}
                  onChange={e => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, address: e.target.value } : l))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Calle, número..."
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase font-medium">Teléfono</label>
                <input
                  value={loc.phone}
                  onChange={e => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, phone: e.target.value } : l))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="600000000"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={loc.active} onChange={e => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, active: e.target.checked } : l))} />
                  <span className="text-sm">Activo</span>
                </div>
                <button onClick={() => { if (confirm('¿Eliminar este local?')) setLocations(prev => prev.filter(l => l.id !== loc.id)) }}
                  className="mb-2 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                  Eliminar
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
