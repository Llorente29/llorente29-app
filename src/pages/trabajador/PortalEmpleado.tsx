// src/pages/trabajador/PortalEmpleado.tsx
// Submenú del portal del empleado: fichaje, horario, documentos, vacaciones, etc.
// Extraído del antiguo HomeEmpleado para separar la navegación por módulos.

import {
  ArrowLeft, LogIn, LogOut, Calendar, Armchair, RefreshCw,
  Clock, Wallet, FileText, Sun,
  type LucideIcon,
} from 'lucide-react'
import type { Employee } from '../../types'
import { hasOpenShift } from '../../services/fichajeKiosko'

export type PortalSubPage = 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos' | 'cambios'

interface Props {
  employee: Employee
  onNavigate: (page: PortalSubPage) => void
  onBack?: () => void
  showBolsaHoras?: boolean
}

interface MenuItem {
  id: PortalSubPage
  Icon: LucideIcon
  title: string
  desc: string
  color: string
}

export default function PortalEmpleado({ employee, onNavigate, onBack, showBolsaHoras = false }: Props) {
  const open = hasOpenShift(employee)

  const menuItems: MenuItem[] = [
    {
      id: 'fichar',
      Icon: open ? LogOut : LogIn,
      title: open ? 'Fichar SALIDA' : 'Fichar ENTRADA',
      desc: open ? 'Cerrar tu jornada' : 'Empezar tu jornada',
      color: open
        ? 'bg-warning-bg border-warning/30 hover:border-warning'
        : 'bg-accent-bg border-accent/30 hover:border-accent',
    },
    {
      id: 'horario',
      Icon: Calendar,
      title: 'Mi horario',
      desc: 'Tus turnos de la semana',
      color: 'bg-card border-border-default hover:border-accent',
    },
    {
      id: 'turnos',
      Icon: Armchair,
      title: 'Turnos abiertos',
      desc: 'Coger turnos disponibles',
      color: 'bg-card border-border-default hover:border-accent',
    },
    {
      id: 'cambios',
      Icon: RefreshCw,
      title: 'Cambios de turno',
      desc: 'Solicitar y gestionar cambios',
      color: 'bg-card border-border-default hover:border-accent',
    },
    {
      id: 'fichajes',
      Icon: Clock,
      title: 'Mis fichajes',
      desc: 'Historial de tus fichajes',
      color: 'bg-card border-border-default hover:border-accent',
    },
    ...(showBolsaHoras ? [{
      id: 'bolsa' as PortalSubPage,
      Icon: Wallet,
      title: 'Mi bolsa de horas',
      desc: 'Saldo de horas extra/pendientes',
      color: 'bg-card border-border-default hover:border-accent',
    }] : []),
    {
      id: 'documentos',
      Icon: FileText,
      title: 'Mis documentos',
      desc: 'Nóminas, contratos, partes',
      color: 'bg-card border-border-default hover:border-accent',
    },
    {
      id: 'vacaciones',
      Icon: Sun,
      title: 'Mis vacaciones',
      desc: 'Solicitar y consultar saldo',
      color: 'bg-card border-border-default hover:border-accent',
    },
  ]

  return (
    <div className="min-h-screen bg-page pb-8">
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
              aria-label="Volver"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mi Portal</p>
            <p className="font-display text-xl text-accent">{employee.name.split(' ')[0]}</p>
          </div>
        </div>

        {open && (
          <div className="mt-3 bg-success-bg border border-success/30 rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-success font-medium">Tienes una jornada abierta</span>
          </div>
        )}
      </div>

      {/* Menú */}
      <div className="px-4 space-y-3">
        {menuItems.map(item => {
          const Icon = item.Icon
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full p-4 rounded-xl border-2 ${item.color} text-left transition-base active:scale-95`}
            >
              <div className="flex items-center gap-3">
                <Icon size={28} className="text-accent shrink-0" strokeWidth={2} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary">{item.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{item.desc}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
