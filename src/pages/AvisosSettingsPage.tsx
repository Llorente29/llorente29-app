// src/pages/AvisosSettingsPage.tsx
// Configuración global de avisos y settings de Personal.
import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Button } from '../components/ui'
import { fetchAppSettings, updateAppSettings, type AppSettings } from '../services/appSettingsService'
import { fetchShiftTypes } from '../services/calendarService'
import { supabase } from '../lib/supabase'

export default function AvisosSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Estado local del formulario
  const [showHourBank, setShowHourBank] = useState(false)
  const [tolerance, setTolerance] = useState(8)
  const [lateAlert, setLateAlert] = useState(15)
  const [forgotMin, setForgotMin] = useState(30)

  useEffect(() => {
    fetchAppSettings().then(s => {
      setSettings(s)
      setShowHourBank(s.showHourBankToEmployee)
      setTolerance(s.roundingToleranceMin)
      setLateAlert(s.lateAlertMin)
      setForgotMin(s.forgotClockoutMin)
      setLoading(false)
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

  const isDirty = settings && (
    settings.showHourBankToEmployee !== showHourBank ||
    settings.roundingToleranceMin !== tolerance ||
    settings.lateAlertMin !== lateAlert ||
    settings.forgotClockoutMin !== forgotMin
  )

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

      {/* Calendario: mínimos por turno */}
      <MinimumsSection />

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

      {/* Notificaciones (placeholder) */}
      <Card className="p-5 opacity-60">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Notificaciones</p>
        <h3 className="font-semibold text-text-primary mb-2">Push, Email y WhatsApp</h3>
        <p className="text-xs text-text-secondary">
          Próximamente. Las alertas push del navegador, emails automáticos y avisos por WhatsApp se configurarán aquí.
        </p>
      </Card>

      {/* Guardar */}
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

// ─── MinimumsSection ──────────────────────────────────────────────────────

interface MinimumRowState {
  shiftTypeId: string
  shiftCode: string
  shiftLabel: string
  shiftColor: string
  minDefault: number
  minWeekend: number
}

function MinimumsSection() {
  const { locations } = useApp()
  const [scope, setScope] = useState<string>('global')   // 'global' o id de local
  const [rows, setRows] = useState<MinimumRowState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    const types = await fetchShiftTypes()
    if (!supabase) { setLoading(false); return }
    const { data } = await supabase.from('shift_minimums').select('*')
    const all = (data || []) as Array<{ shift_type_id: string; location_id: string | null; min_default: number; min_weekend: number | null }>

    // Construir filas: una por shift_type no off
    const newRows: MinimumRowState[] = []
    for (const t of types.filter(t => !t.isOff)) {
      // Buscar primero la específica del scope
      const targetLoc = scope === 'global' ? null : scope
      const localMin = all.find(m => m.shift_type_id === t.id && m.location_id === targetLoc)
      const globalMin = all.find(m => m.shift_type_id === t.id && m.location_id === null)
      const m = localMin || globalMin
      newRows.push({
        shiftTypeId: t.id,
        shiftCode: t.code,
        shiftLabel: t.label,
        shiftColor: t.color,
        minDefault: m?.min_default ?? 1,
        minWeekend: m?.min_weekend ?? m?.min_default ?? 1,
      })
    }
    setRows(newRows)
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-line */ }, [scope])

  async function save() {
    if (!supabase) return
    setSaving(true)
    const targetLoc = scope === 'global' ? null : scope
    for (const r of rows) {
      // Upsert por (location_id, shift_type_id)
      const { data: existing } = await supabase.from('shift_minimums')
        .select('id')
        .eq('shift_type_id', r.shiftTypeId)
        .is('location_id', targetLoc as null)
        .maybeSingle()
      if (existing) {
        await supabase.from('shift_minimums').update({
          min_default: r.minDefault,
          min_weekend: r.minWeekend,
          updated_at: new Date().toISOString(),
        }).eq('id', (existing as { id: string }).id)
      } else {
        await supabase.from('shift_minimums').insert({
          location_id: targetLoc,
          shift_type_id: r.shiftTypeId,
          min_default: r.minDefault,
          min_weekend: r.minWeekend,
        })
      }
    }
    setSaving(false)
    setSavedAt(new Date())
    setTimeout(() => setSavedAt(null), 3000)
  }

  function update(idx: number, patch: Partial<MinimumRowState>) {
    setRows(prev => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], ...patch }
      return copy
    })
  }

  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Calendario</p>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h3 className="font-semibold text-text-primary">Mínimos de plantilla por turno</h3>
        <select value={scope} onChange={e => setScope(e.target.value)}
          className="text-xs border border-border-default rounded-lg px-3 py-1.5 bg-card">
          <option value="global">Por defecto (todos los locales)</option>
          {locations.filter(l => l.active).map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-text-secondary mb-3">
        Cuántas personas deben estar asignadas a cada turno. Si la cobertura es menor saltará un aviso al gestor en el calendario.
      </p>

      {loading ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default">
              <th className="text-left py-2 text-xs font-medium text-text-secondary uppercase">Turno</th>
              <th className="text-center py-2 text-xs font-medium text-text-secondary uppercase">Por defecto</th>
              <th className="text-center py-2 text-xs font-medium text-text-secondary uppercase">V/S/D</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.shiftTypeId} className="border-b border-border-default">
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded" style={{ backgroundColor: r.shiftColor }} />
                    <span className="font-semibold text-text-primary">{r.shiftCode}</span>
                    <span className="text-xs text-text-secondary">{r.shiftLabel}</span>
                  </span>
                </td>
                <td className="py-2 text-center">
                  <input type="number" min={0} max={20} value={r.minDefault}
                    onChange={e => update(i, { minDefault: parseInt(e.target.value) || 0 })}
                    className="w-16 border border-border-default rounded px-2 py-1 text-center text-sm bg-card text-text-primary" />
                </td>
                <td className="py-2 text-center">
                  <input type="number" min={0} max={20} value={r.minWeekend}
                    onChange={e => update(i, { minWeekend: parseInt(e.target.value) || 0 })}
                    className="w-16 border border-border-default rounded px-2 py-1 text-center text-sm bg-card text-text-primary" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between pt-3 mt-3 border-t border-border-default">
        <p className="text-xs text-text-secondary inline-flex items-center gap-1">
          {savedAt ? <><CheckCircle2 size={12} className="text-success" /> Guardado a las {savedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</> : ''}
        </p>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar mínimos'}
        </Button>
      </div>
    </Card>
  )
}
