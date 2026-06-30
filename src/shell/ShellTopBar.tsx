// src/shell/ShellTopBar.tsx
//
// TopBar del Shell modular. Rebrand 30/06/2026 — dirección "instrumento":
// barra superior CLARA (blanco + hairline) con el logo "El ciclo" (anillo tinta
// + punto de margen verde), wordmark Space Grotesk, y pestañas en tinta con
// subrayado tinta en la activa. Sustituye a la barra azul marino anterior.
//
// El logo se dibuja INLINE (anillo SVG + texto) para clavar proporciones.
//
// Lógica intacta respecto a la versión anterior: menú de avatar (Administración
// / Ver como trabajador / Cerrar sesión), selector de cuenta (platform admin),
// selector de local, notificaciones, comportamiento móvil (R1.3a/b).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Home, MapPin, Settings, Shield, LogOut, User, Building2, ChevronDown } from 'lucide-react'
import { getOrderedModules } from './moduleRegistry'
import { useIsMobile } from './useIsMobile'
import { isMobileOverflowModule } from './shellMobileNav'
import LocationSelector from '../modules/multitenancy/components/LocationSelector'
import { usePlatformAdmin } from '@/platform/usePlatformAdmin'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import { signOut } from '@/services/authService'
import NotificationBell from '@/components/NotificationBell'
import { configuracionModule } from '@/modules/configuracion/module'
import type { ModuleDefinition } from './types'
import type { UserProfileRole, Account } from '@/types/multitenancy'

// Clave especial del Home general (no es un módulo, es del Shell).
export const HOME_KEY = '__home__'

// Marca nueva: barra clara, acento de acción en tinta, punto de margen verde.
const INK = '#15171A'        // texto/estructura, pestaña activa, avatar
const MUTED = '#6B7077'      // texto inactivo (gris frío)
const BAR_BG = '#FFFFFF'     // fondo de la barra (claro)
const BORDER = '#E9EBED'     // hairline inferior
const GREEN = '#1F9D6B'      // punto de margen del logo
const PILL_BG = '#F1F2F4'    // fondo de pastilla (selector de cuenta)
const DANGER = '#E0492E'     // cerrar sesión

interface ShellTopBarProps {
  activeKey: string
  onSelect: (key: string) => void
  onOpenSettings?: () => void
  settingsActive?: boolean
  userInitials?: string
  /** employee_id del user logueado. null = admin sin employee vinculado;
   *  la campana se esconde. */
  currentEmployeeId?: string | null
  /** Callback opcional para entrar en modo trabajador. Solo se cablea cuando
   *  el user es encargado dual (tiene employee_id). Si no se pasa, el item
   *  "Ver como trabajador" del menú no se renderiza. */
  onEnterWorkerMode?: () => void
  /** Cuenta activa (para mostrar a platform admin qué cliente gestiona). */
  activeAccount?: Account | null
  /** Lista de cuentas a las que saltar (solo se usa si es platform admin). */
  accounts?: Account[]
  /** Cambia la cuenta activa y va al inicio. Solo se cablea para platform admin. */
  onSwitchAccount?: (accountId: string) => void
}

/**
 * ¿Es visible un módulo para el user actual? Criterio: tiene al menos un
 * item de sidebar que pasa los gates de permiso Y rol.
 */
function isModuleVisible(
  module: ModuleDefinition,
  hasPermission: (key: string) => boolean,
  role: UserProfileRole | null,
): boolean {
  const items = module.sidebar?.items
  if (!items || items.length === 0) return false
  return items.some(item => {
    const passesPermission = !item.requiredPermission || hasPermission(item.requiredPermission)
    const passesRole = !item.requiredRole || role === item.requiredRole || role === 'admin'
    return passesPermission && passesRole
  })
}

