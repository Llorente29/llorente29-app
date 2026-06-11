// src/shell/ShellTopBar.tsx
//
// TopBar del Shell modular (Bloque G-4, Sprint 3). Patrón "Microsoft 365":
// barra superior azul marino con wordmark Folvy + pestañas (Inicio + módulos
// del registry) + selector de local + notificaciones + avatar.
//
// Diseño aprobado por Julio (Sesión 14): marca azul marino #1E3A5F, wordmark
// Fraunces, sección activa subrayada en terracota #D67442. Proporciones
// validadas en maqueta: barra 68px, isotipo+wordmark inline (no .svg externo,
// para clavar el tamaño), pestañas 15px con aire.
//
// El logo se dibuja INLINE (isotipo SVG + texto) en vez de cargar un fichero
// .svg, para controlar las proporciones al pixel y que coincidan con la maqueta.
//
// Sesión 16: el avatar es un menú desplegable (Administración / Cerrar sesión).
//
// R1.3a (responsive móvil): en < 768px el TopBar es MÍNIMO — sin pestañas de
// módulos (van a la barra inferior) ni etiqueta de local; quedan wordmark +
// engranaje + campana + avatar.
//
// R1.3b: en móvil, los módulos del overflow (ver shellMobileNav; hoy Team) que
// NO caben en la barra inferior se listan en el menú del avatar, para que sigan
// teniendo acceso por toque.

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

const INK = '#1E3A5F'
const CREAM = '#F5F4F0'
const TERRACOTA = '#D67442'
const MUTED = '#9FB3C8'

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
      style={{ background: INK, height: 68, paddingLeft: isMobile ? 16 : 26, paddingRight: isMobile ? 16 : 26, gap: isMobile ? 0 : 34 }}
    >
      {/* Wordmark inline (isotipo + texto), proporciones de maqueta */}
      <div className="flex items-center shrink-0" style={{ gap: 11 }}>
        <svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="38" fill="none" stroke={CREAM} strokeWidth="6" />
          <path d="M 50 12 A 38 38 0 0 1 76.9 76.9" fill="none" stroke={TERRACOTA} strokeWidth="10" strokeLinecap="round" />
          <circle cx="50" cy="50" r="6" fill={TERRACOTA} />
        </svg>
        <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, color: CREAM, fontWeight: 600, letterSpacing: '-0.5px', lineHeight: 1 }}>
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
        {/* Selector de cuenta — EXCLUSIVO platform admin. Marca qué cliente se
            gestiona y permite saltar a otro (va al inicio del nuevo cliente). */}
        {canSwitchAccount && !isMobile && (
          <div className="relative" ref={acctMenuRef}>
            <button
              type="button"
              onClick={() => setAcctMenuOpen(o => !o)}
              className="inline-flex items-center rounded-md"
              style={{ background: 'rgba(255,255,255,0.12)', color: CREAM, fontSize: 14, gap: 6, padding: '6px 10px' }}
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
                style={{ top: 40, minWidth: 240, maxHeight: 360, background: '#fff', border: '1px solid var(--color-border, #e5e5e5)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)', zIndex: 50 }}
              >
                <div style={{ padding: '8px 12px', fontSize: 11, color: '#8a8a8a', borderBottom: '1px solid var(--color-border, #eee)' }}>
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
                      style={{ background: isActive ? 'var(--color-accent-bg, #eef2f7)' : 'transparent', color: isActive ? INK : '#1a1a1a', fontWeight: isActive ? 600 : 400 }}
                    >
                      <Building2 size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      {isActive && <span style={{ fontSize: 10, color: INK }}>actual</span>}
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
            style={{ color: settingsActive ? CREAM : MUTED }}
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
            style={{ width: 34, height: 34, background: TERRACOTA, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
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
                border: '1px solid var(--color-border, #e5e5e5)',
                boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
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
                    style={{ color: 'var(--color-text-primary, #1a1a1a)' }}
                  >
                    <Icon size={16} style={{ color: INK }} />
                    {m.name}
                  </button>
                )
              })}
              {overflowModules.length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border, #eee)' }} />
              )}

              {isPlatformAdmin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={goAdmin}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
                  style={{ color: 'var(--color-text-primary, #1a1a1a)' }}
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
                  style={{ color: 'var(--color-text-primary, #1a1a1a)', borderTop: isPlatformAdmin ? '1px solid var(--color-border, #eee)' : 'none' }}
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
                style={{ color: '#A12626', borderTop: (isPlatformAdmin || (currentEmployeeId && onEnterWorkerMode)) ? '1px solid var(--color-border, #eee)' : 'none' }}
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
        color: active ? CREAM : MUTED,
        borderBottom: active ? `2px solid ${TERRACOTA}` : '2px solid transparent',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
