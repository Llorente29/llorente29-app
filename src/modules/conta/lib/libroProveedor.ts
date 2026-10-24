// src/modules/conta/lib/libroProveedor.ts
//
// I01e · Lo que el libro sabe de un proveedor, para su ficha. Puro.
//
// La ficha leía solo las facturas subidas a Sumied (supplier_invoice). Un
// proveedor traído de Diez tiene sus facturas en el libro de IVA y sus asientos
// en su 410, y la ficha decía «Aún no hay facturas suyas»: falso (Julio, 20/10,
// Anthropic y HubRise). Aquí:
//
//   · las facturas del libro de IVA de los asientos de su cuenta, sin las que
//     ya salen como factura de Sumied (las de source_type 'supplier_invoice'
//     con su id entre las de la ficha), cada una con su origen;
//   · el origen de un asiento en palabras: traído de Diez, factura subida a
//     Sumied, el banco, las ventas del día o hecho en Sumied;
//   · las cifras de arriba con las dos fuentes: lo comprado este año suma las
//     del libro; «Le debes», si no hay ninguna factura de Sumied, es el saldo
//     de su cuenta (el de Diez dice lo que se le pagó; la factura del libro no).

import { extracto, type Apunte, type OrigenApunte } from './cuentasProveedor'
import type { CifrasFicha } from './cifras'

/** Una fila del libro de IVA (vat_book_entry), con lo que la ficha usa. */
export interface FilaLibroProveedor {
  entryId: string
  serie: string | null
  numero: string | null
  fecha: string
  base: number
  cuota: number
  total: number
  /** Inversión del sujeto pasivo: el proveedor factura la base; la cuota la pones tú. */
  isp: boolean
  sourceType: string | null
  sourceId: string | null
}

export interface FacturaDelLibro {
  /** El asiento del que sale: «Ver el asiento». */
  entryId: string
  numero: string
  fecha: string
  base: number
  cuota: number
  /** Lo que te factura: base + IVA, o solo la base si es inversión del sujeto pasivo. */
  importe: number
  isp: boolean
  origen: OrigenApunte
  /** El asiento en el diario: «2/123». */
  asiento: string | null
}

const c = (x: number) => Math.round(x * 100)

/** El origen de un asiento, de journal_entry (source_type, external_program). */
export function origenDelAsiento(sourceType: string | null | undefined, programa: string | null | undefined): OrigenApunte {
  if (sourceType === 'migrated' || programa === 'diez') return 'diez'
  if (sourceType === 'supplier_invoice') return 'factura'
  if (sourceType === 'bank') return 'banco'
  if (sourceType === 'sales_day') return 'ventas'
  return 'sumied'
}

/** El origen de un asiento, en palabras de oficina. `marca`: el nombre del programa (Sumied). */
export function textoOrigen(o: OrigenApunte, marca: string): string {
  switch (o) {
    case 'diez': return 'Traído de Diez'
    case 'factura': return `Factura subida a ${marca}`
    case 'banco': return 'Del banco'
    case 'ventas': return 'Ventas del día'
    case 'sumied': return `Apuntado en ${marca}`
  }
}

/** El origen de una factura del libro: traída de Diez o apuntada en el programa. */
export function textoOrigenFactura(o: OrigenApunte, marca: string): string {
  return o === 'diez' ? 'Traída de Diez' : `Apuntada en ${marca}`
}

/**
 * Las facturas del libro de IVA de sus asientos, una por factura (una factura
 * con dos tipos de IVA son dos filas del libro), de la más reciente a la más
 * antigua. Sin las que ya salen como factura de Sumied.
 */
export function facturasDelLibro(filas: readonly FilaLibroProveedor[], apuntes: readonly Apunte[], idsDeSumied: ReadonlySet<string>): FacturaDelLibro[] {
  const asientos = new Map<string, Apunte>()
  for (const a of apuntes) if (a.enlace?.tipo === 'asiento' && !asientos.has(a.enlace.id)) asientos.set(a.enlace.id, a)
  const grupos = new Map<string, FacturaDelLibro & { _b: number; _c: number; _i: number }>()
  for (const f of filas) {
    if (f.sourceType === 'supplier_invoice' && f.sourceId && idsDeSumied.has(f.sourceId)) continue
    const numero = [f.serie, f.numero].filter((x) => x && x.trim()).join(' ').trim() || 'Sin número'
    const clave = `${f.entryId}|${numero}`
    const a = asientos.get(f.entryId)
    const g = grupos.get(clave) ?? {
      entryId: f.entryId, numero, fecha: f.fecha, base: 0, cuota: 0, importe: 0, isp: false,
      origen: a?.origen ?? origenDelAsiento(f.sourceType, null),
      asiento: a?.asiento ? `${a.asiento.serie}/${a.asiento.numero}` : null,
      _b: 0, _c: 0, _i: 0,
    }
    g._b += c(f.base); g._c += c(f.cuota); g._i += f.isp ? c(f.base) : c(f.total)
    g.isp = g.isp || f.isp
    if (f.fecha < g.fecha) g.fecha = f.fecha
    grupos.set(clave, g)
  }
  return [...grupos.values()]
    .map(({ _b, _c, _i, ...g }) => ({ ...g, base: _b / 100, cuota: _c / 100, importe: _i / 100 }))
    .sort((x, y) => y.fecha.localeCompare(x.fecha) || y.numero.localeCompare(x.numero))
}

export interface CifrasConLibro extends CifrasFicha {
  /** De dónde sale «Le debes»: de las facturas de Sumied o del saldo de su cuenta. */
  leDebesDe: 'facturas' | 'cuenta' | null
  /** Cuántas de las de este año vienen del libro (las demás, de Sumied). */
  delLibroEsteAnio: number
}

/**
 * Las cifras de arriba con las dos fuentes. `cifras` son las de las facturas
 * de Sumied (lib/cifras.ts, que no cambia).
 */
export function cifrasConLibro(cifras: CifrasFicha | null, libro: readonly FacturaDelLibro[], apuntes: readonly Apunte[], hoy: string): CifrasConLibro {
  const anio = hoy.slice(0, 4)
  const delAnio = libro.filter((f) => f.fecha.startsWith(anio))
  const base: CifrasFicha = cifras ?? { compradoEsteAnio: null, facturasEsteAnio: 0, leDebes: null, proximoPago: null, hayFacturas: false }
  const comprado = base.compradoEsteAnio === null && delAnio.length === 0
    ? null
    : (c(base.compradoEsteAnio ?? 0) + delAnio.reduce((s, f) => s + c(f.importe), 0)) / 100
  let leDebes = base.leDebes
  let leDebesDe: CifrasConLibro['leDebesDe'] = base.leDebes !== null ? 'facturas' : null
  if (!base.hayFacturas && apuntes.length > 0) {
    leDebes = extracto(apuntes).at(-1)!.saldo
    leDebesDe = 'cuenta'
  }
  return {
    ...base,
    compradoEsteAnio: comprado,
    facturasEsteAnio: base.facturasEsteAnio + delAnio.length,
    leDebes,
    leDebesDe,
    hayFacturas: base.hayFacturas || libro.length > 0,
    delLibroEsteAnio: delAnio.length,
  }
}
