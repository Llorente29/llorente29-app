// src/shell/moduleRegistry.ts
//
// Registro central de módulos del Shell (Bloque G, Sprint 3).
// El Shell lee este array para construir el TopBar de módulos y el routing.
//
// Principio (doc reconciliado §3, Principio 2): añadir un módulo = añadir una
// línea aquí; quitarlo = borrar una línea. Cero modificaciones en el Shell.
//
// G-1: array vacío. Los ModuleDefinition se añaden en:
//   - G-3: appccModule (piloto).
//   - G-5: personalModule, ventasModule.
//
// FUSIÓN ORDERS+KDS (19/06): el módulo KDS desaparece como botón propio; su
// tablero y sus ajustes viven ahora DENTRO de Folvy Orders (vistas Cocina y
// Ajustes). El kiosco /cocina-tv sigue en App.tsx, intacto. El código del KDS
// (board, componentes, servicio, kiosco) permanece en src/modules/kds/.
//
// Más adelante (G-7) este registro estático se complementará con la consulta
// a la tabla `account_modules` para gating por cuenta.

import type { ModuleDefinition } from './types'
import { personalModule } from '@/modules/personal/module'
import { appccModule } from '@/modules/appcc/module'
import { ventasModule } from '@/modules/ventas/module'
import { kitchenModule } from '@/modules/kitchen/module'
import { integrationsModule } from '@/modules/integrations/module'
import { supplyModule } from '@/modules/supply/module'
import { ordersModule } from '@/modules/orders/module'
import { shopModule } from '@/modules/shop/module'

export const moduleRegistry: ModuleDefinition[] = [
  personalModule,     // G-8.4 (Folvy Team, topBarOrder 1)
  appccModule,        // G-3   (Folvy Safety, topBarOrder 2)
  ventasModule,       // G-8.4 (Folvy Sales, topBarOrder 3)
  kitchenModule,      //       (Folvy Kitchen, topBarOrder 4)
  integrationsModule, //       (Folvy Connect, topBarOrder 5)
  supplyModule,       //       (Folvy Supply, topBarOrder 6) — aprovisionamiento / MRP II
  ordersModule,       //       (Folvy Orders, topBarOrder 7) — pedidos + cocina (KDS) + ajustes
  shopModule,         //       (Folvy Shop, topBarOrder 9) — canal directo / capa de diseño
]

/** Devuelve los módulos ordenados por su posición en el TopBar. */
export function getOrderedModules(): ModuleDefinition[] {
  return [...moduleRegistry].sort((a, b) => a.topBarOrder - b.topBarOrder)
}

/** Busca un módulo por su id. */
export function getModuleById(id: string): ModuleDefinition | undefined {
  return moduleRegistry.find(m => m.id === id)
}

/** Busca el módulo que posee un basePath dado. */
export function getModuleByBasePath(basePath: string): ModuleDefinition | undefined {
  return moduleRegistry.find(m => m.basePath === basePath)
}
