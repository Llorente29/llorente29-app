// src/modules/shop/admin/ShopCampaignsPage.tsx
//
// G1 — Gestor de campañas del Shop. Lista de tarjetas-fila (Uber Eats Manager):
// Sistema (bienvenida/frecuencia, dorado) y Código (manual, gris), con badges de
// estado (Activa/Programada/Pausada/Caducada), config legible, rendimiento REAL a
// la derecha y acciones. "+ Nueva campaña" abre un modal con impacto de margen en
// vivo (preview_coupon_impact, reutilizado). Los de sistema se configuran en su
// sección de Diseño de la tienda; aquí solo se pausan/reactivan.
//
// Autocontenida (estilos inline). accountId vía useActiveAccount (como ShopDesignPage).

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { type DiscountType } from '@/modules/shop/admin/couponAdminService'
import {
  listCampaigns, saveCampaign, toggleCampaign, saveCampaignError,
  getCampaignMenuTree, getCampaignScope, createMirrorItem,
  type Campaign, type CampaignStatus, type CampaignKind, type ScopeRef,
  type CampaignMenuTree, type TreeItem,
} from '@/modules/shop/admin/campaignService'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5',
  accent: '#FF5436',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', amberLine: '#E9A81C', gold: '#FFF3D6', goldLine: '#F0DDB4',
  blue: '#1D4ED8', blueBg: '#EAF0FF', red: '#C23B22', pill: '#EEEEEB',
}

