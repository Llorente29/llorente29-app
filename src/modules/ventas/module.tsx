// src/modules/ventas/module.tsx
//
// ModuleDefinition del módulo Ventas (Folvy Sales) — Bloque G-8.4, Sprint 3.
//
// Referencia: folvy_arquitectura_reconciliada.md §6 (Ventas = 'ventas' /
// display 'Folvy Sales'). En V1 es backend Last.app + estas vistas de
// análisis; dashboards/predicción crecen en V1.1+.
//
// Paths relativos al basePath 'ventas' (en la app actual ya viven bajo
// ventas/analisis, ventas/prediccion, ventas/zonas — ver src/routes.ts).
//
// Fichero .tsx porque los `element` de las rutas son JSX.

import { BarChart3, Bike } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import VentasAnalisisPage from '@/pages/VentasAnalisisPage'
import PrediccionPersonalPage from '@/pages/PrediccionPersonalPage'
import ZonasPedidoPage from '@/pages/ZonasPedidoPage'

export const ventasModule: ModuleDefinition = {
  id: 'ventas',
  name: 'Folvy Sales',
  icon: BarChart3,
  topBarOrder: 3,
  requiredRole: 'manager',

  basePath: 'ventas',
  routes: [
    { path: '',           element: <VentasAnalisisPage /> },
    { path: 'prediccion', element: <PrediccionPersonalPage /> },
    { path: 'zonas',      element: <ZonasPedidoPage /> },
  ],

  sidebar: {
    items: [
      { id: 'ventas_analisis',   label: 'Análisis de ventas',  icon: BarChart3, path: '',      requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_zonas',      label: 'Zonas de pedido',     icon: Bike,      path: 'zonas', requiredPermission: 'show_zonas_pedido' },
    ],
  },

  publishes: [
    { key: 'ventas.sale.imported', description: 'Se han importado ventas de un TPV' },
  ],
}
