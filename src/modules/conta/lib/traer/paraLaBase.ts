// src/modules/conta/lib/traer/paraLaBase.ts
//
// N06a · Lo leído (leerCarga, N04) en la forma que recibe la base para traerlo en prueba
// (conta_traer_cargar). Puro: sin base y sin pantalla. Los importes, en CÉNTIMOS enteros;
// las cuentas, como texto y con los números que traían; las fechas, AAAA-MM-DD.
//
// El tipo de IVA y la retención de cada apunte salen de SU FACTURA DEL LIBRO, cuando casa
// (decisión 3 de la respuesta N06 · 1):
//   · el apunte de la 472 (recibidas) o la 477 (emitidas) se parte en uno por tipo de IVA
//     de la factura, cada uno con su base y su cuota (la B-7: 41,00 en la 472 son 21,00 al
//     21 % y 20,00 al 10 %), porque en Sumied cada apunte de IVA lleva su tipo;
//   · el apunte de la 4751, con el % de retención y la base de la factura.
// Lo que no casa (o no se puede partir: la cuota del apunte no es la de la factura) entra
// sin tipo, marcado («sinTipo»), y se dice.

import type { Carga } from './index'
import type { Asiento, Factura } from './leer'

export interface ApunteParaLaBase {
  cuenta: string
  nombre: string
  concepto: string
  debe: number
  haber: number
  iva?: { tipo: number; base: number; libro: 'received' | 'issued' }
  retencion?: { tipo: number; base: number }
  /** Es de IVA o de retención y no se le ha podido poner su tipo. */
  sinTipo?: true
}
export interface AsientoParaLaBase {
  clave: string; serie: string; documento: string; fecha: string; concepto: string
  /** Los apuntes como se leyeron (el de IVA de una factura con dos tipos sale aquí en dos). */
  apuntesLeidos: number
  apuntes: ApunteParaLaBase[]
}
export interface FacturaParaLaBase {
  libro: 'recibidas' | 'expedidas'
  numero: string
  serie: string | null
  numeroSolo: string | null
  fecha: string
  operacion: string | null
  periodo: string | null
  ejercicio: string | null
  nif: string | null
  nombre: string
  tramos: { base: number; tipo: number | null; cuota: number }[]
  base: number
  cuota: number
  total: number
  retencion: { tipo: number | null; importe: number } | null
  /** Su asiento del diario («2.18|2026-01-20»), si casa. */
  asiento: string | null
  /** Lo que queda pendiente según el saldo del tercero (0: pagada o cobrada). Nulo si no se sabe (falta su tercero o el diario). */
  pendiente: number | null
}
export interface DatosDeLaCarga {
  version: 1
  programa: string
  ficheros: { tipo: string; nombre: string; haLeido: string | null }[]
  /** El largo de las subcuentas de los ficheros (si es uno solo). */
  largos: number[]
  cuentas: { codigo: string; nombre: string }[]
  terceros: { clase: 'proveedor' | 'cliente'; codigo: string; nombre: string; nombreComercial: string; nif: string | null }[]
  asientos: AsientoParaLaBase[]
  facturas: FacturaParaLaBase[]
  aprendido: { codigo: string; gasto: { cuenta: string; nombre: string } | null; tiposIva: number[]; retencion: number | null; porque: string }[]
  /** Los terceros cuyo saldo no cuadra exacto con sus facturas (decisión 3): solo estos se enseñan. */
  pendientesNoExactos: { codigo: string; nombre: string; saldo: number; frase: string; facturasSinCasar: string[]; cuadraConSaldo: boolean }[]
  raros: { que: string; cuentas: string[]; nif: string | null; frase: string }[]
  /** N06b · El sumas y saldos de allí, por subcuenta (céntimos): se compara al darlo por bueno. Vacío si no se trajo. */
  sumas: { cuenta: string; nombre: string; debe: number; haber: number }[]
  /** El inmovilizado, tal cual se leyó: Sumied no tiene todavía dónde escribirlo. */
  inmovilizado: Carga['inmovilizado']
  /** Todo lo que no cuadra al leer (N04), en frases. */
  frases: string[]
}

const claveAsiento = (a: Pick<Asiento, 'clave' | 'fecha'>) => `${a.clave}|${a.fecha}`

/** Parte el apunte de IVA de un asiento casado en uno por tipo, y pone la retención. */
function apuntesDe(a: Asiento, f: Factura | null, libro: 'recibidas' | 'expedidas' | null): ApunteParaLaBase[] {
  const out: ApunteParaLaBase[] = []
  const prefijo = libro === 'recibidas' ? '472' : libro === 'expedidas' ? '477' : null
  const deIva = a.apuntes.filter((x) => /^47[27]/.test(x.subcuenta))
  for (const x of a.apuntes) {
    const base: ApunteParaLaBase = { cuenta: x.subcuenta, nombre: x.nombre, concepto: x.concepto, debe: x.debe, haber: x.haber }
    const esIva = /^47[27]/.test(x.subcuenta)
    const esRet = x.subcuenta.startsWith('4751')
    const importe = x.debe - x.haber
    if (esIva && f && prefijo && x.subcuenta.startsWith(prefijo) && deIva.filter((y) => y.subcuenta.startsWith(prefijo)).length === 1
        && Math.abs(importe) === f.cuota && f.tramos.every((t) => t.tipo !== null)) {
      // Uno por tipo de IVA, en el mismo lado que el apunte.
      for (const t of f.tramos) {
        out.push({ ...base, debe: x.debe ? t.cuota : 0, haber: x.haber ? t.cuota : 0,
          iva: { tipo: t.tipo as number, base: t.base, libro: libro === 'recibidas' ? 'received' : 'issued' } })
      }
      continue
    }
    if (esRet && f?.retencion?.tipo != null) { out.push({ ...base, retencion: { tipo: f.retencion.tipo, base: f.base } }); continue }
    out.push(esIva || esRet ? { ...base, sinTipo: true } : base)
  }
  return out
}

