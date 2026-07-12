// src/pages/RecomendacionesPage.tsx
//
// Recomendaciones / Copiloto: cruza margen (margin_by_brand), food cost
// (food_cost_dashboard) y calidad (quality_dashboard) y genera focos accionables
// priorizados. Todo cliente, sobre dato ya real. Sin ETL nuevo.

import { useEffect, useState } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getMarginByBrand, getFoodCost, type MarginByBrand, type FoodCostDashboard } from '@/modules/ventas/services/foodCostService'
import { getQuality, type QualityDashboard } from '@/modules/ventas/services/qualityService'

const GREEN = '#0F7A54', AMBER = '#B87400', RED = '#C0392B', MUT = '#6b7686', LINE = '#e6e9ef'
const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

type Sev = 'alta' | 'media' | 'baja'
const SEV: Record<Sev, [string, string, string]> = {
  alta: [RED, '#fbe6e3', 'ALTA'], media: [AMBER, '#fdf1dd', 'MEDIA'], baja: [MUT, '#eef1f5', 'BAJA'],
}
interface Reco { sev: Sev; area: string; titulo: string; evi: string; accion: string }

// Personal/otros asumidos igual que en Margen final, para el veredicto de negocio
const PERS = 0.17, OTROS = 0.08

export default function RecomendacionesPage() {
  const { activeAccountId } = useActiveAccount()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [recos, setRecos] = useState<Reco[]>([])
  const [verdict, setVerdict] = useState<{ final: number; pct: number } | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setErr(null)
    Promise.all([
      getMarginByBrand({ accountId: activeAccountId }),
      getFoodCost({ accountId: activeAccountId }),
      getQuality({ accountId: activeAccountId }),
    ]).then(([margin, food, quality]) => {
      if (!alive) return
      const { recos, verdict } = build(margin, food, quality)
      setRecos(recos); setVerdict(verdict)
    }).catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId])

  if (loading) return <div style={{ padding: 24, color: MUT }}>Analizando tus datos…</div>
  if (err) return <div style={{ padding: 24, color: RED }}>Error: {err}</div>

  const vcol = !verdict ? MUT : verdict.pct >= 10 ? GREEN : verdict.pct >= 0 ? AMBER : RED
  const vbg = !verdict ? '#f1f5f9' : verdict.pct >= 10 ? '#e3f3ea' : verdict.pct >= 0 ? '#fdf1dd' : '#fbe6e3'

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 18px 80px' }}>
      <div>
        <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Recomendaciones</h1>
        <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>Qué está mal, cuánto cuesta y qué hacer — cruzando margen, food cost y calidad</div>
      </div>

      {verdict && (
        <div style={{ border: `2px solid ${vcol}`, background: vbg, borderRadius: 14, padding: '14px 18px', margin: '14px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.5px', color: vcol }}>EL NEGOCIO</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: vcol, margin: '2px 0' }}>
            {verdict.pct >= 10 ? 'GANA DINERO' : verdict.pct >= 0 ? 'AJUSTADO' : 'PIERDE DINERO'}
          </div>
          <div style={{ fontSize: 13, color: '#334' }}>Margen final estimado <b>{eur(verdict.final)}</b> ({pct(verdict.pct)}), con comisión y food cost reales y personal/otros al {Math.round((PERS + OTROS) * 100)}%.</div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: MUT, margin: '4px 0 10px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
        {recos.length} focos detectados
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {recos.map((r, i) => {
          const [c, bg, t] = SEV[r.sev]
          return (
            <div key={i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderLeft: `3px solid ${c}`, borderRadius: 12, padding: '13px 15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.titulo}</div>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontWeight: 700, fontSize: 10.5, background: bg, color: c, flex: 'none' }}>{r.area} · {t}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#445', marginTop: 6 }}><b>Qué pasa:</b> {r.evi}</div>
              <div style={{ fontSize: 12.5, color: '#134', marginTop: 5, background: '#f0f8f4', borderRadius: 8, padding: '8px 10px' }}><b>Qué hacer:</b> {r.accion}</div>
            </div>
          )
        })}
      </div>
      {recos.length === 0 && <div style={{ padding: 20, color: MUT }}>Sin focos relevantes con los datos actuales. 🎉</div>}
    </div>
  )
}

