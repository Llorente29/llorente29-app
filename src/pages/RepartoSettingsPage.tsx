// src/pages/RepartoSettingsPage.tsx
// Configuración del reparto (dispatcher). Todo en una pantalla:
//  A) Enlace de seguimiento (dominio)   B) Por local (modo/transportista/aviso)
//  C) Reglas de despacho (con margen)   D) Flota propia (repartidores)   E) Zonas (enlace)
import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, Plus, Trash2, Pencil, X } from 'lucide-react'
import { Card, Button } from '../components/ui'
import { supabase } from '../lib/supabase'

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }> {
  if (!supabase) return { data: null, error: { message: 'Supabase no configurado' } }
  return await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>)(fn, args)
}

interface Loc { id: string; name: string; mode: string; broker: string; notify: boolean }
interface Rule {
  id?: string; priority?: number; location_id?: string | null; weekdays?: number[] | null
  time_from?: string | null; time_to?: string | null; min_total?: number | null; max_total?: number | null
  margin_floor_pct?: number | null; then_carrier?: string | null; fallback_carrier?: string | null
  strategy?: string | null; is_active?: boolean
}
interface Courier {
  id?: string; name?: string; phone?: string | null; transport_type?: string | null
  assigned_locations?: string[] | null; cost_model?: string | null; cost_value?: number | null
  active?: boolean; on_shift?: boolean
}

const CARRIERS: Record<string, string> = { catcher: 'Catcher', own_fleet: 'Flota propia' }
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] // 0=Lunes..6=Domingo (convención Folvy)

