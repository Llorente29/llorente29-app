// src/modules/supply/module.tsx
//
// ModuleDefinition del módulo Folvy Supply (aprovisionamiento).
// Sigue el patrón canónico de integrations/module.tsx y kitchen/module.tsx.
//
// Folvy Supply es el módulo de PROCESO del ciclo de aprovisionamiento (el
// destino es MRP II de ciclo cerrado): pedir → recibir → facturar → inventario
// → previsión → planificación. Folvy Kitchen sigue siendo los DATOS MAESTROS
// (ingredientes, recetas, proveedores, coste) que este módulo consume.
//
// Se construye por capas, cada una usable por sí sola:
//   - C1: Pedidos (purchase_order). Crear/listar pedidos.
//   - C2 (ahora): Recepciones (goods_receipt + libro mayor de stock) → inventario.
//   - C3: Facturas (three-way match + OCR) → eslabón al coste.
//   - Luego: Inventario, Previsión, Planificación.
//
// Gating: requiredRole 'manager' a nivel de módulo, más requiredPermission
// por item (ENCARGO CODE 14/08 — antes NINGÚN item de este módulo tenía
// requiredPermission; cualquier manager/admin veía las 5 pantallas,
// show_inventory incluido, sin que esa columna gatease nada realmente).
// Comunicar a CTB sube a requiredRole: 'admin' (decisión de Julio, no
// manager) — comunica datos a la gestoría, no es operativa de local.

import { Truck, ClipboardList, PackageCheck, FileText, Boxes, Send, AlertTriangle } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import SupplyOrdersPage from '@/modules/supply/pages/SupplyOrdersPage'
import GoodsReceiptsPage from '@/modules/supply/pages/GoodsReceiptsPage'
import PendientesRecepcionPage from '@/modules/supply/pages/PendientesRecepcionPage'
import SupplierInvoicesPage from '@/modules/supply/pages/SupplierInvoicesPage'
import InventoryPage from '@/modules/supply/pages/InventoryPage'
import CtbNotifyPage from '@/modules/supply/pages/CtbNotifyPage'
import StockNegativoCard from '@/modules/supply/home/StockNegativoCard'
import ConteosPendientesCard from '@/modules/supply/home/ConteosPendientesCard'

export const supplyModule: ModuleDefinition = {
  // Identidad
  id: 'supply',
  name: 'Folvy Supply',
  icon: Truck,
  topBarOrder: 6,
  // Gating
  requiredRole: 'manager',
  // Routing: paths relativos al basePath 'supply'.
  basePath: 'supply',
  routes: [
    { path: '', element: <SupplyOrdersPage /> },
    { path: 'recepciones', element: <GoodsReceiptsPage /> },
    { path: 'pendientes', element: <PendientesRecepcionPage /> },
    { path: 'facturas', element: <SupplierInvoicesPage /> },
    { path: 'inventario', element: <InventoryPage /> },
    { path: 'comunicar-ctb', element: <CtbNotifyPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  // C2 añade Recepciones. Al construir C3 se añaden Facturas, etc.
  sidebar: {
    items: [
      { id: 'supply_orders', label: 'Pedidos', icon: ClipboardList, path: '', requiredPermission: 'show_pedidos' },
      { id: 'supply_receipts', label: 'Recepciones', icon: PackageCheck, path: 'recepciones', requiredPermission: 'show_recepcion' },
      { id: 'supply_pending', label: 'Pendientes', icon: AlertTriangle, path: 'pendientes', requiredPermission: 'show_recepcion' },
      { id: 'supply_invoices', label: 'Facturas', icon: FileText, path: 'facturas', requiredPermission: 'show_facturas' },
      { id: 'supply_inventory', label: 'Almacén', icon: Boxes, path: 'inventario', requiredPermission: 'show_inventory' },
      { id: 'supply_ctb', label: 'Comunicar a CTB', icon: Send, path: 'comunicar-ctb', requiredRole: 'admin' },
    ],
  },
  // §Almacén de la maqueta. Cuelga del mismo servicio que la pantalla de Stock.
  homeCards: [
    {
      key: 'supply.conteos_pendientes',
      title: 'Conteos pendientes',
      grupo: 'Almacen',
      size: 'sm',
      source: 'inventory_count',
      drill: { ruta: '/supply/inventario', etiqueta: 'Abrir Almacén · Inventarios →' },
      requiredRole: 'manager',
      component: ConteosPendientesCard,
    },

    {
      key: 'supply.stock_negativo',
      title: 'Stock negativo',
      grupo: 'Almacen',
      size: 'sm',
      source: 'stock_movement',
      drill: { ruta: '/supply/stock', etiqueta: 'Abrir Almacén · Stock →' },
      requiredRole: 'manager',
      component: StockNegativoCard,
    },
  ],
}
