// src/pages/MargenPlatoPage.tsx
//
// Food cost real (escandallo) y margen por plato. Lee la RPC food_cost_dashboard
// via foodCostService. Muestra SALUD DEL DATO (cobertura), food cost por marca
// (con recetas sospechosas) y margen por plato (precio − food cost).

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getFoodCost, type FoodCostDashboard } from '@/modules/ventas/services/foodCostService'

const NAVY = '#1E3A5F', CORAL = '#FF5436', GREEN = '#0F7A54', AMBER = '#B87400', RED = '#C0392B', MUT = '#6b7686', LINE = '#e6e9ef'
const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const eur2 = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

// food cost: verde <=30, ámbar 30-38, rojo >38 (o sospechoso)
function foodSem(v: number | null, susp = false): { bg: string; fg: string } {
  if (susp) return { bg: '#fbe6e3', fg: RED }
  if (v == null) return { bg: '#f1f5f9', fg: '#64748b' }
  if (v <= 30) return { bg: '#e3f3ea', fg: GREEN }
  if (v <= 38) return { bg: '#fdf1dd', fg: AMBER }
  return { bg: '#fbe6e3', fg: RED }
}
function badge(v: number | null, susp = false): CSSProperties {
  const { bg, fg } = foodSem(v, susp)
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontWeight: 700, fontSize: 12, background: bg, color: fg }
}

const PERIODS: { k: string; label: string; days: number | null }[] = [
  { k: '30d', label: '30 días', days: 30 },
  { k: '90d', label: '90 días', days: 90 },
  { k: 'todo', label: 'Todo', days: null },
]

export default function MargenPlatoPage() {
  const { activeAccountId } = useActiveAccount()
  const [data, setData] = useState<FoodCostDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [period, setPeriod] = useState('todo')

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setErr(null)
    const p = PERIODS.find(x => x.k === period)!
    const from = p.days ? new Date(Date.now() - p.days * 864e5) : null
    getFoodCost({ accountId: activeAccountId, from, to: null })
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId, period])

  const suspechosos = useMemo(() => (data?.by_brand ?? []).filter(b => b.sospechoso), [data])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 18px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Food cost y margen por plato</h1>
          <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>Coste real del escandallo por marca y plato · precio − food cost</div>
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

      {loading && <div style={{ padding: 24, color: MUT }}>Cargando food cost…</div>}
      {err && <div style={{ padding: 16, color: RED }}>Error: {err}</div>}

      {data && !loading && (
        <>
          {/* Salud del dato */}
          <div style={{ background: '#f5f8fc', border: '1px solid #dbe6f2', borderRadius: 14, padding: '13px 16px', margin: '14px 0' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#334', marginBottom: 6 }}>
              Salud del dato — cuánto food cost conocemos
            </div>
            <div style={{ fontSize: 12.5, color: '#445' }}>
              Cobertura <b>{pct(data.salud.cobertura_pct)}</b> · {data.salud.lineas_costeadas.toLocaleString('es-ES')} de {data.salud.lineas.toLocaleString('es-ES')} líneas con receta costeada.
              El resto son platos sin escandallo enlazado — no penalizan el %, pero conviene completarlos.
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 14 }}>
            <Kpi l="Ingreso (con coste conocido)" v={eur(data.total.ingreso)} />
            <Kpi l="Food cost total" v={eur(data.total.food_cost)} color={CORAL} />
            <Kpi l="Food cost %" v={pct(data.total.food_cost_pct)} color={foodSem(data.total.food_cost_pct).fg}
              s="objetivo sector 28-35%" />
          </div>

          {suspechosos.length > 0 && (
            <div style={{ background: '#fdf3f2', border: `1px solid ${RED}`, borderRadius: 12, padding: '11px 14px', marginBottom: 14, fontSize: 12.5, color: '#5a1e18' }}>
              <b>Revisa estas recetas:</b> {suspechosos.map(b => `${b.brand} (${pct(b.food_cost_pct)})`).join(' · ')} — el food cost sale fuera de rango, probablemente error de escandallo (unidades, precio o ingredientes).
            </div>
          )}

          {/* Food cost por marca */}
          <div style={card}>
            <h3 style={h3}>Food cost por marca</h3>
            <div style={cd}>Verde ≤30% · ámbar 30-38% · rojo &gt;38% o receta sospechosa.</div>
            <table style={table}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>Marca</th><th style={th}>Ingreso</th>
                <th style={th}>Food cost</th><th style={th}>Food %</th><th style={th}>Cobertura</th>
              </tr></thead>
              <tbody>
                {data.by_brand.map(b => (
                  <tr key={b.brand}>
                    <td style={{ ...td, textAlign: 'left' }}>{b.brand}</td>
                    <td style={tdm}>{eur(b.ingreso)}</td>
                    <td style={tdm}>{eur(b.food_cost)}</td>
                    <td style={{ ...td, textAlign: 'right' }}><span style={badge(b.food_cost_pct, b.sospechoso)}>{pct(b.food_cost_pct)}</span></td>
                    <td style={{ ...tdm, color: MUT }}>{pct(b.cobertura_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Margen por plato */}
          <div style={card}>
            <h3 style={h3}>Margen por plato</h3>
            <div style={cd}>Precio − food cost por unidad. Falta descontar comisión de canal y personal para el margen final; esto es el margen bruto de cocina.</div>
            <table style={table}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>Plato</th><th style={{ ...th, textAlign: 'left' }}>Marca</th>
                <th style={th}>Uds</th><th style={th}>Precio</th><th style={th}>Food</th><th style={th}>Food %</th><th style={th}>Margen/ud</th>
              </tr></thead>
              <tbody>
                {data.by_dish.map((d, i) => {
                  const margen = d.precio - d.food
                  return (
                    <tr key={i}>
                      <td style={{ ...td, textAlign: 'left' }}>{d.dish}</td>
                      <td style={{ ...td, textAlign: 'left', color: MUT }}>{d.brand ?? '—'}</td>
                      <td style={tdm}>{d.uds}</td>
                      <td style={tdm}>{eur2(d.precio)}</td>
                      <td style={{ ...tdm, color: MUT }}>{eur2(d.food)}</td>
                      <td style={{ ...td, textAlign: 'right' }}><span style={badge(d.food_cost_pct)}>{pct(d.food_cost_pct)}</span></td>
                      <td style={{ ...tdm, fontWeight: 700, color: margen > 0 ? GREEN : RED }}>{eur2(margen)}</td>
                    </tr>
                  )
                })}
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
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: props.color ?? NAVY }}>{props.v}</div>
      {props.s && <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{props.s}</div>}
    </div>
  )
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '17px 19px', marginBottom: 15 }
const h3: CSSProperties = { margin: '0 0 2px', fontSize: 15 }
const cd: CSSProperties = { color: MUT, fontSize: 12, marginBottom: 13, lineHeight: 1.4 }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.3px', color: MUT, fontWeight: 600, background: '#fafbfd', padding: '7px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'right' }
const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LINE}` }
const tdm: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
