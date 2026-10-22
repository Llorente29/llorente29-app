// src/modules/conta/diseno/plantillas/lista.ts
//
// S02 · La plantilla Lista: lo que decide sin React (tableros 2, 4 y 7).
//
//   · Pestañas de estado con su número, que SUMAN lo de «Todas» (encargo S02).
//     Una pestaña que existe por ley (las del patrón) sale aunque cuente 0; una
//     de más («Otras») solo si tiene algo. Así la suma siempre cuadra y ninguna
//     fila se queda sin pestaña (regla 7).
//   · Volver a la lista como estaba (respuesta de Julio al paso 1, punto 5):
//     los filtros, el orden y la fila donde ibas viven en la DIRECCIÓN de la
//     página (se recarga y queda igual; el atrás del navegador vuelve igual), y
//     la dirección de la última lista se recuerda en la pestaña del navegador
//     (sessionStorage) para que «Volver», las migas y Esc lleven a ella aunque
//     se entre en la ficha desde otro sitio. Nada en la base: un filtro que se
//     queda guardado días esconde filas que nadie ha pedido esconder hoy.

export interface PestanaEstado {
  id: string
  etiqueta: string
  n: number
  /** Sale aunque cuente 0 (las del patrón: «Por revisar», «Por pagar»…). */
  siempre?: boolean
}

/** Las pestañas que salen: las fijas y las demás con algo. «Todas» primero, con la suma. */
export function pestanasConTodas(pestanas: readonly PestanaEstado[], etiquetaTodas = 'Todas'): PestanaEstado[] {
  const total = pestanas.reduce((s, p) => s + p.n, 0)
  return [{ id: 'todas', etiqueta: etiquetaTodas, n: total, siempre: true }, ...pestanas.filter((p) => p.siempre || p.n > 0)]
}

/** ¿Suman las pestañas lo de «Todas»? (una prueba de la plantilla y un aviso en desarrollo). */
export function sumanTodas(pestanas: readonly PestanaEstado[]): boolean {
  const [todas, ...resto] = pestanas
  return !!todas && resto.reduce((s, p) => s + p.n, 0) === todas.n
}

// ── El estado de la lista en la dirección ────────────────────────────────

/** Lo que guarda la dirección de una lista: cada filtro por su nombre. Lo vacío no se escribe. */
export type EstadoLista = Record<string, string>

export function leerEstado(search: string, claves: readonly string[]): EstadoLista {
  const q = new URLSearchParams(search)
  const e: EstadoLista = {}
  for (const k of claves) { const v = q.get(k); if (v !== null && v !== '') e[k] = v }
  return e
}

/** La consulta nueva: lo de antes con lo que cambia; lo vacío se quita (no deja «?q=»). */
export function conCambio(search: string, cambio: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams(search)
  for (const [k, v] of Object.entries(cambio)) {
    if (v === null || v === undefined || v === '') q.delete(k)
    else q.set(k, v)
  }
  const t = q.toString()
  return t ? `?${t}` : ''
}

// ── La última lista, para volver ─────────────────────────────────────────

const CLAVE = (lista: string) => `sumied.lista.${lista}`

type Almacen = Pick<Storage, 'getItem' | 'setItem'>
const sesion = (): Almacen | null => { try { return window.sessionStorage } catch { return null } }

/** Recuerda la dirección de la lista (camino y consulta) en esta pestaña del navegador. */
export function recordarLista(lista: string, direccion: string, almacen: Almacen | null = sesion()): void {
  try { almacen?.setItem(CLAVE(lista), direccion) } catch { /* sin almacén, se vuelve a la lista de serie */ }
}

/** La última dirección de la lista, o la de serie si no hay o no es de esa lista. */
export function listaRecordada(lista: string, deSerie: string, almacen: Almacen | null = sesion()): string {
  let v: string | null
  try { v = almacen?.getItem(CLAVE(lista)) ?? null } catch { v = null }
  const camino = deSerie.split('?')[0]
  return v && v.split('?')[0] === camino ? v : deSerie
}

// ── Orden ────────────────────────────────────────────────────────────────

export type Sentido = 'asc' | 'desc'
/** «fecha» / «-fecha» → la columna y el sentido. */
export function leerOrden(valor: string | undefined, deSerie: { columna: string; sentido: Sentido }): { columna: string; sentido: Sentido } {
  if (!valor) return deSerie
  return valor.startsWith('-') ? { columna: valor.slice(1), sentido: 'desc' } : { columna: valor, sentido: 'asc' }
}
export const escribirOrden = (o: { columna: string; sentido: Sentido }): string => (o.sentido === 'desc' ? `-${o.columna}` : o.columna)

/** Ordena sin tocar la lista de entrada; lo vacío al final; empate, por el orden de antes. */
export function ordenar<T>(filas: readonly T[], valor: (f: T) => string | number | null, sentido: Sentido): T[] {
  return filas.map((f, i) => ({ f, i, v: valor(f) })).sort((a, b) => {
    if (a.v === b.v) return a.i - b.i
    if (a.v === null) return 1
    if (b.v === null) return -1
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'es')
    return sentido === 'asc' ? c : -c
  }).map((x) => x.f)
}
