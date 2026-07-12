// src/pages/CalidadPage.tsx
//
// Área de Calidad y Operativa: valoraciones (dist/por marca), comentarios reales,
// etiquetas, tipos de error, platos que fallan y reembolsos. Dato real de Uber
// (channel_review + channel_incident) via qualityService.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getQuality, tagLabel, tagIsNegative, type QualityDashboard } from '@/modules/ventas/services/qualityService'

const NAVY = '#1E3A5F', CORAL = '#FF5436', GREEN = '#0F7A54', AMBER = '#B87400', RED = '#C0392B', MUT = '#6b7686', LINE = '#e6e9ef'
const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const STAR_COLOR: Record<number, string> = { 5: GREEN, 4: '#5FA98C', 3: AMBER, 2: '#D9662B', 1: RED }

export default function CalidadPage() {
  const { activeAccountId } = useActiveAccount()
  const [d, setD] = useState<QualityDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setErr(null)
    getQuality({ accountId: activeAccountId })
      .then(r => { if (alive) setD(r) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId])

  if (loading) return <div style={{ padding: 24, color: MUT }}>Cargando calidad…</div>
  if (err) return <div style={{ padding: 24, color: RED }}>Error: {err}</div>
  if (!d) return null

  const n = d.ratings.n || 0
  const dist = [5, 4, 3, 2, 1].map(s => ({ s, c: d.ratings.dist[String(s)] ?? 0 }))
  const smax = Math.max(1, ...dist.map(x => x.c))
  const pct1 = n ? Math.round((d.ratings.dist['1'] ?? 0) / n * 100) : 0
  const tagsPos = d.tags.filter(t => !tagIsNegative(t.tag)).slice(0, 6)
  const tagsNeg = d.tags.filter(t => tagIsNegative(t.tag)).slice(0, 6)
  const errMax = Math.max(1, ...d.err_types.map(e => e.n))
  const failMax = Math.max(1, ...d.top_fail.map(f => f.n))

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 18px 80px' }}>
      <div>
        <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Calidad y operativa</h1>
        <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>Valoraciones, comentarios, errores y reembolsos · dato real de Uber</div>
      </div>

      <div style={{ background: '#f5f8fc', border: '1px solid #dbe6f2', borderRadius: 14, padding: '11px 15px', margin: '14px 0', fontSize: 12.5, color: '#445' }}>
        Todo sale del detalle de <b>Uber Eats</b>. Glovo aún no publica valoraciones; según entren más meses, esto se vuelve serie histórica.
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(165px,1fr))', gap: 12, marginBottom: 14 }}>
        <Kpi l="Valoración media" v={`${(d.ratings.avg ?? 0).toFixed(2)}★`} s={`${n} valoraciones`}
          color={(d.ratings.avg ?? 0) >= 4.3 ? GREEN : (d.ratings.avg ?? 0) >= 3.9 ? AMBER : RED} />
        <Kpi l="% de 1 estrella" v={`${pct1}%`} s={`${d.ratings.dist['1'] ?? 0} de ${n}`} color={pct1 > 10 ? RED : AMBER} />
        <Kpi l="Incidencias" v={String(d.incidencias)} s="pedidos con problema" color={CORAL} />
        <Kpi l="Reembolso que pagas tú" v={eur(d.refund.own)} s={`de ${eur(d.refund.total)} total`} color={RED} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
        {/* Distribución */}
        <div style={card}>
          <h3 style={h3}>Distribución de valoraciones</h3>
          <div style={cd}>Bimodal: mucha gente encantada, pero un núcleo de 1★ que arrastra la media. Ahí está el trabajo.</div>
          {dist.map(({ s, c }) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '6px 0' }}>
              <div style={{ width: 34, fontWeight: 700, color: STAR_COLOR[s] }}>{s}★</div>
              <div style={{ flex: 1, height: 9, borderRadius: 6, background: LINE, overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', width: `${c / smax * 100}%`, background: STAR_COLOR[s] }} />
              </div>
              <div style={{ width: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c}</div>
            </div>
          ))}
        </div>
        {/* Etiquetas */}
        <div style={card}>
          <h3 style={h3}>Qué dicen los clientes</h3>
          <div style={cd}>Etiquetas que Uber recoge en cada valoración.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <TagCol title="A favor" color={GREEN} tags={tagsPos} />
            <TagCol title="En contra" color={RED} tags={tagsNeg} />
          </div>
        </div>
      </div>

      {/* Voz del cliente */}
      <div style={card}>
        <h3 style={h3}>La voz del cliente</h3>
        <div style={cd}>Comentarios de texto, tal cual llegan. Pocos, pero valen oro.</div>
        {d.comments.length === 0 && <div style={cd}>Sin comentarios de texto en el periodo.</div>}
        {d.comments.map((c, i) => {
          const col = (c.stars ?? 0) >= 4 ? GREEN : (c.stars ?? 0) <= 2 ? RED : AMBER
          return (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderLeft: `3px solid ${col}`, borderRadius: 9, padding: '10px 13px', margin: '8px 0' }}>
              <div style={{ fontSize: 13, fontStyle: 'italic' }}>“{c.txt}”</div>
              <div style={{ fontSize: 11.5, color: MUT, marginTop: 5 }}>
                <b style={{ color: col }}>{'★'.repeat(c.stars ?? 0)}{'☆'.repeat(5 - (c.stars ?? 0))}</b> · {c.brand}
              </div>
            </div>
          )
        })}
      </div>

      {/* Errores + platos que fallan */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
        <div style={card}>
          <h3 style={h3}>Tipos de error</h3>
          <div style={cd}>Manda el <b>producto que falta</b>: es picking, no cocina. Lo más barato de arreglar.</div>
          {d.err_types.map((e, i) => (
            <BarRow key={i} label={e.type} v={e.n} max={errMax} color={e.type.includes('Falta') ? RED : e.type.includes('frío') || e.type.includes('mal estado') ? CORAL : AMBER} />
          ))}
        </div>
        <div style={card}>
          <h3 style={h3}>Platos que más fallan</h3>
          <div style={cd}>Por artículo: dónde se concentra la incidencia.</div>
          {d.top_fail.map((f, i) => (
            <BarRow key={i} label={f.item} v={f.n} max={failMax} color={CORAL} />
          ))}
        </div>
      </div>

      {/* Tiempos */}
      {d.tiempos && (
        <div style={card}>
          <h3 style={h3}>Tiempos de preparación y entrega</h3>
          <div style={cd}>Del histórico de pedidos de Uber. La <b>espera evitable del rider en tienda</b> es tiempo que penaliza tu ranking y enfría la comida.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 8 }}>
            <Kpi l="Preparación" v={`${d.tiempos.prep_avg ?? '—'} min`} s={`${d.tiempos.n} pedidos`} />
            <Kpi l="Entrega total" v={`${d.tiempos.delivery_avg ?? '—'} min`} />
            <Kpi l="Espera evitable rider" v={`${d.tiempos.wait_avoidable_total_h ?? '—'} h`} s="el mes · rider parado" color={RED} />
            <Kpi l="Prep + entrega" v={`${d.tiempos.total_avg ?? '—'} min`} s={`${d.tiempos.completion_pct ?? '—'}% completados`} />
          </div>
          {(() => {
            const bt = d.tiempos.by_brand
            const tmax = Math.max(1, ...bt.map(x => x.total ?? 0))
            return (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: MUT, margin: '10px 0 2px' }}>Prep + entrega por marca (más lento = revisar cocina/montaje)</div>
                {bt.map((x, i) => (
                  <BarRow key={i} label={`${x.brand}`} v={x.total ?? 0} max={tmax}
                    color={(x.total ?? 0) > 28 ? RED : (x.total ?? 0) > 24 ? AMBER : GREEN} suffix=" min" />
                ))}
              </>
            )
          })()}
        </div>
      )}

      {/* Valoración por marca */}
      <div style={card}>
        <h3 style={h3}>Valoración por marca</h3>
        <div style={cd}>Media y nº de valoraciones negativas (≤2★) por marca. Ahí ves quién tiene problema de calidad.</div>
        <table style={table}>
          <thead><tr>
            {['Marca', 'Media', 'Valoraciones', 'Negativas (≤2★)'].map((hh, i) => (
              <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{hh}</th>
            ))}
          </tr></thead>
          <tbody>
            {d.by_brand.map((b, i) => (
              <tr key={i}>
                <td style={{ ...td, textAlign: 'left' }}>{b.brand}</td>
                <td style={{ ...tdm, fontWeight: 700, color: (b.avg ?? 0) >= 4.3 ? GREEN : (b.avg ?? 0) >= 3.9 ? AMBER : RED }}>{(b.avg ?? 0).toFixed(2)}★</td>
                <td style={{ ...tdm, color: MUT }}>{b.n}</td>
                <td style={{ ...tdm, color: b.neg > 0 ? RED : MUT }}>{b.neg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi(props: { l: string; v: string; s?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: '13px 15px' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px', color: MUT, fontWeight: 700 }}>{props.l}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: props.color ?? NAVY }}>{props.v}</div>
      {props.s && <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{props.s}</div>}
    </div>
  )
}

function TagCol(props: { title: string; color: string; tags: { tag: string; n: number }[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: props.color, textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4 }}>{props.title}</div>
      {props.tags.length === 0 && <div style={{ fontSize: 12, color: MUT }}>—</div>}
      {props.tags.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, margin: '5px 0' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: props.color, marginRight: 6 }} />{tagLabel(t.tag)}</span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{t.n}</b>
        </div>
      ))}
    </div>
  )
}

function BarRow(props: { label: string; v: number; max: number; color: string; suffix?: string }) {
  return (
    <div style={{ margin: '7px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
        <span>{props.label}</span><span style={{ fontVariantNumeric: 'tabular-nums', color: props.color, fontWeight: 700 }}>{props.v}{props.suffix ?? ''}</span>
      </div>
      <div style={{ height: 9, borderRadius: 6, background: LINE, overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: `${props.v / props.max * 100}%`, background: props.color, borderRadius: 6 }} />
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
