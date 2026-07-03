// src/modules/shop/admin/FrequencyRewardSettings.tsx
//
// F4·T3 — Motor de recompensa por FRECUENCIA por cuenta, con el IMPACTO DE MARGEN
// REAL delante (golpe nº1 de Folvy). El operador elige "cada N pedidos, un premio X"
// y ve, en vivo, qué le hace a su margen antes de guardar. Reutiliza la RPC
// preview_coupon_impact (agnóstica del cupón) y guarda con save_frequency_reward.
//
// Autocontenida (estilos inline); se monta con <FrequencyRewardSettings accountId={…} />.
// El suelo de margen es el de la cuenta (se configura en "Oferta de bienvenida");
// aquí se muestra como referencia. El premio se aplica SOLO al llegar a N pedidos.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  getFrequencyReward, previewCouponImpact, saveFrequencyReward,
  type DiscountType, type CouponImpact,
} from '@/modules/shop/admin/couponAdminService'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5',
  accent: '#FF5436', accentBg: '#FFF4F1',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', amberLine: '#E9A81C',
  red: '#C23B22', redBg: '#FDE7E2', pill: '#EEEEEB',
}

function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`
}
function eur(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toFixed(2).replace('.', ',')} €`
}

export default function FrequencyRewardSettings({ accountId }: { accountId: string }) {
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(true)
  const [threshold, setThreshold] = useState<number>(5)
  const [discountType, setDiscountType] = useState<DiscountType>('percent')
  const [value, setValue] = useState<number>(10)

  const [impact, setImpact] = useState<CouponImpact | null>(null)
  const [impactBusy, setImpactBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debRef = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const off = await getFrequencyReward(accountId)
      if (!alive) return
      setActive(off.active); setThreshold(off.threshold); setDiscountType(off.discountType); setValue(off.value)
      const imp = await previewCouponImpact(accountId, off.discountType, off.value)
      if (!alive) return
      setImpact(imp); setLoading(false)
    })()
    return () => { alive = false }
  }, [accountId])

  // Recalcular impacto al cambiar tipo/valor (el umbral no afecta al margen por pedido).
  useEffect(() => {
    if (loading) return
    setImpactBusy(true)
    if (debRef.current) window.clearTimeout(debRef.current)
    debRef.current = window.setTimeout(async () => {
      const imp = await previewCouponImpact(accountId, discountType, value)
      setImpact(imp); setImpactBusy(false)
    }, 350)
    return () => { if (debRef.current) window.clearTimeout(debRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountType, value, accountId])

  async function onSave() {
    if (threshold < 2) { setError('El umbral debe ser 2 o más.'); return }
    setSaving(true); setError(null); setSaved(false)
    const res = await saveFrequencyReward({ accountId, active, threshold, discountType, value })
    setSaving(false)
    if (!res.ok) { setError('No se pudo guardar. Inténtalo de nuevo.'); return }
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  const nowM = impact?.avgMarginNowPct ?? null
  const afterM = impact?.avgMarginAfterPct ?? null
  const floorPct = impact?.floorPct ?? null
  const belowFloor = impact?.itemsBelowFloorAfter ?? null
  const afterBad = floorPct != null && afterM != null && afterM < floorPct
  const s = styles

  if (loading) {
    return <div style={{ ...s.card, color: C.inkFaint }}>Cargando el motor de fidelidad…</div>
  }

  return (
    <div style={s.card}>
      <div style={s.head}>
        <div>
          <div style={s.title}>Recompensa por frecuencia</div>
          <div style={s.sub}>Premia a quien repite: cada N pedidos, un descuento. El premio se aplica solo al llegar a N; mira su impacto en tu margen antes de guardar.</div>
        </div>
        <label style={s.switchRow}>
          <input type="checkbox" checked={active} onChange={(e) => { setActive(e.target.checked); setSaved(false) }} style={s.switchBox} />
          <span style={s.switchLabel}>{active ? 'Activo' : 'Desactivado'}</span>
        </label>
      </div>

      {/* Umbral N */}
      <div style={s.presets}>
        <span style={s.presetsLabel}>Cada</span>
        {[3, 5, 10].map((n) => (
          <button key={n} type="button"
            style={{ ...s.presetBtn, ...(threshold === n ? s.presetOn : {}) }}
            onClick={() => { setThreshold(n); setSaved(false) }}>{n}</button>
        ))}
        <input type="number" min={2} step={1} value={Number.isFinite(threshold) ? threshold : 0}
          onChange={(e) => { setThreshold(Math.max(2, Math.round(parseFloat(e.target.value) || 0))); setSaved(false) }}
          style={{ ...s.input, width: 70 }} />
        <span style={s.presetsLabel}>pedidos, premio de:</span>
      </div>

      {/* Premio */}
      <div style={s.presets}>
        <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('percent'); setValue(10); setSaved(false) }}>10%</button>
        <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('percent'); setValue(20); setSaved(false) }}>20%</button>
        <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('fixed'); setValue(4); setSaved(false) }}>4 €</button>
        <button type="button" style={s.presetBtn} onClick={() => { setDiscountType('fixed'); setValue(5); setSaved(false) }}>5 €</button>
      </div>

      <div style={s.row}>
        <div style={s.field}>
          <label style={s.label}>Tipo</label>
          <div style={s.seg}>
            <button type="button" onClick={() => { setDiscountType('percent'); setSaved(false) }}
              style={{ ...s.segBtn, ...(discountType === 'percent' ? s.segOn : {}) }}>Porcentaje</button>
            <button type="button" onClick={() => { setDiscountType('fixed'); setSaved(false) }}
              style={{ ...s.segBtn, ...(discountType === 'fixed' ? s.segOn : {}) }}>Importe fijo</button>
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Valor del premio</label>
          <div style={s.valueRow}>
            <input type="number" min={0} step={discountType === 'percent' ? 1 : 0.5}
              value={Number.isFinite(value) ? value : 0}
              onChange={(e) => { setValue(parseFloat(e.target.value) || 0); setSaved(false) }}
              style={s.input} />
            <span style={s.unit}>{discountType === 'percent' ? '%' : '€'}</span>
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Suelo de margen <span style={s.opt}>(de la cuenta)</span></label>
          <div style={s.floorRO}>{floorPct != null ? pct(floorPct) : 'sin suelo'}</div>
        </div>
      </div>

      {/* Impacto de margen real */}
      <div style={{ ...s.impact, opacity: impactBusy ? 0.6 : 1 }}>
        <div style={s.impactHead}>Impacto en tu margen (cuando se aplique el premio)</div>

        {discountType === 'fixed' && impact?.effectivePct == null ? (
          <div style={s.note}>Aún no hay pedidos para estimar el efecto de un importe fijo. Se estimará en cuanto tengas ventas del Shop.</div>
        ) : (
          <>
            <div style={s.marginBig}>
              <span style={s.marginNow}>{pct(nowM)}</span>
              <span style={s.arrow}>{'→'}</span>
              <span style={{ ...s.marginAfter, color: afterBad ? C.red : C.greenDeep }}>{pct(afterM)}</span>
              <span style={s.marginCaption}>margen medio por plato</span>
            </div>
            <div style={s.stats}>
              <div style={s.stat}>
                <div style={s.statVal}>{impact?.effectivePct != null ? pct(impact.effectivePct) : '—'}</div>
                <div style={s.statLbl}>descuento efectivo{impact?.avgOrder != null ? ` · pedido medio ${eur(impact.avgOrder)}` : ''}</div>
              </div>
              {floorPct != null && (
                <div style={s.stat}>
                  <div style={{ ...s.statVal, color: (belowFloor ?? 0) > 0 ? C.red : C.ink }}>{belowFloor ?? 0}</div>
                  <div style={s.statLbl}>platos bajo el suelo ({pct(floorPct)})</div>
                </div>
              )}
              <div style={s.stat}>
                <div style={s.statVal}>{pct(impact?.minMarginAfterPct)}</div>
                <div style={s.statLbl}>margen del peor plato</div>
              </div>
            </div>

            {(impact?.uncostedItems ?? 0) > 0 && (
              <div style={s.warn}>
                {impact!.uncostedItems} de {impact!.sellableItems} platos no tienen escandallo y no cuentan en el margen. Complétalos para ver el impacto real.
              </div>
            )}
            {afterBad && (
              <div style={s.warn}>
                El margen medio quedaría por debajo de tu suelo. En el premio por frecuencia el suelo es DURO: los platos que caigan por debajo no recibirán el descuento.
              </div>
            )}
          </>
        )}
      </div>

      <div style={s.actions}>
        {error && <span style={s.err}>{error}</span>}
        {saved && <span style={s.ok}>{'✓'} Guardado</span>}
        <button type="button" onClick={onSave} disabled={saving} style={{ ...s.save, ...(saving ? { opacity: 0.6 } : {}) }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '18px 20px' },
  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  title: { fontSize: 16, fontWeight: 600, color: C.ink },
  sub: { fontSize: 13, color: C.inkDim, marginTop: 3, maxWidth: 520, lineHeight: 1.45 },
  switchRow: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, cursor: 'pointer' },
  switchBox: { width: 18, height: 18, accentColor: C.green, cursor: 'pointer' },
  switchLabel: { fontSize: 13, fontWeight: 500, color: C.ink },
  presets: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  presetsLabel: { fontSize: 12.5, color: C.inkFaint },
  presetBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '5px 13px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  presetOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  row: { display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150, flex: 1 },
  label: { fontSize: 12.5, fontWeight: 500, color: C.inkDim },
  opt: { fontWeight: 400, color: C.inkFaint },
  seg: { display: 'flex', border: `1px solid ${C.lineInput}`, borderRadius: 10, overflow: 'hidden' },
  segBtn: { flex: 1, border: 'none', background: '#fff', color: C.inkDim, padding: '9px 10px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  segOn: { background: C.ink, color: '#fff' },
  valueRow: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  unit: { fontSize: 14, fontWeight: 500, color: C.inkDim },
  floorRO: { border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: C.inkDim, background: C.page },
  impact: { background: C.page, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', transition: 'opacity .15s' },
  impactHead: { fontSize: 12.5, fontWeight: 600, color: C.inkDim, marginBottom: 10 },
  marginBig: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  marginNow: { fontSize: 24, fontWeight: 600, color: C.inkFaint },
  arrow: { fontSize: 18, color: C.inkFaint },
  marginAfter: { fontSize: 26, fontWeight: 600 },
  marginCaption: { fontSize: 12.5, color: C.inkFaint },
  stats: { display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 14 },
  stat: { minWidth: 90 },
  statVal: { fontSize: 18, fontWeight: 600, color: C.ink },
  statLbl: { fontSize: 12, color: C.inkFaint, marginTop: 1 },
  note: { fontSize: 13, color: C.inkDim, lineHeight: 1.45 },
  warn: { marginTop: 12, padding: '9px 12px', background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 10, fontSize: 12.5, color: C.amber, lineHeight: 1.4 },
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginTop: 16 },
  err: { fontSize: 13, color: C.red, fontWeight: 500 },
  ok: { fontSize: 13, color: C.greenDeep, fontWeight: 600 },
  save: { border: 'none', background: C.accent, color: '#fff', borderRadius: 10, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
}
