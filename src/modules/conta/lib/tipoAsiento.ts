// src/modules/conta/lib/tipoAsiento.ts
//
// S01 · Los botones de la cinta de Contabilidad › Asientos («Expedida»,
// «Tesorería», «Predefinidos») abren el asiento a mano con `?tipo=`. Aquí, qué
// significa cada tipo para el formulario (la serie, el título y una ayuda) y el
// paso entre un asiento predefinido (entry_template, del C04) y los apuntes a mano.
// Sin pantalla: se prueba sola.

import { importeMano, type LineaMano } from '@/modules/conta/lib/diario'
import { eurosExactos } from '@/modules/conta/lib/formato'
import type { Serie } from '@/modules/conta/lib/libro'

export type TipoAsiento = 'expedida' | 'tesoreria' | 'predefinido'

export interface DefTipoAsiento { tipo: TipoAsiento; serie: Serie; titulo: string; ayuda: string }

export const TIPOS_ASIENTO: Record<TipoAsiento, DefTipoAsiento> = {
  expedida: {
    // S02 · PR 2: vive en Facturación › Nueva factura emitida (la palabra de la calle es «emitida»).
    tipo: 'expedida', serie: 1, titulo: 'Nueva factura emitida',
    ayuda: 'Una factura que emites se apunta así: el cliente (430) al debe; las ventas (700) y el IVA repercutido (477) al haber.',
  },
  tesoreria: {
    tipo: 'tesoreria', serie: 3, titulo: 'Nuevo cobro o pago',
    ayuda: 'Un cobro o un pago que no ha llegado por el banco: la cuenta del banco o la caja (572, 570) contra el cliente, el proveedor o el gasto.',
  },
  predefinido: {
    tipo: 'predefinido', serie: 4, titulo: 'Usar un asiento predefinido',
    ayuda: 'Elige uno de tus asientos predefinidos: pone la serie, el concepto y los apuntes. Los importes que no son fijos los escribes tú.',
  },
}

/** El tipo de `?tipo=`; cualquier otro valor (o ninguno) es el asiento a mano de siempre. */
export function tipoDeAsiento(valor: string | null): DefTipoAsiento | null {
  return valor && Object.hasOwn(TIPOS_ASIENTO, valor) ? TIPOS_ASIENTO[valor as TipoAsiento] : null
}

export interface LineaPredefinida {
  cuentaId: string
  lado: 'debit' | 'credit'
  /** Importe fijo; nulo = se escribe al usarlo. */
  importe: number | null
  concepto: string | null
  localId: string | null
  comun: boolean
}

export interface Predefinido { id: string; nombre: string; serie: Serie; concepto: string; lineas: LineaPredefinida[] }

// Como se escribe en el campo: «1452,50», sin separador de miles.
const enTexto = (n: number): string => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

/**
 * Los apuntes a mano de un predefinido. Una cuenta que ya no está entre las de
 * apunte (cerrada o con hijas) se queda vacía para que se elija: no se inventa.
 */
export function lineasDePredefinido(p: Predefinido, codigoDe: ReadonlyMap<string, string>): { lineas: LineaMano[]; sinCuenta: number } {
  let sinCuenta = 0
  const lineas = [...p.lineas].map((l) => {
    const cuenta = codigoDe.get(l.cuentaId) ?? ''
    if (!cuenta) sinCuenta += 1
    const importe = l.importe === null ? '' : enTexto(l.importe)
    return { cuenta, debe: l.lado === 'debit' ? importe : '', haber: l.lado === 'credit' ? importe : '', localId: l.comun ? null : l.localId, comun: l.comun, concepto: l.concepto ?? '' }
  })
  return { lineas, sinCuenta }
}

/**
 * Lo que se guarda como predefinido desde el asiento a mano: cada apunte con
 * cuenta, su lado (el del importe que lleva; sin importe, el debe si no dice
 * nada) y el importe como fijo solo si se pide. Los apuntes sin cuenta no van.
 */
