// src/modules/conta/nucleo/recibida/origen.ts
//
// K04 · De dónde ha salido cada dato de la ficha de la factura recibida: la
// marca azul encima de la casilla («PDF», «por NIF», «de su ficha»,
// «Sumied»). Solo lo que la base sabe hoy; lo que no sabe, nada (no se
// inventa). La respuesta está en el PR del K04, casilla a casilla:
//
//   · Proveedor «por NIF»: la base empareja el proveedor de una factura leída
//     SOLO por su NIF (conta_factura_desde_lectura, 0220). Sale si la factura
//     trae lectura propia (no la de su recepción: ahí el proveedor viene del
//     albarán) y el NIF leído casa con el de su ficha. Si se ha cambiado el
//     proveedor a mano, nada.
//   · N.I.F. «PDF»: el NIF leído casa con el de su ficha (también leído mal en
//     un carácter, que la ficha de hoy ya da por bueno).
//   · Nombre «de su ficha»: es supplier.name, siempre que haya proveedor.
//   · Tipo de operación «de su ficha»: supplier.vat_regime, si lo tiene.
//   · N.º de factura y Fecha «PDF»: lo que hay es lo que se leyó (mismo
//     número con la clave de la base; misma fecha).
//   · Concepto del asiento «Sumied»: el de la propuesta del asiento, si nadie
//     lo ha tocado a mano.
//   · Sin proveedor (K04b): el NIF y el nombre leídos, «PDF».
//   · Se deduce en y Serie / documento: nada (salen de la fecha y del libro,
//     no de un sitio que se pueda nombrar).

import { casaNif } from '@/modules/conta/documentos/paraValidar'
import { claveNumero } from '../../../../../supabase/functions/_shared/lecturaFactura.ts'

export type Origen = 'PDF' | 'por NIF' | 'de su ficha' | 'Sumied'
export type CasillaConOrigen = 'proveedor' | 'nif' | 'nombre' | 'tipoOperacion' | 'numero' | 'fecha' | 'concepto'

export interface DatosOrigen {
  /** Lo leído del PDF de la propia factura (supplier_invoice.reading), o null. */
  leido: { nif: string | null; numero: string | null; fecha: string | null; nombre?: string | null } | null
  /** ¿La lectura es la de su recepción (la factura salió de un albarán)? */
  deRecepcion: boolean
  /** El proveedor que tiene la factura (su ficha), o null. */
  proveedor: { id: string; nif: string | null; regimen: string | null } | null
  /** ¿Se ha cambiado el proveedor en esta ficha, sin guardar? */
  proveedorCambiado: boolean
  /** Lo que hay ahora en las casillas. */
  numero: string
  fecha: string
  /** ¿El concepto es el de la propuesta (no tocado a mano)? */
  conceptoPropuesto: boolean
}

/** El origen de cada casilla; las que no tienen, fuera. */
export function origenes(d: DatosOrigen): Partial<Record<CasillaConOrigen, Origen>> {
  const o: Partial<Record<CasillaConOrigen, Origen>> = {}
  const p = d.proveedor
  const nifCasa = !!p && !!d.leido && (() => { const c = casaNif(p.nif, d.leido.nif); return c === 'igual' || c === 'leido_mal' })()
  if (p && !d.proveedorCambiado && nifCasa && !d.deRecepcion) o.proveedor = 'por NIF'
  if (p && nifCasa) o.nif = 'PDF'
  if (p) o.nombre = 'de su ficha'
  // K04b · Sin proveedor, el NIF y el nombre que se ven son los leídos del PDF.
  if (!p && d.leido?.nif) o.nif = 'PDF'
  if (!p && d.leido?.nombre) o.nombre = 'PDF'
  if (p?.regimen) o.tipoOperacion = 'de su ficha'
  if (d.leido?.numero && claveNumero(d.leido.numero) !== null && claveNumero(d.leido.numero) === claveNumero(d.numero)) o.numero = 'PDF'
  if (d.leido?.fecha && d.leido.fecha.slice(0, 10) === d.fecha) o.fecha = 'PDF'
  if (d.conceptoPropuesto) o.concepto = 'Sumied'
  return o
}
