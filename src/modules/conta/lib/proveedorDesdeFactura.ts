// src/modules/conta/lib/proveedorDesdeFactura.ts
//
// S01b · Cuándo se ofrece «Dar de alta a …» en una factura y con qué texto.
// Núcleo puro: lo usan Revisar factura y la recibida a mano.

import { normalizarNif } from '@/modules/conta/lib/nif'

/** «Dar de alta a Suministros del Ejemplo S.L.U.» (o «Dar de alta a su proveedor» si no leyó el nombre). */
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

// ── S01b2 · Volver a leer la factura cuando su lectura es de antes ─────────

/** Lo que la lectura guardada dice del proveedor (reading->factura->proveedor). */
export type ProveedorLeido = Partial<Record<'nombre' | 'nif' | 'email' | 'direccion' | 'telefono' | 'web', string | null>>

/**
 * ¿Hay que volver a leer su PDF? Sí si la lectura es de antes del 28/10: no
 * tiene las CLAVES «telefono» y «web» (el lector de hoy las deja siempre,
 * vacías si la factura no las trae). Una clave vacía no se vuelve a leer: ya se
 * leyó con el lector de hoy y la factura no lo trae.
 */
export function hayQueReleer(p: ProveedorLeido | null | undefined, conPdf: boolean): boolean {
  if (!conPdf || !p || typeof p !== 'object') return false
  return !('telefono' in p) || !('web' in p)
}

/** Debajo de un campo del alta: lo que dice si la factura no lo trae (vacío, nunca un ejemplo que parezca un dato). */
export const NO_VIENE_EN_LA_FACTURA = 'No viene en la factura'

/** La frase de la relectura, para decirla (regla 8). */
export function fraseRelectura(puesto: readonly string[]): string {
  const nombre: Record<string, string> = { telefono: 'el teléfono', web: 'la web', email: 'el correo', direccion: 'la dirección' }
  const cosas = puesto.map((k) => nombre[k] ?? k)
  if (cosas.length === 0) return 'He vuelto a leer la factura: no trae nada más del proveedor.'
  const lista = cosas.length === 1 ? cosas[0] : `${cosas.slice(0, -1).join(', ')} y ${cosas.at(-1)}`
  return `He vuelto a leer la factura: añado ${lista}.`
}
