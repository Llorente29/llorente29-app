// src/pages/AvisosSettingsPage.tsx
// Configuración global de avisos y settings de Personal + Aviso al cliente (reparto).
import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Card, Button } from '../components/ui'
import { fetchAppSettings, updateAppSettings, type AppSettings } from '../services/appSettingsService'
import { supabase } from '../lib/supabase'

// Helper: llamada RPC sin tipos (el cliente supabase no tiene el esquema tipado aqui).
async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }> {
  if (!supabase) return { data: null, error: { message: 'Supabase no configurado' } }
  return await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>)(fn, args)
}

interface RepartoLoc { id: string; name: string; notify: boolean }

export default function AvisosSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Estado local del formulario (Personal)
  const [showHourBank, setShowHourBank] = useState(false)
  const [tolerance, setTolerance] = useState(8)
  const [lateAlert, setLateAlert] = useState(15)
  const [forgotMin, setForgotMin] = useState(30)

  // Estado: aviso al cliente por WhatsApp (reparto)
  const [locs, setLocs] = useState<RepartoLoc[]>([])
  const [trackUrl, setTrackUrl] = useState('')
  const [trackUrlSaved, setTrackUrlSaved] = useState('')
  const [savingDomain, setSavingDomain] = useState(false)
  const [domainOk, setDomainOk] = useState(false)

  useEffect(() => {
    fetchAppSettings().then(s => {
      setSettings(s)
      setShowHourBank(s.showHourBankToEmployee)
      setTolerance(s.roundingToleranceMin)
      setLateAlert(s.lateAlertMin)
      setForgotMin(s.forgotClockoutMin)
      setLoading(false)
    })
    // Ajustes de reparto (aviso al cliente)
    rpc<{ track_base_url: string | null; locations: RepartoLoc[] }>('reparto_settings', {}).then(({ data }) => {
      if (!data) return
      setLocs(data.locations ?? [])
      setTrackUrl(data.track_base_url ?? '')
      setTrackUrlSaved(data.track_base_url ?? '')
    })
  }, [])

  async function save() {
    setSaving(true)
    const ok = await updateAppSettings({
      showHourBankToEmployee: showHourBank,
      roundingToleranceMin: tolerance,
      lateAlertMin: lateAlert,
      forgotClockoutMin: forgotMin,
    })
    setSaving(false)
    if (ok) {
      setSavedAt(new Date())
      setTimeout(() => setSavedAt(null), 3000)
    }
  }

  // Toggle de aviso por local: guarda al instante (optimista, revierte si falla).
  async function toggleLoc(id: string, next: boolean) {
    setLocs(prev => prev.map(l => l.id === id ? { ...l, notify: next } : l))
    const { error } = await rpc('set_customer_notify', { p_location_id: id, p_enabled: next })
    if (error) {
      setLocs(prev => prev.map(l => l.id === id ? { ...l, notify: !next } : l))
      alert('No se pudo guardar el aviso de este local: ' + error.message)
    }
  }

  async function saveDomain() {
    setSavingDomain(true)
    const { error } = await rpc('set_track_base_url', { p_url: trackUrl })
    setSavingDomain(false)
    if (!error) {
      setTrackUrlSaved(trackUrl)
      setDomainOk(true); setTimeout(() => setDomainOk(false), 3000)
    } else {
      alert('No se pudo guardar el dominio: ' + error.message)
    }
  }

  const isDirty = settings && (
    settings.showHourBankToEmployee !== showHourBank ||
    settings.roundingToleranceMin !== tolerance ||
    settings.lateAlertMin !== lateAlert ||
    settings.forgotClockoutMin !== forgotMin
  )
  const domainDirty = trackUrl.trim() !== (trackUrlSaved ?? '').trim()

  if (loading) {
    return <Card className="p-6 text-center"><p className="text-sm text-text-secondary">Cargando...</p></Card>
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Personal: Bolsa de horas */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Personal</p>
        <h3 className="font-semibold text-text-primary mb-4">Bolsa de horas</h3>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showHourBank}
            onChange={e => setShowHourBank(e.target.checked)}
            className="mt-1 w-4 h-4 accent-accent"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">Mostrar la bolsa de horas a los trabajadores</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Si activas esta opción, cada trabajador podrá ver su saldo de horas (semanal, mensual y acumulado) desde su móvil personal.
            </p>
          </div>
        </label>
      </Card>

      {/* Personal: Fichajes */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Fichajes</p>
        <h3 className="font-semibold text-text-primary mb-4">Tolerancia y alertas</h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Tolerancia de redondeo (minutos)</label>
            <p className="text-xs text-text-secondary mb-2">
              Si el fichaje cae dentro de esta franja respecto al horario teórico, se redondea automáticamente. La hora real siempre se registra para auditoría.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={60} value={tolerance}
                onChange={e => setTolerance(parseInt(e.target.value) || 0)}
                className="w-20 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
              />
              <span className="text-xs text-text-secondary">min</span>
              <span className="text-xs text-text-secondary">(recomendado: 8)</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Alerta por retraso</label>
            <p className="text-xs text-text-secondary mb-2">
              Tiempo desde la hora teórica de entrada para considerar que el empleado no ha fichado y mostrar alerta en "Ahora mismo".
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={120} value={lateAlert}
                onChange={e => setLateAlert(parseInt(e.target.value) || 0)}
                className="w-20 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
              />
              <span className="text-xs text-text-secondary">min</span>
              <span className="text-xs text-text-secondary">(recomendado: 15)</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Alerta por olvido de salida</label>
            <p className="text-xs text-text-secondary mb-2">
              Tiempo desde la hora teórica de salida para suponer que el empleado olvidó fichar la salida.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={240} value={forgotMin}
                onChange={e => setForgotMin(parseInt(e.target.value) || 0)}
                className="w-20 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
              />
              <span className="text-xs text-text-secondary">min</span>
              <span className="text-xs text-text-secondary">(recomendado: 30)</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Aviso al cliente por WhatsApp (reparto propio) */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Reparto propio</p>
        <h3 className="font-semibold text-text-primary mb-1">Aviso al cliente por WhatsApp</h3>
        <p className="text-xs text-text-secondary mb-4">
          Cuando un pedido de reparto propio sale "en camino", el cliente recibe un WhatsApp con el enlace de seguimiento en vivo. Actívalo en los locales que quieras.
        </p>

        {/* Dominio del enlace de seguimiento */}
        <div className="mb-5">
          <label className="text-sm font-medium text-text-primary block mb-1">Dominio del enlace de seguimiento</label>
          <p className="text-xs text-text-secondary mb-2">
            La dirección del enlace <span className="font-mono">/seguir</span> que recibe el cliente. Déjalo vacío para el predeterminado, o pon tu dominio propio.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text" value={trackUrl} onChange={e => setTrackUrl(e.target.value)}
              placeholder="https://foodint.es"
              className="flex-1 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
            />
            <Button onClick={saveDomain} disabled={!domainDirty || savingDomain}>
              {savingDomain ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
          {domainOk && (
            <p className="text-xs text-success inline-flex items-center gap-1 mt-2">
              <CheckCircle2 size={12} /> Dominio guardado
            </p>
          )}
        </div>

        {/* Toggle por local */}
        <p className="text-sm font-medium text-text-primary mb-1">Locales</p>
        {locs.length === 0 ? (
          <p className="text-xs text-text-secondary">No hay locales.</p>
        ) : (
          <div>
            {locs.map(l => (
              <label key={l.id} className="flex items-center justify-between gap-3 py-2.5 border-t border-border-default cursor-pointer">
                <span className="text-sm text-text-primary">{l.name}</span>
                <input
                  type="checkbox" checked={l.notify}
                  onChange={e => toggleLoc(l.id, e.target.checked)}
                  className="w-4 h-4 accent-accent"
                />
              </label>
            ))}
          </div>
        )}
      </Card>

      {/* Guardar (Personal) */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-text-secondary inline-flex items-center gap-1">
          {savedAt
            ? <><CheckCircle2 size={12} className="text-success" /> Guardado a las {savedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>
            : isDirty ? 'Cambios sin guardar' : ''}
        </p>
        <Button onClick={save} disabled={!isDirty || saving}>
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  )
}
