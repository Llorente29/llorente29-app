// src/modules/supply/lib/lineCost.ts
//
// LAS DOS CIFRAS DE UNA LÍNEA DE ALBARÁN, EN UN SOLO SITIO — 31/08/2026.
//
// EL INCIDENTE (ALB-00134, AMIRSA, Alcalá)
// AMIRSA puso el precio con el IVA dentro. Pamela pulsó Cambiar y guardó el
// neto. Se guardó bien —verificado en BBDD: unit_cost 83,636363 a las 17:48:07
// y 90,00 a las 17:48:49, los dos = importe del papel ÷ 1,10— pero la pantalla
// siguió diciendo «92,00 €». No fallaba la escritura: fallaba la lectura, por
// tres sitios a la vez.
//   1. La tarjeta plegada pintaba `doc_amount` (el papel), no `unit_cost` (lo
//      que se guarda). Dos campos distintos, y enseñaba el que no se toca.
//   2. El único número que sí venía del coste, el «€ la unidad», salía
//      redondeado a dos decimales: 92/10000 = 0,0092 y 83,64/10000 = 0,0084
//      se pintaban LOS DOS «0,01 €». La corrección era invisible por falta de
//      precisión.
//   3. Guardar no confirmaba nada en pantalla.
//
// EL MODELO DE DATOS ESTÁ BIEN Y NO SE TOCA
// El albarán se cuadra contra el papel CON IVA (`doc_amount`: es lo que van a
// cobrar, por eso «191,00 € de 191,00 €» sigue cuadrando) y el almacén se
// valora con el coste NETO (`unit_cost`). Son dos cifras distintas y las dos
// son verdad. El fallo era enseñar una y dejar editar la otra a ciegas.
//
// POR QUÉ ESTE FICHERO
// Regla del 19/08: un dato se calcula en UN sitio y el resto lo lee. El coste
// por unidad base estaba calculado a mano en tres sitios de
// ReceiptOfficeReview (ResueltaRow, DudosaRow y el bloque del desglose), y los
// tres partían de `doc_amount` — el mismo error copiado tres veces. Aquí vive
// una sola vez, con nombre, y las pantallas lo leen.
//
// Funciones puras (sin React, sin red): se prueban en
// tests/unit/modules/supply/lineCost.test.ts.

/** Lo mínimo de una línea de albarán para poder hablar de su dinero. */
export interface LineaConImportes {
  qtyReceived: number
  qtyInBase: number | null
  /** Coste por unidad de compra (por caja, por pack…), NETO. Vale el almacén. */
  unitCost: number | null
  /** Importe de la línea SEGÚN EL PAPEL. Puede llevar el IVA dentro. */
  docAmount: number | null
}

// ── Los tipos de IVA que existen en hostelería en España ───────────────────
// 10 % es el general de alimentación; 21 % lo llevan bebidas alcohólicas,
// material y servicios; 4 % el superreducido (pan, leche, huevos, fruta).
// «otro» deja escribirlo a mano: un tipo cerrado que no cubra un caso real
// obliga a la aritmética mental, que es justo lo que se está quitando.
export const TIPOS_IVA = [4, 10, 21] as const
export type TipoIva = number

/**
 * Neto a partir de un importe con IVA dentro. `tipoIva` en porcentaje (10, no
 * 0,10). Devuelve null si los datos no permiten decir nada — nunca un 0 que
 * parezca una respuesta.
 */
export function netoDesdeBruto(bruto: number | null, tipoIva: number | null): number | null {
  if (bruto == null || !Number.isFinite(bruto)) return null
  if (tipoIva == null || !Number.isFinite(tipoIva) || tipoIva <= -100) return null
  return bruto / (1 + tipoIva / 100)
}

/** Lo que dice el papel para esta línea. Null si el papel no lo dice. */
export function importePapel(l: LineaConImportes): number | null {
  return l.docAmount != null && Number.isFinite(l.docAmount) ? l.docAmount : null
}

