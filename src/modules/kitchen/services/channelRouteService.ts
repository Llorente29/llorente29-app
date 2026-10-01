// src/modules/kitchen/services/channelRouteService.ts
//
// POR DÓNDE SALE CADA CANAL DE CADA LOCAL.
//
// ENCARGO CODE (21/08) «El gestor de precios pide cinco decisiones» §4.1.
// REHECHO (01/10) «Pantalla de precios por canal».
//
// REGLA (§4 de la casa): si Folvy no controla algo, la UI DEGRADA en vez de
// ofrecer un botón que no cumple. Aquí eso es: la celda no se edita y la
// columna dice por qué, en UNA frase que entiende un administrativo.
//
// ── LO QUE PASÓ EL 01/10 ────────────────────────────────────────────────────
// La rejilla decía de Glovo «Se gestiona en Last · este precio no se publica»
// y era FALSO: en las propias, Glovo entra por la vía de Folvy desde el 27/08
// en Alcalá y en Carabanchel, y Uber de Carabanchel desde el 28/08.
// `channel_publish_route` se rellenó a mano el 18/08 y nadie la tocó después.
// Se corrigió en datos el 01/10. Esta pantalla añade tres cosas para que no
// vuelva a pasar en silencio:
//
// 1. CEDIDAS: EL PRECIO NO SE TOCA, NUNCA (regla de Julio). Va por
//    `brand.ownership_type`, NO por que la tabla de rutas no tenga filas de
//    cedidas: el día que alguien siembre una, la cedida no puede volverse
//    editable por accidente. Bloquea TODAS las columnas, también las internas.
//
// 2. «TODOS LOS LOCALES» NO ES «SIN DECLARAR». Antes, sin local elegido, todo
//    canal salía «Sin declarar» aunque los dos locales dijeran lo mismo (ya
//    estaba en la auditoría de pantallas del 06/09). Ahora se resuelve local a
//    local: si coinciden se dice eso; si no, en cuáles sí y en cuáles no.
//
// 3. LA RUTA NO PUEDE DEPENDER DE QUE ALGUIEN SE ACUERDE. Se miran las ventas
//    de las marcas propias de los últimos días y, si un (local, canal) entra
//    por una vía distinta de la declarada, se AVISA. No se cambia sola: la
//    tabla la corrige una persona, la pantalla sólo deja de callarse.
//
// ── EL VOCABULARIO DEL CLIENTE ──────────────────────────────────────────────
// El cliente no ve nunca la palabra HubRise (regla de Julio): es fontanería.
// Para él una plataforma la publica Folvy o no está conectada a Folvy. Por eso
// `route` ('hubrise' | 'lastapp' | 'none') se queda en este fichero y lo que
// sale hacia la pantalla son veredictos con nombre de cliente.
//
// UN CANAL SIN FILA = NO CONECTADO (cambio del 01/10). Antes un hueco se dejaba
// editar con un «sin declarar · no se sabe si llega». Eso es exactamente el
// daño del 21/08: teclear un precio que no llega a ninguna parte. Un hueco ya
// no se calla: si las ventas dicen que sí entra por Folvy, lo cuenta el
// detector de deriva (punto 3) y la columna sigue cerrada hasta que se declare.
//
// LOS CANALES QUE NO SON DE REPARTO no tienen ruta ni la necesitan: Mostrador
// (dine_in) y Shop (takeaway) valen dentro de Folvy en cuanto se guardan.
//
// `effective_from` puede traer varias filas por (local, canal) — es una tabla
// con corte de fecha. Vale la MÁS RECIENTE que ya esté vigente. La centinela
// 2000-01-01 significa «la ruta es la de siempre».

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

// DEUDA DECLARADA, la misma que en priceGridService: src/types/database.ts se
// regenera con el CLI de Supabase y todavía no conoce `channel_publish_route`.
// Se pasa por el cliente sin tipar; la forma de las filas se declara a mano.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return supabase
}

