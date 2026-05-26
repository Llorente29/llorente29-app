// src/modules/configuracion/module.tsx
//
// ModuleDefinition de Configuración (Bloque G-8.5, Sprint 3).
//
// DIFERENCIA con los módulos de negocio (Team/Safety/Sales): Configuración NO
// es una pestaña del TopBar. Se accede por el icono de ENGRANAJE (derecha del
// TopBar) y se monta en /shell/configuracion. Internamente reutiliza la misma
// maquinaria (ModuleSidebar) porque crecerá (Locales, Marcas, Avisos, Usuarios,
// datos fiscales, plan/facturación, API keys, activación de módulos...).
//
// Por eso este módulo NO se registra en moduleRegistry (que alimenta el
// TopBar). El Shell lo trata como sección especial accesible por el engranaje.
//
// Referencia: folvy_arquitectura_reconciliada.md §4.7 (Settings de cuenta es
// del Shell, no módulo de negocio) — aquí lo implementamos como módulo de
// settings con su propio sidebar, accedido por engranaje.
//
// Fichero .tsx porque los `element` de las rutas son JSX.

import { MapPin, Tag, Bell, UserCog } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import { LocationsPage } from '@/pages/OtherPages'
import BrandsPage from '@/modules/multitenancy/pages/BrandsPage'
import AvisosSettingsPage from '@/pages/AvisosSettingsPage'
import UsuariosAccesosPage from '@/pages/UsuariosAccesosPage'

export const configuracionModule: ModuleDefinition = {
  id: 'configuracion',
  name: 'Configuración',
  icon: UserCog,        // no se usa en TopBar; el acceso es el engranaje
  topBarOrder: 999,     // irrelevante (no va al TopBar)

  basePath: 'configuracion',
  routes: [
    { path: '',          element: <LocationsPage /> },
    { path: 'locales',   element: <LocationsPage /> },
    { path: 'marcas',    element: <BrandsPage /> },
    { path: 'avisos',    element: <AvisosSettingsPage /> },
    { path: 'usuarios',  element: <UsuariosAccesosPage /> },
  ],

  sidebar: {
    items: [
      { id: 'config_locales',  label: 'Locales',            icon: MapPin,  path: 'locales',  requiredPermission: 'show_locations' },
      { id: 'config_marcas',   label: 'Marcas',             icon: Tag,     path: 'marcas',   requiredRole: 'admin' },
      { id: 'config_avisos',   label: 'Avisos',             icon: Bell,    path: 'avisos',   requiredPermission: 'show_tspoon_settings' },
      { id: 'config_usuarios', label: 'Usuarios y accesos', icon: UserCog, path: 'usuarios', requiredRole: 'admin' },
    ],
  },
}
