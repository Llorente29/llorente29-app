// src/modules/kitchen/lib/iconoDeCanal.ts
//
// B80 (06/09/2026). El icono de un canal, elegido por su nombre — y a prueba de
// que ese nombre no exista.
//
// LA FACTURA, y es de anoche. Esta heurística vivía dentro de
// `RecipeEscandalloTab.tsx` con la firma `channelIcon(name: string)` y un
// `name.toLowerCase()` sin guarda. Nunca había fallado por un motivo incómodo:
// **no se llamaba nunca**. `menu_item_economics` devolvía cero filas para todas
// las marcas de todas las cuentas (un INNER JOIN contra `menu_item.channel_id`,
// que está vacío en las 584 filas de la cuenta), así que el bucle que la invoca
// no tenía sobre qué iterar.
//
// Al arreglar esa RPC (B79) empezaron a llegar filas — con `channelName` a NULL,
// porque el catálogo no tiene canal asignado. Resultado: `Cannot read properties
// of null (reading 'toLowerCase')` dentro de dos `map` anidados, y la pantalla
// entera de un plato en blanco. Ocho productos de Lobbers y Lovers Burgers no se
// podían abrir.
//
// LA LECCIÓN, que es la que importa: **el tipo decía `string` y la realidad era
// `string | null`**. No mentía por descuido — mentía porque nadie había llegado
// hasta ahí con datos reales, y un tipo que nunca se ejecuta no se comprueba
// solo. Arreglar un cero silencioso aguas arriba destapa todo lo que se apoyaba
// en que ese cero no llegara nunca.
//
// Está fuera del componente para poder probarla sin pintar nada — y porque un
// fichero de componente que exporta funciones rompe el fast refresh (lección de
// B72, la dijo el lint y tenía razón).

import { Store, Bike, ShoppingBag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Icono para un canal de venta, por palabras clave de su nombre.
 *
 * Sin nombre —canal no asignado— devuelve la bolsa, que es el icono neutro: no
 * se afirma que sea local ni delivery, porque no se sabe.
 */
export function iconoDeCanal(name: string | null | undefined): LucideIcon {
  if (!name) return ShoppingBag
  const n = name.toLowerCase()
  if (n.includes('local') || n.includes('shop') || n.includes('tienda') || n.includes('sala')) return Store
  if (n.includes('glovo') || n.includes('uber') || n.includes('just') || n.includes('deliver')) return Bike
  return ShoppingBag
}
