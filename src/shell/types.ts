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
import type { DrillDestino } from './home/drill'

export type { DrillDestino }

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
  // Clave(s) de permiso (snake_case) requeridas para ver el item. Si está
  // presente, el item solo se renderiza si hasPermission(clave) === true
  // (admin con isFullAccess bypasea automáticamente). Si está ausente, el
  // item es público dentro del módulo (sin gating por permiso granular).
  // Un array exige TODAS las claves (AND) — ej. los márgenes de Ventas
  // necesitan show_ventas_analisis Y show_costes (ENCARGO CODE 14/08).
  requiredPermission?: string | string[]
  // Sección/grupo opcional para agrupar items en la sidebar.
  section?: string
}

export interface ModuleSidebarDefinition {
  items: ModuleSidebarItem[]
}

// ─── Tarjetas del Inicio ───────────────────────────────────────────────────
// INICIO P1 · SUB-LOTE 2 (31/08/2026). Decision de Julio, del RECON del 30/08:
// CATALOGO HIBRIDO CON EL CODIGO COMO VERDAD.
//
// Una tarjeta no es una fila: es un COMPONENTE mas una CONSULTA. La «grafica de
// 14 dias» no se pinta desde un nombre de RPC guardado en una columna. Por eso
// la definicion vive aqui, en el codigo, junto al componente que la sabe
// renderizar, y no puede desincronizarse de si misma.
//
// `home_card_catalog` existe en BBDD, pero es ESPEJO e INTERRUPTOR:
//   · espejo   → se regenera desde este catalogo; sirve para saber que habia.
//   · interruptor → `active`, y `home_card_account` por cuenta.
// Una fila huerfana —existe en BBDD, ya no en codigo— NO SE PINTA. Nunca al
// reves: la BBDD no puede inventar una tarjeta que nadie sabe renderizar.
// Y no se descarta en silencio: `resolverMosaico` la devuelve aparte para que
// la pantalla pueda decirlo (regla 7).

/** Lo que recibe toda tarjeta del Inicio. Nada mas: se busca sus datos sola. */
export interface HomeCardProps {
  accountId: string | null
  /** Local activo, o null en consolidado («todos los locales»). */
  locationId: string | null
  /**
   * Ir a donde lleva esta tarjeta. La tarjeta construye su destino —ruta mas
   * filtros— porque los filtros dependen de SUS datos: el rango de «ventas de
   * ayer» no se sabe hasta que se sabe que dia era ayer.
   *
   * (02/09) Sustituye al `onDrill` sin argumentos, que el Inicio ataba contra
   * `moduleId: 'shell'` — un id que no existe en el registro — y no hacia nada.
   * Ver src/shell/home/drill.ts.
   */
  drillTo?: (destino: DrillDestino) => void
}

export interface HomeCardDefinition {
  /** Clave global y estable. Es la que se guarda en home_layout.cards. */
  key: string
  title: string
  description?: string
  /** Ancho en el mosaico. Coincide con home_card_catalog.size. */
  size: 'sm' | 'md' | 'lg'
  /**
   * A donde lleva al pulsarla, SIN filtros: es el destino estatico, el que el
   * cajon puede enseñar sin renderizar la tarjeta. Los filtros los añade el
   * componente con `drillTo`, porque salen de sus datos.
   * Ausente = esta tarjeta no lleva a ningun sitio y no se pinta pulsable.
   */
  drill?: DrillDestino
  /** De donde sale el dato. INFORMATIVO: quien consulta es el componente. */
  source?: string
  /** Rol minimo. P1: solo `admin` tiene Inicio; `worker` sigue en su portal. */
  requiredRole?: ShellRole
  component: ComponentType<HomeCardProps>
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

  // Tarjetas que este módulo aporta al Inicio (opcional). Añadir una aquí la
  // hace aparecer en el cajón «Personalizar» sin tocar el Inicio: es la
  // verificación 5 del encargo.
  homeCards?: HomeCardDefinition[]

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
