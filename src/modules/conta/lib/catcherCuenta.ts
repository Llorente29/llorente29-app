// src/modules/conta/lib/catcherCuenta.ts
//
// E05 · Retoque 1 (Julio, 15/10): lo reclamado sale como «Reclamada», nunca
// como «por aclarar», y la tarjeta de arriba, el bloque de cada grupo, su fila
// y la lista de Documentos dicen lo mismo porque salen de UNA sola cuenta: el
// estado de cada cosa por aclarar tal como está ahora (no el resumen del
// cruce, que no se mueve cuando alguien decide).

export type EstadoCosa = 'abierta' | 'aceptada' | 'reclamada'
export interface Cuenta { abiertas: number; reclamadas: number; aceptadas: number }

const cero = (): Cuenta => ({ abiertas: 0, reclamadas: 0, aceptadas: 0 })
const sumar = (c: Cuenta, e: EstadoCosa) => {
  if (e === 'abierta') c.abiertas++
  else if (e === 'reclamada') c.reclamadas++
  else c.aceptadas++
}

/** La cuenta de un lote: la de todo y la de cada factura (las cosas de toda la quincena solo cuentan en el total). */
export function cuentaDelLote(cosas: { facturaId: string | null; estado: EstadoCosa }[]): { total: Cuenta; porFactura: Map<string, Cuenta> } {
  const total = cero()
  const porFactura = new Map<string, Cuenta>()
  for (const c of cosas) {
    sumar(total, c.estado)
    if (!c.facturaId) continue
    const f = porFactura.get(c.facturaId) ?? cero()
    sumar(f, c.estado)
    porFactura.set(c.facturaId, f)
  }
  return { total, porFactura }
}

/** La cuenta de un grupo de facturas (riders, flotas, Catcher): la suma de las suyas. */
export function cuentaDeGrupo(facturaIds: string[], porFactura: Map<string, Cuenta>): Cuenta {
  const t = cero()
  for (const id of facturaIds) {
    const c = porFactura.get(id)
    if (c) { t.abiertas += c.abiertas; t.reclamadas += c.reclamadas; t.aceptadas += c.aceptadas }
  }
  return t
}

export type Tono = 'abierta' | 'reclamada' | 'aceptada'

/** Lo que dice la fila de una factura. Lo abierto manda; luego lo reclamado; luego lo que la lectura no dio por seguro. */
export function estadoDeFactura(c: Cuenta | undefined, f: { sinProveedor: boolean; confianza: string | null }): { texto: string; tono: Tono } {
  if (f.sinProveedor) return { texto: 'Sin ficha del proveedor', tono: 'abierta' }
  if (c && c.abiertas > 0) return { texto: `Por aclarar (${c.abiertas})`, tono: 'abierta' }
  if (c && c.reclamadas > 0) return { texto: c.reclamadas === 1 ? 'Reclamada' : `Reclamadas (${c.reclamadas})`, tono: 'reclamada' }
  if (f.confianza !== 'seguro') return { texto: 'Por mirar', tono: 'abierta' }
  return { texto: 'Cuadra', tono: 'aceptada' }
}

/** Las etiquetas de un bloque o de una quincena en la lista: lo abierto y lo reclamado, cada uno con su nombre. */
export function etiquetasDe(c: Cuenta): { texto: string; tono: Tono }[] {
  const e: { texto: string; tono: Tono }[] = []
  if (c.abiertas) e.push({ texto: `${c.abiertas} por aclarar`, tono: 'abierta' })
  if (c.reclamadas) e.push({ texto: `${c.reclamadas} ${c.reclamadas === 1 ? 'reclamada' : 'reclamadas'}`, tono: 'reclamada' })
  return e
}

/** La línea bajo el título de la quincena (retoque 6): solo si cuadra con los pedidos. */
export function cuadraConLosPedidos(cruzado: boolean, c: Cuenta): string {
  if (!cruzado) return 'Sin cruzar con los pedidos todavía'
  const salvo = c.abiertas + c.reclamadas
  if (!salvo) return 'Cuadra con los pedidos'
  return `Cuadra con los pedidos salvo ${salvo}${c.reclamadas ? ` (${c.reclamadas} ${c.reclamadas === 1 ? 'reclamada' : 'reclamadas'})` : ''}`
}

/** La tarjeta «Por aclarar» de arriba: el número es lo abierto; debajo, lo ya decidido, con su nombre. */
export function apoyoDeLaTarjeta(cruzado: boolean, c: Cuenta): string {
  if (!cruzado) return 'sin cruzar todavía'
  const r = `${c.reclamadas} ${c.reclamadas === 1 ? 'reclamada' : 'reclamadas'}`
  const a = `${c.aceptadas} ${c.aceptadas === 1 ? 'dada por buena' : 'dadas por buenas'}`
  return `${r} · ${a}`
}

/** La comisión de Catcher contra la de los pedidos entregados (retoque 3): «0,79 € de más», o nada si cuadra. */
export function diferenciaDeComision(c: { esperada: number; cobrada: number } | null): { centimos: number; sentido: 'de más' | 'de menos' } | null {
  if (!c) return null
  const d = Math.round(c.cobrada * 100) - Math.round(c.esperada * 100)
  return d === 0 ? null : { centimos: Math.abs(d), sentido: d > 0 ? 'de más' : 'de menos' }
}

/** «1 factura» / «3 facturas»: el número con su nombre, en singular o en plural. */
export const contar = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`

/** Cuántas facturas de cada grupo (retoque del 15/10): «3 riders · 1 flota · 1 de Catcher». */
export function facturasPorGrupo(n: { rider: number; flota: number; catcher: number }): string {
  return [contar(n.rider, 'rider', 'riders'), contar(n.flota, 'flota', 'flotas'), `${n.catcher} de Catcher`].join(' · ')
}
