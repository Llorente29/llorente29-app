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
// Gating: requiredRole 'manager' (el aprovisionamiento lo gestiona admin/manager).

import { Truck, ClipboardList, PackageCheck, FileText, Boxes, Send } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import SupplyOrdersPage from '@/modules/supply/pages/SupplyOrdersPage'
import GoodsReceiptsPage from '@/modules/supply/pages/GoodsReceiptsPage'
import SupplierInvoicesPage from '@/modules/supply/pages/SupplierInvoicesPage'
import InventoryPage from '@/modules/supply/pages/InventoryPage'
import CtbNotifyPage from '@/modules/supply/pages/CtbNotifyPage'

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
    { path: 'facturas', element: <SupplierInvoicesPage /> },
    { path: 'inventario', element: <InventoryPage /> },
    { path: 'comunicar-ctb', element: <CtbNotifyPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  // C2 añade Recepciones. Al construir C3 se añaden Facturas, etc.
  sidebar: {
    items: [
      { id: 'supply_orders', label: 'Pedidos', icon: ClipboardList, path: '' },
      { id: 'supply_receipts', label: 'Recepciones', icon: PackageCheck, path: 'recepciones' },
      { id: 'supply_invoices', label: 'Facturas', icon: FileText, path: 'facturas' },
      { id: 'supply_inventory', label: 'Almacén', icon: Boxes, path: 'inventario' },
      { id: 'supply_ctb', label: 'Comunicar a CTB', icon: Send, path: 'comunicar-ctb' },
    ],
  },
}
