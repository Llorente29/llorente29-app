// src/shell/home/cards/p2Cards.ts
//
// LAS TARJETAS PROMETIDAS Y AÚN SIN CABLEAR (lote P2).
//
// Quince de las veintiuna del catálogo. Están DECLARADAS aunque no tengan
// componente, y eso es deliberado:
//
//   · Se ve que existen. El cajón las lista con su etiqueta gris «P2», así que
//     quien busca «ticket medio» lo encuentra y sabe que llegará, en vez de
//     concluir que no está previsto.
//   · No dan dato y lo dicen. Si alguien marca una, el mosaico pinta un hueco
//     punteado que dice «se cablea en el lote P2» — no un «—» ni un cero, que
//     es lo que hacían las tres retiradas el 02/09 y por lo que se retiraron.
//
// La diferencia con una tarjeta RETIRADA es la dirección: una retirada se fue y
// deja lápida; una P2 no ha llegado todavía. Confundirlas sería decirle al
// usuario que algo se rompió cuando lo que pasa es que aún no está.
//
// El día que una se cablee: se le pone `component`, se le quita de aquí, y ya
// está — el cajón, el orden y el grupo no cambian.

import type { HomeCardDefinition } from '../../types'

export const P2_HOME_CARDS: HomeCardDefinition[] = [
  // ── Ventas ───────────────────────────────────────────────────────────────
  { key: 'ventas.ticket_medio', grupo: 'Ventas', title: 'Ticket medio', size: 'sm', source: 'sale',
    drill: { ruta: '/ventas', etiqueta: 'Abrir Ventas →' } },
  { key: 'ventas.por_canal', grupo: 'Ventas', title: 'Ventas por canal', size: 'md', source: 'sale',
    drill: { ruta: '/ventas', etiqueta: 'Abrir Ventas →' } },

  // ── Team ─────────────────────────────────────────────────────────────────
  { key: 'personal.pct_sobre_ventas', grupo: 'Team', title: '% personal sobre ventas', size: 'sm',
    source: 'clock_entries', drill: { ruta: '/personal/informes-analitica', etiqueta: 'Abrir Team · Informes →' } },
  { key: 'personal.bolsa_horas', grupo: 'Team', title: 'Bolsa de horas', size: 'sm',
    source: 'clock_entries', drill: { ruta: '/personal/bolsa-horas', etiqueta: 'Abrir Team · Bolsa de horas →' } },
  { key: 'personal.sin_fichar_con_turno', grupo: 'Team', title: 'Sin fichar teniendo turno', size: 'sm',
    source: 'clock_entries', drill: { ruta: '/personal/ahora-mismo', etiqueta: 'Abrir Team · Ahora mismo →' } },

  // ── Cocina ───────────────────────────────────────────────────────────────
  { key: 'kitchen.food_cost_medio', grupo: 'Cocina', title: 'Food cost medio', size: 'sm',
    source: 'recipe_item', drill: { ruta: '/kitchen/rentabilidad', etiqueta: 'Abrir Cocina · Rentabilidad →' } },
  { key: 'kitchen.margen_del_mes', grupo: 'Cocina', title: 'Margen del mes', size: 'sm',
    source: 'sale', drill: { ruta: '/kitchen/rentabilidad', etiqueta: 'Abrir Cocina · Rentabilidad →' } },
  { key: 'kitchen.platos_sin_escandallo', grupo: 'Cocina', title: 'Platos sin escandallo', size: 'sm',
    source: 'recipe_item', drill: { ruta: '/kitchen/recetas', etiqueta: 'Abrir Cocina · Platos →' } },

  // ── Almacén ──────────────────────────────────────────────────────────────
  { key: 'supply.puntos_de_pedido', grupo: 'Almacen', title: 'Puntos de pedido', size: 'sm',
    source: 'recipe_item', drill: { ruta: '/supply/pedidos', etiqueta: 'Abrir Almacén · Pedidos →' } },

  // ── Canales ──────────────────────────────────────────────────────────────
  { key: 'orders.liquidaciones_ctb', grupo: 'Canales', title: 'Liquidaciones CTB', size: 'sm',
    source: 'sale', drill: { ruta: '/pedidos', etiqueta: 'Abrir Pedidos →' } },

  // ── Agentes ──────────────────────────────────────────────────────────────
  // OJO: es la TARJETA del mosaico. El panel «Mis agentes» de la maqueta va
  // debajo del mosaico y es otra cosa; no se confunden ni comparten clave.
]

/**
 * EL ORDEN APROBADO del cajón, las veintiuna en fila.
 *
 * Vive en una lista y no en un número por tarjeta porque así se lee de un
 * vistazo contra la tabla aprobada, que es como se comprueba que no falta
 * ninguna. Una clave que no esté aquí va al final de su grupo: no se pierde, se
 * nota.
 */
export const ORDEN_DEL_CAJON: string[] = [
  // Ventas
  'ventas.ayer', 'ventas.semana', 'ventas.grafica_14_dias',
  'ventas.ticket_medio', 'ventas.por_canal',
  // Team
  'personal.en_cocina_ahora', 'personal.cuadrantes',
  'personal.pct_sobre_ventas', 'personal.bolsa_horas', 'personal.sin_fichar_con_turno',
  // Cocina
  'kitchen.food_cost_medio', 'kitchen.margen_del_mes', 'kitchen.platos_sin_escandallo',
  // Almacén
  'supply.conteos_pendientes', 'supply.stock_negativo', 'supply.puntos_de_pedido',
  // Canales
  'kitchen.productos_86', 'orders.pedidos_atascados',
  'orders.liquidaciones_ctb', 'integrations.salud_conexiones',
  // Agentes
  'agentes.resumen',
]

/** true = declarada y todavía sin cablear. */
export function esP2(card: { component?: unknown }): boolean {
  return card.component == null
}