function build(margin: MarginByBrand, food: FoodCostDashboard, quality: QualityDashboard): { recos: Reco[]; verdict: { final: number; pct: number } } {
  const recos: Reco[] = []
  const sevRank: Record<Sev, number> = { alta: 0, media: 1, baja: 2 }

  // Veredicto de negocio
  const T = margin.total
  const promoTotal = margin.by_brand.reduce((a, b) => a + b.venta * ((b.promo_pct ?? 0) / 100), 0)
  const finalTotal = T.venta - T.comision - promoTotal - T.food - T.venta * PERS - T.venta * OTROS
  const verdict = { final: Math.round(finalTotal), pct: T.venta ? (finalTotal / T.venta) * 100 : 0 }

  // Margen por marca: promo alta, margen negativo/fino
  for (const b of margin.by_brand) {
    const promo = b.venta * ((b.promo_pct ?? 0) / 100)
    const fin = b.venta - b.comision - promo - b.food - b.venta * PERS - b.venta * OTROS
    const finPct = b.venta ? (fin / b.venta) * 100 : 0
    if (b.venta < 500) continue
    if ((b.promo_pct ?? 0) >= 28) {
      recos.push({ sev: 'alta', area: 'Promo', titulo: `${b.brand}: promo del ${pct(b.promo_pct)} se come el margen`,
        evi: `Sobre ${eur(b.venta)} de venta, ${eur(promo)} se van en promoción — muy por encima de la comisión (${pct(b.comision_pct)}).`,
        accion: `Recorta la promo flash y sube el PVP 3-5% en sus platos estrella. Cada punto de promo que bajes es margen directo.` })
    }
    if (finPct < 5) {
      recos.push({ sev: finPct < 0 ? 'alta' : 'media', area: 'Margen', titulo: `${b.brand}: margen final ${pct(finPct)}`,
        evi: `Tras comisión, promo, food cost y personal estimado, deja ${eur(fin)} sobre ${eur(b.venta)}.`,
        accion: `Revisa la palanca dominante: si promo>25% recórtala; si food cost>32% sube PVP o ajusta escandallo.` })
    }
  }

  // Food cost: recetas sospechosas y food alto
  for (const b of food.by_brand) {
    if (b.sospechoso) {
      recos.push({ sev: 'media', area: 'Escandallo', titulo: `${b.brand}: receta mal costeada (${pct(b.food_cost_pct)})`,
        evi: `El food cost sale fuera de rango — casi seguro un error de escandallo (unidades, precio o ingredientes).`,
        accion: `Revisa la ficha técnica de esa marca; hasta corregirla, su margen no es fiable.` })
    } else if ((b.food_cost_pct ?? 0) >= 34 && b.ingreso >= 800) {
      recos.push({ sev: 'media', area: 'Food cost', titulo: `${b.brand}: food cost alto (${pct(b.food_cost_pct)})`,
        evi: `Sobre ${eur(b.ingreso)}, la cocina se lleva ${pct(b.food_cost_pct)} — por encima del 30-33% sano.`,
        accion: `Sube PVP de los platos más pesados o renegocia compras; ahí el margen se lo come la cocina, no el canal.` })
    } else if ((b.food_cost_pct ?? 0) > 0 && (b.food_cost_pct ?? 0) < 10 && b.ingreso >= 800) {
      recos.push({ sev: 'baja', area: 'Escandallo', titulo: `${b.brand}: food cost sospechosamente bajo (${pct(b.food_cost_pct)})`,
        evi: `Un food cost tan bajo suele indicar receta incompleta (faltan ingredientes).`,
        accion: `Completa la ficha técnica; si no, el margen de esa marca está inflado.` })
    }
  }

  // Calidad: marcas con valoración baja, reembolsos
  for (const b of quality.by_brand) {
    if ((b.avg ?? 5) < 3.9 && b.n >= 8) {
      recos.push({ sev: 'media', area: 'Calidad', titulo: `${b.brand}: valoración ${b.avg?.toFixed(2)}★`,
        evi: `${b.neg} de ${b.n} valoraciones son negativas (≤2★). Problema de calidad percibida.`,
        accion: `Cruza con sus incidencias y tiempos: si es "falta producto" es picking; si es "frío/lento" es sincronía de recogida.` })
    }
  }
  if (quality.refund.own >= 150) {
    const top = quality.err_types[0]
    recos.push({ sev: 'media', area: 'Errores', titulo: `Reembolsos: pagas ${eur(quality.refund.own)} de tu bolsillo`,
      evi: `De ${eur(quality.refund.total)} reembolsados, ${eur(quality.refund.own)} los cubre el establecimiento. El error nº1 es "${top?.type}" (${top?.n} casos).`,
      accion: `Checklist de bolsa antes de sellar, empezando por los platos que más fallan. Es la palanca más barata (coste casi 0).` })
  }

  recos.sort((a, b) => sevRank[a.sev] - sevRank[b.sev])
  return { recos, verdict }
}
