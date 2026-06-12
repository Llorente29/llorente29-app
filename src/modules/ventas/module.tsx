// src/modules/ventas/module.tsx
//
// ModuleDefinition del módulo Ventas (Folvy Sales).
//
// La pantalla principal ('' ) es ahora el DASHBOARD DE VENTAS nuevo
// (VentasDashboardPage), que lee de `sale` vía la RPC server-side
// sales_dashboard. El análisis heredado (VentasAnalisisPage, basado en
// tspoon/Excel/localStorage) se conserva bajo 'analisis' como legacy hasta su
// retirada, para no perder funcionalidad mientras el dashboard madura.
//
// Fichero .tsx porque los `element` de las rutas son JSX.

import { BarChart3, LineChart, Bike } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import VentasDashboardPage from '@/pages/VentasDashboardPage'
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
    { path: '',           element: <VentasDashboardPage /> },
    { path: 'analisis',   element: <VentasAnalisisPage /> },
    { path: 'prediccion', element: <PrediccionPersonalPage /> },
    { path: 'zonas',      element: <ZonasPedidoPage /> },
  ],

  sidebar: {
    items: [
      { id: 'ventas_dashboard',  label: 'Resumen de ventas',   icon: BarChart3, path: '',         requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_analisis',   label: 'Análisis (heredado)', icon: LineChart, path: 'analisis', requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_zonas',      label: 'Zonas de pedido',     icon: Bike,      path: 'zonas',    requiredPermission: 'show_zonas_pedido' },
    ],
  },

  publishes: [
    { key: 'ventas.sale.imported', description: 'Se han importado ventas de un TPV' },
  ],
}
