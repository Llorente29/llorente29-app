// src/shell/types.ts
//
// Contratos del Shell modular Folvy (Bloque G, Sprint 3, Sesión 14).
// Define el "Module Contract": la interfaz que todo módulo enchufable
// (Folvy Team, Folvy Safety, Folvy Sales...) debe cumplir para registrarse
// en el Shell.
//
// Referencia de diseño: folvy_arquitectura_reconciliada.md §5 (Module Contract).
//
// G-1: solo definiciones de tipos. No hay implementación de render todavía.

import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

// ─── Roles y planes (re-export ligero para no acoplar) ─────────────────────
// El rol vive en el modelo de multitenancy; aquí solo tipamos el mínimo que
// el Shell necesita para gating de navegación.
export type ShellRole = 'admin' | 'manager' | 'worker'

// ─── Descriptor de evento del EventBus ─────────────────────────────────────
// Un módulo declara qué eventos publica y/o consume. El `key` es el nombre
// canónico del evento (ej. 'personal.employee.created').
export interface EventDescriptor {
  key: string
  description?: string
}

// ─── Definición de la sidebar de un módulo ─────────────────────────────────
// Cada módulo declara su propia navegación interna (ModuleSidebar). El Shell
// la renderiza cuando el módulo está activo.
export interface ModuleSidebarItem {
  id: string
  label: string
  icon: LucideIcon
  // Ruta relativa al basePath del módulo (ej. 'empleados', 'turnos').
  path: string
  // Rol mínimo para ver este item (opcional).
  requiredRole?: ShellRole
  // Clave de permiso (snake_case) requerida para ver el item. Si está
  // presente, el item solo se renderiza si hasPermission(clave) === true
  // (admin con isFullAccess bypasea automáticamente). Si está ausente, el
  // item es público dentro del módulo (sin gating por permiso granular).
  requiredPermission?: string
  // Sección/grupo opcional para agrupar items en la sidebar.
  section?: string
}

export interface ModuleSidebarDefinition {
  items: ModuleSidebarItem[]
}

// ─── Module Contract ───────────────────────────────────────────────────────
// Interfaz que define un módulo enchufable. Ver doc reconciliado §5.1.
export interface ModuleDefinition {
  // Identidad
  id: string                 // 'personal', 'appcc', 'ventas' (técnico, neutro)
  name: string               // 'Folvy Team', 'Folvy Safety' (comercial)
  icon: LucideIcon           // icono para el TopBar
  topBarOrder: number        // posición en el TopBar de módulos

  // Permisos y gating
  requiredRole?: ShellRole   // rol mínimo para ver el módulo
  // requiredPlan se añadirá cuando entre el gating comercial (account_modules).

  // Routing
  basePath: string           // 'personal' → rutas bajo /:slug/personal/*
  routes: RouteObject[]      // rutas internas del módulo (React Router v6)

  // Navegación interna
  sidebar: ModuleSidebarDefinition

  // Eventos (opcional)
  publishes?: EventDescriptor[]
  subscribes?: EventDescriptor[]

  // Settings propios del módulo (opcional, panel en config de cuenta)
  settingsPanel?: ComponentType

  // Lifecycle (opcional)
  onActivate?: (ctx: ShellContext) => Promise<void> | void
  onDeactivate?: (ctx: ShellContext) => Promise<void> | void
}

// ─── ShellContext ──────────────────────────────────────────────────────────
// Contexto que el Shell expone a los módulos en sus hooks de lifecycle.
// Mínimo en G-1; se ampliará cuando se cablee el render (G-4+).
export interface ShellContext {
  accountId: string | null
  slug: string
  role: ShellRole | null
}
