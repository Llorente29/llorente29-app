// src/modules/shop/admin/ShopRulesPage.tsx
//
// G2d sub-lote 4 — Sección "Reglas": el humano crea/edita las reglas que encienden
// campañas solas (con límites) y VE cuándo dispararon. La creación real la hace el
// evaluador (pg_cron */15). Autocontenida (estilos inline).

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getCampaignMenuTree, getShopAdminLocations, type ShopAdminLocation } from '@/modules/shop/admin/campaignService'
import {
  listRules, saveRule, toggleRule, deleteRule, listRuleFirings,
  type CampaignRule, type RuleTrigger, type RuleFiring, type SaveRuleArgs,
} from '@/modules/shop/admin/campaignRulesService'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5',
  accent: '#FF5436', green: '#16A05B', greenDeep: '#0E6B38', blue: '#1D4ED8', amber: '#8A5B0A', red: '#C23B22', pill: '#EEEEEB',
}
const TRIGGERS: { k: RuleTrigger; label: string; hint: string }[] = [
  { k: 'hourly_valley', label: 'Valle horario', hint: 'Cuando una franja va floja vs su media' },
  { k: 'weak_brand', label: 'Marca floja', hint: 'Cuando una marca baja vs su media semanal' },
  { k: 'stalled_dish', label: 'Plato parado', hint: 'Plato con stock alto y pocas ventas' },
]
function trigLabel(k: RuleTrigger): string { return TRIGGERS.find((t) => t.k === k)?.label ?? k }
function eur(n: number): string { return `${n.toFixed(2).replace('.', ',')} €` }
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3600000)
  if (h < 1) return `hace ${Math.max(1, Math.floor(ms / 60000))} min`
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

