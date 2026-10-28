// src/modules/conta/services/fichaDesdeFacturaService.ts
//
// S01b · Guardar en la ficha del proveedor lo que trae su factura, y dejar
// escrito de cuál sale («de la factura R0672»):
//   · el NIF, el nombre fiscal, la dirección y la web, en la ficha (supplier),
//     y su origen en supplier.data_from_invoice (1304);
//   · el correo y el teléfono, en un contacto de facturación (supplier_contact),
//     con su origen en la nota.
// Lo decide el núcleo puro (lib/fichaDesdeDocumento.ts): aquí solo se escribe.
// El IBAN NO pasa por aquí: lo guarda la base al pulsar (guardarIbanDeFactura).

import type { FichaProveedor } from '@/modules/conta/types'
import { crearContacto, guardarFicha, listarContactos } from '@/modules/conta/services/proveedorService'
import { apuntarOrigen, deLaFactura, type CambiosFicha, type CampoDeFicha } from '@/modules/conta/lib/fichaDesdeDocumento'

export interface FacturaOrigen { id: string; numero: string | null }
export interface Quien { id: string | null; name: string | null }

const hoy = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

/** Los correos y teléfonos de sus contactos (para no proponer lo que ya tiene). */
export async function contactosDeLaFicha(supplierId: string): Promise<{ correos: string[]; telefonos: string[] }> {
  const cs = await listarContactos(supplierId)
  return { correos: cs.map((c) => c.email).filter((x): x is string => !!x), telefonos: cs.map((c) => c.phone).filter((x): x is string => !!x) }
}

/**
 * Guarda en la ficha `cambios` (y el contacto con el correo o el teléfono, si
 * los hay) y apunta de qué factura sale cada uno de `campos`. Devuelve lo que
 * ha hecho, para decirlo (regla 8).
 */
export async function guardarDesdeFactura(x: {
  accountId: string
  ficha: Pick<FichaProveedor, 'id' | 'dataFromInvoice'>
  cambios: CambiosFicha
  campos: readonly CampoDeFicha[]
  contacto?: { correo?: string; telefono?: string }
  factura: FacturaOrigen
  quien: Quien
}): Promise<FichaProveedor | null> {
  const origen = { factura: x.factura.numero, facturaId: x.factura.id, fecha: hoy(), quien: x.quien.name }
  const deFicha = x.campos.filter((c) => c !== 'correo' && c !== 'telefono')
  let guardada: FichaProveedor | null = null
  if (Object.keys(x.cambios).length || deFicha.length) {
    guardada = await guardarFicha(x.ficha.id, { ...x.cambios, dataFromInvoice: apuntarOrigen(x.ficha.dataFromInvoice, deFicha, origen) })
  }
  if (x.contacto && (x.contacto.correo || x.contacto.telefono)) {
    const hay = await listarContactos(x.ficha.id)
    await crearContacto(x.accountId, x.ficha.id, {
      name: 'Facturación', role: 'billing', email: x.contacto.correo ?? null, phone: x.contacto.telefono ?? null,
      notes: `${deLaFactura(x.factura.numero).replace(/^d/, 'D')}.`,
    }, x.quien, hay.length === 0)
  }
  return guardada
}
