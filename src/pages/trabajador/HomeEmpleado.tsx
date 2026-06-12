// src/pages/trabajador/HomeEmpleado.tsx
// Pantalla de inicio del trabajador: botones grandes para cada módulo.
// Diseño preparado para añadir más módulos (Stock, etc.)
//
// Reskin (Pieza 2): banda superior navy (coherente con el Folvy de gestión),
// sin gradientes. Tarjetas de módulo planas en marca (card + icono de color).
// NO cambia lógica, props ni navegación: solo el aspecto.

import { useEffect, useState } from 'react'
import { Leaf, User, LogOut, AlertCircle, ArrowLeft, ChevronRight, LogIn, Clock } from 'lucide-react'
import type { Employee } from '../../types'
import { hasOpenShift } from '../../services/fichajeKiosko'
import NotificationBell from '../../components/NotificationBell'
import { supabase } from '../../lib/supabase'
import InstallAppButton from '../../components/InstallAppButton'

export type WorkerModule = 'appcc' | 'portal' | 'fichar'

interface Props {
  employee: Employee
  onNavigate: (module: WorkerModule) => void
  onLogout: () => void
  /** Etiquetado del botón de salida. 'logout' (default): icono LogOut + aria
   *  "Salir", semántica cerrar sesión (worker puro). 'back-to-management':
   *  icono ArrowLeft + texto visible "Volver a gestión" (encargado dual). El
   *  onClick es onLogout en ambos casos: el caller decide qué hace. */
  exitLabel?: 'logout' | 'back-to-management'
  /** Número de checklists APPCC pendientes hoy para este empleado */
  appccPendingCount?: number
}

interface ModuleButton {
  id: WorkerModule
  icon: typeof Leaf
  title: string
  desc: string
  /** Color del icono y del fondo suave del círculo (clases Tailwind). */
  iconColor: string
  iconBg: string
  badge?: number
  badgeColor?: string
}

