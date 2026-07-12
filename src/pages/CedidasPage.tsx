// src/pages/CedidasPage.tsx
//
// Cedidas (CTB / Cloudtown): el segundo motor de ingreso del dark-kitchen. Muestra,
// por marca / canal / local, el ingreso REAL de Llorente por cesión (revenue share
// que CTB liquida cada mes), no el gross de plataforma (que cobra CTB). Lee
// licensed_economics_dashboard. Junio cargado; el resto de meses llega según Drive.

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  getLicensedEconomics, getLocationsLic,
  type LicensedDashboard, type LocationOpt,
} from '@/modules/ventas/services/licensedService'

const NAVY = '#1E3A5F', GREEN = '#0F7A54', MUT = '#6b7686', LINE = '#e6e9ef'
const CH_COLOR: Record<string, string> = { glovo: '#FF8000', uber: '#000000', justeat: '#FF8000' }
const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const eur2 = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n ?? 0)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

export default function CedidasPage() {
  const { activeAccountId } = useActiveAccount()
  const [locs, setLocs] = useState<LocationOpt[]>([])
  const [locId, setLocId] = useState<string | null>(null)
  const [data, setData] = useState<LicensedDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    getLocationsLic(activeAccountId).then(setLocs).catch(() => {})
  }, [activeAccountId])

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setErr(null)
    getLicensedEconomics({ accountId: activeAccountId, locationId: locId })
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId, locId])

  if (loading) return <div style={{ padding: 24, color: MUT }}>Cargando cedidas…</div>
  if (err) return <div style={{ padding: 24, color: '#C0392B' }}>Error: {err}</div>
  if (!data) return null

  const t = data.total
  const maxBrand = Math.max(1, ...data.by_brand.map(b => b.ingreso))

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 18px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Cedidas (Cloudtown)</h1>
          <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>
            El segundo motor: lo que ganas cediendo cocina. Ingreso = liquidación mensual de CTB, no la venta de plataforma.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={locId === null} onClick={() => setLocId(null)}>Todos</Chip>
          {locs.map(l => (
            <Chip key={l.id} active={locId === l.id} onClick={() => setLocId(l.id)}>{l.name.replace('Foodint ', '')}</Chip>
          ))}
        </div>
      </div>

      {/* Explicación del modelo cedido */}
      <div style={{ background: '#eef4fb', border: `1px solid #d4e2f2`, borderRadius: 12, padding: '11px 14px', margin: '14px 0', fontSize: 12.5, color: '#28527a', lineHeight: 1.5 }}>
        En las marcas cedidas <b>CTB (Cloudtown) cobra toda la plataforma</b> y te liquida una vez al mes.
        Tu ingreso es el <b>revenue share</b> (~25% en agregador, 35% en reparto propio) sobre la venta bruta.
        La promo y la comisión de plataforma son de CTB — por eso aquí no las pagas tú.
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, margin: '14px 0' }}>
        <Kpi l="Venta bruta cedida" v={eur(t.gross)} s="la mueven las marcas en plataforma" />
        <Kpi l="Tu ingreso (revenue share)" v={eur(t.ingreso)} s={`${pct(t.share_pct)} de la venta bruta`} color={GREEN} />
        <Kpi l="Se queda CTB" v={eur(t.corte)} s="comisión+promo+margen de Cloudtown" color={MUT} />
        <Kpi l="Marcas cedidas activas" v={`${t.marcas ?? 0}`} s="con venta en el periodo" color={NAVY} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 15 }}>
        {/* Ingreso por marca */}
        <div style={card}>
          <h3 style={h3}>Tu ingreso por marca cedida</h3>
          <div style={cd}>Cuánto te deja cada marca cedida al mes (revenue share, ya neto de devoluciones).</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data.by_brand.map((b, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{b.brand}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <b>{eur(b.ingreso)}</b> <span style={{ color: MUT, fontSize: 11.5 }}>de {eur(b.gross)}</span>
                  </span>
                </div>
                <div style={{ height: 8, background: '#eef1f5', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${(b.ingreso / maxBrand) * 100}%`, height: '100%', background: GREEN, borderRadius: 5 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Por canal + por local */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div style={card}>
            <h3 style={h3}>Por canal</h3>
            <div style={cd}>Qué plataforma trae el ingreso cedido.</div>
            {data.by_channel.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderBottom: i < data.by_channel.length - 1 ? `1px solid ${LINE}` : 'none' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: CH_COLOR[c.slug] ?? MUT, flex: 'none' }} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{c.channel}</span>
                <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}><b>{eur(c.ingreso)}</b></span>
                <span style={{ fontSize: 11.5, color: MUT, width: 78, textAlign: 'right' }}>de {eur(c.gross)}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <h3 style={h3}>Por local</h3>
            <div style={cd}>Ingreso cedido que aporta cada cocina.</div>
            {data.by_location.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderBottom: i < data.by_location.length - 1 ? `1px solid ${LINE}` : 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{l.location.replace('Foodint ', '')}</span>
                <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}><b>{eur(l.ingreso)}</b></span>
                <span style={{ fontSize: 11.5, color: MUT, width: 78, textAlign: 'right' }}>de {eur(l.gross)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detalle tabla */}
      <div style={card}>
        <h3 style={h3}>Detalle por marca</h3>
        <table style={table}>
          <thead><tr>
            {['Marca', 'Venta bruta', 'Tu ingreso', 'Revenue share'].map((hh, i) => (
              <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{hh}</th>
            ))}
          </tr></thead>
          <tbody>
            {data.by_brand.map((b, i) => (
              <tr key={i}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{b.brand}</td>
                <td style={tdm}>{eur2(b.gross)}</td>
                <td style={{ ...tdm, fontWeight: 700, color: GREEN }}>{eur2(b.ingreso)}</td>
                <td style={{ ...tdm, color: MUT }}>{pct(b.share_pct)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td style={{ ...td, textAlign: 'left', fontWeight: 800, borderTop: `2px solid ${LINE}` }}>Total</td>
            <td style={{ ...tdm, fontWeight: 800, borderTop: `2px solid ${LINE}` }}>{eur2(t.gross)}</td>
            <td style={{ ...tdm, fontWeight: 800, color: GREEN, borderTop: `2px solid ${LINE}` }}>{eur2(t.ingreso)}</td>
            <td style={{ ...tdm, fontWeight: 800, borderTop: `2px solid ${LINE}` }}>{pct(t.share_pct)}</td>
          </tr></tfoot>
        </table>
        <div style={{ fontSize: 11.5, color: MUT, marginTop: 10, lineHeight: 1.5 }}>
          Falta el coste de materia prima de las cedidas para cerrar su margen (viene de la relación
          Compras y Ventas de CTB / escandallo). Con eso, cada marca cedida tendrá su “gana o pierde” igual que las propias.
        </div>
      </div>
    </div>
  )
}

function Chip(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={props.onClick} style={{
      border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
      background: props.active ? NAVY : '#fff', color: props.active ? '#fff' : '#475569',
    }}>{props.children}</button>
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

const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '17px 19px', marginBottom: 15 }
const h3: CSSProperties = { margin: '0 0 2px', fontSize: 15 }
const cd: CSSProperties = { color: MUT, fontSize: 12, marginBottom: 13, lineHeight: 1.4 }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.3px', color: MUT, fontWeight: 600, background: '#fafbfd', padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const tdm: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
