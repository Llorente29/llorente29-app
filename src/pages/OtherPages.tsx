import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import { Wallet, MapPin, Info, ChevronDown, ChevronRight, Check, AlertCircle, Loader2, Navigation, ExternalLink } from 'lucide-react'
import type { Location } from '../types'
import { listLocationApprovals, setLocationReceiptApproval } from '@/modules/supply/services/supplierCatalogService'

// DashboardPage se ha movido a su propia page: src/pages/DashboardPage.tsx
// Re-exportar aquí para retrocompatibilidad con imports antiguos.
export { DashboardPage } from './DashboardPage'

// ============================================================
// LocationsPage — gestión de locales del cliente
//
// REFACTOR P6 (17/05/2026):
// - Usa `saveLocation` y `removeLocation` del context (persisten en Supabase).
// - YA NO usa `setLocations` (que solo actualizaba state local sin persistir).
//   Eso causaba el bug de "los locales se ven pero F5 los borra" detectado
//   con cliente Llorente29 antes de paso a producción.
// - Patrón onBlur en campos de texto (Nombre, Dirección, Teléfono):
//   editas → al salir del campo se persiste.
// - Patrón inmediato en checkbox (Activo) y botón Eliminar.
// - Feedback visual por local: spinner mientras guarda, ✓ tras éxito,
//   ⚠ rojo si falla.
//
// FIX UBICACIÓN (14/06/2026):
// - La sección de geolocalización ya NO se esconde tras "lat/lng definidos"
//   (condición imposible de cumplir en un local nuevo: sin coordenadas no
//   aparecía, y sin aparecer no se podían poner). Ahora siempre visible.
// - Botón "Usar mi ubicación actual": captura lat/lng por GPS del navegador
//   (sin dependencias ni API key). Pensado para abrirse EN el local.
// ============================================================

// Estado de guardado por local. 'idle' por defecto, otros estados
// duran solo unos segundos para feedback al usuario.
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Buffer de edición local: lo que el usuario está escribiendo antes
// de hacer onBlur. Permite teclear sin disparar peticiones por cada
// pulsación. Solo el Location.id actúa de clave (los buffers son por id).
type EditBuffers = Record<string, Partial<Location>>

