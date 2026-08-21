// src/modules/kitchen/services/channelRouteService.ts
//
// POR DÓNDE SALE CADA CANAL DE CADA LOCAL.
//
// ENCARGO CODE (21/08) «El gestor de precios pide cinco decisiones» §4.1.
//
// `channel_publish_route` lleva puesta desde el 18/08 y NO LA CONSUMÍA NADIE.
// Es la cuarta pata otra vez: pieza correcta, sin consumidor. Mientras tanto la
// rejilla de precios dejaba escribir el precio de Glovo en Alcalá, que sale por
// Last y no por HubRise, sin decir que ese número no se publica en ninguna
// parte. Julio lo cambió el 21/08 y no llegó a Glovo.
//
// REGLA (§4 de la casa): si Folvy no controla algo, la UI DEGRADA en vez de
// ofrecer un botón que no cumple. Aquí eso es: la celda no se edita y la
// columna dice por qué.
//
// DOS COSAS QUE NO SE INVENTAN
//
// 1. UN CANAL SIN FILA NO ES UN CANAL SIN RUTA. `channel_publish_route` sólo
//    está sembrada para Foodint (6 filas). En Folvy Interno y Kitchen Grill no
//    hay ninguna. Un hueco se dice «no está declarado» y se DEJA EDITAR: si
//    bloqueáramos por falta de dato, la pantalla se volvería inútil en dos
//    cuentas de tres por una tabla que nadie ha rellenado. Un hueco es un dato;
//    tratarlo como un «no» sería inventar.
//
// 2. LOS CANALES QUE NO SON DE REPARTO NO TIENEN RUTA NI LA NECESITAN.
//    Mostrador (dine_in) y Shop (takeaway) no salen a ningún integrador: su
//    precio vale dentro de Folvy en cuanto se guarda. Decir de ellos «sin
//    declarar» sería un aviso falso.
//
// `effective_from` puede traer varias filas por (local, canal) — es una tabla
// con corte de fecha, no un ajuste. Vale la MÁS RECIENTE que ya esté vigente.
// La centinela 2000-01-01 significa «la ruta es la de siempre».

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

// DEUDA DECLARADA, la misma que en priceGridService: src/types/database.ts se
// regenera con el CLI de Supabase (npm run gen:types, que necesita el CLI
// global y el proyecto enlazado) y todavía no conoce `channel_publish_route`,
// que migró el 18/08. Hasta la próxima regeneración se pasa por el cliente sin
// tipar. Lo único que se afloja es el NOMBRE de la tabla: la forma de las filas
// se sigue declarando a mano (RouteRow) y se mapea campo a campo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return supabase
}

export type Route = 'lastapp' | 'hubrise' | 'none'

/** Qué se puede decir de un canal en un local concreto. */
export type RouteVerdict =
  | { kind: 'folvy' }            // lo publica Folvy (HubRise)
  | { kind: 'last' }             // se gestiona en Last: este precio no se publica
  | { kind: 'ninguna' }          // declarado como que no se publica
  | { kind: 'sin_declarar' }     // canal de reparto sin fila: no se sabe
  | { kind: 'interno' }          // Mostrador / Shop: no sale a plataformas

export interface RouteRow {
  locationId: string
  channelId: string
  route: Route
  effectiveFrom: string
  notes: string | null
}

/** Cabecera de la columna. Es el texto que ve el usuario, no un código. */
export const ROUTE_LABEL: Record<RouteVerdict['kind'], string> = {
  folvy:        'Publica Folvy',
  last:         'Se gestiona en Last',
  ninguna:      'No se publica',
  sin_declarar: 'Sin declarar',
  interno:      'Dentro de Folvy',
}

/** La segunda línea, cuando hace falta explicar. '' = no hace falta. */
export const ROUTE_NOTA: Record<RouteVerdict['kind'], string> = {
  folvy:        '',
  last:         'este precio no se publica',
  ninguna:      'no llega a ninguna plataforma',
  sin_declarar: 'no se sabe si llega',
  interno:      'vale en cuanto se guarda',
}

/**
 * ¿Se puede escribir aquí? Sólo se cierra la puerta cuando SABEMOS que el
 * número no llegaría: Last o 'none' declarados. Con un hueco se deja escribir
 * y se avisa — cerrar por falta de dato sería castigar al usuario por una
 * tabla vacía.
 */
export function esEditable(v: RouteVerdict): boolean {
  return v.kind !== 'last' && v.kind !== 'ninguna'
}

/** ¿Este cambio llegará a una plataforma al publicar? */
export function llegaAPlataforma(v: RouteVerdict): boolean {
  return v.kind === 'folvy'
}

/**
 * Resuelve el veredicto de un canal en un local.
 *
 * `channelType` distingue el canal interno del de reparto: sin él, Mostrador
 * saldría «sin declarar» y sería un aviso falso.
 */
export function veredicto(
  rows: RouteRow[],
  locationId: string | null,
  channelId: string,
  channelType: string | null,
  hoy: string = new Date().toISOString().slice(0, 10),
): RouteVerdict {
  if (channelType !== 'delivery') return { kind: 'interno' }
  // Sin local elegido no hay ruta que resolver: la ruta es POR LOCAL, y en esta
  // cuenta el mismo canal sale por sitios distintos según el local (Uber:
  // HubRise en Alcalá, Last en Carabanchel). Decir una sola cosa sería mentir.
  if (!locationId) return { kind: 'sin_declarar' }

  const vigentes = rows
    .filter((r) => r.locationId === locationId && r.channelId === channelId && r.effectiveFrom <= hoy)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))

  const r = vigentes[0]
  if (!r) return { kind: 'sin_declarar' }
  if (r.route === 'lastapp') return { kind: 'last' }
  if (r.route === 'hubrise') return { kind: 'folvy' }
  return { kind: 'ninguna' }
}

/**
 * Todas las rutas de la cuenta. Es una tabla diminuta (6 filas hoy), así que se
 * trae entera y se resuelve en memoria: una consulta por pantalla, no una por
 * celda.
 *
 * Un fallo aquí NO tumba la rejilla — se degrada a «sin declarar» en todas las
 * columnas, que deja escribir y avisa. Perder la pantalla de precios por no
 * poder leer una tabla declarativa sería peor que el problema que resuelve.
 */
export async function listChannelRoutes(accountId: string): Promise<RouteRow[]> {
  if (!isSupabaseEnabled || !supabase) return []
  const { data, error } = await db()
    .from('channel_publish_route')
    .select('location_id, channel_id, route, effective_from, notes')
    .eq('account_id', accountId)
  if (error) {
    console.warn('[channelRouteService] no se pudieron leer las rutas de publicación', error)
    return []
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    locationId: r.location_id as string,
    channelId: r.channel_id as string,
    route: r.route as Route,
    effectiveFrom: r.effective_from as string,
    notes: (r.notes as string | null) ?? null,
  }))
}