export function predefinidoDeMano(lineas: readonly LineaMano[], idDe: ReadonlyMap<string, string>, conImportes: boolean): LineaPredefinida[] {
  return lineas.filter((l) => idDe.has(l.cuenta.trim())).map((l) => {
    const debe = importeMano(l.debe); const haber = importeMano(l.haber)
    const lado: 'debit' | 'credit' = haber > 0 && !(debe > 0) ? 'credit' : 'debit'
    const importe = lado === 'debit' ? debe : haber
    return {
      cuentaId: idDe.get(l.cuenta.trim())!, lado,
      importe: conImportes && Number.isFinite(importe) && importe > 0 ? Math.round(importe * 100) / 100 : null,
      concepto: l.concepto.trim() || null, localId: l.comun ? null : l.localId, comun: l.comun,
    }
  })
}

// ── S02 · PR 2 · El asiento dicho en palabras (la Hoja de líneas) ───────────

/** Una línea ya resuelta: la cuenta del plan (su número y su nombre) y sus importes. */
export interface LineaEnPalabras { codigo: string; nombre: string; debe: number; haber: number }

const cent = (n: number) => Math.round(n * 100)
const lista = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
const esBanco = (codigo: string) => codigo.startsWith('57')
const esCliente = (codigo: string) => codigo.startsWith('43')
const esVenta = (codigo: string) => codigo.startsWith('70')

/**
 * El asiento en una frase sencilla, para quien no lee debe y haber: de dónde
 * sale el dinero (el haber) y adónde va (el debe). Solo dice lo que se sabe por
 * las cuentas: el banco o la caja (57) que paga o cobra, y la factura a un
 * cliente (43 contra 70). Si no cuadra, o falta una cuenta o un importe, no
 * dice nada: una frase sobre un asiento a medias sería inventada.
 */
export function asientoEnPalabras(lineas: readonly LineaEnPalabras[]): string | null {
  const usadas = lineas.filter((l) => cent(l.debe) > 0 || cent(l.haber) > 0)
  if (usadas.length < 2 || usadas.some((l) => !l.codigo || (cent(l.debe) > 0) === (cent(l.haber) > 0))) return null
  const debe = usadas.filter((l) => cent(l.debe) > 0)
  const haber = usadas.filter((l) => cent(l.haber) > 0)
  const totalDebe = debe.reduce((t, l) => t + cent(l.debe), 0)
  if (totalDebe !== haber.reduce((t, l) => t + cent(l.haber), 0) || !debe.length || !haber.length) return null
  const total = eurosExactos(totalDebe / 100)
  const nombre = (l: LineaEnPalabras) => l.nombre.trim() || l.codigo
  const partes = (ls: readonly LineaEnPalabras[], lado: 'debe' | 'haber', prep: string) => lista(ls.map((l) => `${eurosExactos(l[lado])} ${prep} ${nombre(l)}`))

  // Una factura a un cliente: el cliente al debe y una venta al haber.
  if (debe.length === 1 && esCliente(debe[0].codigo) && haber.some((l) => esVenta(l.codigo))) {
    return haber.length === 1
      ? `Facturas ${total} a ${nombre(debe[0])}, por ${nombre(haber[0])}.`
      : `Facturas ${total} a ${nombre(debe[0])}: ${partes(haber, 'haber', 'de')}.`
  }
  if (haber.length === 1 && debe.length === 1 && !esBanco(haber[0].codigo) && esBanco(debe[0].codigo)) {
    return `Cobras ${total} en ${nombre(debe[0])}, de ${nombre(haber[0])}.`
  }
  if (haber.length === 1) {
    const de = haber[0]
    const inicio = esBanco(de.codigo) ? `Pagas ${total} desde ${nombre(de)}` : `Pasas ${total} de ${nombre(de)}`
    return debe.length === 1 ? `${inicio} a ${nombre(debe[0])}.` : `${inicio}. De eso, ${partes(debe, 'debe', 'a')}.`
  }
  if (debe.length === 1) {
    const a = debe[0]
    const inicio = esBanco(a.codigo) ? `Cobras ${total} en ${nombre(a)}` : `Llevas ${total} a ${nombre(a)}`
    return `${inicio}: ${partes(haber, 'haber', 'de')}.`
  }
  return `Mueves ${total}: sale de ${lista(haber.map(nombre))} y va a ${lista(debe.map(nombre))}.`
}
