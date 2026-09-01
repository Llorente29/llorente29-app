// src/shell/home/homeLayoutService.ts
//
// LAS CUATRO TABLAS DEL INICIO — aplicadas en producción el 31/08 a las 18:35
// (migración 20260831T1835_inicio_p1_datos_y_rls, versión 20260831163522).
//
//   home_card_catalog   espejo del catálogo de código. Se lee, no se escribe
//                       desde el cliente: lo siembra el deploy con service_role.
//   home_card_account   interruptor por cuenta. FILA AUSENTE = lo que diga el
//                       espejo. Mismo patrón que product_availability y
//                       brand_closure: la existencia de la fila ES la decisión.
//   home_layout         el mosaico de UN usuario en UNA cuenta. `cards` es una
//                       lista ORDENADA de card_key: el orden de la lista es el
//                       orden en pantalla.
//   home_role_default   la plantilla por rol. P1: solo `admin`.
//
// RESTAURAR ES BORRAR LA FILA, no escribir el defecto en ella. Si «restaurar»
// guardase una copia del defecto, el día que el defecto de rol cambie este
// usuario se quedaría con la foto vieja creyendo que está en el defecto. Sin
// fila no hay foto que se quede vieja: se cae al defecto, y el defecto es uno.
//
// RLS: home_layout usa `auth.uid() = user_id`, directo y sin joins — el
// precedente bueno (user_item_unit_pref), no el de user_saved_view, donde
// `user_id` es en realidad user_profiles.id y la política necesita un EXISTS
// para algo que aquí es una comparación. Por eso `userId` de aquí es SIEMPRE
// authUserId (auth.users.id), nunca el id del perfil. Confundirlos es lo que
// hace que una política parezca que aísla y no aísle.

import { supabase, isSupabaseEnabled } from '../../lib/supabase'
import type { CatalogMirrorRow, AccountSwitchRow } from './homeCatalog'

type Row = Record<string, unknown>
interface Respuesta { data: unknown; error: { message: string } | null }

// Las cuatro tablas `home_*` se crearon el 31/08 y NO están en los tipos
// autogenerados (`src/types/database.ts`) todavía. Pasarlas por el cliente
// tipado no da un error legible: hace que `tsc` se quede colgado intentando
// resolver el genérico de una tabla que no conoce.
//
// Así que se accede por una puerta ACOTADA y explícita, con las cuatro
// operaciones que este fichero usa y ninguna más. Es el mismo espíritu que el
// `from()` acotado de goodsReceiptService, llevado un paso más allá porque
// aquí la tabla ni siquiera existe en los tipos.
//
// DEUDA, con su disparador: cuando se regeneren los tipos
// (`npm run types:gen`), esto se sustituye por el cliente tipado y se borra.
type Consulta = {
  select: (cols?: string) => Consulta
  eq: (col: string, val: unknown) => Consulta
  maybeSingle: () => Promise<Respuesta>
  delete: () => Consulta
  upsert: (valores: unknown, opciones?: unknown) => Promise<Respuesta>
} & Promise<Respuesta>

function tabla(nombre: string): Consulta {
  return (supabase! as unknown as { from: (t: string) => Consulta }).from(nombre)
}

function listaDeClaves(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** El espejo y el interruptor por cuenta. Si fallan, se asume todo encendido. */
export async function getGating(
  accountId: string,
): Promise<{ espejo: CatalogMirrorRow[]; porCuenta: AccountSwitchRow[] }> {
  if (!isSupabaseEnabled || !supabase) return { espejo: [], porCuenta: [] }
  try {
    const [cat, acc] = await Promise.all([
      tabla('home_card_catalog').select('card_key, active'),
      tabla('home_card_account').select('card_key, active').eq('account_id', accountId),
    ])
    if (cat.error) throw cat.error
    if (acc.error) throw acc.error
    return {
      espejo: ((cat.data as Row[] | null) ?? []).map(r => ({ card_key: r.card_key as string, active: r.active !== false })),
      porCuenta: ((acc.data as Row[] | null) ?? []).map(r => ({ card_key: r.card_key as string, active: r.active !== false })),
    }
  } catch (e) {
    // Sin gating legible se enseña el catálogo del código entero. Es la
    // degradación honesta: el código es la verdad, y un fallo leyendo el espejo
    // no puede dejar el Inicio en blanco.
    console.error('[homeLayout] getGating', e)
    return { espejo: [], porCuenta: [] }
  }
}

/** El mosaico guardado de este usuario, o null si nunca ha personalizado. */
export async function getUserLayout(accountId: string, userId: string): Promise<string[] | null> {
  if (!isSupabaseEnabled || !supabase) return null
  const { data, error } = await tabla('home_layout').select('cards')
    .eq('account_id', accountId).eq('user_id', userId).maybeSingle()
  if (error) { console.error('[homeLayout] getUserLayout', error); return null }
  if (!data) return null
  return listaDeClaves((data as Row).cards)
}

/** La plantilla del rol, o null si esa cuenta no ha definido ninguna. */
export async function getRoleDefault(accountId: string, role: string): Promise<string[] | null> {
  if (!isSupabaseEnabled || !supabase) return null
  const { data, error } = await tabla('home_role_default').select('cards')
    .eq('account_id', accountId).eq('role', role).maybeSingle()
  if (error) { console.error('[homeLayout] getRoleDefault', error); return null }
  if (!data) return null
  return listaDeClaves((data as Row).cards)
}

/**
 * Guarda el mosaico del usuario. LANZA si falla: quien llama tiene que poder
 * decirlo en pantalla (regla 8). Un guardado de preferencias que falla en
 * silencio deja al usuario reordenando lo mismo cada vez que entra.
 */
export async function saveUserLayout(accountId: string, userId: string, cards: string[]): Promise<void> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  const { error } = await tabla('home_layout')
    .upsert({ account_id: accountId, user_id: userId, cards, updated_at: new Date().toISOString() },
            { onConflict: 'account_id,user_id' })
  if (error) throw new Error(`No se pudo guardar tu Inicio: ${error.message}`)
}

/**
 * RESTAURAR = borrar la fila. No se escribe el defecto: se deja de tener
 * opinión propia y se cae a la del rol. Sin estado intermedio.
 */
export async function restoreUserLayout(accountId: string, userId: string): Promise<void> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  const { error } = await tabla('home_layout').delete()
    .eq('account_id', accountId).eq('user_id', userId)
  if (error) throw new Error(`No se pudo restaurar tu Inicio: ${error.message}`)
}