export default function HomeEmpleado({ employee, onNavigate, onLogout, exitLabel = 'logout', appccPendingCount = 0 }: Props) {
  const open = hasOpenShift(employee)
  const [showAppcc, setShowAppcc] = useState(false)

  // Verificar si el local del empleado tiene APPCC configurado
  useEffect(() => {
    if (!supabase || !employee.locationId) return
    let cancel = false
    supabase
      .from('appcc_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', employee.locationId)
      .eq('is_active', true)
      .then(({ count }) => {
        if (!cancel) setShowAppcc((count ?? 0) > 0)
      })
    return () => { cancel = true }
  }, [employee.locationId])

  const modules: ModuleButton[] = [
    ...(showAppcc ? [{
      id: 'appcc' as WorkerModule,
      icon: Leaf,
      title: 'APPCC',
      desc: appccPendingCount > 0
        ? `${appccPendingCount} control${appccPendingCount > 1 ? 'es' : ''} pendiente${appccPendingCount > 1 ? 's' : ''}`
        : 'Controles del día',
      iconColor: 'text-success',
      iconBg: 'bg-success-bg',
      badge: appccPendingCount > 0 ? appccPendingCount : undefined,
      badgeColor: 'bg-danger',
    }] : []),
    {
      id: 'portal',
      icon: User,
      title: 'Mi Portal',
      desc: 'Fichajes, horario, documentos, vacaciones',
      iconColor: 'text-accent',
      iconBg: 'bg-accent-bg',
    },
    // Preparado para más módulos:
    // { id: 'stock', icon: Package, title: 'Stock', desc: 'Recuentos y recepciones', iconColor: '...', iconBg: '...' },
  ]

  const now = new Date()
  const greeting = now.getHours() < 14 ? 'Buenos días' : now.getHours() < 21 ? 'Buenas tardes' : 'Buenas noches'

  // Hora de inicio de la jornada abierta (la entrada más reciente sin salida).
  const openSince: Date | null = open
    ? (() => {
        const entries = employee.clockEntries || []
        const sorted = [...entries].sort((a, b) =>
          new Date(b.datetime).getTime() - new Date(a.datetime).getTime(),
        )
        return sorted[0]?.type === 'entrada' ? new Date(sorted[0].datetime) : null
      })()
    : null

  // Cronómetro vivo: re-render cada minuto mientras haya jornada abierta.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!openSince) return
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [openSince])

  function elapsedLabel(): string {
    if (!openSince) return ''
    const mins = Math.max(0, Math.floor((nowTick - openSince.getTime()) / 60_000))
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className="min-h-screen bg-page flex flex-col">
      {/* Banda superior navy (coherente con el Folvy de gestión) */}
      <div className="bg-accent px-5 pt-6 pb-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/65">{greeting}</p>
            <p className="font-display text-2xl text-white mt-0.5 truncate">{employee.name.split(' ')[0]}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <NotificationBell employeeId={employee.id} />
            {exitLabel === 'back-to-management' ? (
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-xs font-medium text-white hover:bg-white/20 transition-base"
                aria-label="Volver a gestión"
              >
                <ArrowLeft size={14} />
                Volver a gestión
              </button>
            ) : (
              <button
                onClick={onLogout}
                className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-base"
                aria-label="Salir"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Bloque de fichaje de primera clase (adaptativo segun estado) */}
      <div className="px-5 pt-4">
        {open ? (
          <div className="w-full rounded-2xl bg-card border border-border-default shadow-sm p-5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
              <span className="text-sm font-medium text-success">Jornada en curso</span>
            </div>
            <p className="font-display text-3xl text-text-primary mt-1.5 leading-none">
              {elapsedLabel()}
            </p>
            {openSince && (
              <p className="text-xs text-text-secondary mt-1 inline-flex items-center gap-1">
                <Clock size={12} /> Entrada a las {openSince.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            <button
              onClick={() => onNavigate('fichar')}
              className="mt-4 w-full py-3.5 rounded-xl border border-terracota text-terracota bg-terracota-bg font-semibold inline-flex items-center justify-center gap-2 transition-base active:scale-[0.98] hover:bg-terracota hover:text-white"
            >
              <LogOut size={18} /> Fichar salida
            </button>
          </div>
        ) : (
          <button
            onClick={() => onNavigate('fichar')}
            className="w-full rounded-2xl bg-terracota text-white shadow-sm p-5 flex items-center gap-4 text-left transition-base active:scale-[0.98] hover:bg-terracota-hover"
          >
            <span className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <LogIn size={28} />
            </span>
            <span>
              <span className="block font-display text-xl font-medium">Fichar entrada</span>
              <span className="block text-sm text-white/85 mt-0.5">Toca para empezar tu jornada</span>
            </span>
          </button>
        )}
      </div>

      {/* Instalar la app en el móvil (PWA) — banner discreto */}
      <div className="px-5 pt-4">
        <InstallAppButton />
      </div>

      {/* Alerta APPCC grande cuando hay tareas pendientes */}
      {showAppcc && appccPendingCount > 0 && (
        <div className="px-5 pt-4">
          <button
            onClick={() => onNavigate('appcc')}
            className="w-full p-4 rounded-xl bg-warning-bg border-2 border-warning/40 text-left transition-base active:scale-[0.98] hover:border-warning"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
                <AlertCircle size={24} className="text-warning" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-warning text-base">
                  {appccPendingCount} control{appccPendingCount > 1 ? 'es' : ''} APPCC pendiente{appccPendingCount > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-warning/80 mt-0.5">Pulsa aquí para completarlos</p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Botones de módulos — tarjetas planas en marca */}
      <div className="flex-1 px-5 pt-4 pb-8">
        <div className={`grid gap-4 ${modules.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {modules.map(mod => {
            const Icon = mod.icon
            return (
              <button
                key={mod.id}
                onClick={() => onNavigate(mod.id)}
                className="relative flex flex-col items-start text-left p-5 rounded-2xl bg-card border border-border-default shadow-sm hover:shadow-md hover:border-accent transition-base active:scale-95 min-h-[160px] overflow-hidden"
              >
                <div className={`w-14 h-14 rounded-full ${mod.iconBg} flex items-center justify-center`}>
                  <Icon size={28} strokeWidth={2} className={mod.iconColor} />
                </div>
                <div className="mt-auto pt-4">
                  <p className="text-lg font-bold text-text-primary">{mod.title}</p>
                  <p className="text-xs text-text-secondary mt-1">{mod.desc}</p>
                </div>
                <ChevronRight size={18} className="absolute bottom-5 right-5 text-text-secondary" />
                {/* Badge */}
                {mod.badge && (
                  <span className={`absolute top-4 right-4 min-w-[28px] h-7 px-2 ${mod.badgeColor ?? 'bg-danger'} text-white rounded-full text-sm font-bold flex items-center justify-center`}>
                    {mod.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-text-secondary pb-4">Folvy · Restauración Profesional</p>
    </div>
  )
}
