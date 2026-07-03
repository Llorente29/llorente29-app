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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { previewCouponImpact, type DiscountType, type CouponImpact } from '@/modules/shop/admin/couponAdminService'
import {
  listCampaigns, saveCampaign, toggleCampaign, saveCampaignError,
  type Campaign, type CampaignStatus,
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

function configLine(c: Campaign): string {
  const parts: string[] = [promoText(c.discountType, c.value)]
  if (c.kind === 'frequency' && c.frequencyThreshold) parts.push(`cada ${c.frequencyThreshold} pedidos`)
  if (c.firstOrderOnly) parts.push('primer pedido')
  if (c.autoApply && c.kind !== 'frequency') parts.push('automática')
  if (c.code) parts.push(`código ${c.code}`)
  if (c.minSubtotal != null) parts.push(`mín ${eur(c.minSubtotal)}`)
  if (c.startsAt) parts.push(`desde ${fmtDate(c.startsAt)}`)
  if (c.endsAt) parts.push(`hasta ${fmtDate(c.endsAt)}`)
  if (c.maxRedemptions != null) parts.push(`máx ${c.maxRedemptions} usos`)
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
          <p style={s.subtitle}>Tus ofertas del Shop: las de sistema (bienvenida y fidelidad) y las que crees con código. Con su rendimiento real.</p>
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

          <div style={s.sectionLabel}>De código</div>
          {code.length === 0 ? (
            <div style={s.empty}>Aún no hay campañas de código. Crea una con “+ Nueva campaña”.</div>
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
          <span style={{ ...s.badge, ...(c.isSystem ? s.badgeSystem : s.badgeCode) }}>{c.isSystem ? 'Sistema' : 'Código'}</span>
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
function CampaignModal({ accountId, mode, source, onClose, onSaved }: {
  accountId: string
  mode: 'new' | 'edit' | 'clone'
  source?: Campaign
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode === 'edit'
  const [name, setName] = useState(source ? (mode === 'clone' ? `${source.name} (copia)` : source.name) : '')
  const [code, setCode] = useState(source?.code ? (mode === 'clone' ? `COPIA-${source.code}` : source.code) : '')
  const [discountType, setDiscountType] = useState<DiscountType>(source?.discountType ?? 'percent')
  const [value, setValue] = useState<number>(source?.value ?? 10)
  const [minSubtotal, setMinSubtotal] = useState<number | null>(source?.minSubtotal ?? null)
  const [startsAt, setStartsAt] = useState<string>(isoToLocal(source?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState<string>(isoToLocal(source?.endsAt ?? null))
  const [maxRedemptions, setMaxRedemptions] = useState<number | null>(source?.maxRedemptions ?? null)
  const [maxPerCustomer, setMaxPerCustomer] = useState<number>(source?.maxPerCustomer ?? 1)

  const [impact, setImpact] = useState<CouponImpact | null>(null)
  const [impactBusy, setImpactBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debRef = useRef<number | null>(null)
  const s = styles

  // Impacto de margen en vivo (misma llamada que WelcomeOfferSettings).
  useEffect(() => {
    setImpactBusy(true)
    if (debRef.current) window.clearTimeout(debRef.current)
    debRef.current = window.setTimeout(async () => {
      const imp = await previewCouponImpact(accountId, discountType, value)
      setImpact(imp); setImpactBusy(false)
    }, 350)
    return () => { if (debRef.current) window.clearTimeout(debRef.current) }
  }, [discountType, value, accountId])

  async function onSave() {
    if (saving) return
    setSaving(true); setError(null)
    const res = await saveCampaign(accountId, {
      id: mode === 'edit' ? source?.id ?? null : null,
      name, code,
      discountType, value,
      minSubtotal,
      startsAt: localToIso(startsAt),
      endsAt: localToIso(endsAt),
      maxRedemptions,
      maxPerCustomer,
    })
    setSaving(false)
    if (!res.ok) { setError(saveCampaignError(res.reason)); return }
    onSaved()
  }

  const nowM = impact?.avgMarginNowPct ?? null
  const afterM = impact?.avgMarginAfterPct ?? null

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalTitle}>{editing ? 'Editar campaña' : mode === 'clone' ? 'Clonar campaña' : 'Nueva campaña'}</h2>
          <button style={s.modalX} onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div style={s.modalBody}>
          <label style={s.label}>Nombre</label>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Semana del 10%" />

          <label style={s.label}>Código</label>
          <input style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SEMANA10" autoCapitalize="characters" />

          {/* Presets de premio */}
          <div style={s.presets}>
            <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('percent'); setValue(10) }}>10%</button>
            <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('percent'); setValue(20) }}>20%</button>
            <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('fixed'); setValue(4) }}>4 €</button>
            <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('fixed'); setValue(5) }}>5 €</button>
          </div>

          <div style={s.row2}>
            <div style={s.field}>
              <label style={s.label}>Tipo</label>
              <div style={s.seg}>
                <button type="button" onClick={() => setDiscountType('percent')} style={{ ...s.segBtn, ...(discountType === 'percent' ? s.segOn : {}) }}>Porcentaje</button>
                <button type="button" onClick={() => setDiscountType('fixed')} style={{ ...s.segBtn, ...(discountType === 'fixed' ? s.segOn : {}) }}>Importe fijo</button>
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>Valor</label>
              <div style={s.valueRow}>
                <input type="number" min={0} step={discountType === 'percent' ? 1 : 0.5} value={Number.isFinite(value) ? value : 0}
                  onChange={(e) => setValue(parseFloat(e.target.value) || 0)} style={s.input} />
                <span style={s.unit}>{discountType === 'percent' ? '%' : '€'}</span>
              </div>
            </div>
          </div>

          <div style={s.row2}>
            <div style={s.field}>
              <label style={s.label}>Mínimo <span style={s.opt}>(opcional)</span></label>
              <div style={s.valueRow}>
                <input type="number" min={0} step={1} value={minSubtotal ?? ''} placeholder="sin mínimo"
                  onChange={(e) => setMinSubtotal(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                <span style={s.unit}>€</span>
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>Máx. usos totales <span style={s.opt}>(opcional)</span></label>
              <input type="number" min={1} step={1} value={maxRedemptions ?? ''} placeholder="ilimitado"
                onChange={(e) => setMaxRedemptions(e.target.value === '' ? null : (parseInt(e.target.value) || 0))} style={s.input} />
            </div>
          </div>

          <div style={s.row2}>
            <div style={s.field}>
              <label style={s.label}>Empieza <span style={s.opt}>(opcional)</span></label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={s.input} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Termina <span style={s.opt}>(opcional)</span></label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={s.input} />
            </div>
          </div>

          <div style={s.field}>
            <label style={s.label}>Máx. por cliente</label>
            <input type="number" min={1} step={1} value={Number.isFinite(maxPerCustomer) ? maxPerCustomer : 1}
              onChange={(e) => setMaxPerCustomer(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...s.input, maxWidth: 120 }} />
          </div>

          {/* Impacto de margen en vivo */}
          <div style={{ ...s.impact, opacity: impactBusy ? 0.6 : 1 }}>
            <div style={s.impactHead}>Impacto en tu margen</div>
            {discountType === 'fixed' && impact?.effectivePct == null ? (
              <div style={s.note}>Aún no hay pedidos para estimar el efecto de un importe fijo.</div>
            ) : (
              <>
                <div style={s.marginBig}>
                  <span style={s.marginNow}>{pct(nowM)}</span>
                  <span style={s.arrow}>{'→'}</span>
                  <span style={{ ...s.marginAfter, color: (impact?.floorPct != null && afterM != null && afterM < impact.floorPct) ? C.red : C.greenDeep }}>{pct(afterM)}</span>
                  <span style={s.marginCaption}>margen medio · desc. efectivo {impact?.effectivePct != null ? pct(impact.effectivePct) : '—'}</span>
                </div>
                {(impact?.uncostedItems ?? 0) > 0 && (
                  <div style={s.warn}>{impact!.uncostedItems} de {impact!.sellableItems} platos no tienen escandallo y no cuentan en el margen.</div>
                )}
              </>
            )}
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
}
