// src/pages/MargenFinalPage.tsx
//
// Margen final por marca: venta − comisión − promo − food cost − personal − otros.
// COMISIÓN REAL (margin_by_brand → resolve_channel_commission, tu tabla de tarifas,
// asume reparto plataforma) + FOOD COST REAL (escandallo). Promo, personal y otros
// son palancas ajustables hasta cargar promo por marca y nóminas del módulo Team.

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getMarginByBrand, type MarginByBrand, type MarginBrand } from '@/modules/ventas/services/foodCostService'

const NAVY = '#1E3A5F', CORAL = '#FF5436', GREEN = '#0F7A54', AMBER = '#B87400', RED = '#C0392B', MUT = '#6b7686', LINE = '#e6e9ef'
const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

type Verdict = 'gana' | 'ajustado' | 'pierde'
const VC: Record<Verdict, [string, string]> = { gana: [GREEN, '#e3f3ea'], ajustado: [AMBER, '#fdf1dd'], pierde: [RED, '#fbe6e3'] }

const PERIODS: { k: string; label: string; days: number | null }[] = [
  { k: '30d', label: '30 días', days: 30 },
  { k: '90d', label: '90 días', days: 90 },
  { k: 'todo', label: 'Todo', days: null },
]

export default function MargenFinalPage() {
  const { activeAccountId } = useActiveAccount()
  const [data, setData] = useState<MarginByBrand | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [period, setPeriod] = useState('todo')
  const [persPct, setPersPct] = useState(17)
  const [otrosPct, setOtrosPct] = useState(8)

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setErr(null)
    const p = PERIODS.find(x => x.k === period)!
    const from = p.days ? new Date(Date.now() - p.days * 864e5) : null
    getMarginByBrand({ accountId: activeAccountId, from, to: null })
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId, period])

  const model = useMemo(() => {
    if (!data) return null
    const pe = persPct / 100, ot = otrosPct / 100
    const rows = data.by_brand.map((b: MarginBrand) => {
      const promo = b.venta * ((b.promo_pct ?? 0) / 100)   // promo REAL por marca
      const personal = b.venta * pe, otro = b.venta * ot
      const caja = b.venta - b.comision - promo
      const final = caja - b.food - personal - otro
      const pctf = b.venta ? (final / b.venta) * 100 : 0
      const verdict: Verdict = pctf >= 10 ? 'gana' : pctf >= 0 ? 'ajustado' : 'pierde'
      return { ...b, promo, personal, otro, caja, final, pctf, verdict }
    }).sort((a, b) => b.final - a.final)
    const T = rows.reduce((a, r) => ({
      v: a.v + r.venta, comision: a.comision + r.comision, promo: a.promo + r.promo,
      food: a.food + r.food, personal: a.personal + r.personal, otro: a.otro + r.otro, final: a.final + r.final,
    }), { v: 0, comision: 0, promo: 0, food: 0, personal: 0, otro: 0, final: 0 })
    const caja = T.v - T.comision - T.promo
    const mpct = T.v ? (T.final / T.v) * 100 : 0
    return { rows, T, caja, mpct }
  }, [data, persPct, otrosPct])

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '18px 18px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Margen final por marca</h1>
          <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>Venta − comisión − promo − food cost − personal · el número que lo cierra todo</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODS.map(p => (
            <button key={p.k} onClick={() => setPeriod(p.k)} style={{
              border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: period === p.k ? NAVY : '#fff', color: period === p.k ? '#fff' : '#475569',
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      <div style={{ background: '#f5f8fc', border: '1px solid #dbe6f2', borderRadius: 14, padding: '12px 16px', margin: '14px 0', fontSize: 12.5, color: '#445' }}>
        <b style={{ color: '#223' }}>Salud del dato:</b> <b style={{ color: GREEN }}>comisión real</b> (tu tabla de tarifas), <b style={{ color: GREEN }}>food cost real</b> (escandallo) y <b style={{ color: GREEN }}>promo real por marca</b> (liquidaciones Glovo+Uber). <b>Personal</b> y <b>otros</b> siguen como supuestos ajustables. Nota: las marcas <b>cedidas</b> muestran promo 0 hasta cargar CTB (su promo va por Cloudtown, no por tu liquidación).
      </div>

      {loading && <div style={{ padding: 24, color: MUT }}>Cargando margen…</div>}
      {err && <div style={{ padding: 16, color: RED }}>Error: {err}</div>}

      {model && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 14 }}>
            <Kpi l="Venta (coste conocido)" v={eur(model.T.v)} s="base con comisión + food reales" />
            <Kpi l="Comisión (real)" v={eur(model.T.comision)} color={CORAL} s={`${pct(model.T.v ? model.T.comision / model.T.v * 100 : 0)} · de tu tarifa`} />
            <Kpi l="Food cost (real)" v={eur(model.T.food)} color={CORAL} s={`${pct(model.T.v ? model.T.food / model.T.v * 100 : 0)} de la venta`} />
            <Kpi l="Margen final" v={eur(model.T.final)}
              color={model.mpct >= 10 ? GREEN : model.mpct >= 0 ? AMBER : RED}
              bg={model.mpct >= 10 ? '#e3f3ea' : model.mpct >= 0 ? '#fdf1dd' : '#fbe6e3'}
              s={`${pct(model.mpct)} sobre venta`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 15 }}>
            <div style={card}>
              <h3 style={h3}>De la venta al margen final</h3>
              <div style={cd}>Consolidado del negocio. Cada escalón: cuánto se va (rojo) hasta lo que te queda (verde). Comisión y food cost reales.</div>
              <Waterfall T={model.T} mpct={model.mpct} />
            </div>
            <div style={card}>
              <h3 style={h3}>Palancas</h3>
              <div style={cd}>Comisión, food cost y promo son reales por marca. Aquí ajustas solo lo que aún no es dato.</div>
              <Lever label="Personal (sobre venta) · estimado" v={persPct} min={0} max={35} onChange={setPersPct} unit="%" />
              <Lever label="Otros (alquiler, suministros…)" v={otrosPct} min={0} max={20} onChange={setOtrosPct} unit="%" />
              <div style={note}>
                Con estos supuestos el negocio deja <b style={{ color: model.mpct >= 10 ? GREEN : model.mpct >= 0 ? AMBER : RED }}>{eur(model.T.final)}</b> ({pct(model.mpct)}).
                Prime cost (food+personal) {pct(model.T.v ? (model.T.food + model.T.personal) / model.T.v * 100 : 0)} — objetivo del sector &lt;60-65%.
              </div>
            </div>
          </div>

          <div style={card}>
            <h3 style={h3}>Veredicto por marca — ¿gana o pierde?</h3>
            <div style={cd}>Comisión y food cost reales; promo/personal/otros con tus palancas. Ordenado por lo que aporta.</div>
            <table style={table}>
              <thead><tr>
                {['Marca', 'Venta', 'Comisión', 'Promo', 'Food', 'Food %', 'Margen final', '%', 'Veredicto'].map((hh, i) => (
                  <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{hh}</th>
                ))}
              </tr></thead>
              <tbody>
                {model.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: 'left' }}>{r.brand}</td>
                    <td style={tdm}>{eur(r.venta)}</td>
                    <td style={{ ...tdm, color: MUT }}>{eur(r.comision)} <span style={{ fontSize: 11 }}>({pct(r.comision_pct)})</span></td>
                    <td style={{ ...tdm, color: (r.promo_pct ?? 0) > 25 ? RED : (r.promo_pct ?? 0) > 12 ? AMBER : MUT }}>{eur(r.promo)} <span style={{ fontSize: 11 }}>({pct(r.promo_pct)})</span></td>
                    <td style={{ ...tdm, color: MUT }}>{eur(r.food)}</td>
                    <td style={{ ...tdm, color: (r.food_pct ?? 0) > 38 || (r.food_pct ?? 0) < 8 ? RED : (r.food_pct ?? 0) > 30 ? AMBER : GREEN }}>{pct(r.food_pct)}</td>
                    <td style={{ ...tdm, fontWeight: 700, color: r.final > 0 ? GREEN : RED }}>{eur(r.final)}</td>
                    <td style={tdm}>{pct(r.pctf)}</td>
                    <td style={{ ...td, textAlign: 'right' }}><span style={pill(r.verdict)}>{r.verdict.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi(props: { l: string; v: string; s?: string; color?: string; bg?: string }) {
  return (
    <div style={{ background: props.bg ?? '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: '13px 15px' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px', color: MUT, fontWeight: 700 }}>{props.l}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: props.color ?? NAVY }}>{props.v}</div>
      {props.s && <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{props.s}</div>}
    </div>
  )
}

