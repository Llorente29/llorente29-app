// src/modules/conta/erp10/casar.ts
//
// X10c (19/11) · EL PASO 3 CASA FACTURA A FACTURA. Lo que salió por la conexión con ERP10 tiene
// guardado el número que le dio ERP10 (conta_erp10_envio: serie y documento). Al comparar, se
// leen de ERP10 esos documentos (conta-erp10-leer, «saldos» con sus documentos) y cada uno se casa
// con su asiento de Sumied (conta_erp10_comprobar), cuenta a cuenta, en las cuentas de ERP10:
//   · igual: el mismo importe en cada cuenta;
//   · otras_cuentas: el mismo total, en otras cuentas (p. ej., ERP10 pone su propia 472);
//   · distinta: otro total;
//   · no_esta: ERP10 ya no tiene ese número (lo han borrado o cambiado allí).
// Puro: sin red ni base. Importes en céntimos, el debe en positivo.

import type { Comprobar } from '@/modules/conta/erp10/comparar'

export type EnvioErp10 = { entryId: string; clase: string; serie: string; documento: number }
export type DocumentoErp10 = { serie: string; documento: number; lineas: { cuenta: string; importe: number }[] }
export type Casada = {
  entryId: string; numero: string; serie: string; documento: number
  estado: 'igual' | 'otras_cuentas' | 'distinta' | 'no_esta'
  detalle: string
}

const c = (x: number) => Math.round(x * 100)
const eur = (cent: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cent / 100)
const porCuenta = (ls: readonly { cuenta: string; importe: number }[]) => {
  const m = new Map<string, number>()
  for (const l of ls) m.set(l.cuenta, (m.get(l.cuenta) ?? 0) + l.importe)
  for (const [k, v] of m) if (v === 0) m.delete(k)
  return m
}
const debe = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((t, v) => t + Math.max(v, 0), 0)

/** Cada factura salida por la conexión, casada con lo que ERP10 tiene con su número. Las de fuera de la comparación (otra fecha) no salen. */
export function casarFacturas(envios: readonly EnvioErp10[], docs: readonly DocumentoErp10[], base: Comprobar): Casada[] {
  const aErp = new Map(base.saldos.map((s) => [s.codigo, s.erp ?? s.codigo]))
  const doc = new Map(docs.map((d) => [`${d.serie}/${d.documento}`, d]))
  const r: Casada[] = []
  for (const e of envios) {
    const a = base.asientos.find((x) => x.entryId === e.entryId)
    if (!a) continue
    const numero = a.factura ?? `${a.serie}/${a.numero ?? '—'}`
    const num = `${e.serie}/${e.documento}`
    const comun = { entryId: e.entryId, numero, serie: e.serie, documento: e.documento }
    const d = doc.get(num)
    if (!d) { r.push({ ...comun, estado: 'no_esta', detalle: `Salió como ${num} y ERP10 ya no tiene ese número: la han borrado o cambiado allí.` }); continue }
    const sumied = porCuenta(a.lineas.map((l) => ({ cuenta: aErp.get(l.cuenta) ?? l.cuenta, importe: c(l.importe) })))
    const erp10 = porCuenta(d.lineas)
    const [ts, te] = [debe(sumied), debe(erp10)]
    if (ts !== te) { r.push({ ...comun, estado: 'distinta', detalle: `En ERP10 la ${num} suma ${eur(te)} y en Sumied ${eur(ts)}.` }); continue }
    const cuentas = [...new Set([...sumied.keys(), ...erp10.keys()])].sort()
    const distintas = cuentas.filter((k) => (sumied.get(k) ?? 0) !== (erp10.get(k) ?? 0))
    if (!distintas.length) { r.push({ ...comun, estado: 'igual', detalle: `Está en ERP10 como ${num}, igual.` }); continue }
    r.push({ ...comun, estado: 'otras_cuentas', detalle: `Está en ERP10 como ${num} por el mismo total, pero en otras cuentas: ${distintas.map((k) => `${k} (${eur(sumied.get(k) ?? 0)} en Sumied, ${eur(erp10.get(k) ?? 0)} en ERP10)`).join(', ')}.` })
  }
  return r
}

/** La línea de arriba del paso 3: cuántas salidas por la conexión están igual, y las que no. */
export function frasesCasadas(xs: readonly Casada[]): { resumen: string; bien: boolean; malas: Casada[] } {
  const malas = xs.filter((x) => x.estado !== 'igual')
  if (!malas.length) return { resumen: `Factura a factura: ${xs.length === 1 ? 'la que salió' : `las ${xs.length} que salieron`} por la conexión ${xs.length === 1 ? 'está' : 'están'} en ERP10 con su número, igual.`, bien: true, malas }
  return { resumen: `Factura a factura: ${xs.length - malas.length} de ${xs.length} están en ERP10 igual; ${malas.length === 1 ? '1 no' : `${malas.length} no`}.`, bien: false, malas }
}
