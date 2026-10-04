// src/modules/kitchen/proveedores/extensionesProveedor.tsx
//
// Lo que Cocina le pone a la ficha y a la lista de proveedores (C01b): el
// bloque «Artículos que le compras» (con «Migrar artículos») y la cuenta de
// artículos en la lista. Solo sale si la cuenta compra con Cocina (tiene algún
// artículo con proveedor): una cuenta solo de contabilidad no ve un hueco.
//
// Nombres de la base entre comillas (regla 40): article_supplier y sus
// columnas account_id, supplier_id, is_active (las mismas que lee
// purchaseFormatService.listLinksBySupplier).

import { supabase } from '@/lib/supabase'
import type { ExtensionesProveedor } from '@/modules/conta/extensiones'
import ArticulosQueLeCompras from '@/modules/kitchen/proveedores/ArticulosQueLeCompras'

async function articulosPorProveedor(accountId: string): Promise<Record<string, number>> {
  if (!supabase) return {}
  const { data, error } = await supabase.from('article_supplier').select('supplier_id')
    .eq('account_id', accountId).eq('is_active', true)
  if (error) throw new Error(`No se pudieron contar los artículos: ${error.message}`)
  const n: Record<string, number> = {}
  for (const r of (data ?? []) as { supplier_id: string | null }[]) if (r.supplier_id) n[r.supplier_id] = (n[r.supplier_id] ?? 0) + 1
  return n
}

export const EXTENSIONES_COCINA: ExtensionesProveedor = {
  secciones: [{
    id: 'articulos',
    titulo: 'Artículos que le compras',
    tieneAlgo: async (accountId) => Object.keys(await articulosPorProveedor(accountId)).length > 0,
    render: (ctx) => <ArticulosQueLeCompras ctx={ctx} />,
  }],
  columna: { titulo: 'Artículos', valores: articulosPorProveedor },
}