export function LocationsPage() {
  const { locations, saveLocation, removeLocation } = useApp()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editBuffers, setEditBuffers] = useState<EditBuffers>({})
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const [errorMessages, setErrorMessages] = useState<Record<string, string>>({})
  // Estado del botón "Usar mi ubicación actual" por local.
  const [gpsState, setGpsState] = useState<Record<string, 'idle' | 'locating' | 'error'>>({})
  const [gpsError, setGpsError] = useState<Record<string, string>>({})

  // Aprobación de recepciones por local (autocontenido, no pasa por el contexto).
  const [approvals, setApprovals] = useState<Record<string, 'trabajador' | 'oficina'>>({})
  const [approvalSaving, setApprovalSaving] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const ids = locations.map(l => l.id)
    if (ids.length === 0) { setApprovals({}); return }
    let cancelled = false
    listLocationApprovals(ids)
      .then(map => { if (!cancelled) setApprovals(map) })
      .catch(() => { /* por defecto 'trabajador' en la UI */ })
    return () => { cancelled = true }
  }, [locations])

  async function changeApproval(locId: string, value: 'trabajador' | 'oficina') {
    setApprovals(prev => ({ ...prev, [locId]: value }))     // optimista
    setApprovalSaving(prev => ({ ...prev, [locId]: true }))
    try {
      await setLocationReceiptApproval(locId, value)
    } catch {
      // revierte si falla
      setApprovals(prev => ({ ...prev, [locId]: value === 'oficina' ? 'trabajador' : 'oficina' }))
    } finally {
      setApprovalSaving(prev => ({ ...prev, [locId]: false }))
    }
  }

  // Helpers para gestionar el feedback visual por local.
  function markSaving(id: string) {
    setSaveStates(prev => ({ ...prev, [id]: 'saving' }))
    setErrorMessages(prev => ({ ...prev, [id]: '' }))
  }

  function markSaved(id: string) {
    setSaveStates(prev => ({ ...prev, [id]: 'saved' }))
    // Limpia el "saved" tras 2 segundos para no ser invasivo
    setTimeout(() => {
      setSaveStates(prev => prev[id] === 'saved' ? { ...prev, [id]: 'idle' } : prev)
    }, 2000)
  }

  function markError(id: string, message: string) {
    setSaveStates(prev => ({ ...prev, [id]: 'error' }))
    setErrorMessages(prev => ({ ...prev, [id]: message }))
  }

  // Crear nuevo local. Persiste inmediato.
  async function addLocation() {
    const newLoc: Location = {
      id: `loc-${Date.now()}`,
      name: 'Nuevo local',
      address: '',
      phone: '',
      active: true,
      hoursBalanceCloseDay: 25,
      hoursBalanceSyncWithGestoria: true,
    }
    markSaving(newLoc.id)
    try {
      await saveLocation(newLoc)
      markSaved(newLoc.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear el local'
      markError(newLoc.id, msg)
    }
  }

  // Actualiza el buffer local (no persiste todavía).
  function updateBuffer(id: string, patch: Partial<Location>) {
    setEditBuffers(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), ...patch },
    }))
  }

  // Devuelve el valor actual (buffer si existe, sino el del location).
  function getCurrentValue<K extends keyof Location>(loc: Location, key: K): Location[K] {
    const buffered = editBuffers[loc.id]?.[key]
    return (buffered ?? loc[key]) as Location[K]
  }

  // Persiste todos los cambios pendientes del buffer de un local.
  // Solo persiste si hay diferencia real respecto a lo que tiene el location.
  async function persistBuffer(loc: Location) {
    const buffer = editBuffers[loc.id]
    if (!buffer) return
    // Construir la versión actualizada
    const updated: Location = { ...loc, ...buffer }
    // Detectar si hay cambios reales (compara claves del buffer)
    const hasChanges = (Object.keys(buffer) as (keyof Location)[]).some(
      k => buffer[k] !== loc[k]
    )
    if (!hasChanges) {
      // Limpia el buffer sin disparar nada
      setEditBuffers(prev => {
        const next = { ...prev }
        delete next[loc.id]
        return next
      })
      return
    }
    markSaving(loc.id)
    try {
      await saveLocation(updated)
      markSaved(loc.id)
      setEditBuffers(prev => {
        const next = { ...prev }
        delete next[loc.id]
        return next
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar'
      markError(loc.id, msg)
    }
  }

  // Cambio inmediato (sin buffer): para checkbox activo y campos config avanzada.
  async function persistImmediate(loc: Location, patch: Partial<Location>) {
    const updated: Location = { ...loc, ...patch }
    markSaving(loc.id)
    try {
      await saveLocation(updated)
      markSaved(loc.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar'
      markError(loc.id, msg)
    }
  }

  // Captura la ubicación actual por GPS del navegador y la persiste.
  // Pensado para abrirse desde un móvil EN el local.
  function captureLocation(loc: Location) {
    if (!('geolocation' in navigator)) {
      setGpsState(prev => ({ ...prev, [loc.id]: 'error' }))
      setGpsError(prev => ({ ...prev, [loc.id]: 'Este dispositivo no permite geolocalización.' }))
      return
    }
    setGpsState(prev => ({ ...prev, [loc.id]: 'locating' }))
    setGpsError(prev => ({ ...prev, [loc.id]: '' }))
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = Number(pos.coords.latitude.toFixed(7))
        const lng = Number(pos.coords.longitude.toFixed(7))
        setGpsState(prev => ({ ...prev, [loc.id]: 'idle' }))
        // Limpia lat/lng del buffer para que se vean los valores recién capturados.
        setEditBuffers(prev => {
          const b = prev[loc.id]
          if (!b) return prev
          const next = { ...b }
          delete next.lat
          delete next.lng
          return { ...prev, [loc.id]: next }
        })
        void persistImmediate(loc, { lat, lng })
      },
      err => {
        setGpsState(prev => ({ ...prev, [loc.id]: 'error' }))
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Permiso de ubicación denegado. Actívalo en el navegador para usar esto.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'No se pudo obtener la ubicación (señal GPS no disponible).'
              : 'Se agotó el tiempo al obtener la ubicación. Inténtalo de nuevo.'
        setGpsError(prev => ({ ...prev, [loc.id]: msg }))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  async function deleteLocation(loc: Location) {
    if (!confirm(`¿Eliminar el local "${loc.name}"? Esta acción es definitiva.`)) return
    markSaving(loc.id)
    try {
      await removeLocation(loc.id)
      // No marcamos saved porque la fila ya no existe
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo eliminar'
      markError(loc.id, msg)
    }
  }

  // Componente local para el indicador de estado de guardado
  function SaveIndicator({ id }: { id: string }) {
    const state = saveStates[id] ?? 'idle'
    const message = errorMessages[id]
    if (state === 'saving') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
          <Loader2 size={12} className="animate-spin" /> Guardando...
        </span>
      )
    }
    if (state === 'saved') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <Check size={12} /> Guardado
        </span>
      )
    }
    if (state === 'error') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-danger" title={message}>
          <AlertCircle size={12} /> Error al guardar
        </span>
      )
    }
    return null
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
          const closeDay = getCurrentValue(loc, 'hoursBalanceCloseDay') ?? 25
          const syncGestoria = getCurrentValue(loc, 'hoursBalanceSyncWithGestoria') ?? true
          return (
            <Card key={loc.id} className="p-4">
              {/* Datos básicos del local */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-text-secondary uppercase font-medium">Nombre</label>
                  <input
                    value={getCurrentValue(loc, 'name')}
                    onChange={e => updateBuffer(loc.id, { name: e.target.value })}
                    onBlur={() => persistBuffer(loc)}
                    className="mt-1 w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary uppercase font-medium">Dirección</label>
                  <input
                    value={getCurrentValue(loc, 'address')}
                    onChange={e => updateBuffer(loc.id, { address: e.target.value })}
                    onBlur={() => persistBuffer(loc)}
                    className="mt-1 w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Calle, número..."
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary uppercase font-medium">Teléfono</label>
                  <input
                    value={getCurrentValue(loc, 'phone')}
                    onChange={e => updateBuffer(loc.id, { phone: e.target.value })}
                    onBlur={() => persistBuffer(loc)}
                    className="mt-1 w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="600000000"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={loc.active}
                      onChange={e => persistImmediate(loc, { active: e.target.checked })}
                      className="accent-accent"
                    />
                    <span className="text-sm text-text-primary">Activo</span>
                  </div>
                  <button
                    onClick={() => deleteLocation(loc)}
                    className="mb-2 px-3 py-1.5 text-xs text-danger border border-danger/30 rounded-md hover:bg-danger-bg transition-base"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Indicador de estado de guardado */}
              <div className="mt-2 min-h-[16px]">
                <SaveIndicator id={loc.id} />
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
                          onChange={e => persistImmediate(loc, { hoursBalanceSyncWithGestoria: e.target.checked })}
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
                              updateBuffer(loc.id, { hoursBalanceCloseDay: clamped })
                            }}
                            onBlur={() => persistBuffer(loc)}
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

                    {/* Ubicación del local (para el fichaje por GPS) — siempre visible */}
                    <div className="bg-page rounded-md p-3">
                      <p className="text-xs font-semibold mb-1 inline-flex items-center gap-1.5 text-text-primary">
                        <MapPin size={14} /> Ubicación del local (fichaje por GPS)
                      </p>
                      <p className="text-xs text-text-secondary mb-3">
                        Abre esta pantalla en un móvil <strong>desde el local</strong> y pulsa el botón para
                        fijar su posición. También puedes pegar las coordenadas de Google Maps.
                      </p>

                      <button
                        onClick={() => captureLocation(loc)}
                        disabled={gpsState[loc.id] === 'locating'}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-accent text-accent hover:bg-accent/10 transition-base disabled:opacity-60"
                      >
                        {gpsState[loc.id] === 'locating'
                          ? <><Loader2 size={14} className="animate-spin" /> Obteniendo ubicación…</>
                          : <><Navigation size={14} /> Usar mi ubicación actual</>
                        }
                      </button>

                      {gpsState[loc.id] === 'error' && gpsError[loc.id] && (
                        <p className="mt-2 text-xs text-danger inline-flex items-start gap-1.5">
                          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {gpsError[loc.id]}
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <div>
                          <label className="text-xs text-text-secondary uppercase font-medium">Latitud</label>
                          <input
                            type="number"
                            step="any"
                            value={getCurrentValue(loc, 'lat') ?? ''}
                            onChange={e => updateBuffer(loc.id, { lat: e.target.value ? parseFloat(e.target.value) : undefined })}
                            onBlur={() => persistBuffer(loc)}
                            className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            placeholder="40.4345672"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-text-secondary uppercase font-medium">Longitud</label>
                          <input
                            type="number"
                            step="any"
                            value={getCurrentValue(loc, 'lng') ?? ''}
                            onChange={e => updateBuffer(loc.id, { lng: e.target.value ? parseFloat(e.target.value) : undefined })}
                            onBlur={() => persistBuffer(loc)}
                            className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            placeholder="-3.6528093"
                          />
                        </div>
                      </div>

                      {getCurrentValue(loc, 'lat') != null && getCurrentValue(loc, 'lng') != null && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${getCurrentValue(loc, 'lat')},${getCurrentValue(loc, 'lng')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                        >
                          <ExternalLink size={12} /> Ver el punto en Google Maps
                        </a>
                      )}

                      <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-border-default">
                        <div>
                          <label className="text-xs text-text-secondary uppercase font-medium">Radio de fichaje (m)</label>
                          <input
                            type="number"
                            min={20}
                            step={10}
                            value={getCurrentValue(loc, 'clockRadiusM') ?? 200}
                            onChange={e => updateBuffer(loc.id, { clockRadiusM: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                            onBlur={() => persistBuffer(loc)}
                            className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            placeholder="200"
                          />
                          <p className="text-[11px] text-text-tertiary mt-1">Distancia para considerar que el trabajador está en el local.</p>
                        </div>
                        <div>
                          <label className="text-xs text-text-secondary uppercase font-medium">Si está fuera del radio</label>
                          <select
                            value={getCurrentValue(loc, 'clockGeofenceMode') ?? 'block'}
                            onChange={e => persistImmediate(loc, { clockGeofenceMode: e.target.value as 'block' | 'warn' })}
                            className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            <option value="block">Bloquear el fichaje</option>
                            <option value="warn">Permitir y avisar</option>
                          </select>
                          <p className="text-[11px] text-text-tertiary mt-1">"Permitir y avisar" deja fichar aunque el GPS falle, marcando la distancia para revisión.</p>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-border-default">
                        <label className="text-xs text-text-secondary uppercase font-medium flex items-center gap-1.5">
                          <Check size={14} /> Confirmación de recepciones
                        </label>
                        <select
                          value={approvals[loc.id] ?? 'trabajador'}
                          onChange={e => changeApproval(loc.id, e.target.value as 'trabajador' | 'oficina')}
                          disabled={approvalSaving[loc.id]}
                          className="mt-1 w-full border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                        >
                          <option value="trabajador">La confirma el trabajador</option>
                          <option value="oficina">La confirma la oficina</option>
                        </select>
                        <p className="text-[11px] text-text-tertiary mt-1">
                          "La oficina" hace que el trabajador deje la recepción en borrador; la oficina la revisa y confirma desde Folvy Supply → Recepciones.
                        </p>
                      </div>
                    </div>
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
