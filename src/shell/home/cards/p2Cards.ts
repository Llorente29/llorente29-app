// src/shell/home/cards/p2Cards.ts
//
// LAS TARJETAS PROMETIDAS Y AÚN SIN CABLEAR (lote P2).
//
// UNA de las veintiuna del catálogo — quedaban quince el 02/09 por la mañana.
// Está DECLARADA aunque no tenga componente, y eso es deliberado:
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
  // ── Almacén ──────────────────────────────────────────────────────────────
  //
  // «PUNTOS DE PEDIDO» ESTÁ APARCADA A PROPÓSITO, no pendiente de que alguien
  // encuentre un hueco. Julio decidió que el punto lo CALCULA el sistema desde
  // el consumo, no que lo teclee nadie — y el consumo fiable empieza el 30/07,
  // cuando se crearon las tablas. Con cinco semanas de historia, un punto de
  // pedido calculado sería una media de agosto disfrazada de criterio.
  //
  // Se cablea cuando el histórico llegue a dos o tres meses. Quien la coja
  // antes creyendo que «solo falta enchufarla» está cogiendo el frente 10, no
  // una tarjeta. Está escrito ahí y aquí, que es donde se mira.
  { key: 'supply.puntos_de_pedido', grupo: 'Almacen', title: 'Puntos de pedido', size: 'sm',
    source: 'recipe_item', drill: { ruta: '/supply/pedidos', etiqueta: 'Abrir Almacén · Pedidos →' } },
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
