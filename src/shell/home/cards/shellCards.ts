// src/shell/home/cards/shellCards.ts
//
// LAS TARJETAS TRANSVERSALES DEL INICIO, ya en el catálogo.
//
// (02/09 · §0) LAS SIN FUENTE, FUERA. Eran tres —Solicitudes, APPCC hoy y
// Resumen de Safety— y no enseñaban un dato: enseñaban «—» y la palabra
// «próximamente». En junio eso era honesto porque el Inicio era interno. Hoy
// esta pantalla es la cara de la demo del cliente 2, y una casilla que dice
// «próximamente» no comunica transparencia: comunica producto a medias.
//
// No es la regla 7 al revés. La regla 7 prohíbe esconder FILAS QUE EXISTEN; una
// tarjeta sin fuente no tiene filas que esconder, tiene un hueco. Y siguen en el
// catálogo del cajón cuando se cableen: quitarlas del mosaico por defecto no es
// borrarlas del producto.
//
// Se quedan CUATRO, que son las que tienen dato de verdad, hasta que las
// sustituyan las seis de la maqueta.
//
// Eran las siete que el Inicio enseñaba desde junio, sin reescribir
// ni un widget: los componentes de shellCardComponents.tsx envuelven
// `MetricCard` y `ModuleSummaryCard` tal cual. Lo dice el RECON del 30/08 y es
// la razón de que existan como estaban — «preparado para configurabilidad por
// usuario sin reescribir los widgets». Reescribirlos ahora sería tirar el
// trabajo que se hizo para no hacerlo dos veces, y cambiaría el aspecto del
// Inicio en un lote que no va de eso.
//
// Viven en el SHELL y no en un módulo porque su dato sale de
// homeMetricsService, que es del shell. Las de módulo llegan por
// `ModuleDefinition.homeCards` y entran en el mismo catálogo sin tocar esto.

import type { HomeCardDefinition } from '../../types'
import {
  VentasHoy, TrabajandoAhora, ResumenTeam, ResumenSales,
} from './shellCardComponents'

/**
 * El catálogo del shell. El ORDEN de este array es el defecto de fábrica del
 * mosaico — el mismo que el Inicio tiene hoy, para que nadie note el cambio
 * hasta que decida personalizarlo.
 */
export const SHELL_HOME_CARDS: HomeCardDefinition[] = [
  { key: 'shell.ventas_hoy',       title: 'Ventas hoy',        size: 'sm', source: 'sale',                  drillRoute: 'ventas',   component: VentasHoy },
  { key: 'shell.trabajando_ahora', title: 'Trabajando ahora',  size: 'sm', source: 'employee_clock_status', drillRoute: 'personal', component: TrabajandoAhora },
  { key: 'shell.resumen_team',     title: 'Resumen de Team',   size: 'md', source: 'employee_clock_status', drillRoute: 'personal', component: ResumenTeam },
  { key: 'shell.resumen_sales',    title: 'Resumen de Sales',  size: 'md', source: 'sale',                  drillRoute: 'ventas',   component: ResumenSales },
]

/** El defecto de fábrica: lo que ve quien nunca ha personalizado nada. */
export const LAYOUT_POR_DEFECTO: string[] = SHELL_HOME_CARDS.map(c => c.key)