export default function ShopRulesPage() {
  const s = styles
  const { activeAccountId: accountId } = useActiveAccount()
  const [rules, setRules] = useState<CampaignRule[] | null>(null)
  const [firings, setFirings] = useState<RuleFiring[]>([])
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [dishes, setDishes] = useState<{ id: string; name: string; brand: string }[]>([])
  const [locations, setLocations] = useState<ShopAdminLocation[]>([])
  const [modal, setModal] = useState<null | { rule?: CampaignRule }>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function refresh() {
    if (!accountId) return
    setRules(await listRules(accountId))
    setFirings(await listRuleFirings(accountId))
  }
  useEffect(() => {
    if (!accountId) return
    setRules(null); refresh()
    getCampaignMenuTree(accountId).then((t) => {
      setBrands(t.brands.map((b) => ({ id: b.id, name: b.name })))
      const ds: { id: string; name: string; brand: string }[] = []
      for (const b of t.brands) for (const c of b.categories) for (const it of c.items) ds.push({ id: it.id, name: it.name, brand: b.name })
      setDishes(ds)
    }).catch(() => {})
    getShopAdminLocations(accountId).then(setLocations).catch(() => {})
    /* eslint-disable-next-line */
  }, [accountId])

  const lastFiringByRule = useMemo(() => {
    const m = new Map<string, RuleFiring>()
    for (const f of firings) if (!m.has(f.ruleId)) m.set(f.ruleId, f)   // firings vienen ordenados desc
    return m
  }, [firings])

  async function onToggle(r: CampaignRule) {
    if (busyId) return
    setBusyId(r.id); await toggleRule(r.id, !r.active); setBusyId(null); refresh()
  }
  async function onDelete(r: CampaignRule) {
    if (!confirm(`¿Eliminar la regla «${r.name}»? Las campañas ya encendidas no se tocan.`)) return
    setBusyId(r.id); await deleteRule(r.id); setBusyId(null); refresh()
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Reglas</h1>
          <p style={s.subtitle}>Campañas que se encienden solas cuando tu histórico lo pide — con presupuesto y límites. Tú las ves y puedes pararlas.</p>
        </div>
        <button style={s.newBtn} onClick={() => setModal({})}>+ Nueva regla</button>
      </div>

      {rules === null ? (
        <div style={s.muted}>Cargando reglas…</div>
      ) : rules.length === 0 ? (
        <div style={s.empty}>Aún no hay reglas. Crea una y deja que el motor encienda ofertas por ti cuando toque.</div>
      ) : (
        <div style={s.list}>
          {rules.map((r) => {
            const lf = lastFiringByRule.get(r.id)
            const cond = Object.entries(r.condition).map(([k, v]) => `${k}: ${v}`).join(' · ')
            return (
              <div key={r.id} style={s.row}>
                <div style={s.rowMain}>
                  <div style={s.rowTop}>
                    <span style={s.rowName}>{r.name}</span>
                    <span style={{ ...s.badge, ...s.badgeTrig }}>{trigLabel(r.triggerType)}</span>
                    {!r.active && <span style={{ ...s.badge, ...s.badgePaused }}>Pausada</span>}
                  </div>
                  <div style={s.rowConfig}>
                    {r.actionTemplate.kind === 'bogo' ? '2x1' : `−${r.actionTemplate.value}% en platos`} · tope {eur(r.budgetMax)} · máx {r.maxActive} · {Math.round(r.durationMinutes / 60)}h · cooldown {Math.round(r.cooldownMinutes / 60)}h{cond ? ` · ${cond}` : ''}
                  </div>
                  {lf ? (
                    <div style={s.firing}>⚡ Disparó {ago(lf.firedAt)}{lf.couponName ? <> → <b>{lf.couponName}</b></> : ''}</div>
                  ) : (
                    <div style={s.firingNone}>Aún no ha disparado</div>
                  )}
                </div>
                <div style={s.rowActions}>
                  <button style={s.actBtn} onClick={() => setModal({ rule: r })}>Editar</button>
                  <button style={{ ...s.actBtn, ...(busyId === r.id ? s.actOff : {}) }} disabled={busyId === r.id} onClick={() => onToggle(r)}>{r.active ? 'Pausar' : 'Activar'}</button>
                  <button style={s.delBtn} onClick={() => onDelete(r)}>Eliminar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && accountId && (
        <RuleModal accountId={accountId} rule={modal.rule} brands={brands} dishes={dishes} locations={locations}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh() }} />
      )}
    </div>
  )
}

const DEFAULTS: Record<RuleTrigger, Record<string, number>> = {
  hourly_valley: { weeks: 4, dropPct: 30, franjaHoras: 2 },
  weak_brand: { days: 7, weeks: 4, dropPct: 25 },
  stalled_dish: { days: 7, stockMin: 10, salesMax: 2 },
}

function RuleModal({ accountId, rule, brands, dishes, locations, onClose, onSaved }: {
  accountId: string; rule?: CampaignRule
  brands: { id: string; name: string }[]; dishes: { id: string; name: string; brand: string }[]; locations: ShopAdminLocation[]
  onClose: () => void; onSaved: () => void
}) {
  const s = styles
  const [trigger, setTrigger] = useState<RuleTrigger>(rule?.triggerType ?? 'hourly_valley')
  const [name, setName] = useState(rule?.name ?? '')
  const [cond, setCond] = useState<Record<string, number>>(rule?.condition ?? DEFAULTS[rule?.triggerType ?? 'hourly_valley'])
  const [kind, setKind] = useState<'item_percent' | 'bogo'>(rule?.actionTemplate.kind ?? 'item_percent')
  const [value, setValue] = useState<number>(rule?.actionTemplate.value ?? 15)
  const [brandId, setBrandId] = useState<string>(rule?.brandId ?? '')
  const [locationId, setLocationId] = useState<string>(rule?.locationId ?? '')
  const [menuItemId, setMenuItemId] = useState<string>(rule?.menuItemId ?? '')
  const [budgetMax, setBudgetMax] = useState<number>(rule?.budgetMax ?? 30)
  const [cooldown, setCooldown] = useState<number>(rule ? Math.round(rule.cooldownMinutes / 60) : 24)
  const [maxActive, setMaxActive] = useState<number>(rule?.maxActive ?? 1)
  const [duration, setDuration] = useState<number>(rule ? Math.round(rule.durationMinutes / 60) : 4)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function changeTrigger(t: RuleTrigger) { setTrigger(t); setCond(DEFAULTS[t]) }
  const setC = (k: string, v: number) => setCond((p) => ({ ...p, [k]: v }))

  async function onSave() {
    if (saving) return
    if (!name.trim()) { setError('Ponle un nombre a la regla.'); return }
    if (budgetMax <= 0) { setError('El presupuesto es obligatorio (> 0).'); return }
    if (trigger === 'weak_brand' && !brandId) { setError('Elige la marca a vigilar.'); return }
    if (trigger === 'stalled_dish' && !menuItemId) { setError('Elige el plato a vigilar.'); return }
    setSaving(true); setError(null)
    const args: SaveRuleArgs = {
      id: rule?.id ?? null, name: name.trim(), triggerType: trigger, condition: cond,
      actionTemplate: { kind, value },
      brandId: brandId || null, locationId: locationId || null, menuItemId: menuItemId || null,
      budgetMax, cooldownMinutes: cooldown * 60, maxActive, durationMinutes: duration * 60,
    }
    const res = await saveRule(accountId, args)
    setSaving(false)
    if (!res.ok) { setError('No se pudo guardar. Revisa los datos.'); return }
    onSaved()
  }

  const condFields = trigger === 'hourly_valley'
    ? [['franjaHoras', 'Franja (horas)'], ['weeks', 'Semanas de media'], ['dropPct', 'Caída % para disparar']]
    : trigger === 'weak_brand'
      ? [['days', 'Días'], ['weeks', 'Semanas de media'], ['dropPct', 'Caída % para disparar']]
      : [['days', 'Días'], ['stockMin', 'Stock mínimo'], ['salesMax', 'Ventas máx (uds)']]

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}><h2 style={s.modalTitle}>{rule ? 'Editar regla' : 'Nueva regla'}</h2><button style={s.modalX} onClick={onClose}>×</button></div>
        <div style={s.modalBody}>
          <label style={s.label}>Disparador</label>
          <div style={s.trigGrid}>
            {TRIGGERS.map((t) => (
              <button key={t.k} type="button" style={{ ...s.trigBtn, ...(trigger === t.k ? s.trigOn : {}) }} onClick={() => changeTrigger(t.k)}>
                <span style={s.trigLabel}>{t.label}</span><span style={s.trigHint}>{t.hint}</span>
              </button>
            ))}
          </div>

          <label style={s.label}>Nombre</label>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Rescate del valle de tarde" />

          {/* Objetivo según disparador */}
          {trigger === 'weak_brand' && (
            <><label style={s.label}>Marca a vigilar</label>
            <select style={s.input} value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Elige…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></>
          )}
          {trigger === 'stalled_dish' && (
            <><label style={s.label}>Plato a vigilar</label>
            <select style={s.input} value={menuItemId} onChange={(e) => setMenuItemId(e.target.value)}><option value="">Elige…</option>{dishes.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.brand}</option>)}</select></>
          )}
          {trigger === 'hourly_valley' && (
            <><label style={s.label}>Marca <span style={s.opt}>(opcional; vacío = toda la cuenta)</span></label>
            <select style={s.input} value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Toda la cuenta</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></>
          )}
          <label style={s.label}>Local <span style={s.opt}>(opcional)</span></label>
          <select style={s.input} value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Todos</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>

          {/* Umbrales (editables) */}
          <label style={s.label}>Condición</label>
          <div style={s.row2}>
            {condFields.map(([k, lbl]) => (
              <div key={k} style={s.field}><label style={s.labelSm}>{lbl}</label>
                <input type="number" min={0} style={s.input} value={cond[k] ?? 0} onChange={(e) => setC(k, parseFloat(e.target.value) || 0)} /></div>
            ))}
          </div>

          {/* Oferta que nace */}
          <label style={s.label}>Oferta a encender</label>
          <div style={s.row2}>
            <div style={s.field}><label style={s.labelSm}>Tipo</label>
              <div style={s.seg}>
                <button type="button" style={{ ...s.segBtn, ...(kind === 'item_percent' ? s.segOn : {}) }} onClick={() => setKind('item_percent')}>% platos</button>
                <button type="button" style={{ ...s.segBtn, ...(kind === 'bogo' ? s.segOn : {}) }} onClick={() => setKind('bogo')}>2x1</button>
              </div>
            </div>
            <div style={s.field}><label style={s.labelSm}>{kind === 'bogo' ? '% de la 2ª ud' : 'Descuento %'}</label>
              <input type="number" min={0} max={100} style={s.input} value={value} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} /></div>
          </div>

          {/* Límites */}
          <label style={s.label}>Límites <span style={s.opt}>(el freno de mano)</span></label>
          <div style={s.row2}>
            <div style={s.field}><label style={s.labelSm}>Presupuesto € (obligatorio)</label><input type="number" min={1} style={s.input} value={budgetMax} onChange={(e) => setBudgetMax(parseFloat(e.target.value) || 0)} /></div>
            <div style={s.field}><label style={s.labelSm}>Duración (horas)</label><input type="number" min={1} style={s.input} value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 1)} /></div>
          </div>
          <div style={s.row2}>
            <div style={s.field}><label style={s.labelSm}>Cooldown (horas)</label><input type="number" min={0} style={s.input} value={cooldown} onChange={(e) => setCooldown(parseInt(e.target.value) || 0)} /></div>
            <div style={s.field}><label style={s.labelSm}>Máx. activas a la vez</label><input type="number" min={1} style={s.input} value={maxActive} onChange={(e) => setMaxActive(parseInt(e.target.value) || 1)} /></div>
          </div>
          <div style={s.note}>Además, un tope global de 3 campañas de regla activas por cuenta protege siempre.</div>
        </div>
        <div style={s.modalFoot}>
          {error && <span style={s.err}>{error}</span>}
          <button style={s.ghost} onClick={onClose}>Cancelar</button>
          <button style={{ ...s.save, ...(saving ? { opacity: 0.6 } : {}) }} disabled={saving} onClick={onSave}>{saving ? 'Guardando…' : rule ? 'Guardar' : 'Crear regla'}</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { padding: '4px 4px 40px', maxWidth: 960 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 },
  h1: { fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: C.ink, margin: 0 },
  subtitle: { fontSize: 13.5, color: C.inkDim, marginTop: 4, maxWidth: 560, lineHeight: 1.45 },
  newBtn: { flexShrink: 0, border: 'none', background: C.accent, color: '#fff', borderRadius: 999, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  muted: { color: C.inkDim, fontSize: 14, padding: '40px 0', textAlign: 'center' },
  empty: { border: `1px dashed ${C.lineInput}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.inkDim, fontSize: 13.5 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowName: { fontSize: 15, fontWeight: 800, color: C.ink },
  badge: { fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999 },
  badgeTrig: { color: C.blue, background: '#EAF0FF' },
  badgePaused: { color: C.inkDim, background: C.pill },
  rowConfig: { fontSize: 12.5, color: C.inkDim, marginTop: 5 },
  firing: { fontSize: 12, color: C.greenDeep, fontWeight: 700, marginTop: 5 },
  firingNone: { fontSize: 12, color: C.inkFaint, marginTop: 5 },
  rowActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  actBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  actOff: { opacity: 0.5, cursor: 'default' },
  delBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.red, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },

  modalWrap: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,14,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { background: '#fff', borderRadius: 18, maxWidth: 560, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.3)' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${C.line}` },
  modalTitle: { fontSize: 18, fontWeight: 800, margin: 0 },
  modalX: { background: C.page, border: `1px solid ${C.line}`, borderRadius: '50%', width: 32, height: 32, fontSize: 20, cursor: 'pointer', color: C.ink },
  modalBody: { padding: '18px 22px', overflowY: 'auto' },
  modalFoot: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '14px 22px', borderTop: `1px solid ${C.line}` },
  label: { display: 'block', fontSize: 12.5, fontWeight: 700, color: C.inkDim, margin: '14px 0 5px' },
  labelSm: { display: 'block', fontSize: 11.5, fontWeight: 600, color: C.inkFaint, margin: '0 0 4px' },
  opt: { fontWeight: 400, color: C.inkFaint },
  input: { width: '100%', border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  row2: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 130 },
  seg: { display: 'flex', border: `1px solid ${C.lineInput}`, borderRadius: 10, overflow: 'hidden' },
  segBtn: { flex: 1, border: 'none', background: '#fff', color: C.inkDim, padding: '9px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  segOn: { background: C.ink, color: '#fff' },
  trigGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  trigBtn: { textAlign: 'left', border: `1px solid ${C.lineInput}`, background: '#fff', borderRadius: 12, padding: '9px 11px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 },
  trigOn: { border: `2px solid ${C.accent}`, background: '#FFF7F5' },
  trigLabel: { fontSize: 12.5, fontWeight: 800, color: C.ink },
  trigHint: { fontSize: 10.5, color: C.inkFaint, lineHeight: 1.3 },
  note: { fontSize: 12, color: C.inkDim, marginTop: 12, lineHeight: 1.4 },
  err: { fontSize: 13, color: C.red, fontWeight: 600, marginRight: 'auto' },
  ghost: { background: 'none', border: `1px solid ${C.lineInput}`, color: C.ink, borderRadius: 10, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  save: { border: 'none', background: C.accent, color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
}