/**
 * Lo que entra al almacén como valor: coste unitario × unidades recibidas.
 * ES LA CIFRA QUE SE EDITA, y por tanto la que tiene que moverse en pantalla
 * cuando alguien la corrige.
 */
export function importeAlAlmacen(l: LineaConImportes): number | null {
  if (l.unitCost == null || !Number.isFinite(l.unitCost)) return null
  if (!Number.isFinite(l.qtyReceived)) return null
  return l.unitCost * l.qtyReceived
}

/**
 * Coste por unidad BASE (€/g, €/ml, €/ud) con el que se valora el inventario.
 * Sale de `unit_cost`, NO de `doc_amount`: antes salía del papel y por eso
 * corregir el coste no movía el número.
 */
export function costePorUnidadBase(l: LineaConImportes): number | null {
  const almacen = importeAlAlmacen(l)
  if (almacen == null) return null
  if (l.qtyInBase == null || !Number.isFinite(l.qtyInBase) || l.qtyInBase <= 0) return null
  return almacen / l.qtyInBase
}

/** El mismo cálculo, pero desde el papel: sirve para contrastar, no para valorar. */
export function costePorUnidadBaseSegunPapel(l: LineaConImportes): number | null {
  const papel = importePapel(l)
  if (papel == null) return null
  if (l.qtyInBase == null || !Number.isFinite(l.qtyInBase) || l.qtyInBase <= 0) return null
  return papel / l.qtyInBase
}

/**
 * ¿Coinciden papel y almacén? Con tolerancia de céntimo, porque el neto de un
 * bruto casi nunca es redondo (92 ÷ 1,10 = 83,636363…).
 *
 * Que coincidan NO es un fallo por sí solo: en la mayoría de proveedores el
 * albarán ya lista base imponible por línea y suma el IVA al pie, y entonces
 * papel = almacén es lo correcto. Solo es sospechoso cuando SE SABE que ese
 * proveedor factura con el IVA dentro (ver `avisoIvaProbable`).
 */
export function importesCoinciden(a: number | null, b: number | null, tol = 0.005): boolean {
  if (a == null || b == null) return false
  return Math.abs(a - b) <= tol
}

/**
 * El aviso del punto 5 del encargo, y exactamente el caso ALB-00080 (30/07:
 * pollo a 92 y ternera a 99, con el IVA dentro, valorando el stock un 10 % por
 * encima de su coste real durante un mes).
 *
 * Solo salta si el proveedor está MARCADO como «factura con IVA incluido». Sin
 * esa marca no se avisa: desde los datos no se distingue un albarán con IVA
 * dentro de uno que lista base imponible, y un aviso que no se puede afirmar
 * es ruido que enseña a ignorar los avisos de verdad.
 */
export function avisoIvaProbable(
  l: LineaConImportes,
  proveedorFacturaConIva: boolean,
  tipoIva: number | null,
): { papel: number; almacen: number; netoPropuesto: number | null } | null {
  if (!proveedorFacturaConIva) return null
  const papel = importePapel(l)
  const almacen = importeAlAlmacen(l)
  if (papel == null || almacen == null) return null
  if (!importesCoinciden(papel, almacen)) return null
  return { papel, almacen, netoPropuesto: netoDesdeBruto(papel, tipoIva) }
}

/**
 * Decimales suficientes para que un cambio se VEA.
 *
 * Regla del encargo: si editar un dato no cambia ningún número visible en
 * pantalla, la pantalla está mal. `fmtMoney` fija dos decimales y aplasta
 * 0,0092 y 0,0084 en el mismo «0,01 €». Aquí se dan siempre al menos dos
 * cifras significativas (con suelo de 2 decimales y techo de 6, que es la
 * precisión con la que se guardan las cantidades).
 */
export function decimalesSignificativos(x: number, min = 2, max = 6): number {
  if (!Number.isFinite(x) || x === 0) return min
  const exp = Math.floor(Math.log10(Math.abs(x)))
  return Math.min(max, Math.max(min, 1 - exp))
}
