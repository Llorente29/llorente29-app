// src/components/Sidebar.tsx
// Sidebar separado de App.tsx para mejor mantenimiento.
// - Paleta nueva: accent, accent-bg, border-default, text-secondary
// - Iconos Lucide React reemplazando emojis
// - Secciones colapsables con persistencia en localStorage
// - Auto-expand si la página activa está en una sección colapsada
//
// BLOQUE C Fases 2-3 (17/05/2026):
//   - Eliminadas props `page` y `setPage`.
//   - Página activa derivada de la URL con useLocation + pathToPage.
//   - Items renderizados como <Link to={pageToRoute(item.id, slug)}>.
//   - Cierre del drawer móvil al pulsar un item (preservado del onClick del Link).

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Page } from '../types'
import Logo, { LogoSquare } from './Logo'
import { parseRoute, pathToPage, pageToRoute } from '../routes'
import { useActiveAccount } from '../modules/multitenancy/hooks/useActiveAccount'
import {
  LayoutDashboard, Users, Activity, Clock, Smartphone, Inbox, Armchair,
  RefreshCw, Calendar, FolderOpen, FileText, Wallet, BarChart3, Brain,
  Bike, Leaf, AlertTriangle, ClipboardCheck, Settings, MapPin, Bell,
  Tag, ChevronDown, ChevronRight, X,
  type LucideIcon,
} from 'lucide-react'

// =============================================================
//   NAV: items del menú lateral con iconos Lucide
// =============================================================
export const NAV: { id: Page; label: string; Icon: LucideIcon; section?: string; roleRequired?: 'admin' }[] = [
  { id: 'dashboard',              label: 'Dashboard',           Icon: LayoutDashboard },
  { id: 'staff',                  label: 'Personal',            Icon: Users, section: 'Personal' },
  { id: 'ahora_mismo',            label: 'Ahora mismo',         Icon: Activity },
  { id: 'fichajes_global',        label: 'Control Horario',     Icon: Clock },
  { id: 'kiosko_fichaje',         label: 'Kiosko Fichaje',      Icon: Smartphone },
  { id: 'solicitudes_pendientes', label: 'Solicitudes',         Icon: Inbox },
  { id: 'turnos_abiertos',        label: 'Turnos abiertos',     Icon: Armchair },
  { id: 'cambios_pendientes',     label: 'Cambios de turno',    Icon: RefreshCw },
  { id: 'calendario',             label: 'Calendario',          Icon: Calendar },
  { id: 'plantilla_turnos',       label: 'Plantilla turnos',    Icon: FolderOpen },
  { id: 'informes_personal',      label: 'Informes Gestoría',   Icon: FileText },
  { id: 'bolsa_horas',            label: 'Bolsa de horas',      Icon: Wallet },
  { id: 'ventas_analisis',        label: 'Análisis de Ventas',  Icon: BarChart3, section: 'Ventas' },
  { id: 'prediccion_personal',    label: 'Predicción Personal', Icon: Brain },
  { id: 'zonas_pedido',           label: 'Zonas de Pedido',     Icon: Bike },
  { id: 'brands',                 label: 'Marcas',              Icon: Tag, section: 'Stock', roleRequired: 'admin' },
  { id: 'appcc_dashboard',        label: 'APPCC: Dashboard',    Icon: BarChart3, section: 'APPCC' },
  { id: 'appcc_today',            label: 'APPCC: Hoy',          Icon: Leaf },
  { id: 'appcc_incidents',        label: 'APPCC: Incidencias',  Icon: AlertTriangle },
  { id: 'appcc_audits',           label: 'APPCC: Auditorías',   Icon: ClipboardCheck },
  { id: 'appcc_audit_templates',  label: 'APPCC: Plantillas Auditoría', Icon: FolderOpen, roleRequired: 'admin' },
  { id: 'appcc_reports',          label: 'APPCC: Informes',     Icon: FileText },
  { id: 'appcc_templates',        label: 'APPCC: Plantillas',   Icon: FolderOpen },
  { id: 'appcc_onboarding',       label: 'APPCC: Configurar',   Icon: Settings, roleRequired: 'admin' },
  { id: 'locations',              label: 'Locales',             Icon: MapPin, section: 'Configuración' },
  { id: 'avisos_settings',        label: 'Avisos',              Icon: Bell },
]

// Secciones por defecto desplegadas (al primer load del usuario)
const DEFAULT_EXPANDED: string[] = ['Personal']
const STORAGE_KEY = 'sidebar:expanded_sections'

