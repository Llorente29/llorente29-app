// src/modules/personal/module.tsx
//
// ModuleDefinition del módulo Personal (Folvy Team) — Bloque G-8.4, Sprint 3.
//
// Referencia: folvy_arquitectura_reconciliada.md §6 (Personal = 'personal' /
// display 'Folvy Team').
//
// NOTA DE RUTAS (importante): en la app actual las páginas de Personal NO
// comparten un prefijo común (viven en /:slug/fichajes-global, /:slug/calendario,
// etc., sin un /personal/ delante — ver src/routes.ts PAGE_TO_PATH). Para el
// Shell modular, las agrupamos bajo el basePath 'personal' con paths relativos
// nuevos (/shell/personal/<path>). Esto NO cambia las rutas de la app vieja
// (que sigue activa hasta G-8.6); es la estructura limpia del Shell. La
// unificación definitiva de URLs se hará en el cambio de default (G-8.6).
//
// Fichero .tsx porque los `element` de las rutas son JSX.

import {
  Users, Activity, Clock, Smartphone, Inbox, Armchair,
  RefreshCw, Calendar, FolderOpen, FileText, Wallet, BarChart3, Receipt,
} from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import StaffPage from '@/pages/StaffPage'
import FichajesGlobalPage from '@/pages/FichajesGlobalPage'
import KioskoFichajePage from '@/pages/KioskoFichajePage'
import SolicitudesPendientesPage from '@/pages/SolicitudesPendientesPage'
import AhoraMismoPage from '@/pages/AhoraMismoPage'
import TurnosAbiertosPage from '@/pages/TurnosAbiertosPage'
import CambiosPendientesPage from '@/pages/CambiosPendientesPage'
import CalendarioPage from '@/pages/CalendarioPage'
import PlantillaTurnosPage from '@/pages/PlantillaTurnosPage'
import InformesPage from '@/pages/InformesPage'
import InformesTeamPage from '@/pages/InformesTeamPage'
import NominasPage from '@/pages/NominasPage'
import BolsaHorasPage from '@/pages/BolsaHorasPage'

export const personalModule: ModuleDefinition = {
  id: 'personal',
  name: 'Folvy Team',
  icon: Users,
  topBarOrder: 1,
  requiredRole: 'manager',

  basePath: 'personal',
  routes: [
    { path: '',                 element: <StaffPage /> },
    { path: 'ahora-mismo',      element: <AhoraMismoPage /> },
    { path: 'control-horario',  element: <FichajesGlobalPage /> },
    { path: 'kiosko',           element: <KioskoFichajePage /> },
    { path: 'solicitudes',      element: <SolicitudesPendientesPage /> },
    { path: 'turnos-abiertos',  element: <TurnosAbiertosPage /> },
    { path: 'cambios',          element: <CambiosPendientesPage /> },
    { path: 'calendario',       element: <CalendarioPage /> },
    { path: 'plantilla-turnos', element: <PlantillaTurnosPage /> },
    { path: 'informes-analitica', element: <InformesTeamPage /> },
    { path: 'nominas',          element: <NominasPage /> },
    { path: 'informes',         element: <InformesPage /> },
    { path: 'bolsa-horas',      element: <BolsaHorasPage /> },
  ],

  sidebar: {
    items: [
      { id: 'personal_staff',        label: 'Empleados',         icon: Users,      path: '',                    requiredPermission: 'show_staff' },
      { id: 'personal_ahora',        label: 'Ahora mismo',       icon: Activity,   path: 'ahora-mismo',         requiredPermission: 'show_ahora_mismo' },
      { id: 'personal_horario',      label: 'Control horario',   icon: Clock,      path: 'control-horario',     requiredPermission: 'show_fichajes_global' },
      { id: 'personal_kiosko',       label: 'Kiosko fichaje',    icon: Smartphone, path: 'kiosko',              requiredPermission: 'show_kiosko_fichaje' },
      { id: 'personal_solicitudes',  label: 'Solicitudes',       icon: Inbox,      path: 'solicitudes',         requiredPermission: 'show_solicitudes_pendientes' },
      { id: 'personal_turnos',       label: 'Turnos abiertos',   icon: Armchair,   path: 'turnos-abiertos',     requiredPermission: 'show_turnos_abiertos' },
      { id: 'personal_cambios',      label: 'Cambios de turno',  icon: RefreshCw,  path: 'cambios',             requiredPermission: 'show_cambios_pendientes' },
      { id: 'personal_calendario',   label: 'Calendario',        icon: Calendar,   path: 'calendario',          requiredPermission: 'show_calendario' },
      { id: 'personal_plantilla',    label: 'Plantilla turnos',  icon: FolderOpen, path: 'plantilla-turnos',    requiredPermission: 'show_plantilla_turnos' },
      { id: 'personal_informes_team', label: 'Informes',         icon: BarChart3,  path: 'informes-analitica',  requiredPermission: 'show_informes_personal' },
      { id: 'personal_nominas',      label: 'Nóminas',           icon: Receipt,    path: 'nominas',             requiredPermission: 'show_informes_personal' },
      { id: 'personal_informes',     label: 'Informes Gestoría', icon: FileText,   path: 'informes',            requiredPermission: 'show_informes_personal' },
      { id: 'personal_bolsa',        label: 'Bolsa de horas',    icon: Wallet,     path: 'bolsa-horas',         requiredPermission: 'show_bolsa_horas' },
    ],
  },

  publishes: [
    { key: 'personal.employee.created', description: 'Se ha creado un empleado' },
    { key: 'personal.clock.in',         description: 'Un empleado ha fichado' },
  ],
}