function eur(n: number | null | undefined): string { return n == null ? '—' : `${n.toFixed(2).replace('.', ',')} €` }
function pct(n: number | null | undefined): string { return n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%` }
function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' }
}
function promoText(t: DiscountType, v: number): string {
  return t === 'percent' ? `${String(v).replace('.', ',')}%` : eur(v)
}

// datetime-local <-> ISO (respeta la hora local del operador).
function pad(n: number): string { return String(n).padStart(2, '0') }
function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

const STATUS_META: Record<CampaignStatus, { label: string; style: CSSProperties }> = {
  active:    { label: 'Activa',     style: { color: C.greenDeep, background: C.greenBg } },
  scheduled: { label: 'Programada', style: { color: C.blue, background: C.blueBg } },
  paused:    { label: 'Pausada',    style: { color: C.inkDim, background: C.pill } },
  expired:   { label: 'Caducada',   style: { color: C.inkFaint, background: C.pill } },
}

const WD_LABELS = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D']

function kindLabel(c: Campaign): string {
  return c.isSystem ? 'Sistema'
    : c.kind === 'item_percent' ? 'Carta'
    : c.kind === 'free_delivery' ? 'Envío'
    : 'Código'
}

function configLine(c: Campaign): string {
  const parts: string[] = []
  if (c.kind === 'free_delivery') parts.push('Envío gratis')
  else if (c.kind === 'item_percent') parts.push(`${promoText('percent', c.value)} en platos`)
  else parts.push(promoText(c.discountType, c.value))
  if (c.kind === 'frequency' && c.frequencyThreshold) parts.push(`cada ${c.frequencyThreshold} pedidos`)
  if (c.firstOrderOnly) parts.push('primer pedido')
  if (c.autoApply && c.kind !== 'frequency' && c.kind !== 'free_delivery') parts.push('automática')
  if (c.code) parts.push(`código ${c.code}`)
  if (c.minSubtotal != null) parts.push(`mín ${eur(c.minSubtotal)}`)
  if (c.weekdays && c.weekdays.length) parts.push(c.weekdays.map((n) => WD_LABELS[n] ?? '').join(''))
  if (c.timeFrom && c.timeTo) parts.push(`${c.timeFrom.slice(0, 5)}–${c.timeTo.slice(0, 5)}`)
  if (c.startsAt) parts.push(`desde ${fmtDate(c.startsAt)}`)
  if (c.endsAt) parts.push(`hasta ${fmtDate(c.endsAt)}`)
  if (c.maxRedemptions != null) parts.push(`máx ${c.maxRedemptions} usos`)
  if (c.budgetMax != null) parts.push(`tope ${eur(c.budgetMax)}`)
  return parts.join(' · ')
}

export default function ShopCampaignsPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Campaign[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<null | { mode: 'new' | 'edit' | 'clone'; c?: Campaign }>(null)

  async function refresh() {
    if (!accountId) return
    setRows(await listCampaigns(accountId))
  }
  useEffect(() => { setRows(null); refresh() /* eslint-disable-next-line */ }, [accountId])

  async function onToggle(c: Campaign) {
    if (!accountId || busyId) return
    setBusyId(c.id)
    const nextActive = c.status === 'paused'   // pausada -> reactivar; cualquier otra -> pausar
    await toggleCampaign(accountId, c.id, nextActive)
    setBusyId(null)
    refresh()
  }

  const system = useMemo(() => (rows ?? []).filter((c) => c.isSystem), [rows])
  const code = useMemo(() => (rows ?? []).filter((c) => !c.isSystem), [rows])
  const s = styles

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Campañas</h1>
          <p style={s.subtitle}>Tus ofertas del Shop: las de sistema (bienvenida y fidelidad) y las que crees (código, % en platos, envío gratis). Con su rendimiento real.</p>
        </div>
        <button style={s.newBtn} onClick={() => setModal({ mode: 'new' })}>+ Nueva campaña</button>
      </div>

      {rows === null ? (
        <div style={s.muted}>Cargando campañas…</div>
      ) : (
        <>
          {system.length > 0 && (
            <>
              <div style={s.sectionLabel}>Del sistema</div>
              <div style={s.list}>
                {system.map((c) => (
                  <CampaignRow key={c.id} c={c} busy={busyId === c.id}
                    onConfigure={() => navigate('../diseno')}
                    onToggle={() => onToggle(c)} />
                ))}
              </div>
            </>
          )}

          <div style={s.sectionLabel}>Tus campañas</div>
          {code.length === 0 ? (
            <div style={s.empty}>Aún no hay campañas propias. Crea una con “+ Nueva campaña”.</div>
          ) : (
            <div style={s.list}>
              {code.map((c) => (
                <CampaignRow key={c.id} c={c} busy={busyId === c.id}
                  onEdit={() => setModal({ mode: 'edit', c })}
                  onClone={() => setModal({ mode: 'clone', c })}
                  onToggle={() => onToggle(c)} />
              ))}
            </div>
          )}
        </>
      )}

      {modal && accountId && (
        <CampaignModal
          accountId={accountId}
          mode={modal.mode}
          source={modal.c}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh() }}
        />
      )}
    </div>
  )
}

// ── Fila de campaña ─────────────────────────────────────────────────────────
function CampaignRow({ c, busy, onConfigure, onEdit, onClone, onToggle }: {
  c: Campaign; busy: boolean
  onConfigure?: () => void; onEdit?: () => void; onClone?: () => void; onToggle: () => void
}) {
  const st = STATUS_META[c.status]
  const s = styles
  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <div style={s.rowTop}>
          <span style={s.rowName}>{c.name}</span>
          <span style={{ ...s.badge, ...(c.isSystem ? s.badgeSystem : s.badgeCode) }}>{kindLabel(c)}</span>
          <span style={{ ...s.badge, ...st.style }}>{st.label}</span>
        </div>
        <div style={s.rowConfig}>{configLine(c)}</div>
      </div>

      <div style={s.rowPerf}>
        <div style={s.perfMain}>{c.redemptions} {c.redemptions === 1 ? 'canje' : 'canjes'}</div>
        <div style={s.perfSub}>
          <span style={{ color: c.discounted > 0 ? C.ink : C.inkFaint }}>−{eur(c.discounted)}</span>
          {c.avgMarginPct != null && <span style={{ color: C.greenDeep }}> · margen {pct(c.avgMarginPct)}</span>}
        </div>
      </div>

      <div style={s.rowActions}>
        {c.isSystem ? (
          <button style={s.actBtn} onClick={onConfigure}>Configurar</button>
        ) : (
          <>
            <button style={s.actBtn} onClick={onEdit}>Editar</button>
            <button style={s.actBtn} onClick={onClone}>Clonar</button>
          </>
        )}
        <button style={{ ...s.actBtn, ...(busy ? s.actOff : {}) }} onClick={onToggle} disabled={busy}>
          {c.status === 'paused' ? 'Reactivar' : 'Pausar'}
        </button>
      </div>
    </div>
  )
}

// ── Modal de creación / edición / clonación ─────────────────────────────────
function round2(n: number): number { return Math.round(n * 100) / 100 }
const WEEKDAYS: [number, string][] = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']]
const KIND_OPTS: { kind: CampaignKind; dt?: DiscountType; label: string; hint: string }[] = [
  { kind: 'standard', dt: 'percent', label: '% del pedido', hint: 'Código con % sobre el subtotal' },
  { kind: 'standard', dt: 'fixed', label: '€ del pedido', hint: 'Código con importe fijo' },
  { kind: 'item_percent', label: '% en platos', hint: 'Oferta de carta sobre marca/categoría/platos' },
  { kind: 'free_delivery', label: 'Envío gratis', hint: 'Sin gastos de envío' },
]

function CampaignModal({ accountId, mode, source, onClose, onSaved }: {
  accountId: string
  mode: 'new' | 'edit' | 'clone'
  source?: Campaign
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode === 'edit'
  const s = styles
  const initKind: CampaignKind = source?.kind && source.kind !== 'frequency' ? source.kind : 'standard'
  const [kind, setKind] = useState<CampaignKind>(initKind)
  const [name, setName] = useState(source ? (mode === 'clone' ? `${source.name} (copia)` : source.name) : '')
  const [code, setCode] = useState(source?.code ? (mode === 'clone' ? `COPIA-${source.code}` : source.code) : '')
  const [discountType, setDiscountType] = useState<DiscountType>(source?.discountType ?? 'percent')
  const [value, setValue] = useState<number>(source?.value ?? 10)
  const [minSubtotal, setMinSubtotal] = useState<number | null>(source?.minSubtotal ?? null)
  const [startsAt, setStartsAt] = useState(isoToLocal(source?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState(isoToLocal(source?.endsAt ?? null))
  const [maxRedemptions, setMaxRedemptions] = useState<number | null>(source?.maxRedemptions ?? null)
  const [maxPerCustomer, setMaxPerCustomer] = useState<number>(source?.maxPerCustomer ?? 1)
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(source?.weekdays ?? []))
  const [timeFrom, setTimeFrom] = useState((source?.timeFrom ?? '').slice(0, 5))
  const [timeTo, setTimeTo] = useState((source?.timeTo ?? '').slice(0, 5))
  const [budgetMax, setBudgetMax] = useState<number | null>(source?.budgetMax ?? null)
  const [scope, setScope] = useState<ScopeRef[]>([])
  const [tree, setTree] = useState<CampaignMenuTree | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMsg, setMirrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getCampaignMenuTree(accountId).then((t) => { if (alive) setTree(t) })
    if (source && (mode === 'edit' || mode === 'clone') && source.kind === 'item_percent') {
      getCampaignScope(source.id).then((sc) => { if (alive) setScope(sc) })
    }
    return () => { alive = false }
  }, [accountId, source, mode])

  const isStd = kind === 'standard', isItem = kind === 'item_percent', isFree = kind === 'free_delivery'

  const affected: TreeItem[] = useMemo(() => {
    if (!tree || !isItem) return []
    const byBrand = new Map<string, TreeItem[]>(), byCat = new Map<string, TreeItem[]>(), byItem = new Map<string, TreeItem>()
    for (const b of tree.brands) {
      const arr: TreeItem[] = []
      for (const c of b.categories) {
        const carr: TreeItem[] = []
        for (const it of c.items) { arr.push(it); carr.push(it); byItem.set(it.id, it) }
        byCat.set(c.id, carr)
      }
      byBrand.set(b.id, arr)
    }
    const out = new Map<string, TreeItem>()
    for (const r of scope) {
      const list = r.type === 'brand' ? byBrand.get(r.id) : r.type === 'category' ? byCat.get(r.id) : (byItem.get(r.id) ? [byItem.get(r.id)!] : [])
      for (const it of (list ?? [])) out.set(it.id, it)
    }
    return [...out.values()]
  }, [tree, scope, isItem])

  const impact = useMemo(() => {
    const floor = tree?.floorPct ?? null
    const costed = affected.filter((i) => i.costed && i.price > 0)
    const uncosted = affected.length - costed.length
    let sumNow = 0, sumAfter = 0, below = 0; const belowNames: string[] = []; let noTachado = 0
    for (const it of costed) {
      const disc = round2(it.price * (1 - value / 100))
      const mNow = (it.price - (it.cost ?? 0)) / it.price * 100
      const mAfter = disc > 0 ? (disc - (it.cost ?? 0)) / disc * 100 : 0
      sumNow += mNow; sumAfter += mAfter
      if (floor != null && mAfter < floor) { below++; if (belowNames.length < 3) belowNames.push(it.name) }
    }
    for (const it of affected) {
      if (it.refPrice != null) { const disc = round2(it.price * (1 - value / 100)); if (!(it.refPrice > disc)) noTachado++ }
    }
    return {
      floor, count: affected.length, costedCount: costed.length, uncosted,
      marginNow: costed.length ? sumNow / costed.length : null,
      marginAfter: costed.length ? sumAfter / costed.length : null,
      below, belowNames, noTachado,
    }
  }, [affected, value, tree])

  const singleItemForMirror: TreeItem | null = useMemo(() => {
    if (!isItem || scope.length !== 1 || scope[0].type !== 'item') return null
    const it = affected[0]; if (!it || it.refPrice == null) return null
    const disc = round2(it.price * (1 - value / 100))
    return it.refPrice > disc ? null : it
  }, [isItem, scope, affected, value])

  function toggleScope(r: ScopeRef) {
    setScope((prev) => prev.some((x) => x.type === r.type && x.id === r.id) ? prev.filter((x) => !(x.type === r.type && x.id === r.id)) : [...prev, r])
  }
  const scoped = (r: ScopeRef) => scope.some((x) => x.type === r.type && x.id === r.id)
  function toggleWeekday(n: number) { setWeekdays((prev) => { const st = new Set(prev); st.has(n) ? st.delete(n) : st.add(n); return st }) }

  async function onMirror() {
    if (!singleItemForMirror) return
    const r = await createMirrorItem(accountId, singleItemForMirror.id)
    setMirrorMsg(r.ok ? 'Espejo creado (oculto). Actívalo desde la carta y ponle su precio agresivo.' : 'No se pudo crear el espejo.')
  }

  async function onSave() {
    if (saving) return
    setSaving(true); setError(null)
    const res = await saveCampaign(accountId, {
      id: mode === 'edit' ? (source?.id ?? null) : null,
      kind,
      name,
      code: isStd ? code : null,
      discountType: isStd ? discountType : undefined,
      value: isStd || isItem ? value : undefined,
      minSubtotal: (isStd || isFree) ? minSubtotal : null,
      startsAt: localToIso(startsAt),
      endsAt: localToIso(endsAt),
      maxRedemptions,
      maxPerCustomer,
      weekdays: weekdays.size ? [...weekdays].sort((a, b) => a - b) : null,
      timeFrom: timeFrom || null,
      timeTo: timeTo || null,
      budgetMax,
      scope: isItem ? scope : undefined,
    })
    setSaving(false)
    if (!res.ok) { setError(saveCampaignError(res.reason)); return }
    onSaved()
  }

  const title = editing ? 'Editar campaña' : mode === 'clone' ? 'Clonar campaña' : 'Nueva campaña'

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalTitle}>{title}</h2>
          <button style={s.modalX} onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div style={s.modalBody}>
          {mode !== 'edit' && (
            <>
              <label style={s.label}>Tipo de campaña</label>
              <div style={s.typeGrid}>
                {KIND_OPTS.map((o) => {
                  const on = kind === o.kind && (o.kind !== 'standard' || discountType === o.dt)
                  return (
                    <button key={o.label} type="button" style={{ ...s.typeBtn, ...(on ? s.typeOn : {}) }}
                      onClick={() => { setKind(o.kind); if (o.dt) setDiscountType(o.dt) }}>
                      <span style={s.typeLabel}>{o.label}</span>
                      <span style={s.typeHint}>{o.hint}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <label style={s.label}>Nombre</label>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Semana del 10%" />

          {isStd && (
            <>
              <label style={s.label}>Código</label>
              <input style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SEMANA10" autoCapitalize="characters" />
              <div style={s.row2}>
                <div style={s.field}>
                  <label style={s.label}>Tipo</label>
                  <div style={s.seg}>
                    <button type="button" onClick={() => setDiscountType('percent')} style={{ ...s.segBtn, ...(discountType === 'percent' ? s.segOn : {}) }}>%</button>
                    <button type="button" onClick={() => setDiscountType('fixed')} style={{ ...s.segBtn, ...(discountType === 'fixed' ? s.segOn : {}) }}>€</button>
                  </div>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Valor</label>
                  <div style={s.valueRow}>
                    <input type="number" min={0} value={Number.isFinite(value) ? value : 0} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} style={s.input} />
                    <span style={s.unit}>{discountType === 'percent' ? '%' : '€'}</span>
                  </div>
                </div>
              </div>
              <div style={s.row2}>
                <div style={s.field}>
                  <label style={s.label}>Mínimo <span style={s.opt}>(opcional)</span></label>
                  <div style={s.valueRow}>
                    <input type="number" min={0} value={minSubtotal ?? ''} placeholder="sin mínimo" onChange={(e) => setMinSubtotal(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                    <span style={s.unit}>€</span>
                  </div>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Máx. usos <span style={s.opt}>(opcional)</span></label>
                  <input type="number" min={1} value={maxRedemptions ?? ''} placeholder="ilimitado" onChange={(e) => setMaxRedemptions(e.target.value === '' ? null : (parseInt(e.target.value) || 0))} style={s.input} />
                </div>
              </div>
            </>
          )}

          {isItem && (
            <>
              <div style={s.field}>
                <label style={s.label}>Descuento por plato</label>
                <div style={s.valueRow}>
                  <input type="number" min={0} max={100} value={Number.isFinite(value) ? value : 0} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} style={s.input} />
                  <span style={s.unit}>%</span>
                </div>
              </div>
              <label style={s.label}>¿A qué platos? <span style={s.opt}>({affected.length} platos)</span></label>
              <div style={s.scopeTree}>
                {tree?.brands.map((b) => (
                  <div key={b.id} style={s.scBrand}>
                    <label style={s.scRow}><input type="checkbox" checked={scoped({ type: 'brand', id: b.id })} onChange={() => toggleScope({ type: 'brand', id: b.id })} style={s.checkBox} /><b>{b.name}</b> <span style={s.scHint}>(toda la marca)</span></label>
                    {b.categories.map((c) => (
                      <div key={c.id} style={s.scCat}>
                        <label style={s.scRow}><input type="checkbox" checked={scoped({ type: 'category', id: c.id })} onChange={() => toggleScope({ type: 'category', id: c.id })} style={s.checkBox} />{c.name} <span style={s.scHint}>({c.items.length})</span></label>
                        {c.items.map((it) => (
                          <label key={it.id} style={{ ...s.scRow, ...s.scItem }}><input type="checkbox" checked={scoped({ type: 'item', id: it.id })} onChange={() => toggleScope({ type: 'item', id: it.id })} style={s.checkBox} />{it.name} <span style={s.scHint}>{eur(it.price)}{!it.costed ? ' · sin escandallo' : ''}</span></label>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          {isFree && (
            <div style={s.field}>
              <label style={s.label}>Mínimo para el envío gratis <span style={s.opt}>(opcional)</span></label>
              <div style={s.valueRow}>
                <input type="number" min={0} value={minSubtotal ?? ''} placeholder="sin mínimo" onChange={(e) => setMinSubtotal(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                <span style={s.unit}>€</span>
              </div>
            </div>
          )}

          {(isItem || isFree) && (
            <>
              <label style={s.label}>Días <span style={s.opt}>(vacío = todos)</span></label>
              <div style={s.wdRow}>
                {WEEKDAYS.map(([n, l]) => <button key={n} type="button" style={{ ...s.wdBtn, ...(weekdays.has(n) ? s.wdOn : {}) }} onClick={() => toggleWeekday(n)}>{l}</button>)}
              </div>
              <div style={s.row2}>
                <div style={s.field}><label style={s.label}>Desde <span style={s.opt}>(hora)</span></label><input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} style={s.input} /></div>
                <div style={s.field}><label style={s.label}>Hasta <span style={s.opt}>(hora)</span></label><input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} style={s.input} /></div>
              </div>
            </>
          )}

          <div style={s.row2}>
            <div style={s.field}><label style={s.label}>Empieza <span style={s.opt}>(opcional)</span></label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={s.input} /></div>
            <div style={s.field}><label style={s.label}>Termina <span style={s.opt}>(opcional)</span></label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={s.input} /></div>
          </div>

          {(isItem || isFree) && (
            <div style={s.field}>
              <label style={s.label}>Presupuesto máx. <span style={s.opt}>(€ de descuento; opcional)</span></label>
              <div style={s.valueRow}>
                <input type="number" min={0} value={budgetMax ?? ''} placeholder="sin tope" onChange={(e) => setBudgetMax(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                <span style={s.unit}>€</span>
              </div>
            </div>
          )}

          {isItem && affected.length > 0 && (
            <div style={s.impact}>
              <div style={s.impactHead}>Impacto en tu margen ({impact.costedCount} de {impact.count} con escandallo)</div>
              <div style={s.marginBig}>
                <span style={s.marginNow}>{pct(impact.marginNow)}</span>
                <span style={s.arrow}>→</span>
                <span style={{ ...s.marginAfter, color: (impact.floor != null && impact.marginAfter != null && impact.marginAfter < impact.floor) ? C.red : C.greenDeep }}>{pct(impact.marginAfter)}</span>
                <span style={s.marginCaption}>margen medio por plato</span>
              </div>
              {impact.uncosted > 0 && <div style={s.warn}>{impact.uncosted} platos sin escandallo (no cuentan en el margen).</div>}
              {impact.below > 0 && <div style={s.warn}>{impact.below} platos quedarían bajo el suelo{impact.belowNames.length ? `: ${impact.belowNames.join(', ')}${impact.below > impact.belowNames.length ? '…' : ''}` : ''}.</div>}
              {impact.noTachado === 0
                ? <div style={s.okNote}>✓ Tachado legal verificado en los platos con historial.</div>
                : <div style={s.warn}>{impact.noTachado} platos no mostrarán tachado (su precio de referencia de 30 días no supera el precio con descuento): se verá el badge sin precio anterior.</div>}
              {singleItemForMirror && (
                <div style={s.mirrorBox}>
                  <div style={s.mirrorText}>Para vender <b>{singleItemForMirror.name}</b> a precio agresivo con tachado limpio, crea una versión promo (artículo espejo): nace sin historial, así el tachado es legal.</div>
                  <button type="button" style={s.mirrorBtn} onClick={onMirror}>Crear versión promo (espejo)</button>
                  {mirrorMsg && <div style={s.mirrorMsg}>{mirrorMsg}</div>}
                </div>
              )}
            </div>
          )}

          <div style={s.field}>
            <label style={s.label}>Máx. por cliente</label>
            <input type="number" min={1} value={Number.isFinite(maxPerCustomer) ? maxPerCustomer : 1} onChange={(e) => setMaxPerCustomer(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...s.input, maxWidth: 120 }} />
          </div>
        </div>

        <div style={s.modalFoot}>
          {error && <span style={s.err}>{error}</span>}
          <button style={s.ghost} onClick={onClose}>Cancelar</button>
          <button style={{ ...s.save, ...(saving ? { opacity: 0.6 } : {}) }} onClick={onSave} disabled={saving}>
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear campaña'}
          </button>
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
  sectionLabel: { fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.inkFaint, margin: '18px 0 10px' },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  empty: { border: `1px dashed ${C.lineInput}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.inkDim, fontSize: 13.5 },

  row: { display: 'flex', alignItems: 'center', gap: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowName: { fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-.01em' },
  badge: { fontSize: 11, fontWeight: 800, letterSpacing: '.02em', padding: '3px 9px', borderRadius: 999 },
  badgeSystem: { color: C.amber, background: C.gold, border: `1px solid ${C.goldLine}` },
  badgeCode: { color: C.inkDim, background: C.pill },
  rowConfig: { fontSize: 12.5, color: C.inkDim, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowPerf: { textAlign: 'right', flexShrink: 0, minWidth: 130 },
  perfMain: { fontSize: 15, fontWeight: 800, color: C.ink },
  perfSub: { fontSize: 12, color: C.inkDim, marginTop: 2 },
  rowActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  actBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  actOff: { opacity: 0.5, cursor: 'default' },

  modalWrap: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,14,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { background: '#fff', borderRadius: 18, maxWidth: 560, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.3)' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${C.line}` },
  modalTitle: { fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', margin: 0 },
  modalX: { background: C.page, border: `1px solid ${C.line}`, borderRadius: '50%', width: 32, height: 32, fontSize: 20, lineHeight: 1, cursor: 'pointer', color: C.ink },
  modalBody: { padding: '18px 22px', overflowY: 'auto' },
  modalFoot: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '14px 22px', borderTop: `1px solid ${C.line}` },

  label: { display: 'block', fontSize: 12.5, fontWeight: 600, color: C.inkDim, margin: '12px 0 5px' },
  opt: { fontWeight: 400, color: C.inkFaint },
  input: { width: '100%', border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  presets: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  presetBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '5px 13px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  row2: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 150 },
  seg: { display: 'flex', border: `1px solid ${C.lineInput}`, borderRadius: 10, overflow: 'hidden' },
  segBtn: { flex: 1, border: 'none', background: '#fff', color: C.inkDim, padding: '9px 10px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  segOn: { background: C.ink, color: '#fff' },
  valueRow: { display: 'flex', alignItems: 'center', gap: 8 },
  unit: { fontSize: 14, fontWeight: 500, color: C.inkDim },
  impact: { marginTop: 16, background: C.page, border: `1px solid ${C.line}`, borderRadius: 12, padding: '13px 15px', transition: 'opacity .15s' },
  impactHead: { fontSize: 12.5, fontWeight: 600, color: C.inkDim, marginBottom: 9 },
  marginBig: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  marginNow: { fontSize: 22, fontWeight: 600, color: C.inkFaint },
  arrow: { fontSize: 17, color: C.inkFaint },
  marginAfter: { fontSize: 24, fontWeight: 600 },
  marginCaption: { fontSize: 12, color: C.inkFaint },
  note: { fontSize: 13, color: C.inkDim, lineHeight: 1.45 },
  warn: { marginTop: 10, padding: '8px 11px', background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 10, fontSize: 12, color: C.amber, lineHeight: 1.4 },
  err: { fontSize: 13, color: C.red, fontWeight: 600, marginRight: 'auto' },
  ghost: { background: 'none', border: `1px solid ${C.lineInput}`, color: C.ink, borderRadius: 10, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  save: { border: 'none', background: C.accent, color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },

  // Gestor D
  typeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 },
  typeBtn: { textAlign: 'left', border: `1px solid ${C.lineInput}`, background: '#fff', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 },
  typeOn: { border: `2px solid ${C.accent}`, background: '#FFF7F5' },
  typeLabel: { fontSize: 13.5, fontWeight: 800, color: C.ink },
  typeHint: { fontSize: 11.5, color: C.inkFaint, lineHeight: 1.3 },
  scopeTree: { maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '8px 10px', marginTop: 4 },
  scBrand: { marginBottom: 8 },
  scCat: { marginLeft: 16 },
  scItem: { marginLeft: 16, color: C.inkDim },
  scRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0', cursor: 'pointer' },
  scHint: { color: C.inkFaint, fontSize: 12, fontWeight: 400 },
  checkBox: { width: 15, height: 15, accentColor: C.accent, cursor: 'pointer', flexShrink: 0 },
  wdRow: { display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  wdBtn: { width: 34, height: 34, borderRadius: '50%', border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  wdOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  okNote: { marginTop: 10, padding: '8px 11px', background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 10, fontSize: 12, color: C.greenDeep, fontWeight: 600 },
  mirrorBox: { marginTop: 12, padding: '11px 13px', background: C.gold, border: `1px solid ${C.goldLine}`, borderRadius: 12 },
  mirrorText: { fontSize: 12.5, color: C.amber, lineHeight: 1.45, marginBottom: 9 },
  mirrorBtn: { border: 'none', background: C.ink, color: '#fff', borderRadius: 999, padding: '8px 15px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  mirrorMsg: { fontSize: 12, color: C.greenDeep, marginTop: 8, fontWeight: 600 },
}
