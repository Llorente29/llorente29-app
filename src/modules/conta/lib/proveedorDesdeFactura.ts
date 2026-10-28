// src/modules/conta/lib/proveedorDesdeFactura.ts
//
// S01b · Cuándo se ofrece «Dar de alta a …» en una factura y con qué texto.
// Núcleo puro: lo usan Revisar factura y la recibida a mano.

import { normalizarNif } from '@/modules/conta/lib/nif'

/** «Dar de alta a OFITOR 2000 S.L.U.» (o «Dar de alta a su proveedor» si no leyó el nombre). */
export function textoAltaDesdeFactura(nombreLeido: string | null | undefined): string {
  const n = (nombreLeido ?? '').replace(/\s+/g, ' ').trim()
  return n ? `Dar de alta a ${n}` : 'Dar de alta a su proveedor'
}

export type AltaEnFactura =
  /** Ya tiene proveedor, o no se puede tocar: nada que ofrecer. */
  | { que: 'nada' }
  /** El NIF leído es de uno que ya tienes: se ofrece elegirlo, no darlo de alta otra vez. */
  | { que: 'es_uno_tuyo'; proveedorId: string; nombre: string }
  /** Ni el NIF ni nada: «Dar de alta a …» y «Es uno que ya tengo». */
  | { que: 'alta' }

/**
 * Sin proveedor elegido: si el NIF leído ya es de uno de tus proveedores, se
 * ofrece ese (dar dos veces el mismo NIF no se puede); si no, el alta.
 */
export function altaEnFactura(x: {
  proveedorId: string | null | undefined
  soloLectura: boolean
  nifLeido: string | null | undefined
  proveedores: readonly { id: string; nombre: string; nif: string | null }[]
}): AltaEnFactura {
  if (x.soloLectura || x.proveedorId) return { que: 'nada' }
  const nif = x.nifLeido ? normalizarNif(x.nifLeido) : null
  const suyo = nif ? x.proveedores.find((p) => p.nif && normalizarNif(p.nif) === nif) : undefined
  return suyo ? { que: 'es_uno_tuyo', proveedorId: suyo.id, nombre: suyo.nombre } : { que: 'alta' }
}
