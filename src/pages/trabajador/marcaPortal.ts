// src/pages/trabajador/marcaPortal.ts
//
// LS1 (28/10/2026) · Con qué marca se enseña el portal del trabajador. Si la
// pestaña ya entró con una marca propia (el dominio de Sumied), ésa. Si no,
// la de la cuenta cuando es solo de Sumied (`accounts.product_brand`): una
// persona de una empresa de Sumied no ve Folvy aunque entre por otra puerta.
// En Folvy, null: todo como siempre.

import { CON_MARCA, MARCA, MARCAS, type IdMarca, type Marca } from '@/marca/marca'
import { useFeatureGate } from '@/platform/feature-gate/useFeatureGate'

export function marcaDelPortal(marcaPestana: Marca | null, productBrand: string | null | undefined): Marca | null {
  if (marcaPestana) return marcaPestana
  if (productBrand && productBrand in MARCAS && productBrand !== 'folvy') return MARCAS[productBrand as IdMarca]
  return null
}

export function useMarcaDelPortal(): Marca | null {
  const { account } = useFeatureGate()
  return marcaDelPortal(CON_MARCA ? MARCA : null, account?.product_brand)
}
