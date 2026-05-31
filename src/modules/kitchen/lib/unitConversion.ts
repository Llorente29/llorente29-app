// src/modules/kitchen/lib/unitConversion.ts
//
// Conversor PURO de "cantidad + unidad tecleada" → qtyInBase: la cantidad
// expresada en la UNIDAD BASE del ingrediente, que es lo único que consumen el
// motor de coste y setupSimplePurchase.
//
// Regla de oro (la grieta de Apicbase que NO repetimos): si la dimensión de la
// unidad tecleada NO coincide con la de la unidad base (p.ej. litros vs gramos),
// NO se inventa una conversión 1:1. Se devuelve un resultado "necesita densidad"
// para que la UI reeduque y marque needsReview si procede. La conversión solo es
// automática DENTRO de la misma dimensión, vía factor_to_base (universal).

import type { KitchenUnit } from '@/types/kitchen'

export type ConvertToBaseResult =
  | { ok: true; qtyInBase: number }
  | { ok: false; reason: 'dimension_mismatch'; enteredDimension: string; baseDimension: string }
  | { ok: false; reason: 'invalid_quantity' }
  | { ok: false; reason: 'invalid_factor' }

// qtyInBase = quantity * (enteredUnit.factorToBase / baseUnit.factorToBase),
// SOLO si comparten dimensión. factor_to_base lleva cada unidad a la base de SU
// dimensión, así que el cociente reexpresa "quantity enteredUnit" en baseUnit.
//   Ej: base=g (factor 1), tecleas 5 kg (factor 1000) → 5 * 1000 / 1 = 5000 g.
//   Ej: base=kg (factor 1000), tecleas 5 kg → 5 * 1000 / 1000 = 5.
export function convertToBase(
  quantity: number,
  enteredUnit: KitchenUnit,
  baseUnit: KitchenUnit,
): ConvertToBaseResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: 'invalid_quantity' }
  }
  if (enteredUnit.dimension !== baseUnit.dimension) {
    return {
      ok: false,
      reason: 'dimension_mismatch',
      enteredDimension: enteredUnit.dimension,
      baseDimension: baseUnit.dimension,
    }
  }
  const enteredFactor = enteredUnit.factorToBase
  const baseFactor = baseUnit.factorToBase
  const factorsValid =
    Number.isFinite(enteredFactor) && enteredFactor > 0 &&
    Number.isFinite(baseFactor) && baseFactor > 0
  if (!factorsValid) {
    return { ok: false, reason: 'invalid_factor' }
  }
  return { ok: true, qtyInBase: (quantity * enteredFactor) / baseFactor }
}

// Coste por unidad base a partir del precio del formato y su qtyInBase.
// Es EXACTAMENTE el número que kitchen_recompute_raw_cost guardará
// (last_price / qty_in_base): por eso el preview en vivo es idéntico, no aproximado.
export function unitCostFromFormat(price: number, qtyInBase: number): number | null {
  if (!Number.isFinite(price) || price < 0) return null
  if (!Number.isFinite(qtyInBase) || qtyInBase <= 0) return null
  return price / qtyInBase
}