// =============================================================
//   Componente Sidebar
// =============================================================
export default function Sidebar({
  collapsed, setCollapsed, visiblePageIds,
  isMobile, mobileOpen, onCloseMobile,
}: {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  visiblePageIds: Set<Page>
  isMobile: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
}) {
  // ---------- Página activa derivada de la URL ----------
  const location = useLocation()
  const { rest } = parseRoute(location.pathname)
  const page: Page = pathToPage(rest)

  // ---------- Slug de cuenta activa para los <Link> ----------
  const { activeAccount } = useActiveAccount()
  const slug = activeAccount?.slug ?? 'foodint'

  const [pendingVacations, setPendingVacations] = useState(0)
  const [pendingSwaps, setPendingSwaps] = useState(0)

  // ---------- Estado de secciones expandidas ----------
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set(DEFAULT_EXPANDED)
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const arr = JSON.parse(stored)
        if (Array.isArray(arr)) return new Set(arr)
      }
    } catch { /* ignore */ }
    return new Set(DEFAULT_EXPANDED)
  })

  // Persistir en localStorage cuando cambia
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...expandedSections]))
    } catch { /* ignore */ }
  }, [expandedSections])

  // ---------- NAV filtrado y agrupado por sección ----------
  const visibleNav = useMemo(
    () => NAV.filter(item => visiblePageIds.has(item.id)),
    [visiblePageIds]
  )

  // Agrupa items en secciones. El primer bloque (sin section) son items "huérfanos" arriba (Dashboard).
  type Group = { section: string | null; items: typeof visibleNav }
  const groups = useMemo<Group[]>(() => {
    const result: Group[] = []
    let currentSection: string | null = null
    for (const item of visibleNav) {
      if (item.section) currentSection = item.section
      const lastGroup = result[result.length - 1]
      if (lastGroup && lastGroup.section === currentSection) {
        lastGroup.items.push(item)
      } else {
        result.push({ section: currentSection, items: [item] })
      }
    }
    return result
  }, [visibleNav])

  // ---------- Auto-expand de la sección que contiene la página activa ----------
  useEffect(() => {
    const groupOfActive = groups.find(g => g.items.some(it => it.id === page))
    if (groupOfActive?.section && !expandedSections.has(groupOfActive.section)) {
      setExpandedSections(prev => new Set([...prev, groupOfActive.section as string]))
    }
    // No incluir expandedSections en deps para evitar bucles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, groups])

  // ---------- Cargar conteos de pendientes (vacaciones, cambios) ----------
  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const mod = await import('../services/vacationsService')
        const list = await mod.fetchPendingVacations()
        if (!cancel) setPendingVacations((list || []).length)
      } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 30000)
    return () => { cancel = true; clearInterval(id) }
  }, [])

  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const mod = await import('../services/shiftSwapService')
        const list = await mod.listPendingForManager()
        if (!cancel) setPendingSwaps((list || []).length)
      } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 30000)
    return () => { cancel = true; clearInterval(id) }
  }, [])

  const badge = (id: Page) =>
    id === 'solicitudes_pendientes' ? pendingVacations
    : id === 'cambios_pendientes' ? pendingSwaps
    : 0

  function toggleSection(section: string) {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  function handleItemClick() {
    if (isMobile) onCloseMobile()
  }

  // ---------- Clases del aside ----------
  const widthClass = collapsed && !isMobile ? 'w-[64px]' : 'w-[280px] lg:w-56'
  const translateClass = isMobile
    ? (mobileOpen ? 'translate-x-0' : '-translate-x-full')
    : 'translate-x-0'
  const ariaHidden = isMobile && !mobileOpen
  const inert = ariaHidden ? true : undefined

  const showLabels = !collapsed || isMobile

  return (
    <aside
      inert={inert}
      className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-card border-r border-border-default transition-transform duration-base ease-out ${widthClass} ${translateClass}`}
      aria-hidden={ariaHidden}
    >
      {/* ---------- Header del sidebar ---------- */}
      <div className={`h-14 flex items-center border-b border-border-default shrink-0 ${collapsed && !isMobile ? 'px-3.5 justify-center' : 'px-4'}`}>
        {showLabels ? (
          <Logo size="md" variant="transparent" className="[&>img]:h-14 flex-1 !justify-start" />
        ) : (
          <LogoSquare size={32} />
        )}
        {isMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Cerrar menú"
            className="ml-auto p-2 rounded-md text-text-secondary hover:bg-page hover:text-text-primary"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* ---------- Nav: secciones colapsables ---------- */}
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {groups.map((group, gIdx) => {
          const isExpanded = group.section ? expandedSections.has(group.section) : true
          const headerKey = group.section || `__top-${gIdx}`

          return (
            <div key={headerKey}>
              {/* Header clickable de sección (solo si tiene section) */}
              {group.section && showLabels && (
                <button
                  type="button"
                  onClick={() => toggleSection(group.section as string)}
                  className="w-full flex items-center justify-between gap-2 px-2 pt-3 pb-1 text-xs font-semibold text-text-secondary uppercase tracking-widest hover:text-text-primary transition-colors"
                >
                  <span>{group.section}</span>
                  {isExpanded
                    ? <ChevronDown size={14} className="opacity-60" />
                    : <ChevronRight size={14} className="opacity-60" />
                  }
                </button>
              )}
              {group.section && !showLabels && <div className="border-t border-border-default my-1.5 mx-1" />}

              {/* Items de la sección (solo si expandida) */}
              {isExpanded && group.items.map(item => {
                const isActive = page === item.id
                const b = badge(item.id)
                const Icon = item.Icon
                return (
                  <Link
                    key={item.id}
                    to={pageToRoute(item.id, slug)}
                    title={!showLabels ? item.label : undefined}
                    onClick={handleItemClick}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-sm font-medium transition-base ${
                      isActive
                        ? 'bg-accent-bg text-accent'
                        : 'text-text-secondary hover:bg-page hover:text-text-primary'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Icon size={18} strokeWidth={2} />
                      {b > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-danger text-text-on-accent text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                          {b}
                        </span>
                      )}
                    </span>
                    {showLabels && <span className="truncate">{item.label}</span>}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* ---------- Botón contraer (solo desktop) ---------- */}
      {!isMobile && (
        <div className="p-2 border-t border-border-default">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-md text-xs text-text-secondary hover:bg-page hover:text-text-primary transition-base"
          >
            {collapsed
              ? <ChevronRight size={14} />
              : <>
                  <ChevronDown size={14} className="-rotate-90" />
                  <span>Contraer</span>
                </>
            }
          </button>
        </div>
      )}
    </aside>
  )
}
