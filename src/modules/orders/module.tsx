// src/modules/orders/module.tsx
//
// ModuleDefinition de Folvy Orders — el centro de mando del pedido (delivery y,
// más adelante, sala). UN módulo, tres vistas de la MISMA realidad (el pedido):
//   - Pedidos  (/orders)         feed operativo: aceptar/rechazar/estados [POR CONSTRUIR]
//   - Cocina   (/orders/cocina)  el tablero KDS (KdsBoardPage), reusado tal cual
//   - Ajustes  (/orders/ajustes) auto-aceptación + estaciones/ruteo/dispositivos
//
// FUSIÓN (19/06): Orders y KDS eran dos botones del TopBar para la misma cosa.
// Se funden aquí (un botón). El KDS NO se mueve de carpeta: su board, componentes,
// servicio y kiosco siguen en src/modules/kds/. Solo MUERE kds/module.tsx y su
// página se monta desde aquí. El kiosco /cocina-tv (App.tsx) NO se toca.
//
// Mientras el FEED de pedidos no exista, la raíz '/orders' abre la vista Cocina
// (no enseñar vacío). Cuando el feed entre, la raíz pasará a Pedidos (1 línea).
//
// Gating: requiredRole 'manager' (operar pedidos / cocina = encargado).
// Ruta propia 'orders' (cuidado con el secuestro de prefijo, como /kds→/cocina-tv).

import { ClipboardList, ListOrdered, MonitorPlay, SlidersHorizontal } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
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
    // Hasta que exista el feed, la raíz muestra Cocina (no enseñar vacío).
    { path: '',        element: <KdsBoardPage /> },
    { path: 'cocina',  element: <KdsBoardPage /> },
    { path: 'ajustes', element: <OrdersSettingsPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      // "Pedidos" apunta hoy a la raíz (= Cocina). Cuando el feed exista, la raíz
      // será el feed y este item ya estará correcto sin tocar nada.
      { id: 'orders_feed',     label: 'Pedidos',  icon: ListOrdered,       path: '' },
      { id: 'orders_kitchen',  label: 'Cocina',   icon: MonitorPlay,       path: 'cocina' },
      { id: 'orders_settings', label: 'Ajustes',  icon: SlidersHorizontal, path: 'ajustes', requiredRole: 'manager' },
    ],
  },
}
