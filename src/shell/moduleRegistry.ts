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
// Más adelante (G-7) este registro estático se complementará con la consulta
// a la tabla `account_modules` para gating por cuenta.

import type { ModuleDefinition } from './types'
import { personalModule } from '@/modules/personal/module'
import { appccModule } from '@/modules/appcc/module'
import { ventasModule } from '@/modules/ventas/module'
import { kitchenModule } from '@/modules/kitchen/module'

export const moduleRegistry: ModuleDefinition[] = [
  personalModule,     // G-8.4 (Folvy Team, topBarOrder 1)
  appccModule,        // G-3   (Folvy Safety, topBarOrder 2)
  ventasModule,       // G-8.4 (Folvy Sales, topBarOrder 3)
  kitchenModule,      //       (Folvy Kitchen, topBarOrder 4)
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
