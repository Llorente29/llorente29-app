import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import { Wallet, MapPin, Info, ChevronDown, ChevronRight } from 'lucide-react'
import type { Location } from '../types'

// Dashboard placeholder
export function DashboardPage() {
  const { staff, tasks, incidents, locations } = useApp()
  const working = staff.filter(e => e.clockEntries[0]?.type === 'entrada').length
  const pending = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length
  const openInc = incidents.filter(i => i.status !== 'resuelta').length

  const stats = [
    { label: 'Locales activos',     val: locations.filter(l => l.active).length,  color: 'bg-success-bg text-success' },
    { label: 'Empleados activos',   val: staff.filter(e => e.active).length,      color: 'bg-success-bg text-success' },
    { label: 'Trabajando ahora',    val: working,                                  color: 'bg-accent-bg text-accent' },
    { label: 'Tareas pendientes',   val: pending,                                  color: pending > 0 ? 'bg-warning-bg text-warning' : 'bg-page text-text-secondary' },
    { label: 'Incidencias abiertas',val: openInc,                                  color: openInc > 0 ? 'bg-danger-bg text-danger' : 'bg-page text-text-secondary' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-display text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary">Resumen general de tu negocio</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`p-4 rounded-lg border border-border-default ${s.color}`}>
            <p className="text-3xl font-bold">{s.val}</p>
            <p className="text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>
      {locations.length === 0 && (
        <Card className="p-6">
          <p className="font-medium text-text-primary">Empieza creando un local</p>
          <p className="text-sm text-text-secondary mt-1">Ve a Locales en el menú para añadir tu primer local.</p>
        </Card>
      )}
    </div>
  )
}

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
          <h1 className="text-2xl font-display text-text-primary">Locales</h1>
          <p className="text-sm text-text-secondary">{locations.length} locales registrados</p>
        </div>
        <button
          onClick={addLocation}
          className="px-4 py-2 bg-accent text-text-on-accent text-sm font-medium rounded-md hover:bg-accent-hover transition-base"
        >
          + Nuevo local
        </button>
      </div>
      <div className="space-y-3">
        {locations.length === 0 ? (
          <Card className="p-8 text-center"><p className="text-text-secondary">Sin locales. Añade uno arriba.</p></Card>
        ) : locations.map(loc => {
          const isExpanded = expandedId === loc.id
          const closeDay = loc.hoursBalanceCloseDay ?? 25
          const syncGestoria = loc.hoursBalanceSyncWithGestoria ?? true
          return (
            <Card key={loc.id} className="p-4">
              {/* Datos básicos del local */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-text-secondary uppercase font-medium">Nombre</label>
                  <input
                    value={loc.name}
                    onChange={e => updateLocation(loc.id, { name: e.target.value })}
                    className="mt-1 w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary uppercase font-medium">Dirección</label>
                  <input
                    value={loc.address}
                    onChange={e => updateLocation(loc.id, { address: e.target.value })}
                    className="mt-1 w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Calle, número..."
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary uppercase font-medium">Teléfono</label>
                  <input
                    value={loc.phone}
                    onChange={e => updateLocation(loc.id, { phone: e.target.value })}
                    className="mt-1 w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="600000000"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={loc.active}
                      onChange={e => updateLocation(loc.id, { active: e.target.checked })}
                      className="accent-accent"
                    />
                    <span className="text-sm text-text-primary">Activo</span>
                  </div>
                  <button
                    onClick={() => { if (confirm('¿Eliminar este local?')) setLocations(prev => prev.filter(l => l.id !== loc.id)) }}
                    className="mb-2 px-3 py-1.5 text-xs text-danger border border-danger/30 rounded-md hover:bg-danger-bg transition-base"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Sección de configuración avanzada (plegable) */}
              <div className="mt-3 pt-3 border-t border-border-default">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : loc.id)}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium"
                >
                  {isExpanded
                    ? <><ChevronDown size={14} /> Ocultar configuración avanzada</>
                    : <><ChevronRight size={14} /> Configuración avanzada</>
                  }
                </button>

                {isExpanded && (
                  <div className="mt-3 space-y-4">
                    {/* Bolsa de horas */}
                    <div className="bg-page rounded-md p-3">
                      <p className="text-xs font-semibold mb-2 inline-flex items-center gap-1.5 text-accent">
                        <Wallet size={14} /> Configuración de bolsa de horas
                      </p>

                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={syncGestoria}
                          onChange={e => updateLocation(loc.id, { hoursBalanceSyncWithGestoria: e.target.checked })}
                          className="mt-0.5 w-4 h-4 rounded accent-accent"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-text-primary">
                            Sincronizar cierre con envío a gestoría
                          </span>
                          <p className="text-xs text-text-secondary">
                            El periodo de bolsa de horas se cierra el mismo día que se envía el informe a gestoría (configurable en "Informes Gestoría").
                          </p>
                        </div>
                      </label>

                      {!syncGestoria && (
                        <div className="mt-3 pl-6">
                          <label className="text-xs text-text-primary block mb-1">
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
                            className="w-20 border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                          <p className="text-xs text-text-secondary mt-1">
                            El periodo va del día siguiente al cierre del mes anterior, hasta el día de cierre del mes actual.
                            Ej: si pones 25, el periodo "Mayo" abarca del 26 abril al 25 mayo.
                          </p>
                        </div>
                      )}

                      {syncGestoria && (
                        <p className="mt-2 pl-6 text-xs text-text-secondary inline-flex items-center gap-1.5">
                          <Info size={12} className="shrink-0" />
                          Si aún no has configurado el día de envío a gestoría, ve a "Informes Gestoría" en el menú lateral.
                        </p>
                      )}
                    </div>

                    {/* Geolocalización (si la tienes configurada) */}
                    {(loc.lat !== undefined || loc.lng !== undefined) && (
                      <div className="bg-page rounded-md p-3">
                        <p className="text-xs font-semibold mb-2 inline-flex items-center gap-1.5 text-text-primary">
                          <MapPin size={14} /> Geolocalización del kiosko
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-text-secondary uppercase font-medium">Latitud</label>
                            <input
                              type="number"
                              step="any"
                              value={loc.lat ?? ''}
                              onChange={e => updateLocation(loc.id, { lat: e.target.value ? parseFloat(e.target.value) : undefined })}
                              className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                              placeholder="40.4168"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-text-secondary uppercase font-medium">Longitud</label>
                            <input
                              type="number"
                              step="any"
                              value={loc.lng ?? ''}
                              onChange={e => updateLocation(loc.id, { lng: e.target.value ? parseFloat(e.target.value) : undefined })}
                              className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
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
