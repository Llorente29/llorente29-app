// src/modules/orders/module.tsx
//
// ModuleDefinition de Folvy Orders — el centro de mando del pedido (delivery y,
// más adelante, sala). UN módulo, cuatro vistas de la MISMA realidad (el pedido):
//   - Pedidos   (/orders)          feed operativo: ver/marcar/aceptar/rechazar (A1)
//   - Despacho  (/orders/despacho) board del dispatcher: entregas en vivo + acción
//   - Cocina    (/orders/cocina)   el tablero KDS (KdsBoardPage), reusado tal cual
//   - Ajustes   (/orders/ajustes)  auto-aceptación + estaciones/ruteo/dispositivos
//
// FUSIÓN (19/06): Orders y KDS eran dos botones del TopBar para la misma cosa.
// Se funden aquí (un botón). El KDS NO se mueve de carpeta: su board, componentes,
// servicio y kiosco siguen en src/modules/kds/. El kiosco /cocina-tv (App.tsx) NO se toca.
//
// El FEED de pedidos (OrdersFeedPage) ya es la raíz '/orders' (lente "por pedido").
//
// Gating: requiredRole 'manager' (operar pedidos / cocina = encargado).
// Ruta propia 'orders' (cuidado con el secuestro de prefijo, como /kds→/cocina-tv).

import { ClipboardList, ListOrdered, MonitorPlay, SlidersHorizontal, Bike } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import OrdersFeedPage from '@/modules/orders/pages/OrdersFeedPage'
import DispatchBoardPage from '@/modules/orders/pages/DispatchBoardPage'
import KdsBoardPage from '@/modules/kds/pages/KdsBoardPage'
import OrdersSettingsPage from '@/modules/orders/pages/OrdersSettingsPage'

export const ordersModule: ModuleDefinition = {
  // Identidad
  id: 'orders',
  name: 'Folvy Orders',
  icon: ClipboardList,
  topBarOrder: 7, // ocupa el hueco del KDS (que desaparece como módulo propio)
  // Gating
  requiredRole: 'manager',
  // Routing: paths relativos al basePath 'orders'.
  basePath: 'orders',
  routes: [
    { path: '',         element: <OrdersFeedPage /> },   // ← el feed de pedidos (lente por pedido)
    { path: 'despacho', element: <DispatchBoardPage /> },
    { path: 'cocina',   element: <KdsBoardPage /> },
    { path: 'ajustes',  element: <OrdersSettingsPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      { id: 'orders_feed',     label: 'Pedidos',  icon: ListOrdered,       path: '' },
      { id: 'orders_dispatch', label: 'Despacho', icon: Bike,              path: 'despacho' },
      { id: 'orders_kitchen',  label: 'Cocina',   icon: MonitorPlay,       path: 'cocina' },
      { id: 'orders_settings', label: 'Ajustes',  icon: SlidersHorizontal, path: 'ajustes', requiredRole: 'manager' },
    ],
  },
}
