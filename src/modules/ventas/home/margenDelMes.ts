// src/modules/ventas/home/margenDelMes.ts
//
// MARGEN DEL MES: lo que queda después de la plataforma y de la comida.
//
//   margen = venta − comisión de plataforma − food cost
//
// Sale de `margin_by_brand`, que es la RPC que pinta «Ventas · Margen final»:
// comisión REAL (de la tarifa del canal, no de una media) y food REAL (del
// escandallo). Una consulta.
//
// ── QUÉ MES, Y POR QUÉ NO HAY DELTA ────────────────────────────────────────
// El mes EN CURSO, que es lo que dice el título y lo que alguien espera de una
// pantalla de inicio. Y por eso NO lleva delta: la regla 2 del espejo dice que
// un periodo en curso no se compara con uno cerrado, y el 2 de septiembre eso
// sería comparar dos días contra treinta y uno.
//
// Lo que sí lleva es el mes anterior CERRADO, escrito como lo que es —una
// referencia con su nombre—, no como un delta disfrazado. «Agosto cerró en
// 27.459 €» se entiende sin que nadie tenga que preguntar contra qué se compara.
//
// ── LO QUE FALTA EN ESTE MARGEN, Y LA TARJETA LO DICE ──────────────────────
// No lleva personal, ni alquiler, ni suministros: es margen de contribución,
// no beneficio. Y el food solo cuenta lo que tiene escandallo, así que el
// margen que sale es OPTIMISTA — cuanto menos cobertura, más optimista. Por eso
// la tarjeta pide la cobertura a `food_cost_dashboard` (la misma fuente y por
// tanto el mismo número que la tarjeta de al lado) y la enseña.

import { getMarginByBrand, getFoodCost } from '../services/foodCostService'

export interface MargenDelMes {
  ventaEur: number
  comisionEur: number
  foodEur: number
  /** venta − comisión − food. Puede ser negativo, y entonces se dice. */
  margenEur: number
  /** Sobre la venta. null si no hubo venta. */
  margenPct: number | null
  /** Cobertura del food cost en el mismo periodo, de food_cost_dashboard. */
  coberturaPct: number | null
  /** Días naturales del mes ya empezados, hoy incluido. */
  diasDelMes: number
  /** «septiembre». */
  mes: string
  /** El mes anterior, cerrado: la referencia. */
  anterior: { mes: string; margenEur: number; margenPct: number | null } | null
}

/** Nombre del mes en español, en minúscula: «septiembre». */
export function nombreDeMes(d: Date): string {
  return d.toLocaleDateString('es-ES', { month: 'long' })
}

function margen(t: { venta: number; comision: number; food: number }): number {
  return t.venta - t.comision - t.food
}

export async function leeMargenDelMes(
  accountId: string, locationId: string | null, ahora: Date = new Date(),
): Promise<MargenDelMes> {
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const inicioMesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)

  const [actual, anterior, coste] = await Promise.all([
    getMarginByBrand({ accountId, from: inicioMes, to: ahora, locationId }),
    getMarginByBrand({ accountId, from: inicioMesAnterior, to: inicioMes, locationId }),
    getFoodCost({ accountId, from: inicioMes, to: ahora, locationId }),
  ])

  const m = margen(actual.total)
  const mAnt = margen(anterior.total)

  return {
    ventaEur: actual.total.venta,
    comisionEur: actual.total.comision,
    foodEur: actual.total.food,
    margenEur: m,
    margenPct: actual.total.venta > 0
      ? Math.round((m / actual.total.venta) * 1000) / 10 : null,
    coberturaPct: coste.salud.cobertura_pct,
    diasDelMes: ahora.getDate(),
    mes: nombreDeMes(ahora),
    // Un mes anterior sin venta no es «0 € de margen»: es que no hay
    // referencia, y entonces la tarjeta no la escribe.
    anterior: anterior.total.venta > 0
      ? {
          mes: nombreDeMes(inicioMesAnterior),
          margenEur: mAnt,
          margenPct: Math.round((mAnt / anterior.total.venta) * 1000) / 10,
        }
      : null,
  }
}
