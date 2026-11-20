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
// X10e (20/11) · Y DÍA A DÍA: un día del TPV de un solo asiento salió en dos documentos de ERP10
// (su factura del día y su cobro); se casan los dos juntos con su asiento de Sumied («Clientes de
// contado» se va: entra en uno y sale en el otro). Un día de dos asientos casa cada uno con el suyo.
// Puro: sin red ni base. Importes en céntimos, el debe en positivo.

import type { Comprobar } from '@/modules/conta/erp10/comparar'

export type EnvioErp10 = { entryId: string; clase: string; serie: string; documento: number; cobro?: { serie: string; documento: number } }

/** Los números de ERP10 que hay que leer para casar: el de cada envío y, en un día de un solo asiento, el de su cobro. */
export const documentosACasar = (envios: readonly EnvioErp10[]) => envios.flatMap((e) => [{ serie: e.serie, documento: e.documento }, ...(e.cobro ? [e.cobro] : [])])
export type DocumentoErp10 = { serie: string; documento: number; lineas: { cuenta: string; importe: number }[] }
export type Casada = {
  entryId: string; numero: string; serie: string; documento: number
  /** X10d · recibida, emitida o asiento; X10e, dia. */
  clase?: string
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
    const numero = e.clase === 'asiento' || e.clase === 'dia' ? `${a.serie}/${a.numero ?? '—'}` : a.factura ?? `${a.serie}/${a.numero ?? '—'}`
    const num = e.cobro ? `${e.serie}/${e.documento} y su cobro ${e.cobro.serie}/${e.cobro.documento}` : `${e.serie}/${e.documento}`
    const comun = { entryId: e.entryId, numero, serie: e.serie, documento: e.documento, clase: e.clase }
    const d = doc.get(`${e.serie}/${e.documento}`)
    const dc = e.cobro ? doc.get(`${e.cobro.serie}/${e.cobro.documento}`) : null
    const la = e.clase === 'asiento' || e.clase === 'dia' ? 'lo' : 'la'
    if (!d || (e.cobro && !dc)) {
      const falta = !d ? `${e.serie}/${e.documento}` : `${e.cobro!.serie}/${e.cobro!.documento}`
      r.push({ ...comun, estado: 'no_esta', detalle: `Salió como ${num} y ERP10 ya no tiene ${e.cobro ? `el ${falta}` : 'ese número'}: ${la} han borrado o cambiado allí.` }); continue
    }
    const sumied = porCuenta(a.lineas.map((l) => ({ cuenta: aErp.get(l.cuenta) ?? l.cuenta, importe: c(l.importe) })))
    const erp10 = porCuenta([...d.lineas, ...(dc?.lineas ?? [])])
    const [ts, te] = [debe(sumied), debe(erp10)]
    if (ts !== te) { r.push({ ...comun, estado: 'distinta', detalle: `En ERP10 ${e.cobro ? `el ${num}` : `la ${num}`} suma ${eur(te)} y en Sumied ${eur(ts)}.` }); continue }
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
  // X10d · Con asientos, «asiento a asiento»; si son todo asientos, en masculino. X10e · Y los días, «día a día» (en masculino).
  const asientos = xs.filter((x) => x.clase === 'asiento' || x.clase === 'dia').length
  const hay = { f: xs.some((x) => x.clase !== 'asiento' && x.clase !== 'dia'), a: xs.some((x) => x.clase === 'asiento'), d: xs.some((x) => x.clase === 'dia') }
  const t = [hay.f && 'factura a factura', hay.a && 'asiento a asiento', hay.d && 'día a día'].filter(Boolean) as string[]
  const titulo = (t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}` : t[0] ?? 'factura a factura').replace(/^./, (x) => x.toUpperCase())
  if (!malas.length) {
    if (asientos === xs.length) return { resumen: `${titulo}: ${xs.length === 1 ? 'el que salió' : `los ${xs.length} que salieron`} por la conexión ${xs.length === 1 ? 'está' : 'están'} en ERP10 con su número, igual.`, bien: true, malas }
    return { resumen: `${titulo}: ${xs.length === 1 ? 'la que salió' : `las ${xs.length} que salieron`} por la conexión ${xs.length === 1 ? 'está' : 'están'} en ERP10 con su número, igual.`, bien: true, malas }
  }
  return { resumen: `${titulo}: ${xs.length - malas.length} de ${xs.length} están en ERP10 igual; ${malas.length === 1 ? '1 no' : `${malas.length} no`}.`, bien: false, malas }
}