export default function ShellTopBar({
  activeKey,
  onSelect,
  onOpenSettings,
  settingsActive = false,
  userInitials = 'JG',
  currentEmployeeId = null,
  onEnterWorkerMode,
  activeAccount = null,
  accounts = [],
  onSwitchAccount,
}: ShellTopBarProps) {
  const modules = getOrderedModules()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { isPlatformAdmin } = usePlatformAdmin()
  const { hasPermission, role } = usePermissions()

  // Selector de cuenta: SOLO para platform admin (acceso exclusivo de staff).
  const canSwitchAccount = isPlatformAdmin && !!onSwitchAccount && accounts.length > 0
  const [acctMenuOpen, setAcctMenuOpen] = useState(false)
  const acctMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!acctMenuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (acctMenuRef.current && !acctMenuRef.current.contains(e.target as Node)) {
        setAcctMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [acctMenuOpen])

  // Pestañas: solo los módulos con al menos un item visible. "Inicio" queda
  // fuera (es del Shell, no un módulo, y siempre se ve).
  const visibleModules = modules.filter(m => isModuleVisible(m, hasPermission, role))
  // R1.3b: en móvil, los módulos del overflow (Team) se listan en el menú del
  // avatar (no caben en la barra inferior por el héroe IA central).
  const overflowModules = isMobile ? visibleModules.filter(m => isMobileOverflowModule(m.id)) : []
  // Engranaje: solo si Configuración tiene al menos un item visible.
  const configVisible = isModuleVisible(configuracionModule, hasPermission, role)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Cerrar el menú al hacer clic fuera.
  useEffect(() => {
    if (!menuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  function goAdmin() {
    setMenuOpen(false)
    navigate('/_admin/inicio')
  }

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    // Tras cerrar sesión, App.tsx detectará !authUserId y renderizará el login.
    navigate('/login')
  }

  return (
    <header
      className="flex items-center shrink-0"
      style={{ background: BAR_BG, height: 64, borderBottom: `1px solid ${BORDER}`, paddingLeft: isMobile ? 16 : 26, paddingRight: isMobile ? 16 : 26, gap: isMobile ? 0 : 34 }}
    >
      {/* Logo "El ciclo" inline (anillo tinta + punto de margen verde) + wordmark */}
      <div className="flex items-center shrink-0" style={{ gap: 11 }}>
        <svg width="30" height="30" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M42.5 13.8 A21 21 0 1 1 21.5 13.8" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <circle cx="32" cy="11" r="6" fill={GREEN} />
        </svg>
        <span style={{ fontFamily: '"Space Grotesk", Inter, sans-serif', fontSize: 26, color: INK, fontWeight: 600, letterSpacing: '-1px', lineHeight: 1 }}>
          folvy
        </span>
      </div>

      {/* Pestañas: Inicio + módulos. En móvil se ocultan: viven en la barra
          inferior (ShellBottomNav). */}
      {!isMobile && (
        <nav className="flex items-stretch self-stretch" style={{ gap: 4 }}>
          <TabButton
            label="Inicio"
            icon={<Home size={18} />}
            active={activeKey === HOME_KEY}
            onClick={() => onSelect(HOME_KEY)}
          />
          {visibleModules.map(m => {
            const Icon = m.icon
            return (
              <TabButton
                key={m.id}
                label={m.name}
                icon={<Icon size={18} />}
                active={activeKey === m.id}
                onClick={() => onSelect(m.id)}
              />
            )
          })}
        </nav>
      )}

      {/* Lado derecho: selector de cuenta (solo staff), local, notificaciones, avatar */}
      <div className="flex items-center shrink-0" style={{ marginLeft: 'auto', gap: 16 }}>
        {/* Selector de cuenta — EXCLUSIVO platform admin. */}
        {canSwitchAccount && !isMobile && (
          <div className="relative" ref={acctMenuRef}>
            <button
              type="button"
              onClick={() => setAcctMenuOpen(o => !o)}
              className="inline-flex items-center rounded-md"
              style={{ background: PILL_BG, color: INK, fontSize: 14, gap: 6, padding: '6px 10px' }}
            >
              <Building2 size={15} />
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeAccount?.name ?? 'Cuenta'}
              </span>
              <ChevronDown size={14} style={{ transform: acctMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {acctMenuOpen && (
              <div
                className="absolute right-0 rounded-lg overflow-auto"
                style={{ top: 40, minWidth: 240, maxHeight: 360, background: '#fff', border: `1px solid ${BORDER}`, boxShadow: '0 6px 24px rgba(21,23,26,0.10)', zIndex: 50 }}
              >
                <div style={{ padding: '8px 12px', fontSize: 11, color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                  Cambiar de cliente
                </div>
                {accounts.map(a => {
                  const isActive = a.id === activeAccount?.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { setAcctMenuOpen(false); onSwitchAccount!(a.id) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left"
                      style={{ background: isActive ? PILL_BG : 'transparent', color: INK, fontWeight: isActive ? 600 : 400 }}
                    >
                      <Building2 size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      {isActive && <span style={{ fontSize: 10, color: MUTED }}>actual</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {!isMobile && (
          <span className="inline-flex items-center" style={{ color: MUTED, fontSize: 14, gap: 5 }}>
            <MapPin size={16} />
            <LocationSelector />
          </span>
        )}
        {configVisible && (
          <button
            type="button"
            aria-label="Configuración"
            onClick={onOpenSettings}
            className="inline-flex items-center"
            style={{ color: settingsActive ? INK : MUTED }}
          >
            <Settings size={19} />
          </button>
        )}
        {currentEmployeeId && <NotificationBell employeeId={currentEmployeeId} />}

        {/* Avatar con menú desplegable */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="Menú de usuario"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
            className="rounded-full flex items-center justify-center text-white shrink-0"
            style={{ width: 34, height: 34, background: INK, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            {userInitials}
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 rounded-lg overflow-hidden"
              style={{
                top: 44,
                minWidth: 200,
                background: '#fff',
                border: `1px solid ${BORDER}`,
                boxShadow: '0 6px 24px rgba(21,23,26,0.10)',
                zIndex: 50,
              }}
            >
              {/* R1.3b: módulos del overflow móvil (no caben en la barra). */}
              {overflowModules.map(m => {
                const Icon = m.icon
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); onSelect(m.id) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
                    style={{ color: INK }}
                  >
                    <Icon size={16} style={{ color: INK }} />
                    {m.name}
                  </button>
                )
              })}
              {overflowModules.length > 0 && (
                <div style={{ borderTop: `1px solid ${BORDER}` }} />
              )}

              {isPlatformAdmin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={goAdmin}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
                  style={{ color: INK }}
                >
                  <Shield size={16} style={{ color: INK }} />
                  Administración
                </button>
              )}
              {currentEmployeeId && onEnterWorkerMode && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onEnterWorkerMode() }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
                  style={{ color: INK, borderTop: isPlatformAdmin ? `1px solid ${BORDER}` : 'none' }}
                >
                  <User size={16} style={{ color: INK }} />
                  Ver como trabajador
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
                style={{ color: DANGER, borderTop: (isPlatformAdmin || (currentEmployeeId && onEnterWorkerMode)) ? `1px solid ${BORDER}` : 'none' }}
              >
                <LogOut size={16} />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// ─── Botón de pestaña del TopBar ───────────────────────────────────────────
function TabButton({
  label, icon, active, onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center transition-colors"
      style={{
        gap: 8,
        paddingLeft: 16,
        paddingRight: 16,
        fontSize: 15,
        fontWeight: active ? 500 : 400,
        color: active ? INK : MUTED,
        borderBottom: active ? `2px solid ${INK}` : '2px solid transparent',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
