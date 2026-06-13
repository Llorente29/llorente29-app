// src/modules/kds/module.tsx
//
// ModuleDefinition del módulo Folvy KDS (Kitchen Display System).
// Sigue el patrón canónico de kitchen/module.tsx.
//
// Dos pantallas dentro del Shell (sesión): el TABLERO (board) y los AJUSTES de
// cocina. El kiosco público (/cocina-tv con token) NO va aquí: vive en App.tsx
// como ruta pública (frontera de token), y reutiliza el mismo KdsBoard.

import { MonitorPlay, SlidersHorizontal } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import KdsBoardPage from '@/modules/kds/pages/KdsBoardPage'
import KdsSettingsPage from '@/modules/kds/pages/KdsSettingsPage'

export const kdsModule: ModuleDefinition = {
  // Identidad
  id: 'kds',
  name: 'Folvy KDS',
  icon: MonitorPlay,
  topBarOrder: 7,
  // Gating
  requiredRole: 'manager',
  // Routing: el Shell monta los módulos en la RAÍZ (sin slug) → basePath 'kds'
  // produce /kds (tablero) y /kds/ajustes. El kiosco público /cocina-tv lo
  // resuelve App.tsx (ruta propia, fuera de este routing), no aquí.
  basePath: 'kds',
  routes: [
    { path: '',        element: <KdsBoardPage /> },
    { path: 'ajustes', element: <KdsSettingsPage /> },
  ],
  sidebar: {
    items: [
      { id: 'kds_board',    label: 'Tablero',  icon: MonitorPlay,       path: '' },
      { id: 'kds_settings', label: 'Ajustes',  icon: SlidersHorizontal, path: 'ajustes', requiredRole: 'manager' },
    ],
  },
}
