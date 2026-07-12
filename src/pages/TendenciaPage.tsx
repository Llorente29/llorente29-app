// src/pages/TendenciaPage.tsx
//
// Tendencia: evolución mensual por canal (venta, promo, efectivo). Lee la RPC
// channel_trend_monthly via trendService. Uber tiene los 6 meses completos;
// Glovo llega cuando se complete su Capa C.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getTrend, getChannels, type TrendMonth, type ChannelOpt } from '@/modules/ventas/services/trendService'

const NAVY = '#1E3A5F', CORAL = '#FF5436', GREEN = '#0F7A54', MUT = '#6b7686', LINE = '#e6e9ef'
const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

export default function TendenciaPage() {
  const { activeAccountId } = useActiveAccount()
  const [channels, setChannels] = useState<ChannelOpt[]>([])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [months, setMonths] = useState<TrendMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    getChannels(activeAccountId).then(cs => {
      setChannels(cs)
      setChannelId(prev => prev ?? cs.find(c => c.slug === 'uber')?.id ?? cs[0]?.id ?? null)
    }).catch(() => {})
  }, [activeAccountId])

  useEffect(() => {
    if (!activeAccountId || !channelId) return
    let alive = true
    setLoading(true); setErr(null)
    getTrend(activeAccountId, channelId)
      .then(m => { if (alive) setMonths(m) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId, channelId])

  const first = months[0], last = months[months.length - 1]
  const trendVenta = first && last ? last.venta - first.venta : 0

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 18px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Tendencia</h1>
          <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>Evolución mes a mes · ¿mejora o empeora?</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {channels.map(c => (
            <button key={c.id} onClick={() => setChannelId(c.id)} style={{
              border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: c.id === channelId ? NAVY : '#fff', color: c.id === channelId ? '#fff' : '#475569',
            }}>{c.name}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding: 24, color: MUT }}>Cargando tendencia…</div>}
      {err && <div style={{ padding: 16, color: '#C0392B' }}>Error: {err}</div>}

      {!loading && months.length === 0 && (
        <div style={{ ...card, color: MUT }}>Este canal aún no tiene datos por pedido mes a mes en la base. Uber tiene los 6 meses; el resto llega según se cargue su Capa C.</div>
      )}

      {!loading && months.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(165px,1fr))', gap: 12, margin: '14px 0' }}>
            <Kpi l="Periodo" v={`${months.length} meses`} s={`${first?.mes} → ${last?.mes}`} />
            <Kpi l="Venta último mes" v={eur(last?.venta)} s={`${trendVenta >= 0 ? '▲' : '▼'} ${eur(Math.abs(trendVenta))} vs primer mes`} color={trendVenta >= 0 ? GREEN : CORAL} />
            <Kpi l="Promo último mes" v={pct(last?.promo_pct)} s="sobre venta" />
            <Kpi l="Efectivo último mes" v={pct(last?.efect_pct)} s="lo que llega a caja" color={GREEN} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
            <div style={card}>
              <h3 style={h3}>Venta por mes</h3>
              <div style={cd}>Evolución del volumen facturado en el canal.</div>
              <Chart series={months.map(m => ({ label: m.mes.slice(5), val: m.venta }))} color={NAVY} fmt={eur} />
            </div>
            <div style={card}>
              <h3 style={h3}>Promo vs efectivo por mes</h3>
              <div style={cd}>La clave del canal: cuando sube la promo (coral), baja lo que te queda (verde). El trade-off, mes a mes.</div>
              <Chart series={months.map(m => ({ label: m.mes.slice(5), val: m.efect_pct ?? 0 }))} color={GREEN}
                series2={months.map(m => ({ label: m.mes.slice(5), val: m.promo_pct ?? 0 }))} color2={CORAL} fmt={(v) => `${Math.round(v)}%`} />
            </div>
          </div>

          <div style={card}>
            <h3 style={h3}>Detalle mensual</h3>
            <table style={table}>
              <thead><tr>
                {['Mes', 'Pedidos', 'Venta', 'Comisión', 'Promo', 'Efectivo'].map((hh, i) => (
                  <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{hh}</th>
                ))}
              </tr></thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{m.mes}</td>
                    <td style={tdm}>{m.pedidos}</td>
                    <td style={tdm}>{eur(m.venta)}</td>
                    <td style={{ ...tdm, color: MUT }}>{pct(m.comision_pct)}</td>
                    <td style={{ ...tdm, color: (m.promo_pct ?? 0) > 30 ? CORAL : MUT }}>{pct(m.promo_pct)}</td>
                    <td style={{ ...tdm, fontWeight: 700, color: (m.efect_pct ?? 0) >= 55 ? GREEN : (m.efect_pct ?? 0) >= 45 ? '#B87400' : '#C0392B' }}>{pct(m.efect_pct)}</td>
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

function Kpi(props: { l: string; v: string; s?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: '13px 15px' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px', color: MUT, fontWeight: 700 }}>{props.l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: props.color ?? NAVY }}>{props.v}</div>
      {props.s && <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{props.s}</div>}
    </div>
  )
}

// Gráfico de línea simple (1 o 2 series) en SVG
function Chart(props: {
  series: { label: string; val: number }[]; color: string; fmt: (v: number) => string
  series2?: { label: string; val: number }[]; color2?: string
}) {
  const { series } = props
  const all = [...series.map(s => s.val), ...(props.series2?.map(s => s.val) ?? [])]
  const mn = Math.min(...all) * 0.9, mx = Math.max(...all) * 1.05
  const W = 440, H = 190, pad = 30
  const px = (i: number) => pad + (series.length < 2 ? W / 2 : (i / (series.length - 1)) * (W - pad * 2))
  const py = (v: number) => pad + (H - pad * 2) - ((v - mn) / (mx - mn || 1)) * (H - pad * 2)
  const path = (s: { val: number }[]) => s.map((p, i) => `${px(i)},${py(p.val)}`).join(' ')
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {props.series2 && <polyline points={path(props.series2)} fill="none" stroke={props.color2} strokeWidth={2.5} />}
      <polyline points={path(series)} fill="none" stroke={props.color} strokeWidth={2.5} />
      {series.map((p, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(p.val)} r={3.5} fill={props.color} />
          <text x={px(i)} y={H - 8} fontSize={10} textAnchor="middle" fill={MUT}>{p.label}</text>
        </g>
      ))}
      {props.series2?.map((p, i) => <circle key={i} cx={px(i)} cy={py(p.val)} r={3.5} fill={props.color2} />)}
    </svg>
  )
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '17px 19px', marginBottom: 15 }
const h3: CSSProperties = { margin: '0 0 2px', fontSize: 15 }
const cd: CSSProperties = { color: MUT, fontSize: 12, marginBottom: 13, lineHeight: 1.4 }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.3px', color: MUT, fontWeight: 600, background: '#fafbfd', padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const tdm: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
