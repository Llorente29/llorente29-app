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
import { appccModule } from '@/modules/appcc/module'

export const moduleRegistry: ModuleDefinition[] = [
  appccModule,        // G-3 (piloto)
  // personalModule,  // G-5
  // ventasModule,    // G-5
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
