// src/modules/conta/services/impuestosParaCocina.ts
//
// D1 del C00 (respuesta 1 de Julio): los porcentajes de impuestos tienen UNA
// fuente, la tabla de impuestos de contabilidad (tax_rate). Las categorías de
// IVA de Cocina apuntan a ella por el puente vat_category_tax, y la vista
// vat_category_rate da lo mismo que daba vat_rate: categoría, %, vigencia.
//
// La relación va en un solo sentido: Cocina lee de contabilidad (este fichero)
// y contabilidad no importa nada de Cocina.

import { tabla, mensaje } from '@/modules/conta/services/bd'

/** Con la forma de una fila de la base (como las leía Cocina de vat_rate). */
export type TipoDeCategoria = Record<string, unknown> & {
  category_id: string
  rate: number
  valid_from: string
  valid_to: string | null
}

/** Los tipos de IVA de cada categoría de Cocina, con su vigencia (antes: vat_rate). */
export async function tiposPorCategoria(): Promise<TipoDeCategoria[]> {
  const { data, error } = await tabla('vat_category_rate').select('category_id, rate, valid_from, valid_to')
  if (error) throw new Error(mensaje('No se han podido leer los tipos de IVA', error))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    category_id: String(r.category_id),
    rate: Number(r.rate),
    valid_from: String(r.valid_from),
    valid_to: r.valid_to === null || r.valid_to === undefined ? null : String(r.valid_to),
  }))
}
