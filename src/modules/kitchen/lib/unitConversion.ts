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

// INVERSA de unitCostFromFormat: del €/unidad base al precio del FORMATO.
//   formatPrice = unitCostBase * qtyInBase
// Es la pieza que hace posible la edición "base-first" de la ficha: el cocinero
// teclea lo que sabe (€/kg, €/g) y derivamos el €/caja que se guarda en
// article_supplier.last_price. Round-trip exacto con unitCostFromFormat
// (lo que entra como €/base se recupera como €/base en el motor).
//   Ej.: 0,00899 €/g × 2200 g = 19,78 €/caja.
export function formatPriceFromUnitCost(
  unitCostBase: number,
  qtyInBase: number,
): number | null {
  if (!Number.isFinite(unitCostBase) || unitCostBase < 0) return null
  if (!Number.isFinite(qtyInBase) || qtyInBase <= 0) return null
  return unitCostBase * qtyInBase
}

// Conversión de PRECIO POR UNIDAD entre unidades de la MISMA dimensión.
// OJO: es la INVERSA de convertToBase (que convierte CANTIDADES). Un precio por
// unidad escala al revés que la cantidad: si 1 kg = 1000 g, entonces el €/g es
// el €/kg DIVIDIDO por 1000 (no multiplicado).
//   €/base = pricePerUnit * (baseUnit.factorToBase / fromUnit.factorToBase)
//   Ej.: 8,99 €/kg con base=g → 8,99 * (1/1000) = 0,00899 €/g.
// Igual que convertToBase, NO inventa entre dimensiones distintas: si la unidad
// tecleada no comparte dimensión con la base, devuelve null (que la UI reeduque).
export function unitPriceToBase(
  pricePerUnit: number,
  fromUnit: KitchenUnit,
  baseUnit: KitchenUnit,
): number | null {
  if (!Number.isFinite(pricePerUnit) || pricePerUnit < 0) return null
  if (fromUnit.dimension !== baseUnit.dimension) return null
  const fromFactor = fromUnit.factorToBase
  const baseFactor = baseUnit.factorToBase
  if (!(Number.isFinite(fromFactor) && fromFactor > 0)) return null
  if (!(Number.isFinite(baseFactor) && baseFactor > 0)) return null
  return pricePerUnit * (baseFactor / fromFactor)
}

// Inversa de unitPriceToBase: del €/unidad base al €/unidad de visualización
// (p.ej. para PRE-RELLENAR el editor en €/kg a partir del €/g guardado).
//   €/toUnit = pricePerBase * (toUnit.factorToBase / baseUnit.factorToBase)
//   Ej.: 0,00899 €/g con destino kg → 0,00899 * (1000/1) = 8,99 €/kg.
export function unitPriceFromBase(
  pricePerBase: number,
  toUnit: KitchenUnit,
  baseUnit: KitchenUnit,
): number | null {
  if (!Number.isFinite(pricePerBase) || pricePerBase < 0) return null
  if (toUnit.dimension !== baseUnit.dimension) return null
  const toFactor = toUnit.factorToBase
  const baseFactor = baseUnit.factorToBase
  if (!(Number.isFinite(toFactor) && toFactor > 0)) return null
  if (!(Number.isFinite(baseFactor) && baseFactor > 0)) return null
  return pricePerBase * (toFactor / baseFactor)
}

// La unidad "humana" para mostrar/teclear un precio dentro de una dimensión: la
// de MAYOR factor (kg sobre g, L sobre ml). Cae a baseUnit si no hay candidatas.
// Es la unidad en la que el cocinero piensa el precio (€/kg, €/L) — luego se
// convierte a €/base con unitPriceToBase. Único hogar de esta lógica: la usan
// la ficha del ingrediente, la del proveedor y el alta.
export function pickDisplayUnit(
  priceUnits: KitchenUnit[],
  baseUnit: KitchenUnit | null,
): KitchenUnit | null {
  if (priceUnits.length === 0) return baseUnit
  return priceUnits.reduce((best, u) => (u.factorToBase > best.factorToBase ? u : best), priceUnits[0])
}

// Re-deriva el precio del FORMATO (article_supplier.last_price) cuando cambia el
// contenido del formato (qtyInBase), MANTENIENDO EL €/BASE CONSTANTE. Mismo
// escalado matemático que rescaleCostToFormat de la recepción (decisión de Julio:
// €/base = prevCost/prevQtyInBase, o el €/base de referencia del proveedor si la
// línea aún no tiene precio; los descuentos por volumen NO se modelan aquí).
//
// Diferencia con la copia de recepción: aquí devolvemos `number | null` (valor
// limpio para escribir en last_price), no un string redondeado a céntimo para un
// input. La recepción seguirá formateando a string en su capa cuando migre (0.c).
// Sin ancla (ni precio previo ni referencia) → null: no se inventa, lo pone el humano.
export function rescaleLastPriceToFormat(
  prevPrice: number | null,
  prevQtyInBase: number | null,
  nextQtyInBase: number | null,
  refPerBase: number | null,
): number | null {
  if (nextQtyInBase === null || !Number.isFinite(nextQtyInBase) || nextQtyInBase <= 0) {
    return null
  }
  let perBase: number | null = null
  if (
    prevPrice !== null && Number.isFinite(prevPrice) && prevPrice > 0 &&
    prevQtyInBase !== null && Number.isFinite(prevQtyInBase) && prevQtyInBase > 0
  ) {
    perBase = prevPrice / prevQtyInBase
  } else if (refPerBase !== null && Number.isFinite(refPerBase) && refPerBase > 0) {
    perBase = refPerBase
  }
  if (perBase === null) return null
  return perBase * nextQtyInBase
}
