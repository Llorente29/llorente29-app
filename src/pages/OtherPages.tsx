import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import type { Location } from '../types'

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
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function addLocation() {
    setLocations(prev => [...prev, {
      id: `loc-${Date.now()}`,
      name: 'Nuevo local',
      address: '',
      phone: '',
      active: true,
      hoursBalanceCloseDay: 25,
      hoursBalanceSyncWithGestoria: true,
    }])
  }

  function updateLocation(id: string, patch: Partial<Location>) {
    setLocations(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
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
        ) : locations.map(loc => {
          const isExpanded = expandedId === loc.id
          const closeDay = loc.hoursBalanceCloseDay ?? 25
          const syncGestoria = loc.hoursBalanceSyncWithGestoria ?? true
          return (
            <Card key={loc.id} className="p-4">
              {/* Datos básicos del local */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase font-medium">Nombre</label>
                  <input
                    value={loc.name}
                    onChange={e => updateLocation(loc.id, { name: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase font-medium">Dirección</label>
                  <input
                    value={loc.address}
                    onChange={e => updateLocation(loc.id, { address: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Calle, número..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase font-medium">Teléfono</label>
                  <input
                    value={loc.phone}
                    onChange={e => updateLocation(loc.id, { phone: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="600000000"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-2 mb-2">
                    <input type="checkbox" checked={loc.active} onChange={e => updateLocation(loc.id, { active: e.target.checked })} />
                    <span className="text-sm">Activo</span>
                  </div>
                  <button onClick={() => { if (confirm('¿Eliminar este local?')) setLocations(prev => prev.filter(l => l.id !== loc.id)) }}
                    className="mb-2 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Sección de configuración avanzada (plegable) */}
              <div className="mt-3 pt-3 border-t">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : loc.id)}
                  className="text-xs text-[#7C1A1A] hover:underline font-medium"
                >
                  {isExpanded ? '▼ Ocultar configuración avanzada' : '▶ Configuración avanzada'}
                </button>

                {isExpanded && (
                  <div className="mt-3 space-y-4">
                    {/* Bolsa de horas */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs font-semibold mb-2" style={{ color: '#7C1A1A' }}>
                        💰 Configuración de bolsa de horas
                      </p>

                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={syncGestoria}
                          onChange={e => updateLocation(loc.id, { hoursBalanceSyncWithGestoria: e.target.checked })}
                          className="mt-0.5 w-4 h-4 rounded accent-[#7C1A1A]"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium">
                            Sincronizar cierre con envío a gestoría
                          </span>
                          <p className="text-[11px] text-gray-500">
                            El periodo de bolsa de horas se cierra el mismo día que se envía el informe a gestoría (configurable en "Informes Gestoría").
                          </p>
                        </div>
                      </label>

                      {!syncGestoria && (
                        <div className="mt-3 pl-6">
                          <label className="text-xs text-gray-700 block mb-1">
                            Día de cierre del periodo (1-31)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={closeDay}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10)
                              if (isNaN(v)) return
                              const clamped = Math.max(1, Math.min(31, v))
                              updateLocation(loc.id, { hoursBalanceCloseDay: clamped })
                            }}
                            className="w-20 border rounded-lg px-3 py-1.5 text-sm"
                          />
                          <p className="text-[11px] text-gray-500 mt-1">
                            El periodo va del día siguiente al cierre del mes anterior, hasta el día de cierre del mes actual.
                            Ej: si pones 25, el periodo "Mayo" abarca del 26 abril al 25 mayo.
                          </p>
                        </div>
                      )}

                      {syncGestoria && (
                        <p className="mt-2 pl-6 text-[11px] text-gray-500">
                          ℹ️ Si aún no has configurado el día de envío a gestoría, ve a "Informes Gestoría" en el menú lateral.
                        </p>
                      )}
                    </div>

                    {/* Geolocalización (si la tienes configurada) */}
                    {(loc.lat !== undefined || loc.lng !== undefined) && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-semibold mb-2 text-gray-700">
                          📍 Geolocalización del kiosko
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase font-medium">Latitud</label>
                            <input
                              type="number"
                              step="any"
                              value={loc.lat ?? ''}
                              onChange={e => updateLocation(loc.id, { lat: e.target.value ? parseFloat(e.target.value) : undefined })}
                              className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm"
                              placeholder="40.4168"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase font-medium">Longitud</label>
                            <input
                              type="number"
                              step="any"
                              value={loc.lng ?? ''}
                              onChange={e => updateLocation(loc.id, { lng: e.target.value ? parseFloat(e.target.value) : undefined })}
                              className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm"
                              placeholder="-3.7038"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
