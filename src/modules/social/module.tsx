// src/modules/social/module.tsx
//
// ModuleDefinition de Folvy Social — el canal de contenido de la marca.
// El agente propone borradores (imagen premium-dirty + voz de calle) y aquí el
// humano los revisa y aprueba. También podrá dirigir (empujar marca/plato,
// tematizar por contexto, post a medida) — piezas siguientes.
//
// Pieza 1: solo la vista Cola (lectura). Parrilla, Directivas y Ajustes se
// añaden como items del sidebar en sus piezas, para no mostrar pestañas vacías.
//
// Gating: requiredRole 'manager' (gestionar el canal social = encargado/admin).
// basePath 'social' (ruta propia; el Shell monta el módulo en la raíz).

import { Megaphone, Inbox } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import SocialQueuePage from '@/modules/social/pages/SocialQueuePage'

export const socialModule: ModuleDefinition = {
  id: 'social',
  name: 'Folvy Social',
  icon: Megaphone,
  topBarOrder: 8,          // hueco libre entre Orders (7) y Shop (9)
  requiredRole: 'manager',
  basePath: 'social',
  routes: [
    { path: '', element: <SocialQueuePage /> },
  ],
  sidebar: {
    items: [
      { id: 'social_queue', label: 'Cola', icon: Inbox, path: '' },
    ],
  },
}
