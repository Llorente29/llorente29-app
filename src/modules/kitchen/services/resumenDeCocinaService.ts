// src/modules/kitchen/services/resumenDeCocinaService.ts
//
// B79 lote 4. Lo que lee el Resumen de cocina, que son dos RPC y nada más:
//
//   · `food_cost_dashboard`  → la comida sobre lo vendido, partida por tipo de
//     marca y por marca. Es la MISMA función que ya usaba Ventas, así que el
//     Resumen y Ventas no pueden decir cifras distintas de lo mismo.
//   · `kitchen_catalog_gaps` → las cinco cosas que arreglar, cada una con su
//     definición escrita EN LA SALIDA. Aquí no se re-define ningún contador: se
//     arrastra la definición que da la base y se enseña.
//
// LO QUE ESTE FICHERO NO HACE, A PROPÓSITO: no calcula porcentajes por su cuenta.
// El «tuyas 18,5 % · de terceros 26,8 %» viene de `by_ownership`, sumado en SQL
// sobre las mismas filas que el 24,0 % grande. Sumar aquí las filas de `by_brand`
// —que van redondeadas a euros enteros— daría otra vara de medir (regla 31).
//
// Y UN FALLO NO SE DEVUELVE COMO VACÍO: si una RPC falla o rechaza, esto lanza
// con el motivo, y la pantalla lo enseña. Cero filas de una consulta denegada se
// lee como «no tienes nada que arreglar», que es justo lo contrario de la verdad.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { CosaMedida, ClaveDeCosa } from '@/modules/kitchen/lib/lasCosasQueArreglar'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>

export type TipoDeMarca = 'own' | 'licensed' | 'sin_marca'

export interface ComidaPorTipo {
  tipo: TipoDeMarca
  unidades: number
  vendido: number
  vendidoConCoste: number
  foodCost: number
  foodCostPct: number | null
  coberturaPct: number | null
}

export interface ComidaPorMarca {
  brandId: string | null
  marca: string
  ownershipType: TipoDeMarca
  ingreso: number
  foodCost: number
  foodCostPct: number | null
  coberturaPct: number | null
  sospechoso: boolean
}

export interface ComidaSobreVentas {
  /** Unidades de venta del periodo y cuántas llegaron con coste. */
  unidades: number
  unidadesCosteadas: number
  coberturaPct: number | null
  coberturaDineroPct: number | null
  ingresoTotal: number
  /** Sólo sobre lo que SÍ tiene coste: es el denominador del food cost. */
  ingresoConCoste: number
  foodCost: number
  foodCostPct: number | null
  envaseEur: number | null
  envasePts: number | null
  porTipo: ComidaPorTipo[]
  porMarca: ComidaPorMarca[]
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export interface VentanaDeResumen {
  accountId: string
  desde: Date
  hasta: Date
  locationId?: string | null
  brandId?: string | null
}

export async function getComidaSobreVentas(v: VentanaDeResumen): Promise<ComidaSobreVentas> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as Rpc)('food_cost_dashboard', {
    p_account: v.accountId,
    p_from: v.desde.toISOString(),
    p_to: v.hasta.toISOString(),
    p_location: v.locationId ?? null,
    p_brand: v.brandId ?? null,
  })
  if (error) throw new Error(`No se ha podido leer la comida sobre ventas: ${error.message}`)
  const d = (data ?? {}) as Record<string, unknown>
  const salud = (d.salud ?? {}) as Record<string, unknown>
  const total = (d.total ?? {}) as Record<string, unknown>

  return {
    unidades: num(salud.unidades),
    unidadesCosteadas: num(salud.unidades_costeadas),
    coberturaPct: numOrNull(salud.cobertura_pct),
    coberturaDineroPct: numOrNull(salud.cobertura_dinero_pct),
    ingresoTotal: num(salud.ingreso_total),
    ingresoConCoste: num(total.ingreso),
    foodCost: num(total.food_cost),
    foodCostPct: numOrNull(total.food_cost_pct),
    envaseEur: numOrNull(total.envase_eur),
    envasePts: numOrNull(total.envase_pts),
    porTipo: ((d.by_ownership ?? []) as Record<string, unknown>[]).map((o) => ({
      tipo: (o.tipo as TipoDeMarca) ?? 'sin_marca',
      unidades: num(o.unidades),
      vendido: num(o.vendido),
      vendidoConCoste: num(o.vendido_con_coste),
      foodCost: num(o.food_cost),
      foodCostPct: numOrNull(o.food_cost_pct),
      coberturaPct: numOrNull(o.cobertura_pct),
    })),
    porMarca: ((d.by_brand ?? []) as Record<string, unknown>[]).map((b) => ({
      brandId: (b.brand_id as string) ?? null,
      marca: (b.brand as string) ?? '(sin marca)',
      ownershipType: (b.ownership_type as TipoDeMarca) ?? 'sin_marca',
      ingreso: num(b.ingreso),
      foodCost: num(b.food_cost),
      foodCostPct: numOrNull(b.food_cost_pct),
      coberturaPct: numOrNull(b.cobertura_pct),
      sospechoso: b.sospechoso === true,
    })),
  }
}

export interface LoQueFalta {
  medidoEn: string | null
  ventanaDias: number | null
  enCarta: { definicion: string; n: number }
  cosas: CosaMedida[]
}

export async function getLoQueFalta(accountId: string): Promise<LoQueFalta> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as Rpc)('kitchen_catalog_gaps', {
    p_account: accountId,
  })
  if (error) throw new Error(`No se ha podido leer lo que le falta al catálogo: ${error.message}`)
  const d = (data ?? {}) as Record<string, unknown>
  const enCarta = (d.en_carta ?? {}) as Record<string, unknown>

  return {
    medidoEn: (d.medido_en as string) ?? null,
    ventanaDias: numOrNull(d.ventana_dias),
    enCarta: {
      definicion: String(enCarta.definicion ?? ''),
      n: num(enCarta.n),
    },
    cosas: ((d.cosas ?? []) as Record<string, unknown>[]).map((c) => ({
      clave: c.clave as ClaveDeCosa,
      orden: num(c.orden),
      n: num(c.n),
      de: numOrNull(c.de),
      // La definición y el porqué NO se reescriben aquí: llegan de la base y se
      // enseñan tal cual. Es lo que impide que el número y su regla se separen.
      definicion: String(c.definicion ?? ''),
      // Viaja, no se pinta. Ver `CosaMedida.reglaTecnica`.
      reglaTecnica: c.regla_tecnica ? String(c.regla_tecnica) : undefined,
      porQueAqui: String(c.por_que_aqui ?? ''),
      accion: String(c.accion ?? ''),
      peores: ((c.peores ?? []) as Record<string, unknown>[]).map((p) => ({
        brandId: (p.brand_id as string) ?? null,
        marca: String(p.marca ?? '(sin marca)'),
        n: num(p.n),
        de: num(p.de),
      })),
      venden: numOrNull(c.venden) ?? undefined,
      sinFicha: numOrNull(c.sin_ficha) ?? undefined,
      conFichaSinCoste: numOrNull(c.con_ficha_sin_coste) ?? undefined,
      usadosEnLineasDeReceta: numOrNull(c.usados_en_lineas_de_receta) ?? undefined,
      platosConObjetivoPropio: numOrNull(c.platos_con_objetivo_propio) ?? undefined,
      hayFilaDeAjustes: typeof c.hay_fila_de_ajustes === 'boolean' ? c.hay_fila_de_ajustes : undefined,
    })).sort((a, b) => a.orden - b.orden),
  }
}
