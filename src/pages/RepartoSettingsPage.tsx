// src/pages/RepartoSettingsPage.tsx
// Configuración del reparto (dispatcher). Todo en una pantalla:
//  A) Enlace de seguimiento (dominio)   B) Por local (modo/transportista/aviso)
//  C) Reglas de despacho (cadena + margen)   D) Flota propia (repartidores)   E) Zonas (enlace)
//
// MULTI-TENANT: los TRANSPORTISTAS no se hardcodean. La lista `carriers` la da la
// RPC reparto_settings desde los conectores de logística CONECTADOS por la cuenta
// (+ Flota propia). El cliente 2 verá los suyos (Jelp, Uber Direct, Shipday…), no
// los de nadie más.
//
// CFG-1: cada regla lleva una CADENA de transportistas por orden de prioridad
// (p.ej. Flota propia → Catcher → Jelp). El motor prueba el 1º; si no puede
// (sin repartidor en turno o más lejos del tope de km), pasa al siguiente.
import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, Plus, Trash2, Pencil, X, ChevronUp, ChevronDown, Copy, Link2, RefreshCw } from 'lucide-react'
import { Card, Button } from '../components/ui'
import { supabase } from '../lib/supabase'

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }> {
  if (!supabase) return { data: null, error: { message: 'Supabase no configurado' } }
  return await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>)(fn, args)
}

interface Loc {
  id: string; name: string; mode: string; broker: string | null; notify: boolean
  bonus_rain_pct?: number | null; bonus_demand_max_pct?: number | null
  bonus_combined_cap_pct?: number | null; weather_is_raining?: boolean | null
  weather_auto?: boolean | null; surge_pct?: number | null
}
interface Carrier { code: string; name: string }
interface Rule {
  id?: string; priority?: number; location_id?: string | null; weekdays?: number[] | null
  time_from?: string | null; time_to?: string | null; min_total?: number | null; max_total?: number | null
  margin_floor_pct?: number | null; then_carrier?: string | null; fallback_carrier?: string | null
  carrier_chain?: string[] | null; max_distance_km?: number | null
  strategy?: string | null; is_active?: boolean
}
interface Employee { id: string; name: string }
interface Quest {
  id?: string; name?: string; period?: string; target_count?: number | null; reward?: number | null
  location_id?: string | null; valid_from?: string | null; valid_to?: string | null; is_active?: boolean
}
interface Courier {
  id?: string; name?: string; phone?: string | null; kind?: string | null; employee_id?: string | null
  transport_type?: string | null; vehicle_plate?: string | null; nif?: string | null; iban?: string | null
  access_token?: string | null
  assigned_locations?: string[] | null; cost_model?: string | null; cost_value?: number | null
  rate_base?: number | null; rate_per_km?: number | null; rate_min_pickup?: number | null
  rate_pickup_fee?: number | null; rate_max?: number | null; rate_tiers?: { to_km: number; price: number }[] | null
  active?: boolean; on_shift?: boolean
}

// Modelos de coste del repartidor. 'tariff' = base + €/km + mínimo de recogida
// (estilo Stuart/Glovo). salary/hourly = empleado (se imputa por horas).
const COST_MODELS: { val: string; label: string }[] = [
  { val: 'per_order', label: 'Fijo por entrega' },
  { val: 'per_km', label: 'Por km' },
  { val: 'tariff', label: 'Tarifa (base + km + mínimo)' },
  { val: 'hourly', label: 'Por hora' },
]

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] // 0=Lunes..6=Domingo (convención Folvy)

// Interruptor de despacho de Folvy (3 posiciones). Off = Folvy no despacha; lo hace
// un sistema externo (el TPV/agregador que use la cuenta).
const DISPATCH_MODES: { val: string; label: string }[] = [
  { val: 'auto', label: 'Automático' },
  { val: 'manual', label: 'Manual' },
  { val: 'off', label: 'Off · externo' },
]