export default function RepartoSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [locs, setLocs] = useState<Loc[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [trackUrl, setTrackUrl] = useState('')
  const [trackUrlSaved, setTrackUrlSaved] = useState('')
  const [savingDomain, setSavingDomain] = useState(false)
  const [domainOk, setDomainOk] = useState(false)
  const [editRule, setEditRule] = useState<Rule | null>(null)
  const [editCourier, setEditCourier] = useState<Courier | null>(null)

  const reload = useCallback(async () => {
    const { data } = await rpc<{ track_base_url: string | null; locations: Loc[]; rules: Rule[]; couriers: Courier[] }>('reparto_settings', {})
    if (!data) return
    setLocs(data.locations ?? [])
    setRules(data.rules ?? [])
    setCouriers(data.couriers ?? [])
    setTrackUrl(data.track_base_url ?? '')
    setTrackUrlSaved(data.track_base_url ?? '')
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  // ── A) Dominio ─────────────────────────────────────────────────────────
  async function saveDomain() {
    setSavingDomain(true)
    const { error } = await rpc('set_track_base_url', { p_url: trackUrl })
    setSavingDomain(false)
    if (!error) { setTrackUrlSaved(trackUrl); setDomainOk(true); setTimeout(() => setDomainOk(false), 3000) }
    else alert('No se pudo guardar el dominio: ' + error.message)
  }

  // ── B) Por local ───────────────────────────────────────────────────────
  async function saveLoc(id: string, patch: Partial<Loc>) {
    const before = locs.find(l => l.id === id)
    setLocs(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    let error = null
    if ('notify' in patch) ({ error } = await rpc('set_customer_notify', { p_location_id: id, p_enabled: patch.notify }))
    else ({ error } = await rpc('set_location_dispatch', { p_location_id: id, p_mode: patch.mode ?? before?.mode, p_broker: patch.broker ?? before?.broker }))
    if (error) { setLocs(prev => prev.map(l => l.id === id ? { ...l, ...before } : l)); alert('No se pudo guardar: ' + error.message) }
  }

  // ── C) Reglas ──────────────────────────────────────────────────────────
  async function saveRule() {
    if (!editRule) return
    const { error } = await rpc('upsert_dispatch_rule', { p: editRule })
    if (error) { alert('No se pudo guardar la regla: ' + error.message); return }
    setEditRule(null); await reload()
  }
  async function removeRule(id?: string) {
    if (!id || !confirm('¿Eliminar esta regla?')) return
    const { error } = await rpc('delete_dispatch_rule', { p_id: id })
    if (error) { alert('No se pudo eliminar: ' + error.message); return }
    await reload()
  }

  // ── D) Flota ───────────────────────────────────────────────────────────
  async function saveCourier() {
    if (!editCourier || !editCourier.name) { alert('El repartidor necesita un nombre'); return }
    const { error } = await rpc('upsert_courier', { p: editCourier })
    if (error) { alert('No se pudo guardar el repartidor: ' + error.message); return }
    setEditCourier(null); await reload()
  }
  async function toggleCourier(c: Courier, field: 'active' | 'on_shift', v: boolean) {
    const { error } = await rpc('upsert_courier', { p: { ...c, [field]: v } })
    if (error) { alert('No se pudo guardar: ' + error.message); return }
    await reload()
  }

  const domainDirty = trackUrl.trim() !== (trackUrlSaved ?? '').trim()
  const locName = (id?: string | null) => locs.find(l => l.id === id)?.name ?? 'Todos los locales'
  const input = 'border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary'

  if (loading) return <Card className="p-6 text-center"><p className="text-sm text-text-secondary">Cargando...</p></Card>

  return (
    <div className="space-y-4 max-w-3xl">
      {/* A) Enlace de seguimiento */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Seguimiento</p>
        <h3 className="font-semibold text-text-primary mb-1">Dominio del enlace de seguimiento</h3>
        <p className="text-xs text-text-secondary mb-2">La dirección del enlace <span className="font-mono">/seguir</span> que recibe el cliente por WhatsApp. Vacío = predeterminado.</p>
        <div className="flex items-center gap-2">
          <input type="text" value={trackUrl} onChange={e => setTrackUrl(e.target.value)} placeholder="https://foodint.es" className={`flex-1 ${input}`} />
          <Button onClick={saveDomain} disabled={!domainDirty || savingDomain}>{savingDomain ? 'Guardando...' : 'Guardar'}</Button>
        </div>
        {domainOk && <p className="text-xs text-success inline-flex items-center gap-1 mt-2"><CheckCircle2 size={12} /> Guardado</p>}
      </Card>

      {/* B) Por local */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Por local</p>
        <h3 className="font-semibold text-text-primary mb-4">Modo, transportista y aviso</h3>
        <div className="space-y-3">
          {locs.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 border-t border-border-default pt-3">
              <span className="text-sm font-medium text-text-primary flex-1 min-w-[140px]">{l.name}</span>
              <label className="text-xs text-text-secondary">Modo
                <select value={l.mode} onChange={e => saveLoc(l.id, { mode: e.target.value })} className={`ml-1 ${input} py-1`}>
                  <option value="auto">Automático</option><option value="manual">Manual</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary">Transportista
                <select value={l.broker} onChange={e => saveLoc(l.id, { broker: e.target.value })} className={`ml-1 ${input} py-1`}>
                  <option value="catcher">Catcher</option><option value="own_fleet">Flota propia</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={l.notify} onChange={e => saveLoc(l.id, { notify: e.target.checked })} className="w-4 h-4 accent-accent" />
                Aviso WhatsApp
              </label>
            </div>
          ))}
        </div>
      </Card>

      {/* C) Reglas de despacho */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Reglas de despacho</p>
            <h3 className="font-semibold text-text-primary">Quién reparte, según franja, importe y margen</h3>
          </div>
          <Button onClick={() => setEditRule({ priority: (rules.length + 1) * 10, then_carrier: 'own_fleet', fallback_carrier: 'catcher', is_active: true })}>
            <Plus size={15} className="inline -mt-0.5 mr-1" />Regla
          </Button>
        </div>
        <p className="text-xs text-text-secondary mb-3">Se evalúan por prioridad (menor primero). Sin reglas → transportista por defecto del local. <b>El margen mínimo protege que un reparto no se coma la rentabilidad del pedido</b> — nadie más lo cruza.</p>

        {rules.length === 0 ? <p className="text-xs text-text-secondary">Aún no hay reglas.</p> : (
          <div className="space-y-2">
            {rules.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-sm border-t border-border-default pt-2">
                <span className="text-xs font-mono text-text-secondary w-8">#{r.priority}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary truncate">
                    {locName(r.location_id)} · {(r.time_from && r.time_to) ? `${r.time_from}-${r.time_to}` : 'todo el día'}
                    {(r.min_total != null || r.max_total != null) ? ` · ${r.min_total ?? 0}–${r.max_total ?? '∞'}€` : ''}
                    {r.margin_floor_pct != null ? ` · margen ≥${r.margin_floor_pct}%` : ''}
                  </p>
                  <p className="text-xs text-text-secondary">→ {CARRIERS[r.then_carrier ?? ''] ?? r.then_carrier}{r.fallback_carrier ? ` (si no, ${CARRIERS[r.fallback_carrier] ?? r.fallback_carrier})` : ''}{!r.is_active ? ' · inactiva' : ''}</p>
                </div>
                <button onClick={() => setEditRule(r)} className="text-text-secondary hover:text-text-primary p-1"><Pencil size={15} /></button>
                <button onClick={() => removeRule(r.id)} className="text-danger hover:opacity-80 p-1"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}

        {editRule && (
          <div className="mt-4 border border-border-default rounded-xl p-4 bg-card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{editRule.id ? 'Editar regla' : 'Nueva regla'}</p>
              <button onClick={() => setEditRule(null)} className="text-text-secondary"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-secondary">Prioridad<input type="number" value={editRule.priority ?? ''} onChange={e => setEditRule({ ...editRule, priority: parseInt(e.target.value) || 0 })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Local
                <select value={editRule.location_id ?? ''} onChange={e => setEditRule({ ...editRule, location_id: e.target.value || null })} className={`block mt-1 w-full ${input}`}>
                  <option value="">Todos</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-secondary">Desde<input type="time" value={editRule.time_from ?? ''} onChange={e => setEditRule({ ...editRule, time_from: e.target.value || null })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Hasta<input type="time" value={editRule.time_to ?? ''} onChange={e => setEditRule({ ...editRule, time_to: e.target.value || null })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Importe mín (€)<input type="number" value={editRule.min_total ?? ''} onChange={e => setEditRule({ ...editRule, min_total: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Importe máx (€)<input type="number" value={editRule.max_total ?? ''} onChange={e => setEditRule({ ...editRule, max_total: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Margen mínimo (%)<input type="number" value={editRule.margin_floor_pct ?? ''} onChange={e => setEditRule({ ...editRule, margin_floor_pct: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} /></label>
              <div />
              <label className="text-xs text-text-secondary">Transportista
                <select value={editRule.then_carrier ?? ''} onChange={e => setEditRule({ ...editRule, then_carrier: e.target.value })} className={`block mt-1 w-full ${input}`}>
                  <option value="own_fleet">Flota propia</option><option value="catcher">Catcher</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary">Si no hay → fallback
                <select value={editRule.fallback_carrier ?? ''} onChange={e => setEditRule({ ...editRule, fallback_carrier: e.target.value || null })} className={`block mt-1 w-full ${input}`}>
                  <option value="">—</option><option value="catcher">Catcher</option><option value="own_fleet">Flota propia</option>
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary">Días:</span>
              {DOW.map((d, i) => {
                const on = editRule.weekdays?.includes(i) ?? false
                return <button key={i} type="button" onClick={() => {
                  const cur = new Set(editRule.weekdays ?? [])
                  if (on) cur.delete(i); else cur.add(i)
                  setEditRule({ ...editRule, weekdays: cur.size ? Array.from(cur).sort() : null })
                }} className={`w-7 h-7 rounded-full text-xs font-bold ${on ? 'bg-accent text-white' : 'bg-card border border-border-default text-text-secondary'}`}>{d}</button>
              })}
              <span className="text-[11px] text-text-secondary ml-1">(vacío = todos)</span>
            </div>
            <label className="text-xs text-text-secondary inline-flex items-center gap-1.5"><input type="checkbox" checked={editRule.is_active ?? true} onChange={e => setEditRule({ ...editRule, is_active: e.target.checked })} className="w-4 h-4 accent-accent" /> Activa</label>
            <div className="flex justify-end gap-2 pt-1"><Button onClick={saveRule}>Guardar regla</Button></div>
          </div>
        )}
      </Card>

      {/* D) Flota propia */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Flota propia</p>
            <h3 className="font-semibold text-text-primary">Repartidores</h3>
          </div>
          <Button onClick={() => setEditCourier({ transport_type: 'moto', cost_model: 'per_delivery', active: true, on_shift: false, assigned_locations: [] })}>
            <Plus size={15} className="inline -mt-0.5 mr-1" />Repartidor
          </Button>
        </div>
        {couriers.length === 0 ? <p className="text-xs text-text-secondary">Aún no hay repartidores en flota propia.</p> : (
          <div className="space-y-2">
            {couriers.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm border-t border-border-default pt-2">
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary truncate">{c.name} <span className="text-xs text-text-secondary">· {c.transport_type ?? ''}{c.cost_value != null ? ` · ${c.cost_value}€ ${c.cost_model === 'per_hour' ? '/h' : '/entrega'}` : ''}</span></p>
                  <p className="text-xs text-text-secondary">{(c.assigned_locations?.length ?? 0) === 0 ? 'Todos los locales' : c.assigned_locations!.map(locName).join(', ')}</p>
                </div>
                <label className="text-[11px] text-text-secondary inline-flex items-center gap-1"><input type="checkbox" checked={!!c.on_shift} onChange={e => toggleCourier(c, 'on_shift', e.target.checked)} className="w-4 h-4 accent-accent" />En turno</label>
                <label className="text-[11px] text-text-secondary inline-flex items-center gap-1"><input type="checkbox" checked={!!c.active} onChange={e => toggleCourier(c, 'active', e.target.checked)} className="w-4 h-4 accent-accent" />Activo</label>
                <button onClick={() => setEditCourier(c)} className="text-text-secondary hover:text-text-primary p-1"><Pencil size={15} /></button>
              </div>
            ))}
          </div>
        )}
        {editCourier && (
          <div className="mt-4 border border-border-default rounded-xl p-4 bg-card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{editCourier.id ? 'Editar repartidor' : 'Nuevo repartidor'}</p>
              <button onClick={() => setEditCourier(null)} className="text-text-secondary"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-secondary">Nombre<input type="text" value={editCourier.name ?? ''} onChange={e => setEditCourier({ ...editCourier, name: e.target.value })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Teléfono<input type="text" value={editCourier.phone ?? ''} onChange={e => setEditCourier({ ...editCourier, phone: e.target.value })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Vehículo
                <select value={editCourier.transport_type ?? 'moto'} onChange={e => setEditCourier({ ...editCourier, transport_type: e.target.value })} className={`block mt-1 w-full ${input}`}>
                  <option value="moto">Moto</option><option value="bici">Bici</option><option value="coche">Coche</option><option value="pie">A pie</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary">Coste
                <div className="flex gap-1 mt-1">
                  <input type="number" value={editCourier.cost_value ?? ''} onChange={e => setEditCourier({ ...editCourier, cost_value: e.target.value === '' ? null : Number(e.target.value) })} className={`w-20 ${input}`} placeholder="€" />
                  <select value={editCourier.cost_model ?? 'per_delivery'} onChange={e => setEditCourier({ ...editCourier, cost_model: e.target.value })} className={input}>
                    <option value="per_delivery">/entrega</option><option value="per_hour">/hora</option>
                  </select>
                </div>
              </label>
            </div>
            <div>
              <p className="text-xs text-text-secondary mb-1">Locales asignados (vacío = todos)</p>
              <div className="flex flex-wrap gap-2">
                {locs.map(l => {
                  const on = editCourier.assigned_locations?.includes(l.id) ?? false
                  return <button key={l.id} type="button" onClick={() => {
                    const cur = new Set(editCourier.assigned_locations ?? [])
                    if (on) cur.delete(l.id); else cur.add(l.id)
                    setEditCourier({ ...editCourier, assigned_locations: Array.from(cur) })
                  }} className={`px-3 py-1 rounded-full text-xs font-medium ${on ? 'bg-accent text-white' : 'bg-card border border-border-default text-text-secondary'}`}>{l.name}</button>
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="text-xs text-text-secondary inline-flex items-center gap-1.5"><input type="checkbox" checked={editCourier.active ?? true} onChange={e => setEditCourier({ ...editCourier, active: e.target.checked })} className="w-4 h-4 accent-accent" /> Activo</label>
              <label className="text-xs text-text-secondary inline-flex items-center gap-1.5"><input type="checkbox" checked={editCourier.on_shift ?? false} onChange={e => setEditCourier({ ...editCourier, on_shift: e.target.checked })} className="w-4 h-4 accent-accent" /> En turno</label>
            </div>
            <div className="flex justify-end gap-2 pt-1"><Button onClick={saveCourier}>Guardar repartidor</Button></div>
          </div>
        )}
      </Card>

      {/* E) Zonas (enlace) */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Zonas de reparto</p>
        <p className="text-sm text-text-secondary">Las zonas (área, tarifa de envío y mínimo de pedido) se gestionan en <b>Ventas → Zonas</b>. Las reglas de arriba pueden apoyarse en ellas.</p>
      </Card>
    </div>
  )
}