export type Route = 'lastapp' | 'hubrise' | 'none'

export interface RouteRow {
  locationId: string
  channelId: string
  route: Route
  effectiveFrom: string
  notes: string | null
}

export interface LocalRuta { id: string; name: string }

/** Lo que dice un (local, canal) suelto. Sólo dos respuestas posibles. */
export type EstadoLocal = 'folvy' | 'no_conectada'

/** Qué se puede decir de una columna de la rejilla. */
export type RouteVerdict =
  | { kind: 'folvy' }                                    // lo publica Folvy
  | { kind: 'no_conectada' }                             // la plataforma no está conectada a Folvy
  | { kind: 'cedida' }                                   // marca cedida: el precio no se toca
  | { kind: 'interno' }                                  // Mostrador / Shop
  | { kind: 'mixto'; llegaEn: string[]; noEn: string[] } // «todos los locales» y no coinciden

/** Lo que dice la columna. UNA frase, en el idioma del que pone precios. */
export function fraseDeRuta(v: RouteVerdict): string {
  switch (v.kind) {
    case 'folvy':        return 'Publica Folvy'
    case 'no_conectada': return 'Esta plataforma no está conectada a Folvy'
    case 'cedida':       return 'Marca cedida: el precio no se cambia desde Folvy'
    case 'interno':      return 'Dentro de Folvy'
    case 'mixto':        return `Llega en ${enumeraCorta(v.llegaEn)} · en ${enumeraCorta(v.noEn)} no`
  }
}

/** La etiqueta corta del candado dentro de la celda. */
export function candadoDeRuta(v: RouteVerdict): string {
  return v.kind === 'cedida' ? 'marca cedida' : 'no conectada'
}

/** Por qué un canal NO llega, para la frase «Glovo no: …» tras guardar. */
export function motivoDeNoLlegar(v: RouteVerdict): string {
  return v.kind === 'cedida'
    ? 'marca cedida, el precio no se cambia desde Folvy'
    : 'no está conectada a Folvy'
}

