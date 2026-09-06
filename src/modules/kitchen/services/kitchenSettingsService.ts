// src/modules/kitchen/services/kitchenSettingsService.ts
//
// B79 §3.11 (06/09/2026). Los ajustes de cocina de la CUENTA. Hoy sólo hay uno
// que se pueda tocar desde una pantalla: el objetivo de comida sobre ventas.
//
// POR QUÉ NACE ESTE FICHERO. La tabla `kitchen_settings` existe desde el
// principio y **no había una sola línea de `src/` que la leyera o la escribiera**:
// la fila la creaba `NuevaCuentaPage` al dar de alta la cuenta y ahí se quedaba,
// con el objetivo a NULL en las tres cuentas. Mientras tanto, diez platos tenían
// su objetivo propio puesto a mano desde la pestaña Ficha — y el motor no lo
// miraba (leía sólo el de la cuenta, que estaba vacío). Diez decisiones sin
// efecto. La migración
// `20260906214800_b79_l4_el_objetivo_del_plato_manda_sobre_el_de_la_cuenta.sql`
// arregla la mitad del motor; este servicio arregla la otra mitad: que el
// objetivo de la cuenta se pueda poner sin entrar en la base de datos.
//
// LA REGLA, ESCRITA DONDE SE USA: el objetivo del PLATO manda; el de la CUENTA
// vale para todos los que no tengan el suyo.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

/**
 * ¿Vale este porcentaje como objetivo de comida?
 *
 * Vive aquí y NO en la pantalla porque la pantalla y el servicio tienen que
 * validar con la MISMA regla: si cada uno tiene la suya, un día el campo deja
 * pasar algo que la base rechaza, o al revés, y el usuario ve un fallo que no
 * entiende. `null` es válido: significa «sin objetivo», que es un estado legítimo.
 *
 * El cero no vale: un objetivo del 0 % no es «sin objetivo», es «que la comida no
 * cueste nada», y eso pondría en rojo la carta entera sin que nadie lo haya
 * pedido.
 */
export function objetivoValido(pct: number | null): boolean {
  if (pct === null) return true
  return Number.isFinite(pct) && pct > 0 && pct <= 100
}

/** El motivo, en castellano, para enseñarlo tal cual. Un fallo se explica. */
export const OBJETIVO_INVALIDO =
  'El objetivo tiene que ser un porcentaje mayor que 0 y como mucho 100. Déjalo vacío para no tener objetivo.'

export interface KitchenSettings {
  /** Objetivo de comida sobre ventas de la cuenta, en %. NULL = sin objetivo. */
  targetFoodCostPct: number | null
  /** Objetivo de coste de plato. Sólo existe a nivel de cuenta. */
  targetPlateCostPct: number | null
}

interface Row {
  target_food_cost_pct: number | string | null
  target_plate_cost_pct: number | string | null
}

function toNum(v: number | string | null): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function mapRow(r: Row): KitchenSettings {
  return {
    targetFoodCostPct: toNum(r.target_food_cost_pct),
    targetPlateCostPct: toNum(r.target_plate_cost_pct),
  }
}

/**
 * Los ajustes de la cuenta, o `null` si la cuenta no tiene fila todavía.
 *
 * `null` significa «no hay fila», no «no hay objetivo»: son cosas distintas y la
 * pantalla las dice distinto. Un error de lectura NO se devuelve como `null`, se
 * lanza — un fallo se enseña, no se disfraza de vacío.
 */
export async function getKitchenSettings(accountId: string): Promise<KitchenSettings | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_settings')
    .select('target_food_cost_pct,target_plate_cost_pct')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`No se han podido leer los ajustes de cocina: ${error.message}`)
  return data ? mapRow(data as Row) : null
}

/**
 * Guarda el objetivo de comida de la cuenta y **devuelve lo que ha quedado
 * guardado**, no un booleano: quien llama enseña el valor de vuelta, no un visto
 * (regla 8, «la confirmación lleva contenido»).
 *
 * `null` borra el objetivo. Se actualiza primero y sólo se inserta si no había
 * fila, que es lo que hace bien las dos cosas sin depender de que exista una
 * restricción única sobre `account_id`.
 */
export async function setTargetFoodCostPct(
  accountId: string,
  pct: number | null,
): Promise<KitchenSettings> {
  requireSupabase()
  if (!objetivoValido(pct)) throw new Error(OBJETIVO_INVALIDO)

  const { data: upd, error: errUpd } = await supabase!
    .from('kitchen_settings')
    .update({ target_food_cost_pct: pct })
    .eq('account_id', accountId)
    .select('target_food_cost_pct,target_plate_cost_pct')
  if (errUpd) throw new Error(`No se ha podido guardar el objetivo: ${errUpd.message}`)
  if (Array.isArray(upd) && upd.length > 0) return mapRow(upd[0] as Row)

  const { data: ins, error: errIns } = await supabase!
    .from('kitchen_settings')
    .insert({ account_id: accountId, target_food_cost_pct: pct })
    .select('target_food_cost_pct,target_plate_cost_pct')
    .single()
  if (errIns) throw new Error(`No se ha podido crear los ajustes de cocina: ${errIns.message}`)
  return mapRow(ins as Row)
}

/**
 * Cuántos platos EN CARTA de la cuenta tienen su propio objetivo. Es lo que
 * permite que la pantalla diga «8 lo tienen suyo, los otros 550 usan éste» en vez
 * de dar a entender que el de la cuenta manda sobre todos.
 *
 * «En carta» es la misma definición que usa el Resumen: `is_active IS NOT FALSE`
 * y `archived_at IS NULL`.
 */
export async function contarPlatosConObjetivoPropio(
  accountId: string,
): Promise<{ conObjetivoPropio: number; enCarta: number }> {
  requireSupabase()
  const base = () =>
    supabase!
      .from('menu_item')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .not('is_active', 'is', false)
      .is('archived_at', null)

  const [propios, todos] = await Promise.all([
    base().not('target_food_cost_pct', 'is', null),
    base(),
  ])
  if (propios.error) throw new Error(`No se han podido contar los platos con objetivo propio: ${propios.error.message}`)
  if (todos.error) throw new Error(`No se han podido contar los platos en carta: ${todos.error.message}`)
  return { conObjetivoPropio: propios.count ?? 0, enCarta: todos.count ?? 0 }
}
