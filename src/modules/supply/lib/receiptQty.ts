// src/modules/supply/lib/receiptQty.ts
//
// Cuánto se ha recibido de una línea de albarán, expresado en el FORMATO
// físico (cajas, garrafas, sacos) y no en la unidad base suelta.
//
// Vive aparte de ReceiptWizard.tsx para poder probarse: el 20/08 este cálculo
// dejó "1" en casi todas las líneas de todas las recepciones, y no había una
// sola prueba que lo cubriera.

/** De dónde sale el número que ve el trabajador — decide el aviso de "no cuadra". */
export type QtySource = 'albaran' | 'packages' | 'division' | 'inexact' | 'manual'

function norm(u: string | null): string {
  return (u ?? '').trim().toLowerCase()
}

/**
 * Devuelve la cantidad en unidades de FORMATO, y de dónde sale.
 * `null` si no hay formato con el que contar.
 */
export function deriveFormatQty(
  albaranQty: number | null,
  albaranPackages: number | null,
  formatQtyInBase: number | null,
  albaranUnit: string | null,
  baseUnitAbbr: string | null,
): { qty: number; source: QtySource } | null {
  if (formatQtyInBase == null || formatQtyInBase <= 0) return null

  // 1 · La columna de bultos manda: es un recuento explícito de packs.
  if (albaranPackages != null && albaranPackages > 0) {
    return { qty: Math.round(albaranPackages), source: 'packages' }
  }
  if (albaranQty == null || albaranQty <= 0) return null

  // 2 · SOLO se divide si la cantidad del albarán viene en la unidad BASE.
  //
  // ── EL FALLO DEL 20/08 ────────────────────────────────────────────────
  // Antes se dividía siempre, y encima con `Math.max(1, ...)`. Pero el
  // albarán casi nunca cuenta en unidad base: cuenta en SU formato — "1
  // garrafa", "3 cajas", "2 sacos". Dividir 3 cajas entre las 6 ud que trae
  // cada caja da 0,5, y el max(1,…) lo convertía en 1. De ahí el "siempre
  // sale 1": no era que fallara la lectura, es que se dividía lo que ya
  // estaba contado, y el suelo tapaba el resultado.
  //
  // Sólo cuando el albarán habla en la misma unidad que la ficha (3 kg y la
  // base es kg) tiene sentido convertir a packs.
  const enUnidadBase = norm(albaranUnit) !== '' && norm(albaranUnit) === norm(baseUnitAbbr)

  if (!enUnidadBase || formatQtyInBase === 1) {
    // Ya viene contado en el formato: se toma tal cual.
    return { qty: Math.round(albaranQty), source: 'albaran' }
  }

  const divided = albaranQty / formatQtyInBase
  const rounded = Math.round(divided)
  if (rounded < 1) {
    // Menos de un pack entero. NO se fuerza a 1 en silencio (la cabecera de
    // ReceiptWizard lo prohíbe): se sugiere 1 y se marca inexacto para que la
    // pantalla lo diga y el trabajador corrija.
    return { qty: 1, source: 'inexact' }
  }
  const exact = Math.abs(divided - rounded) < 0.02
  return { qty: rounded, source: exact ? 'division' : 'inexact' }
}
