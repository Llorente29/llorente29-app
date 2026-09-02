// src/modules/ventas/home/foodCostMedio.ts
//
// FOOD COST MEDIO, para la tarjeta del Inicio.
//
// ── LA FUENTE, Y POR QUÉ ESTA Y NO LA DE COCINA ────────────────────────────
// Hay DOS motores de food cost vivos en la aplicación y dan números distintos:
//
//   · `food_cost_dashboard` — una consulta, a nivel CUENTA, ponderada por
//     dinero (Σ coste / Σ ingreso). Es la que pinta «Ventas · Margen por
//     plato», que es donde lleva esta tarjeta.
//   · `menu_item_economics` — por MARCA, y el agregador de Cocina la llama una
//     vez por marca y hace la media de las medias. Con 18 marcas activas en
//     Foodint son 36 idas y vueltas para pintar una tarjeta de 4 cm, y encima
//     una media de medias no es el food cost del negocio: pesa igual una marca
//     de 11.444 € que una de 166 €.
//
// Se usa la primera por las dos razones a la vez: **la tarjeta enseña el mismo
// número que la pantalla que abre**, y le cuesta una consulta.
//
// ── LA VENTANA: 30 DÍAS COMPLETOS, SIN HOY ─────────────────────────────────
// Hoy va fuera a propósito. Un día a medias mete el food cost de la comida sin
// la venta de la cena y ensucia el porcentaje; y sobre todo, dejando el periodo
// CERRADO se puede comparar con su espejo sin romper la regla 2 (un periodo en
// curso no se compara con uno cerrado). Con hoy dentro no habría delta.
//
// El espejo son los 30 días completos anteriores. No es «el mismo día de la
// semana» porque un mes móvil ya lleva dentro todos los días de la semana: el
// sesgo que el espejo diario corrige aquí no existe.

import { getFoodCost } from '../services/foodCostService'
import { diaDelNegocio } from '@/lib/fechas'

/** Días completos que entran en la ventana. */
export const VENTANA_DIAS = 30

const DIA_MS = 24 * 60 * 60 * 1000

export interface MarcaFoodCost {
  marca: string
  pct: number | null
  /** El motor la marca fuera de rango (>60 % o <8 %): el dato no se cree. */
  sospechoso: boolean
}

export interface FoodCostMedio {
  /** Ponderado por dinero. null = no hay ninguna línea costeada. */
  pct: number | null
  /** El mismo cálculo sobre los 30 días anteriores. null = sin espejo. */
  pctEspejo: number | null
  lineas: number
  lineasCosteadas: number
  coberturaPct: number | null
  marcas: MarcaFoodCost[]
  /** Nombres de las marcas fuera de rango, para poder nombrarlas. */
  sospechosas: string[]
  desde: Date
  hasta: Date
  /** La ventana del espejo, para que la tarjeta pueda nombrarla sin recalcularla. */
  espejoDesde: Date
  espejoHasta: Date
}

/** [desde, hasta) de los N días completos que terminan anoche. */
export function ventanaCerrada(ahora: Date, dias: number): { desde: Date; hasta: Date } {
  const hasta = diaDelNegocio(ahora).desde        // medianoche de hoy en Madrid
  return { desde: new Date(hasta.getTime() - dias * DIA_MS), hasta }
}

export async function leeFoodCostMedio(
  accountId: string, locationId: string | null, ahora: Date = new Date(),
): Promise<FoodCostMedio> {
  const actual = ventanaCerrada(ahora, VENTANA_DIAS)
  const espejo = {
    desde: new Date(actual.desde.getTime() - VENTANA_DIAS * DIA_MS),
    hasta: actual.desde,
  }

  // Las dos ventanas a la vez: el espejo no puede tardar el doble que el dato.
  const [d, e] = await Promise.all([
    getFoodCost({ accountId, from: actual.desde, to: actual.hasta, locationId }),
    getFoodCost({ accountId, from: espejo.desde, to: espejo.hasta, locationId }),
  ])

  const marcas: MarcaFoodCost[] = d.by_brand.map(b => ({
    marca: b.brand, pct: b.food_cost_pct, sospechoso: b.sospechoso,
  }))

  return {
    pct: d.total.food_cost_pct,
    // Un espejo sin líneas costeadas no es un 0 %: es que no hay espejo.
    pctEspejo: e.salud.lineas_costeadas > 0 ? e.total.food_cost_pct : null,
    lineas: d.salud.lineas,
    lineasCosteadas: d.salud.lineas_costeadas,
    coberturaPct: d.salud.cobertura_pct,
    marcas,
    sospechosas: marcas.filter(m => m.sospechoso).map(m => m.marca),
    desde: actual.desde,
    hasta: actual.hasta,
    espejoDesde: espejo.desde,
    espejoHasta: espejo.hasta,
  }
}
