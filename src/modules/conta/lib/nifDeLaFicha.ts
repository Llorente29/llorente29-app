// src/modules/conta/lib/nifDeLaFicha.ts
//
// N1 · El NIF de la ficha del proveedor, desde la factura y ANTES de validar
// (Julio, 23/10, CARREFOUR 2026FBFN01634861 del 06/08).
//
// Por qué: sin NIF en su ficha no hay propuesta de asiento («A X le falta el
// NIF: ponlo en su ficha»), y el D07b.4 guardaba el NIF del documento solo AL
// VALIDAR. Sin propuesta no se puede validar, así que el NIF no llegaba nunca a
// la ficha: el huevo y la gallina. Y en CARREFOUR, además, el documento no lo
// trae (su lectura dejó supplier_tax_id vacío): hay que poder escribirlo.
//
// Núcleo puro: qué NIF se propone, si vale y qué se guarda en la ficha (lo mismo
// que guarda «Datos fiscales» de la ficha del proveedor para un NIF español).

import { normalizarNif, tipoEntidadPorNif, validarNifEs } from '@/modules/conta/lib/nif'
import type { FichaProveedor } from '@/modules/conta/types'

/** El NIF que se escribe de partida: el que trae el documento, si es válido; si no, vacío. */
export function nifPropuesto(delDocumento: string | null | undefined): string {
  const x = (delDocumento ?? '').trim()
  if (!x) return ''
  const v = validarNifEs(x)
  return v.ok ? v.normalizado : ''
}

/** Por qué no se puede guardar lo escrito (null si vale). */
export function faltaEnElNif(escrito: string): string | null {
  const v = validarNifEs(escrito)
  return v.ok ? null : v.motivo
}

/** Lo que se guarda en la ficha: el NIF español comprobado (como en «Datos fiscales»). */
export function cambiosDelNif(escrito: string, entityKind: FichaProveedor['entityKind'] | null, ahora = new Date().toISOString()): Partial<FichaProveedor> {
  const nif = normalizarNif(escrito)
  const c: Partial<FichaProveedor> = {
    taxId: nif, taxIdType: 'nif_es', taxIdCheckedAt: ahora, taxIdVerifiedAt: ahora, taxIdCheckStatus: 'valid', countryCode: 'ES',
  }
  if (!entityKind) c.entityKind = tipoEntidadPorNif(nif)
  return c
}

/** Lo que dice la pantalla al guardarlo (regla 8: con contenido). */
export function textoGuardado(proveedor: string, nif: string): string {
  return `Guardado: ${proveedor} ya tiene el NIF ${normalizarNif(nif)} en su ficha. Vuelvo a preparar el asiento.`
}
