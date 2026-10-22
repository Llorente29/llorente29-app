// src/modules/conta/marco/migas.ts
//
// S02 · Las migas de una página (encargo S02, «Encabezado de cada página»):
// pequeñas, encima del título, desde el segundo nivel, y cada trozo se pulsa
// menos el último. «Compras y gastos › Facturas recibidas › EUROPASTRY
// 24048027». Las dos primeras salen solas del mapa (productos.ts); la página
// añade las suyas (la ficha). Núcleo puro.

import type { Pestana, Producto } from '@/modules/conta/esqueleto/productos'

export interface Miga {
  etiqueta: string
  /** A dónde lleva (absoluta). La última no lleva a ningún sitio. */
  a?: string
}

/**
 * Las migas de un apartado y su página, más las que añade la pantalla. La
 * última nunca es un enlace. Un apartado sin páginas (Inicio) no lleva migas:
 * es el primer nivel.
 */
export function migasDe(
  donde: { producto: Producto; pestana: Pestana | null } | null,
  rutaDe: (relativa: string) => string,
  extra: readonly Miga[] = [],
): Miga[] {
  if (!donde) return extra.map((m, i) => (i === extra.length - 1 ? { etiqueta: m.etiqueta } : m))
  const { producto, pestana } = donde
  const lista: Miga[] = []
  if (producto.pestanas.length > 0 && producto.ruta) lista.push({ etiqueta: producto.etiqueta, a: rutaDe(producto.ruta) })
  if (pestana?.ruta) lista.push({ etiqueta: pestana.etiqueta, a: rutaDe(pestana.ruta) })
  lista.push(...extra)
  if (lista.length < 2) return []
  return lista.map((m, i) => (i === lista.length - 1 ? { etiqueta: m.etiqueta } : m))
}
