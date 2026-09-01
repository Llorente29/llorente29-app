// src/shell/home/cards/shellCards.ts
//
// LAS TARJETAS TRANSVERSALES DEL INICIO, ya en el catálogo.
//
// Son EXACTAMENTE las siete que el Inicio enseña desde junio, sin reescribir
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
  VentasHoy, TrabajandoAhora, Solicitudes, AppccHoy,
  ResumenTeam, ResumenSafety, ResumenSales,
} from './shellCardComponents'

/**
 * El catálogo del shell. El ORDEN de este array es el defecto de fábrica del
 * mosaico — el mismo que el Inicio tiene hoy, para que nadie note el cambio
 * hasta que decida personalizarlo.
 */
export const SHELL_HOME_CARDS: HomeCardDefinition[] = [
  { key: 'shell.ventas_hoy',       title: 'Ventas hoy',        size: 'sm', source: 'sale',                  drillRoute: 'ventas',   component: VentasHoy },
  { key: 'shell.trabajando_ahora', title: 'Trabajando ahora',  size: 'sm', source: 'employee_clock_status', drillRoute: 'personal', component: TrabajandoAhora },
  { key: 'shell.solicitudes',      title: 'Solicitudes',       size: 'sm', description: 'Sin fuente todavía',                       component: Solicitudes },
  { key: 'shell.appcc_hoy',        title: 'APPCC hoy',         size: 'sm', description: 'Sin fuente todavía',                       component: AppccHoy },
  { key: 'shell.resumen_team',     title: 'Resumen de Team',   size: 'md', source: 'employee_clock_status', drillRoute: 'personal', component: ResumenTeam },
  { key: 'shell.resumen_safety',   title: 'Resumen de Safety', size: 'md', description: 'Sin fuente todavía',                       component: ResumenSafety },
  { key: 'shell.resumen_sales',    title: 'Resumen de Sales',  size: 'md', source: 'sale',                  drillRoute: 'ventas',   component: ResumenSales },
]

/** El defecto de fábrica: lo que ve quien nunca ha personalizado nada. */
export const LAYOUT_POR_DEFECTO: string[] = SHELL_HOME_CARDS.map(c => c.key)
