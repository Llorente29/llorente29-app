// src/pages/trabajador/HomeEmpleado.tsx
import {
  LogIn,
  LogOut,
  Calendar,
  Armchair,
  RefreshCw,
  Clock,
  Wallet,
  FileText,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import type { Employee } from '../../types'
import { hasOpenShift } from '../../services/fichajeKiosko'
import NotificationBell from '../../components/NotificationBell'

type SubPage = 'home' | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos' | 'cambios'

interface Props {
  employee: Employee
  onNavigate: (page: SubPage) => void
  onLogout: () => void
  showBolsaHoras?: boolean
}

interface MenuItem {
  id: SubPage
  Icon: LucideIcon
  title: string
  desc: string
  color: string
  enabled: boolean
}

export default function HomeEmpleado({ employee, onNavigate, onLogout, showBolsaHoras = false }: Props) {
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
      enabled: true,
    },
    {
      id: 'horario',
      Icon: Calendar,
      title: 'Mi horario',
      desc: 'Tus turnos de la semana',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    },
    {
      id: 'turnos',
      Icon: Armchair,
      title: 'Turnos abiertos',
      desc: 'Coger turnos disponibles',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    },
    {
      id: 'cambios',
      Icon: RefreshCw,
      title: 'Cambios de turno',
      desc: 'Solicitar y gestionar cambios',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    },
    {
      id: 'fichajes',
      Icon: Clock,
      title: 'Mis fichajes',
      desc: 'Historial de tus fichajes',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    },
    ...(showBolsaHoras ? [{
      id: 'bolsa' as SubPage,
      Icon: Wallet,
      title: 'Mi bolsa de horas',
      desc: 'Saldo de horas extra/pendientes',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    }] : []),
    {
      id: 'documentos',
      Icon: FileText,
      title: 'Mis documentos',
      desc: 'Nóminas, contratos, partes',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    },
    {
      id: 'vacaciones',
      Icon: Sun,
      title: 'Mis vacaciones',
      desc: 'Solicitar y consultar saldo',
      color: 'bg-card border-border-default hover:border-accent',
      enabled: true,
    },
  ]

  const now = new Date()
  const greeting = now.getHours() < 14 ? 'Buenos días' : now.getHours() < 21 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="min-h-screen bg-page pb-8">
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-secondary uppercase tracking-wide">{greeting}</p>
            <p className="font-display text-xl font-bold text-accent">{employee.name.split(' ')[0]}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell employeeId={employee.id} />
            <button
              onClick={onLogout}
              className="text-xs px-3 py-1.5 rounded-full bg-card border border-border-default text-text-secondary hover:text-text-primary transition-base"
            >
              Salir
            </button>
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
              disabled={!item.enabled}
              onClick={() => item.enabled && onNavigate(item.id)}
              className={`w-full p-4 rounded-xl border-2 ${item.color} text-left transition-base active:scale-95 ${
                !item.enabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon size={28} className="text-accent shrink-0" strokeWidth={2} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary">{item.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{item.desc}</p>
                </div>
                {!item.enabled && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-page text-text-secondary font-medium">Próximamente</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-text-secondary mt-6">Foodint · Plataforma Hostelería</p>
    </div>
  )
}
