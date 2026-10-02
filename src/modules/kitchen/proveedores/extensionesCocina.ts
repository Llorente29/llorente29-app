// src/modules/kitchen/proveedores/extensionesCocina.tsx
//
// Lo que Cocina le aporta a la lista y a la ficha de proveedor (C01).
//
// La ficha vive en src/modules/conta y no sabe nada de Cocina (respuesta 1 de
// Julio: el módulo de contabilidad podrá venderse solo). Cocina, al montarla,
// le pasa esto:
//   · la columna «Artículos» de la lista (cuántos le compras a cada uno);
//   · la sección «Lo que le compras» de la ficha, con «Migrar artículos a otro
//     proveedor», que es lo que tenía la ficha vieja.
// Una cuenta sin artículos de cocina no ve ni la columna ni la sección.

import { createElement } from 'react'
import type { ExtensionesProveedor } from '@/modules/conta/extensiones'
import { countLinksBySupplier } from '@/modules/kitchen/services/purchaseFormatService'
import { supabase } from '@/lib/supabase'
import LoQueLeCompras from '@/modules/kitchen/proveedores/LoQueLeCompras'

/** ¿Usa esta cuenta los ingredientes de Cocina? Si no tiene ni uno, no hay nada que enseñar. */
async function cuentaUsaCocina(accountId: string): Promise<boolean> {
  if (!supabase) return false
  const { count, error } = await supabase
    .from('recipe_item')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .limit(1)
  return !error && (count ?? 0) > 0
}

export const extensionesCocina: ExtensionesProveedor = {
  secciones: [{
    id: 'articulos-cocina',
    titulo: 'Lo que le compras',
    tieneAlgo: cuentaUsaCocina,
    render: (ctx) => createElement(LoQueLeCompras, ctx),
  }],
  columna: {
    titulo: 'Artículos',
    valores: countLinksBySupplier,
  },
}
