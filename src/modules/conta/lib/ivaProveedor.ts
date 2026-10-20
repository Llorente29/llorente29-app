// src/modules/conta/lib/ivaProveedor.ts
//
// I01d · Cómo se apunta el IVA de un proveedor, de su ficha (país, NIF-IVA,
// lo que dijo VIES y su régimen de IVA). Puro. Es la misma regla que la base
// (conta_proveedor_iva_clase, migración 0300), que es la que manda al validar:
// esto sirve para proponer el asiento y para decirlo en la ficha.
//
//   · De España: «nacional», salvo que su régimen de IVA diga inversión del
//     sujeto pasivo (marcado a mano: obras, chatarra…) → «isp_nacional».
//   · De otro país de la UE con NIF-IVA europeo que VIES no rechaza →
//     «intracomunitaria». Sin comprobar (VIES no contestó) cuenta igual: la
//     ficha lo dice. Sin NIF-IVA, o si VIES dice que no vale → «ue_sin_nif_iva».
//   · De fuera de la UE → «isp_extranjero» (inversión del sujeto pasivo).

import { ESTADOS_UE } from './vatEu'
import type { TaxIdCheckStatus, TaxIdType, VatRegime } from '../types'

export type ClaseIva = 'nacional' | 'isp_nacional' | 'intracomunitaria' | 'ue_sin_nif_iva' | 'isp_extranjero'

export interface FichaIva {
  pais: string | null
  tipoNif: TaxIdType | null
  nif: string | null
  vies: TaxIdCheckStatus | null
  regimen: VatRegime | null
}

export function claseIva(f: FichaIva): ClaseIva {
  const pais = (f.pais ?? '').trim().toUpperCase() || 'ES'
  if (pais === 'ES') return f.regimen === 'inversion_sujeto_pasivo' ? 'isp_nacional' : 'nacional'
  if (pais === 'EL' || ESTADOS_UE.includes(pais)) {
    return f.tipoNif === 'vat_eu' && !!f.nif?.trim() && (f.vies ?? 'pending') !== 'invalid' ? 'intracomunitaria' : 'ue_sin_nif_iva'
  }
  return 'isp_extranjero'
}

/** El tipo de IVA del catálogo con el que va su compra (null: el de su factura). */
export function tipoDeLaClase(c: ClaseIva): 'ue_compra' | 'isp' | null {
  if (c === 'intracomunitaria') return 'ue_compra'
  if (c === 'isp_extranjero' || c === 'isp_nacional') return 'isp'
  return null
}

const NOMBRES = (() => {
  try { return new Intl.DisplayNames(['es'], { type: 'region' }) } catch { return null }
})()

/** El país en palabras: «Francia». Grecia va como EL en el IVA. Sin nombre, el código. */
export function nombrePais(codigo: string | null | undefined): string {
  const c = (codigo ?? '').trim().toUpperCase()
  if (!c) return 'España'
  const iso = c === 'EL' ? 'GR' : c
  try { return NOMBRES?.of(iso) ?? c } catch { return c }
}

/** Lo que dice la ficha de su IVA, en palabras de oficina. */
export function textoClaseIva(c: ClaseIva, pais: string | null): { titulo: string; detalle: string } {
  const p = nombrePais(pais)
  switch (c) {
    case 'nacional':
      return { titulo: 'Proveedor de España', detalle: 'Sus facturas traen IVA español y se apuntan con el IVA de la factura.' }
    case 'isp_nacional':
      return { titulo: 'De España, con inversión del sujeto pasivo', detalle: 'Su factura no trae IVA: lo declaras y lo deduces tú (472 y 477 por la misma cuota). Está marcado a mano en «Régimen de IVA».' }
    case 'intracomunitaria':
      return { titulo: `Compra en otro país de la UE (${p})`, detalle: 'Su factura no trae IVA: es una compra intracomunitaria. El IVA lo declaras y lo deduces tú (472 y 477 por la misma cuota) y va en el 303 y en el 349.' }
    case 'ue_sin_nif_iva':
      return { titulo: `De ${p}, sin NIF-IVA europeo válido`, detalle: 'Sin un NIF-IVA europeo que VIES acepte, su compra no puede ir como intracomunitaria. Ponlo arriba y se comprueba en VIES.' }
    case 'isp_extranjero':
      return { titulo: `De fuera de la UE (${p})`, detalle: 'Su factura no trae IVA español: va con inversión del sujeto pasivo. El IVA lo declaras y lo deduces tú (472 y 477 por la misma cuota). Si es una mercancía que entra por aduana (con DUA), no va así: díselo a tu asesoría.' }
  }
}

/** Lo que dijo VIES, en palabras. null si no hay NIF-IVA europeo. */
export function textoVies(tipoNif: TaxIdType | null, nif: string | null, vies: TaxIdCheckStatus | null, comprobadoEl: string | null, preguntando: boolean): string | null {
  if (tipoNif !== 'vat_eu' || !nif?.trim()) return null
  if (preguntando) return 'Comprobando en VIES (el registro europeo)…'
  if (vies === 'valid') return `Comprobado en VIES${comprobadoEl ? ` el ${fecha(comprobadoEl)}` : ''}: el NIF-IVA está dado de alta.`
  if (vies === 'invalid') return 'VIES dice que este NIF-IVA no está dado de alta: sus compras no pueden ir como intracomunitarias.'
  return 'Sin comprobar: VIES no ha contestado. Se vuelve a preguntar al abrir la ficha.'
}

const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
