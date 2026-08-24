// src/modules/kitchen/components/menuFilters.ts
//
// F2: el TIPO y los ayudantes de los chips de filtro, separados del componente.
// Van aparte porque el fichero de un componente solo debe exportar componentes
// (si no, el fast-refresh de Vite deja de funcionar en toda la pantalla y cada
// cambio recarga entera la página en desarrollo).

export type MenuFilterKey = 'sinEscandallo' | 'sinFoto' | 'agotados' | 'archivados'

export type MenuFilters = Record<MenuFilterKey, boolean>

export const EMPTY_FILTERS: MenuFilters = {
  sinEscandallo: false,
  sinFoto: false,
  agotados: false,
  archivados: false,
}

export function anyFilterActive(f: MenuFilters): boolean {
  return f.sinEscandallo || f.sinFoto || f.agotados || f.archivados
}