export default function RepartoSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [locs, setLocs] = useState<Loc[]>([])
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [editQuest, setEditQuest] = useState<Quest | null>(null)
  const [copiedTok, setCopiedTok] = useState(false)
  const [trackUrl, setTrackUrl] = useState('')
  const [trackUrlSaved, setTrackUrlSaved] = useState('')
  const [savingDomain, setSavingDomain] = useState(false)
  const [domainOk, setDomainOk] = useState(false)
  const [editRule, setEditRule] = useState<Rule | null>(null)
  const [editCourier, setEditCourier] = useState<Courier | null>(null)

  const reload = useCallback(async () => {
    const { data } = await rpc<{ track_base_url: string | null; carriers: Carrier[]; employees: Employee[]; locations: Loc[]; rules: Rule[]; bonuses: Quest[]; couriers: Courier[] }>('reparto_settings', {})
    if (!data) return
    setCarriers(data.carriers ?? [])
    setEmployees(data.employees ?? [])
    setLocs(data.locations ?? [])
    setRules(data.rules ?? [])
    setQuests(data.bonuses ?? [])
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
    else ({ error } = await rpc('set_location_dispatch', { p_location_id: id, p_mode: patch.mode ?? before?.mode, p_broker: ('broker' in patch ? patch.broker : before?.broker) }))
    if (error) { setLocs(prev => prev.map(l => l.id === id ? { ...l, ...before } : l)); alert('No se pudo guardar: ' + error.message) }
  }

  // ── B2) Bonos por local (surge) ────────────────────────────────────────
  async function saveBonus(id: string, next: Loc) {
    const { error } = await rpc('set_location_bonus', {
      p_location_id: id,
      p_rain_pct: next.bonus_rain_pct ?? 0,
      p_demand_max_pct: next.bonus_demand_max_pct ?? 0,
      p_combined_cap_pct: next.bonus_combined_cap_pct ?? null,
    })
    if (error) { alert('No se pudo guardar el bono: ' + error.message); await reload() }
  }
  async function toggleRain(id: string, v: boolean) {
    setLocs(prev => prev.map(l => l.id === id ? { ...l, weather_is_raining: v, weather_auto: false } : l))
    const { error } = await rpc('set_location_weather', { p_location_id: id, p_is_raining: v, p_auto: false })
    if (error) { await reload(); alert('No se pudo cambiar el clima: ' + error.message) }
  }
  async function toggleWeatherAuto(id: string, auto: boolean) {
    const cur = locs.find(l => l.id === id)
    setLocs(prev => prev.map(l => l.id === id ? { ...l, weather_auto: auto } : l))
    const { error } = await rpc('set_location_weather', { p_location_id: id, p_is_raining: cur?.weather_is_raining ?? false, p_auto: auto })
    if (error) { await reload(); alert('No se pudo cambiar el modo de clima: ' + error.message) }
    else await reload()
  }
  const patchLoc = (id: string, patch: Partial<Loc>) => setLocs(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))

  // ── C) Reglas ──────────────────────────────────────────────────────────
  async function saveRule() {
    if (!editRule) return
    if (!(editRule.carrier_chain?.length)) { alert('La regla necesita al menos un transportista en la cadena'); return }
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
  // Editor de la cadena de transportistas (por orden de prioridad).
  const chainAdd = (code: string) => {
    if (!editRule || !code) return
    if ((editRule.carrier_chain ?? []).includes(code)) return
    setEditRule({ ...editRule, carrier_chain: [...(editRule.carrier_chain ?? []), code] })
  }
  const chainRemove = (idx: number) => {
    if (!editRule) return
    const next = [...(editRule.carrier_chain ?? [])]; next.splice(idx, 1)
    setEditRule({ ...editRule, carrier_chain: next })
  }
  const chainMove = (idx: number, dir: -1 | 1) => {
    if (!editRule) return
    const next = [...(editRule.carrier_chain ?? [])]
    const j = idx + dir; if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setEditRule({ ...editRule, carrier_chain: next })
  }

  // ── Retos (quests) ─────────────────────────────────────────────────────
  async function saveQuest() {
    if (!editQuest) return
    if (!editQuest.name || !(editQuest.target_count) || !(editQuest.reward)) { alert('El reto necesita nombre, nº de entregas y bono'); return }
    const { error } = await rpc('upsert_courier_bonus', { p: editQuest })
    if (error) { alert('No se pudo guardar el reto: ' + error.message); return }
    setEditQuest(null); await reload()
  }
  async function removeQuest(id?: string) {
    if (!id || !confirm('¿Eliminar este reto?')) return
    const { error } = await rpc('delete_courier_bonus', { p_id: id })
    if (error) { alert('No se pudo eliminar: ' + error.message); return }
    await reload()
  }
  const periodLabel = (p?: string | null) => p === 'day' ? 'al día' : 'a la semana'

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
  // Enlace mágico a la PWA del repartidor (sin login). Se sirve en el mismo dominio de la app.
  const courierLink = (token?: string | null) => token ? `${window.location.origin}/repartidor?token=${token}` : ''
  async function copyLink(token?: string | null) {
    const url = courierLink(token); if (!url) return
    try { await navigator.clipboard.writeText(url); setCopiedTok(true); setTimeout(() => setCopiedTok(false), 2000) }
    catch { alert('Copia manual: ' + url) }
  }
  async function resetToken(id?: string) {
    if (!id || !confirm('¿Regenerar el enlace? El anterior dejará de funcionar.')) return
    const { data, error } = await rpc<string>('courier_reset_token', { p_id: id })
    if (error) { alert('No se pudo regenerar: ' + error.message); return }
    setEditCourier(prev => prev ? { ...prev, access_token: data ?? prev.access_token } : prev)
    await reload()
  }

  const domainDirty = trackUrl.trim() !== (trackUrlSaved ?? '').trim()
  const locName = (id?: string | null) => locs.find(l => l.id === id)?.name ?? 'Todos los locales'
  const carrierName = (code?: string | null) => carriers.find(c => c.code === code)?.name ?? (code ?? '—')
  // Opciones de un select de transportista; incluye el valor actual aunque ya no
  // esté conectado, para no perderlo de vista.
  const carrierOptions = (current?: string | null): Carrier[] => {
    const list = [...carriers]
    if (current && !list.some(c => c.code === current)) list.unshift({ code: current, name: carrierName(current) })
    return list
  }
  // Cadena visible de una regla (con compat de reglas antiguas then/fallback).
  const ruleChain = (r: Rule): string[] => {
    if (r.carrier_chain && r.carrier_chain.length) return r.carrier_chain
    return [r.then_carrier, r.fallback_carrier].filter(Boolean) as string[]
  }
  // Resumen legible de la tarifa de un repartidor.
  const costLabel = (c: Courier): string => {
    if (c.cost_model === 'tariff') {
      const parts: string[] = []
      if (c.rate_base != null) parts.push(`${c.rate_base}€ base`)
      if (c.rate_per_km != null) parts.push(`${c.rate_per_km}€/km`)
      if (c.rate_min_pickup != null) parts.push(`mín ${c.rate_min_pickup}€`)
      return parts.length ? `tarifa · ${parts.join(' + ')}` : 'tarifa'
    }
    if (c.cost_value == null) return ''
    if (c.cost_model === 'per_km') return `${c.cost_value}€/km`
    if (c.cost_model === 'hourly') return `${c.cost_value}€/h`
    return `${c.cost_value}€/entrega`
  }
  // Tope al que puede llegar el surge de un local con su config (lluvia + demanda máx, con tope combinado).
  const surgeCeil = (l: Loc): number => {
    const raw = (l.bonus_rain_pct ?? 0) + (l.bonus_demand_max_pct ?? 0)
    return l.bonus_combined_cap_pct != null ? Math.min(raw, l.bonus_combined_cap_pct) : raw
  }
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
          <input type="text" value={trackUrl} onChange={e => setTrackUrl(e.target.value)} placeholder="https://tudominio.com" className={`flex-1 ${input}`} />
          <Button onClick={saveDomain} disabled={!domainDirty || savingDomain}>{savingDomain ? 'Guardando...' : 'Guardar'}</Button>
        </div>
        {domainOk && <p className="text-xs text-success inline-flex items-center gap-1 mt-2"><CheckCircle2 size={12} /> Guardado</p>}
      </Card>

      {/* B) Por local */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Por local</p>
        <h3 className="font-semibold text-text-primary mb-2">Modo, transportista y aviso</h3>
        <p className="text-xs text-text-secondary mb-4">
          <b>Automático</b>: Folvy despacha solo al aceptar. · <b>Manual</b>: solo al pulsar el botón en el pedido. · <b>Off</b>: Folvy no despacha; lo gestiona un sistema externo (tu TPV o agregador) y se oculta el botón.
        </p>
        <div className="space-y-3">
          {locs.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 border-t border-border-default pt-3">
              <span className="text-sm font-medium text-text-primary flex-1 min-w-[140px]">{l.name}</span>
              <div className="text-xs text-text-secondary">
                <span className="block mb-1">Despacho de Folvy</span>
                <div className="inline-flex rounded-lg border border-border-default overflow-hidden">
                  {DISPATCH_MODES.map(m => (
                    <button key={m.val} type="button" onClick={() => saveLoc(l.id, { mode: m.val })}
                      className={`px-3 py-1.5 text-xs font-medium border-r border-border-default last:border-r-0 ${l.mode === m.val ? 'bg-accent text-white' : 'bg-card text-text-secondary hover:text-text-primary'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs text-text-secondary">Transportista
                <select value={l.broker ?? ''} onChange={e => saveLoc(l.id, { broker: e.target.value || null })} className={`ml-1 ${input} py-1`}>
                  {!l.broker && <option value="">— elige —</option>}
                  {carrierOptions(l.broker).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
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

      {/* B2) Bonos por local (surge) */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Bonos por local</p>
        <h3 className="font-semibold text-text-primary mb-1">Lluvia y alta demanda</h3>
        <p className="text-xs text-text-secondary mb-4">El extra se suma al pago del repartidor. La <b>alta demanda es dinámica</b> (pedidos pendientes ÷ repartidores en turno), no un % fijo como en otros. El repartidor ve el motivo en su app.</p>
        <div className="space-y-3">
          {locs.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 border-t border-border-default pt-3">
              <span className="text-sm font-medium text-text-primary flex-1 min-w-[120px]">{l.name}
                {(l.surge_pct ?? 0) > 0 && <span className="ml-2 text-[11px] font-bold text-accent">+{l.surge_pct}% ahora</span>}
                <span className="block text-[11px] text-text-secondary font-normal">tope +{surgeCeil(l)}% · ej. pedido 5€ → hasta {(5 * (1 + surgeCeil(l) / 100)).toFixed(2)}€</span>
              </span>
              <label className="text-xs text-text-secondary">% lluvia
                <input type="number" value={l.bonus_rain_pct ?? ''} onChange={e => patchLoc(l.id, { bonus_rain_pct: e.target.value === '' ? null : Number(e.target.value) })} onBlur={() => { const cur = locs.find(x => x.id === l.id); if (cur) void saveBonus(l.id, cur) }} className={`ml-1 w-16 ${input} py-1`} placeholder="0" />
              </label>
              <label className="text-xs text-text-secondary">% demanda máx
                <input type="number" value={l.bonus_demand_max_pct ?? ''} onChange={e => patchLoc(l.id, { bonus_demand_max_pct: e.target.value === '' ? null : Number(e.target.value) })} onBlur={() => { const cur = locs.find(x => x.id === l.id); if (cur) void saveBonus(l.id, cur) }} className={`ml-1 w-16 ${input} py-1`} placeholder="0" />
              </label>
              <label className="text-xs text-text-secondary">% tope comb.
                <input type="number" value={l.bonus_combined_cap_pct ?? ''} onChange={e => patchLoc(l.id, { bonus_combined_cap_pct: e.target.value === '' ? null : Number(e.target.value) })} onBlur={() => { const cur = locs.find(x => x.id === l.id); if (cur) void saveBonus(l.id, cur) }} className={`ml-1 w-16 ${input} py-1`} placeholder="—" />
              </label>
              <label className="text-xs text-text-secondary inline-flex items-center gap-1.5 cursor-pointer" title="Detecta la lluvia solo por el GPS del local (Open-Meteo)">
                <input type="checkbox" checked={l.weather_auto !== false} onChange={e => toggleWeatherAuto(l.id, e.target.checked)} className="w-4 h-4 accent-accent" />
                Clima auto
              </label>
              <label className={`text-xs inline-flex items-center gap-1.5 ${l.weather_auto !== false ? 'text-text-secondary/50' : 'text-text-secondary cursor-pointer'}`} title={l.weather_auto !== false ? 'En modo auto lo decide el clima real; desactiva "Clima auto" para forzarlo' : 'Forzar lluvia manualmente'}>
                <input type="checkbox" checked={!!l.weather_is_raining} disabled={l.weather_auto !== false} onChange={e => toggleRain(l.id, e.target.checked)} className="w-4 h-4 accent-accent disabled:opacity-40" />
                {l.weather_is_raining ? '🌧 lluvia' : 'lluvia'}
              </label>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-text-secondary mt-3">Con <b>Clima auto</b> la lluvia se detecta sola por el GPS del local (se revisa cada ~10 min). Desactívalo para forzarla a mano si el pronóstico falla.</p>
      </Card>

      {/* C) Reglas de despacho */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Reglas de despacho</p>
            <h3 className="font-semibold text-text-primary">Quién reparte, según franja, importe y margen</h3>
          </div>
          <Button onClick={() => setEditRule({ priority: (rules.length + 1) * 10, carrier_chain: ['own_fleet'], is_active: true })}>
            <Plus size={15} className="inline -mt-0.5 mr-1" />Regla
          </Button>
        </div>
        <p className="text-xs text-text-secondary mb-3">Se evalúan por prioridad (menor primero). Sin reglas → transportista por defecto del local. Cada regla lleva una <b>cadena de transportistas</b>: se prueba el 1º y, si no puede, pasa al siguiente. <b>El margen mínimo protege que un reparto no se coma la rentabilidad del pedido.</b></p>

        {rules.length === 0 ? <p className="text-xs text-text-secondary">Aún no hay reglas.</p> : (
          <div className="space-y-2">
            {rules.map(r => {
              const chainStr = ruleChain(r).map(c => carrierName(c)).join(' → ') || '—'
              return (
                <div key={r.id} className="flex items-center gap-2 text-sm border-t border-border-default pt-2">
                  <span className="text-xs font-mono text-text-secondary w-8">#{r.priority}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary truncate">
                      {locName(r.location_id)} · {(r.time_from && r.time_to) ? `${r.time_from}-${r.time_to}` : 'todo el día'}
                      {(r.min_total != null || r.max_total != null) ? ` · ${r.min_total ?? 0}–${r.max_total ?? '∞'}€` : ''}
                      {r.margin_floor_pct != null ? ` · margen ≥${r.margin_floor_pct}%` : ''}
                    </p>
                    <p className="text-xs text-text-secondary">→ {chainStr}{r.max_distance_km != null ? ` · propio ≤${r.max_distance_km} km` : ''}{!r.is_active ? ' · inactiva' : ''}</p>
                  </div>
                  <button onClick={() => setEditRule(r)} className="text-text-secondary hover:text-text-primary p-1"><Pencil size={15} /></button>
                  <button onClick={() => removeRule(r.id)} className="text-danger hover:opacity-80 p-1"><Trash2 size={15} /></button>
                </div>
              )
            })}
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
              <label className="text-xs text-text-secondary">Máx. km flota propia<input type="number" value={editRule.max_distance_km ?? ''} onChange={e => setEditRule({ ...editRule, max_distance_km: e.target.value === '' ? null : Number(e.target.value) })} placeholder="sin límite" className={`block mt-1 w-full ${input}`} /></label>
            </div>

            {/* Cadena de transportistas por orden de prioridad */}
            <div>
              <p className="text-xs text-text-secondary mb-1">Cadena de transportistas <span className="text-text-secondary/70">(orden de prioridad · se prueba de arriba abajo)</span></p>
              <div className="space-y-1.5">
                {(editRule.carrier_chain ?? []).map((code, idx) => (
                  <div key={code} className="flex items-center gap-2 bg-card border border-border-default rounded-lg px-2 py-1.5">
                    <span className="text-xs font-mono text-text-secondary w-5 text-center">{idx + 1}</span>
                    <span className="flex-1 text-sm text-text-primary">{carrierName(code)}</span>
                    <button type="button" onClick={() => chainMove(idx, -1)} disabled={idx === 0} className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"><ChevronUp size={14} /></button>
                    <button type="button" onClick={() => chainMove(idx, 1)} disabled={idx === (editRule.carrier_chain?.length ?? 0) - 1} className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"><ChevronDown size={14} /></button>
                    <button type="button" onClick={() => chainRemove(idx)} className="p-1 text-danger hover:opacity-80"><X size={14} /></button>
                  </div>
                ))}
                {(editRule.carrier_chain ?? []).length === 0 && <p className="text-xs text-danger">Añade al menos un transportista.</p>}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <select value="" onChange={e => { chainAdd(e.target.value); e.currentTarget.value = '' }} className={`${input} py-1.5 text-sm`}>
                  <option value="">+ Añadir transportista…</option>
                  {carrierOptions().filter(c => !(editRule.carrier_chain ?? []).includes(c.code)).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                <span className="text-[11px] text-text-secondary">La flota propia se salta si no hay repartidor en turno o el cliente supera el máx. km.</span>
              </div>
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
          <Button onClick={() => setEditCourier({ kind: 'freelance', transport_type: 'moto', cost_model: 'per_order', active: true, on_shift: false, assigned_locations: [] })}>
            <Plus size={15} className="inline -mt-0.5 mr-1" />Repartidor
          </Button>
        </div>
        {couriers.length === 0 ? <p className="text-xs text-text-secondary">Aún no hay repartidores en flota propia.</p> : (
          <div className="space-y-2">
            {couriers.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm border-t border-border-default pt-2">
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary truncate">{c.name} <span className="text-xs text-text-secondary">· {c.transport_type ?? ''}{costLabel(c) ? ` · ${costLabel(c)}` : ''}</span></p>
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
              <label className="text-xs text-text-secondary">Tipo
                <select value={editCourier.kind ?? 'freelance'} onChange={e => setEditCourier({ ...editCourier, kind: e.target.value })} className={`block mt-1 w-full ${input}`}>
                  <option value="freelance">Autónomo</option><option value="employee">Empleado</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary">Vehículo
                <select value={editCourier.transport_type ?? 'moto'} onChange={e => setEditCourier({ ...editCourier, transport_type: e.target.value })} className={`block mt-1 w-full ${input}`}>
                  <option value="moto">Moto</option><option value="bici">Bici</option><option value="coche">Coche</option><option value="a_pie">A pie</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary">Matrícula<input type="text" value={editCourier.vehicle_plate ?? ''} onChange={e => setEditCourier({ ...editCourier, vehicle_plate: e.target.value })} className={`block mt-1 w-full ${input}`} placeholder="0000 XXX" /></label>
              <label className="text-xs text-text-secondary">Modelo de coste
                <select value={editCourier.cost_model ?? 'per_order'} onChange={e => setEditCourier({ ...editCourier, cost_model: e.target.value })} className={`block mt-1 w-full ${input}`}>
                  {COST_MODELS.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
                </select>
              </label>
              {editCourier.cost_model !== 'tariff' && (
                <label className="text-xs text-text-secondary">
                  {editCourier.cost_model === 'per_km' ? 'Precio por km (€)' : editCourier.cost_model === 'hourly' ? 'Precio por hora (€)' : 'Precio por entrega (€)'}
                  <input type="number" value={editCourier.cost_value ?? ''} onChange={e => setEditCourier({ ...editCourier, cost_value: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} placeholder="€" />
                </label>
              )}
            </div>

            {/* Tarifa rica: base + €/km + mínimo de recogida + fijo de recogida */}
            {editCourier.cost_model === 'tariff' && (
              <div className="border border-border-default rounded-lg p-3 bg-card/50">
                <p className="text-xs text-text-secondary mb-2">Tarifa por pedido · <span className="text-text-secondary/70">payout = máx(mínimo, base + fijo recogida + €/km × distancia)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-text-secondary">Base por pedido (€)<input type="number" value={editCourier.rate_base ?? ''} onChange={e => setEditCourier({ ...editCourier, rate_base: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} placeholder="0" /></label>
                  <label className="text-xs text-text-secondary">Precio por km (€)<input type="number" value={editCourier.rate_per_km ?? ''} onChange={e => setEditCourier({ ...editCourier, rate_per_km: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} placeholder="0" /></label>
                  <label className="text-xs text-text-secondary">Mínimo de recogida (€)<input type="number" value={editCourier.rate_min_pickup ?? ''} onChange={e => setEditCourier({ ...editCourier, rate_min_pickup: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} placeholder="0" /></label>
                  <label className="text-xs text-text-secondary">Fijo por recogida (€)<input type="number" value={editCourier.rate_pickup_fee ?? ''} onChange={e => setEditCourier({ ...editCourier, rate_pickup_fee: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} placeholder="0" /></label>
                  <label className="text-xs text-text-secondary">Precio máximo (€)<input type="number" value={editCourier.rate_max ?? ''} onChange={e => setEditCourier({ ...editCourier, rate_max: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} placeholder="sin tope" /></label>
                </div>
              </div>
            )}

            {/* Identidad según tipo: empleado de plantilla o datos de liquidación del autónomo */}
            {editCourier.kind === 'employee' ? (
              <label className="text-xs text-text-secondary block">Empleado vinculado
                <select value={editCourier.employee_id ?? ''} onChange={e => {
                  const emp = employees.find(x => x.id === e.target.value)
                  setEditCourier({ ...editCourier, employee_id: e.target.value || null, name: emp?.name ?? editCourier.name })
                }} className={`block mt-1 w-full ${input}`}>
                  <option value="">— elige empleado —</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-text-secondary">NIF / DNI<input type="text" value={editCourier.nif ?? ''} onChange={e => setEditCourier({ ...editCourier, nif: e.target.value })} className={`block mt-1 w-full ${input}`} placeholder="Para la liquidación" /></label>
                <label className="text-xs text-text-secondary">IBAN<input type="text" value={editCourier.iban ?? ''} onChange={e => setEditCourier({ ...editCourier, iban: e.target.value })} className={`block mt-1 w-full ${input}`} placeholder="ES..." /></label>
              </div>
            )}

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
            {/* Enlace mágico a la PWA del repartidor (sin instalar ni registrarse) */}
            {editCourier.id && (
              <div className="border border-border-default rounded-lg p-3 bg-card/50">
                <p className="text-xs text-text-secondary mb-1.5 inline-flex items-center gap-1"><Link2 size={13} /> Enlace de acceso del repartidor</p>
                {editCourier.access_token ? (
                  <>
                    <div className="flex items-center gap-2">
                      <input readOnly value={courierLink(editCourier.access_token)} onFocus={e => e.currentTarget.select()} className={`flex-1 text-xs ${input}`} />
                      <button type="button" onClick={() => copyLink(editCourier.access_token)} className="p-2 text-text-secondary hover:text-text-primary" title="Copiar"><Copy size={15} /></button>
                      <button type="button" onClick={() => resetToken(editCourier.id)} className="p-2 text-text-secondary hover:text-text-primary" title="Regenerar"><RefreshCw size={15} /></button>
                    </div>
                    {copiedTok && <p className="text-xs text-success mt-1 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Copiado</p>}
                    <p className="text-[11px] text-text-secondary mt-1">Envíaselo por WhatsApp: entra sin instalar nada ni crear cuenta.</p>
                  </>
                ) : <p className="text-xs text-text-secondary">Guarda el repartidor para generar su enlace.</p>}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1"><Button onClick={saveCourier}>Guardar repartidor</Button></div>
          </div>
        )}
      </Card>

      {/* D2) Retos (quests) */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Retos</p>
            <h3 className="font-semibold text-text-primary">Bonos por objetivo de entregas</h3>
          </div>
          <Button onClick={() => setEditQuest({ name: '', period: 'week', target_count: null, reward: null, is_active: true })}>
            <Plus size={15} className="inline -mt-0.5 mr-1" />Reto
          </Button>
        </div>
        <p className="text-xs text-text-secondary mb-3">"Haz N entregas → bono €". El repartidor ve su progreso en la app. Es la palanca de fidelización que la flota contratada no ofrece.</p>

        {quests.length === 0 ? <p className="text-xs text-text-secondary">Aún no hay retos.</p> : (
          <div className="space-y-2">
            {quests.map(q => (
              <div key={q.id} className="flex items-center gap-2 text-sm border-t border-border-default pt-2">
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary truncate">{q.name} <span className="text-xs text-text-secondary">· {q.target_count} entregas {periodLabel(q.period)} → <b className="text-accent">+{q.reward}€</b></span></p>
                  <p className="text-xs text-text-secondary">{q.location_id ? locName(q.location_id) : 'Todos los locales'}{!q.is_active ? ' · inactivo' : ''}</p>
                </div>
                <button onClick={() => setEditQuest(q)} className="text-text-secondary hover:text-text-primary p-1"><Pencil size={15} /></button>
                <button onClick={() => removeQuest(q.id)} className="text-danger hover:opacity-80 p-1"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}

        {editQuest && (
          <div className="mt-4 border border-border-default rounded-xl p-4 bg-card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{editQuest.id ? 'Editar reto' : 'Nuevo reto'}</p>
              <button onClick={() => setEditQuest(null)} className="text-text-secondary"><X size={16} /></button>
            </div>
            <label className="text-xs text-text-secondary block">Nombre<input type="text" value={editQuest.name ?? ''} onChange={e => setEditQuest({ ...editQuest, name: e.target.value })} className={`block mt-1 w-full ${input}`} placeholder="Ej. Reto de la semana" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-secondary">Nº entregas<input type="number" value={editQuest.target_count ?? ''} onChange={e => setEditQuest({ ...editQuest, target_count: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Bono (€)<input type="number" value={editQuest.reward ?? ''} onChange={e => setEditQuest({ ...editQuest, reward: e.target.value === '' ? null : Number(e.target.value) })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Periodo
                <select value={editQuest.period ?? 'week'} onChange={e => setEditQuest({ ...editQuest, period: e.target.value })} className={`block mt-1 w-full ${input}`}>
                  <option value="week">Por semana</option><option value="day">Por día</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary">Local
                <select value={editQuest.location_id ?? ''} onChange={e => setEditQuest({ ...editQuest, location_id: e.target.value || null })} className={`block mt-1 w-full ${input}`}>
                  <option value="">Todos</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-secondary">Desde (opcional)<input type="date" value={editQuest.valid_from ?? ''} onChange={e => setEditQuest({ ...editQuest, valid_from: e.target.value || null })} className={`block mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-text-secondary">Hasta (opcional)<input type="date" value={editQuest.valid_to ?? ''} onChange={e => setEditQuest({ ...editQuest, valid_to: e.target.value || null })} className={`block mt-1 w-full ${input}`} /></label>
            </div>
            {(editQuest.target_count && editQuest.reward) ? <p className="text-[11px] text-text-secondary">Vista previa: <b>{editQuest.target_count} entregas {periodLabel(editQuest.period)} → +{editQuest.reward}€</b> (≈ {(Number(editQuest.reward) / Number(editQuest.target_count)).toFixed(2)}€ por entrega extra).</p> : null}
            <label className="text-xs text-text-secondary inline-flex items-center gap-1.5"><input type="checkbox" checked={editQuest.is_active ?? true} onChange={e => setEditQuest({ ...editQuest, is_active: e.target.checked })} className="w-4 h-4 accent-accent" /> Activo</label>
            <div className="flex justify-end gap-2 pt-1"><Button onClick={saveQuest}>Guardar reto</Button></div>
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