/** Lo leído, para la base. `carga` es lo que devuelve leerCarga. */
export function paraLaBase(carga: Carga, programa = 'erp10'): DatosDeLaCarga {
  const casada = new Map<string, { f: Factura; libro: 'recibidas' | 'expedidas' }>()
  const asientoDe = new Map<Factura, string>()
  for (const c of carga.comprobado.facturas?.casadas ?? []) {
    casada.set(claveAsiento(c.asiento), { f: c.factura, libro: c.libro })
    asientoDe.set(c.factura, claveAsiento(c.asiento))
  }
  // Lo pendiente de cada factura: el casado de sus pagos (N09, pendientesPorPagos).
  const pendienteDe = new Map<string, number>()
  const conSaldo = new Set<string>()
  const nifDe = new Map([...(carga.proveedores?.terceros ?? []), ...(carga.clientes?.terceros ?? [])].map((t) => [t.codigo, t.nif]))
  for (const p of carga.aprendido.pendientes) {
    const nif = nifDe.get(p.codigo)
    if (!nif) continue
    conSaldo.add(nif)
    for (const x of p.facturas) pendienteDe.set(`${nif}|${x.numero}|${x.fecha}`, x.pendiente)
  }
  const facturas: FacturaParaLaBase[] = []
  for (const [libro, l] of [['recibidas', carga.recibidas], ['expedidas', carga.expedidas]] as const) {
    for (const f of l?.facturas ?? []) {
      facturas.push({
        libro, numero: f.numero, serie: f.serie, numeroSolo: f.numeroSolo, fecha: f.expedicion, operacion: f.operacion, periodo: f.periodo,
        ejercicio: f.ejercicio, nif: f.nif, nombre: f.nombre, tramos: f.tramos, base: f.base, cuota: f.cuota, total: f.total, retencion: f.retencion,
        asiento: asientoDe.get(f) ?? null,
        pendiente: f.nif && conSaldo.has(f.nif) && carga.diario ? (pendienteDe.get(`${f.nif}|${f.numero}|${f.expedicion}`) ?? 0) : null,
      })
    }
  }
  const asientos: AsientoParaLaBase[] = (carga.diario?.asientos ?? []).map((a) => {
    const c = casada.get(claveAsiento(a))
    return { clave: a.clave, serie: a.serie, documento: a.documento, fecha: a.fecha, concepto: a.apuntes[0]?.concepto ?? '', apuntesLeidos: a.apuntes.length, apuntes: apuntesDe(a, c?.f ?? null, c?.libro ?? null) }
  })
  // Las cuentas: las del plan y las que usan el diario y los listados (con el nombre que traigan).
  const cuentas = new Map<string, string>()
  for (const s of carga.plan?.subcuentas ?? []) cuentas.set(s.codigo, s.nombre)
  for (const a of carga.diario?.asientos ?? []) for (const x of a.apuntes) if (!cuentas.has(x.subcuenta)) cuentas.set(x.subcuenta, x.nombre)
  for (const t of [...(carga.proveedores?.terceros ?? []), ...(carga.clientes?.terceros ?? [])]) if (!cuentas.has(t.codigo)) cuentas.set(t.codigo, t.nombreFiscal)
  return {
    version: 1,
    programa,
    ficheros: carga.ficheros.filter((f) => f.fichero).map((f) => ({ tipo: f.tipo, nombre: f.fichero as string, haLeido: f.haLeido })),
    largos: carga.comprobado.largos.largos,
    cuentas: [...cuentas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([codigo, nombre]) => ({ codigo, nombre })),
    terceros: [
      ...(carga.proveedores?.terceros ?? []).map((t) => ({ clase: 'proveedor' as const, codigo: t.codigo, nombre: t.nombreFiscal, nombreComercial: t.nombreComercial, nif: t.nif })),
      ...(carga.clientes?.terceros ?? []).map((t) => ({ clase: 'cliente' as const, codigo: t.codigo, nombre: t.nombreFiscal, nombreComercial: t.nombreComercial, nif: t.nif })),
    ],
    asientos,
    facturas,
    aprendido: carga.aprendido.proveedores.map((a) => ({ codigo: a.codigo, gasto: a.gasto ? { cuenta: a.gasto.cuenta, nombre: a.gasto.nombre } : null, tiposIva: a.tiposIva, retencion: a.retencion, porque: a.porque })),
    // N09 · Con las facturas cuyos pagos no se han podido casar y si cuadra con su saldo: los lee el paso 3 (detail.pendientesNoExactos).
    pendientesNoExactos: carga.aprendido.pendientes.filter((p) => !p.cuadraExacto).map((p) => ({ codigo: p.codigo, nombre: p.nombre, saldo: p.saldo, frase: p.frase,
      facturasSinCasar: p.facturasSinCasar ?? [], cuadraConSaldo: p.cuadraConSaldo ?? p.cuadraExacto })),
    raros: carga.comprobado.tercerosRaros.map((r) => ({ que: r.que, cuentas: r.cuentas, nif: r.nif, frase: r.frase })),
    sumas: (carga.sumas?.filas ?? []).map((x) => ({ cuenta: x.subcuenta, nombre: x.nombre, debe: x.debe, haber: x.haber })),
    inmovilizado: carga.inmovilizado,
    frases: carga.comprobado.frases,
  }
}