function Lever(props: { label: string; v: number; min: number; max: number; unit: string; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
        <span>{props.label}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{props.v}{props.unit}</b>
      </div>
      <input type="range" min={props.min} max={props.max} value={props.v}
        onChange={e => props.onChange(+e.target.value)} style={{ width: '100%', accentColor: NAVY }} />
    </div>
  )
}

function Waterfall(props: { T: { v: number; comision: number; promo: number; food: number; personal: number; otro: number; final: number }; mpct: number }) {
  const { T } = props
  const mx = T.v || 1
  const fg = props.mpct >= 10 ? GREEN : props.mpct >= 0 ? AMBER : RED
  const steps: [string, number, string, boolean][] = [
    ['Venta bruta', T.v, NAVY, false],
    ['− Comisión (real)', T.comision, CORAL, true],
    ['− Promo (real)', T.promo, '#E4572E', true],
    ['− Food cost (real)', T.food, '#C0392B', true],
    ['− Personal (est.)', T.personal, AMBER, true],
    ['− Otros', T.otro, '#B0752B', true],
  ]
  return (
    <div>
      {steps.map((s, i) => (
        <div key={i} style={wfrow}>
          <div>{s[0]}</div>
          <div style={barWrap}><i style={{ display: 'block', height: '100%', width: `${(s[1] / mx) * 100}%`, background: s[2], opacity: s[3] ? 0.9 : 1 }} /></div>
          <div style={{ textAlign: 'right', fontWeight: 700, color: s[3] ? RED : '#0f1720' }}>{s[3] ? '−' : ''}{eur(s[1])}</div>
        </div>
      ))}
      <div style={{ ...wfrow, fontWeight: 800, borderTop: `2px solid ${LINE}`, paddingTop: 7 }}>
        <div>= Margen final</div>
        <div style={barWrap}><i style={{ display: 'block', height: '100%', width: `${(Math.max(0, T.final) / mx) * 100}%`, background: fg }} /></div>
        <div style={{ textAlign: 'right', fontWeight: 800, color: fg }}>{eur(T.final)}</div>
      </div>
    </div>
  )
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '17px 19px', marginBottom: 15 }
const h3: CSSProperties = { margin: '0 0 2px', fontSize: 15 }
const cd: CSSProperties = { color: MUT, fontSize: 12, marginBottom: 13, lineHeight: 1.4 }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.3px', color: MUT, fontWeight: 600, background: '#fafbfd', padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const tdm: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const wfrow: CSSProperties = { display: 'grid', gridTemplateColumns: '170px 1fr 92px', alignItems: 'center', gap: 11, fontSize: 12.5, margin: '6px 0' }
const barWrap: CSSProperties = { height: 18, borderRadius: 5, background: LINE, overflow: 'hidden' }
const note: CSSProperties = { background: '#f0f4fb', borderLeft: `3px solid ${NAVY}`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#334', marginTop: 11 }
function pill(v: Verdict): CSSProperties { const [fg, bg] = VC[v]; return { display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontWeight: 700, fontSize: 11, background: bg, color: fg } }
