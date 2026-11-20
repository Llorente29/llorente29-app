// supabase/functions/_shared/erp10DesdeLaBase.ts
//
// X10c (19/11) · LO QUE SE ESCRIBE EN ERP10 SE ARMA DESDE LA BASE, NO DESDE LO QUE MANDA EL
// NAVEGADOR. El navegador solo dice qué sociedad, qué mes y qué asientos (pedidasDelCuerpo: el
// resto del cuerpo no se lee). conta-erp10-escribir lee lo que sale ese mes con las mismas
// funciones de la base que la pantalla (conta_erp10_por_salir, …_recibidas_por_salir,
// …_emitidas_por_salir, …_asientos_por_salir, …_dias_tpv_por_salir, con la sesión de quien
// pulsa), lo lee con los mismos lectores (erp10Lectura.ts) y lo arma con el mismo armarSalida
// (erp10Salida.ts): lo que entra en ERP10 es exactamente lo que llevaría el Excel, con sus
// cuentas ya convertidas y la huella de su fila.
//
// Lo prueba tests/conta/erp10/desdeLaBase.test.ts: un importe distinto en el cuerpo no entra.
// X10d: y los asientos (lo del X07), con la huella de sus filas; los días del TPV, no.

import { armarSalida } from './erp10Salida.ts'
import { aAsientos, aDias, aEmitidas, aPorSalir, aRecibidas } from './erp10Lectura.ts'
import { huellaFila, type AsientoParaApi, type EmitidaParaApi, type RecibidaParaApi } from './erp10Ficheros.ts'

/** Lo que devuelven las cinco funciones de la base, tal cual, y la carpeta de los PDF de la salida. */
export type BaseCruda = {
  porSalir: Record<string, unknown>
  recibidas: Record<string, unknown>
  emitidas: Record<string, unknown>
  asientos: Record<string, unknown>
  dias: Record<string, unknown>
  carpeta: string
}

export type ParaEscribir =
  | { clase: 'recibida'; entryId: string; numero: string; api: RecibidaParaApi; huella: string; pdf: { ruta: string; nombre: string } | null }
  | { clase: 'emitida'; entryId: string; numero: string; api: EmitidaParaApi; huella: string; pdf: { ruta: string; nombre: string } | null }
  /** X10d · Un asiento (lo del X07). Los días del TPV no: esperan al R07. */
  | { clase: 'asiento'; entryId: string; numero: string; api: AsientoParaApi; huella: string; pdf: null }

/** La carpeta de los PDF de la salida (la misma regla que la pantalla). */
export const carpetaDe = (carpeta: string | null | undefined, codigo: string | null | undefined) => carpeta ?? `C:\\Sumied\\${codigo ?? ''}\\`

/** Del cuerpo que manda el navegador, solo los asientos pedidos (ids). Todo lo demás se ignora. */
export function pedidasDelCuerpo(cuerpo: unknown): string[] {
  const b = (cuerpo ?? {}) as { entradas?: unknown }
  const xs = Array.isArray(b.entradas) ? b.entradas : []
  return [...new Set(xs.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))]
}

/**
 * Lo que sale por la conexión de los asientos pedidos, armado desde la base: su recibida o su
 * emitida (con las cuentas de ERP10), la huella de su fila y su PDF. Los que no están en lo que
 * sale ese mes (ya salieron, no pueden salir, o no son de este mes) vuelven con su porqué.
 */
export async function loQueSaleDesdeLaBase(b: BaseCruda, pedidas: readonly string[]): Promise<{
  salen: ParaEscribir[]
  noSalen: { entryId: string; porque: string }[]
  cuentasNuevas: { codigo: string; nombre: string; nif: string | null }[]
}> {
  const s = armarSalida(aPorSalir(b.porSalir), aRecibidas(b.recibidas), aEmitidas(b.emitidas), b.carpeta, aAsientos(b.asientos), aDias(b.dias))
  const rec = new Map(s.ficheros.recibidas.map((f) => [f.entryId, f]))
  const emi = new Map(s.ficheros.expedidas.map((f) => [f.entryId, f]))
  const asi = new Map(s.ficheros.asientos.map((f) => [f.entryId, f]))
  const dias = new Set(s.ficheros.dias.map((d) => d.entryId))
  const porque = new Map(s.noPuedenSalir.map((x) => [x.entryId, x.porque]))
  const salen: ParaEscribir[] = []
  const noSalen: { entryId: string; porque: string }[] = []
  for (const id of pedidas) {
    const r = rec.get(id)
    if (r?.api) { salen.push({ clase: 'recibida', entryId: id, numero: r.api.numero, api: r.api, huella: await huellaFila(r.fila), pdf: r.pdf ?? null }); continue }
    const e = emi.get(id)
    if (e?.api) { salen.push({ clase: 'emitida', entryId: id, numero: e.api.numero, api: e.api, huella: await huellaFila(e.fila), pdf: e.pdf ?? null }); continue }
    if (dias.has(id)) { noSalen.push({ entryId: id, porque: 'Es un día del TPV, y todavía no sale por la conexión: sigue con el Excel.' }); continue }
    const a = asi.get(id)
    if (a?.api) { salen.push({ clase: 'asiento', entryId: id, numero: a.api.numero, api: a.api, huella: await huellaFila(a.filas.flat()), pdf: null }); continue }
    noSalen.push({ entryId: id, porque: porque.get(id) ?? 'No está en lo que sale este mes: ya salió, o no sale por aquí.' })
  }
  return { salen, noSalen, cuentasNuevas: s.listas.cuentas.map((c) => ({ codigo: c.codigoErp10, nombre: c.nombre, nif: c.nif })) }
}
