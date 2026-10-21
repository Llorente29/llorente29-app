// src/modules/conta/lib/tipoAsiento.ts
//
// S01 · Los botones de la cinta de Contabilidad › Asientos («Expedida»,
// «Tesorería», «Predefinidos») abren el asiento a mano con `?tipo=`. Aquí, qué
// significa cada tipo para el formulario (la serie, el título y una ayuda) y el
// paso entre un asiento predefinido (entry_template, del C04) y los apuntes a mano.
// Sin pantalla: se prueba sola.

import { importeMano, type LineaMano } from '@/modules/conta/lib/diario'
import type { Serie } from '@/modules/conta/lib/libro'

export type TipoAsiento = 'expedida' | 'tesoreria' | 'predefinido'

export interface DefTipoAsiento { tipo: TipoAsiento; serie: Serie; titulo: string; ayuda: string }

export const TIPOS_ASIENTO: Record<TipoAsiento, DefTipoAsiento> = {
  expedida: {
    tipo: 'expedida', serie: 1, titulo: 'Nueva factura expedida',
    ayuda: 'Hasta que llegue Facturación, una factura que emites se apunta a mano: el cliente (430) al debe; las ventas (700) y el IVA repercutido (477) al haber.',
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