/** «A», «A y B», «A, B y C». */
export function enumeraCorta(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/**
 * ¿Se puede escribir aquí? Sólo cuando el número llega a algún sitio: lo
 * publica Folvy en al menos un local, o es un canal interno. Una cedida nunca.
 */
export function esEditable(v: RouteVerdict): boolean {
  return v.kind === 'folvy' || v.kind === 'interno' || v.kind === 'mixto'
}

/** ¿Este cambio llegará a alguna plataforma al publicar? */
export function llegaAPlataforma(v: RouteVerdict): boolean {
  return v.kind === 'folvy' || v.kind === 'mixto'
}

/** Ruta vigente declarada para un (local, canal), o null si no hay fila. */
function rutaDeclarada(rows: RouteRow[], locationId: string, channelId: string, hoy: string): Route | null {
  const vigentes = rows
    .filter((r) => r.locationId === locationId && r.channelId === channelId && r.effectiveFrom <= hoy)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  return vigentes[0]?.route ?? null
}

/** Un (local, canal) de reparto: lo publica Folvy o no. Sin fila = no. */
export function estadoLocal(rows: RouteRow[], locationId: string, channelId: string, hoy: string): EstadoLocal {
  return rutaDeclarada(rows, locationId, channelId, hoy) === 'hubrise' ? 'folvy' : 'no_conectada'
}

/**
 * Nombre corto de cada local para las frases de columna: «Alcalá», no
 * «Foodint Alcalá». Sólo se quita la primera palabra si la comparten TODOS los
 * locales y a ninguno le deja el nombre vacío; si no, va el nombre entero.
 */
export function nombresCortos(locales: LocalRuta[]): Map<string, string> {
  const m = new Map<string, string>()
  const partes = locales.map((l) => l.name.trim().split(/\s+/))
  const primera = partes[0]?.[0]
  const comun = locales.length > 1 && primera !== undefined
    && partes.every((p) => p.length > 1 && p[0] === primera)
  locales.forEach((l, i) => m.set(l.id, comun ? partes[i].slice(1).join(' ') : l.name))
  return m
}

export interface VeredictoArgs {
  rows: RouteRow[]
  /** null = «todos los locales». */
  locationId: string | null
  /** Los locales abiertos de la cuenta: los mismos que ofrece «Dónde». */
  locales: LocalRuta[]
  channelId: string
  channelType: string | null
  /** `brand.ownership_type === 'licensed'`. Manda sobre todo lo demás. */
  cedida: boolean
  hoy?: string
}

/** Resuelve el veredicto de una columna. */
export function veredicto(a: VeredictoArgs): RouteVerdict {
  const hoy = a.hoy ?? new Date().toISOString().slice(0, 10)
  // Primero la marca: una cedida no se toca diga lo que diga la tabla.
  if (a.cedida) return { kind: 'cedida' }
  if (a.channelType !== 'delivery') return { kind: 'interno' }
  if (a.locationId) {
    return { kind: estadoLocal(a.rows, a.locationId, a.channelId, hoy) }
  }

  // «Todos los locales»: se resuelve local a local. Si la lista de locales no
  // ha cargado, se usan los locales que la tabla nombra para ese canal; y si
  // tampoco hay, no hay nada que llegue.
  const locales: LocalRuta[] = a.locales.length > 0
    ? a.locales
    : Array.from(new Set(a.rows.filter((r) => r.channelId === a.channelId).map((r) => r.locationId)))
        .map((id) => ({ id, name: id }))
  if (locales.length === 0) return { kind: 'no_conectada' }

  const cortos = nombresCortos(locales)
  const llegaEn: string[] = []
  const noEn: string[] = []
  for (const l of locales) {
    const nombre = cortos.get(l.id) ?? l.name
    if (estadoLocal(a.rows, l.id, a.channelId, hoy) === 'folvy') llegaEn.push(nombre)
    else noEn.push(nombre)
  }
  if (noEn.length === 0) return { kind: 'folvy' }
  if (llegaEn.length === 0) return { kind: 'no_conectada' }
  return { kind: 'mixto', llegaEn, noEn }
}

/**
 * Todas las rutas de las marcas propias de la cuenta. Es una tabla diminuta,
 * así que se trae entera y se resuelve en memoria.
 *
 * Un fallo aquí NO tumba la rejilla: las columnas de reparto salen «no
 * conectada» (cerradas) y la pantalla sigue sirviendo para los canales
 * internos. Cerrar es lo seguro: abrir sin dato es teclear precios a ciegas.
 */
export async function listChannelRoutes(accountId: string): Promise<RouteRow[]> {
  if (!isSupabaseEnabled || !supabase) return []
  const { data, error } = await db()
    .from('channel_publish_route')
    .select('location_id, channel_id, route, effective_from, notes')
    .eq('account_id', accountId)
    .eq('ownership_scope', 'own')
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

// ── DERIVA: LO DECLARADO CONTRA LO QUE ENTRA ────────────────────────────────

/** Días de ventas que se miran para decir por dónde entra un canal. */
export const DIAS_DERIVA = 7

/** Ventas de marcas propias agrupadas por (local, canal, vía). */
export interface VentasPorRuta {
  locationId: string
  channelId: string
  /** 'hubrise' = entra por Folvy. Cualquier otra = no. */
  source: string
  n: number
}

export interface Deriva {
  locationId: string
  channelId: string
  declarada: EstadoLocal
  observada: EstadoLocal
  /** Ventas de la ventana que entraron por Folvy. */
  porFolvy: number
  /** Ventas de la ventana en total. */
  total: number
}

/**
 * Los (local, canal) cuya ruta declarada no casa con por dónde han entrado las
 * ventas de los últimos días. Manda la vía MAYORITARIA de la ventana: un cambio
 * de ruta a mitad de semana se avisa en cuanto la nueva pesa más que la vieja,
 * y un pedido suelto no da la vuelta a un canal. Sin ventas no se dice nada:
 * no hay con qué comparar.
 */
export function derivas(rows: RouteRow[], ventas: VentasPorRuta[], hoy: string): Deriva[] {
  const m = new Map<string, { locationId: string; channelId: string; porFolvy: number; total: number }>()
  for (const v of ventas) {
    const k = `${v.locationId}::${v.channelId}`
    const e = m.get(k) ?? { locationId: v.locationId, channelId: v.channelId, porFolvy: 0, total: 0 }
    e.total += v.n
    if (v.source === 'hubrise') e.porFolvy += v.n
    m.set(k, e)
  }
  const out: Deriva[] = []
  for (const e of m.values()) {
    if (e.total === 0) continue
    const observada: EstadoLocal = e.porFolvy * 2 > e.total ? 'folvy' : 'no_conectada'
    const declarada = estadoLocal(rows, e.locationId, e.channelId, hoy)
    if (observada !== declarada) out.push({ ...e, declarada, observada })
  }
  return out
}

/** La frase del aviso de deriva. Sin nombres de fontanería. */
export function fraseDeDeriva(d: Deriva, canal: string, local: string): string {
  if (d.observada === 'folvy') {
    return `${canal} en ${local}: en los últimos ${DIAS_DERIVA} días ${d.porFolvy} de ${d.total} pedidos ` +
      'entraron por Folvy, pero aquí consta como no conectada. Hay que corregir la configuración.'
  }
  return `${canal} en ${local}: en los últimos ${DIAS_DERIVA} días sólo ${d.porFolvy} de ${d.total} pedidos ` +
    'entraron por Folvy, pero aquí consta que lo publica Folvy. Lo que publiques puede no llegar. ' +
    'Hay que corregir la configuración.'
}

/**
 * Ventas de las marcas PROPIAS de la cuenta en los últimos `DIAS_DERIVA` días,
 * agrupadas por (local, canal, vía). Las cedidas no cuentan: entran siempre
 * por su TPV y `channel_publish_route` sólo declara las propias.
 *
 * Un fallo aquí devuelve null y la pantalla lo DICE: no saber si hay deriva no
 * es lo mismo que no haberla.
 */
export async function listVentasPorRuta(accountId: string): Promise<VentasPorRuta[] | null> {
  if (!isSupabaseEnabled || !supabase) return []
  const { data: marcas, error: e1 } = await db()
    .from('brand').select('id')
    .eq('account_id', accountId).eq('ownership_type', 'own')
  if (e1) { console.warn('[channelRouteService] marcas propias', e1); return null }
  const ids = ((marcas ?? []) as Array<{ id: string }>).map((b) => b.id)
  if (ids.length === 0) return []

  const desde = new Date(Date.now() - DIAS_DERIVA * 86_400_000).toISOString()
  const PAGINA = 1000
  const m = new Map<string, VentasPorRuta>()
  for (let desdeFila = 0; ; desdeFila += PAGINA) {
    const { data, error } = await db()
      .from('sale').select('location_id, channel_id, source')
      .eq('account_id', accountId)
      .in('brand_id', ids)
      .gte('sold_at', desde)
      .not('location_id', 'is', null)
      .not('channel_id', 'is', null)
      .order('id')
      .range(desdeFila, desdeFila + PAGINA - 1)
    if (error) { console.warn('[channelRouteService] ventas por ruta', error); return null }
    const filas = (data ?? []) as Array<{ location_id: string; channel_id: string; source: string | null }>
    for (const f of filas) {
      const src = f.source ?? ''
      const k = `${f.location_id}::${f.channel_id}::${src}`
      const e = m.get(k)
      if (e) e.n++
      else m.set(k, { locationId: f.location_id, channelId: f.channel_id, source: src, n: 1 })
    }
    if (filas.length < PAGINA) break
  }
  return Array.from(m.values())
}
