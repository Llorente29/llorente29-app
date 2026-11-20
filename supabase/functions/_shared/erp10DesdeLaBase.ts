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
// X10d: y los asientos (lo del X07), con la huella de sus filas.
// X10e: y los días del TPV: su factura del día y su cobro (el asiento armado, en un día de un solo
// asiento; o el asiento del cobro del día, si va en dos), con la misma huella que apunta el Excel.

import { armarSalida } from './erp10Salida.ts'
import { aAsientos, aDias, aEmitidas, aPorSalir, aRecibidas } from './erp10Lectura.ts'
import { huellaFila, type AsientoParaApi, type DiaParaApi, type EmitidaParaApi, type RecibidaParaApi } from './erp10Ficheros.ts'

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
  /** X10d · Un asiento (lo del X07). */
  | { clase: 'asiento'; entryId: string; numero: string; api: AsientoParaApi; huella: string; pdf: null }
  /**
   * X10e · Un día del TPV: su factura del día y su cobro. `cobro.aparte`: el día va en dos asientos
   * (R07) y el cobro es otro asiento, con su huella; si no, el cobro sale del mismo asiento del día.
   */
  | { clase: 'dia'; entryId: string; numero: string; api: DiaParaApi; huella: string; pdf: null
      cobro: { entryId: string; api: AsientoParaApi; aparte: boolean; huella: string } }

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
  const dias = new Map(s.ficheros.dias.map((d) => [d.entryId, d]))
  // El cobro de un día en dos asientos sale con su día, no suelto.
  const cobroDe = new Map(s.ficheros.dias.flatMap((d) => (d.cobroId ? [[d.cobroId, d.entryId] as const] : [])))
  const porque = new Map(s.noPuedenSalir.map((x) => [x.entryId, x.porque]))
  const salen: ParaEscribir[] = []
  const noSalen: { entryId: string; porque: string }[] = []
  // Pedir el cobro de un día de dos asientos es pedir su día (sale con él, una sola vez).
  const vistas = new Set<string>()
  for (const pedida of pedidas) {
    const id = cobroDe.get(pedida) ?? pedida
    if (vistas.has(id)) continue
    vistas.add(id)
    const r = rec.get(id)
    if (r?.api) { salen.push({ clase: 'recibida', entryId: id, numero: r.api.numero, api: r.api, huella: await huellaFila(r.fila), pdf: r.pdf ?? null }); continue }
    const e = emi.get(id)
    if (e?.api) { salen.push({ clase: 'emitida', entryId: id, numero: e.api.numero, api: e.api, huella: await huellaFila(e.fila), pdf: e.pdf ?? null }); continue }
    const d = dias.get(id)
    if (d) {
      if (!d.api || !d.cobro) { noSalen.push({ entryId: id, porque: 'Es un día del TPV y no se ha podido armar su factura o su cobro: sale con el Excel.' }); continue }
      const aparte = d.cobro.entryId !== id
      // La huella, la misma que apunta el Excel: la fila del día y, en un día de un asiento, la de su cobro.
      const huella = await huellaFila([...d.fila, ...(aparte ? [] : d.cobro.filas.flat())])
      salen.push({ clase: 'dia', entryId: id, numero: d.api.numero, api: d.api, huella, pdf: null,
        cobro: { entryId: d.cobro.entryId, api: d.cobro.api, aparte, huella: aparte ? await huellaFila(d.cobro.filas.flat()) : huella } })
      continue
    }
    const a = asi.get(id)
    if (a?.api) { salen.push({ clase: 'asiento', entryId: id, numero: a.api.numero, api: a.api, huella: await huellaFila(a.filas.flat()), pdf: null }); continue }
    noSalen.push({ entryId: id, porque: porque.get(id) ?? 'No está en lo que sale este mes: ya salió, o no sale por aquí.' })
  }
  return { salen, noSalen, cuentasNuevas: s.listas.cuentas.map((c) => ({ codigo: c.codigoErp10, nombre: c.nombre, nif: c.nif })) }
}
