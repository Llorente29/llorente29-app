// src/modules/kitchen/home/vendidoSinCoste.ts
//
// LO QUE SE VENDE Y NO SE PUEDE COSTEAR. Fuente de la tarjeta «Platos sin
// escandallo».
//
// ── LA FUENTE QUE PARECÍA LA BUENA Y HABRÍA DICHO CERO ─────────────────────
// `list_costless_sold_products` existe desde antes y parecía escrita para esto.
// Se midió antes de cablearla: devuelve CERO filas para Foodint. Exige que el
// `recipe_item` enlazado no tenga coste, y hoy todos los enlazados lo tienen;
// el agujero está un paso antes —productos de carta SIN escandallo enlazado— y
// esa RPC los excluye por construcción, porque hace JOIN contra recipe_item.
//
// Una tarjeta anclada ahí habría dicho «0 platos sin escandallo» con 118
// productos y 11.522 € vendidos sin coste detrás. El cero de la regla 7,
// servido por una fuente de aspecto impecable. Por eso la tarjeta lee
// `home_vendido_sin_coste`, escrita para esto (ver la migración
// 20260902T2100_home_vendido_sin_coste.sql, que explica las tres decisiones).
//
// ── COMBOS APARTE ──────────────────────────────────────────────────────────
// Un combo declarado no lleva escandallo propio: su coste es la suma de sus
// componentes. Mandar a alguien a «hacerle el escandallo al Korean Crispy Menu»
// sería mandarle a hacer un trabajo equivocado. Se cuentan, con su dinero, y se
// dicen aparte.

import { rpcSinTipar } from '@/lib/rpcSinTipar'

export interface ProductoSinCoste {
  nombre: string
  marca: string | null
  lineas: number
  venta: number
}

interface Cubo { productos: number; lineas: number; venta: number }

interface RespuestaCruda {
  lineas: number
  lineas_costeadas: number
  cobertura_pct: number | null
  venta: number
  venta_sin_coste: number
  platos: Cubo
  combos: Cubo
  top: { nombre: string; marca: string | null; lineas: number; venta: number }[]
}

export interface VendidoSinCoste {
  /** Líneas de PRODUCTO del periodo. Modificadores y combo_item no cuentan. */
  lineas: number
  lineasCosteadas: number
  coberturaPct: number | null
  ventaEur: number
  ventaSinCosteEur: number
  /** Productos sin coste que NO son combo declarado: los que se arreglan a mano. */
  platos: Cubo
  /** Combos declarados sin coste: su escandallo son sus componentes. */
  combos: Cubo
  /** Los `platos` con más dinero detrás, ya ordenados. */
  top: ProductoSinCoste[]
}

export async function leeVendidoSinCoste(
  accountId: string, locationId: string | null,
): Promise<VendidoSinCoste> {
  const d = await rpcSinTipar<RespuestaCruda | null>('home_vendido_sin_coste', {
    p_account: accountId,
    p_location: locationId,
    // Las fechas van por defecto (30 días) desde la propia función: el criterio
    // vive en un sitio, no en dos.
  })
  const vacio: Cubo = { productos: 0, lineas: 0, venta: 0 }
  return {
    lineas: Number(d?.lineas ?? 0),
    lineasCosteadas: Number(d?.lineas_costeadas ?? 0),
    coberturaPct: d?.cobertura_pct == null ? null : Number(d.cobertura_pct),
    ventaEur: Number(d?.venta ?? 0),
    ventaSinCosteEur: Number(d?.venta_sin_coste ?? 0),
    platos: d?.platos ?? vacio,
    combos: d?.combos ?? vacio,
    top: (d?.top ?? []).map(p => ({
      nombre: p.nombre, marca: p.marca,
      lineas: Number(p.lineas), venta: Number(p.venta),
    })),
  }
}
