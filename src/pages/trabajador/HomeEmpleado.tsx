// src/pages/trabajador/HomeEmpleado.tsx
import type { Employee } from '../../types'
import { hasOpenShift } from '../../services/fichajeKiosko'
import NotificationBell from '../../components/NotificationBell'

type SubPage = 'home' | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos'

interface Props {
  employee: Employee
  onNavigate: (page: SubPage) => void
  onLogout: () => void
  showBolsaHoras?: boolean
}

export default function HomeEmpleado({ employee, onNavigate, onLogout, showBolsaHoras = false }: Props) {
  const open = hasOpenShift(employee)

  const menuItems = [
    {
      id: 'fichar' as SubPage,
      icon: open ? '🛑' : '🟢',
      title: open ? 'Fichar SALIDA' : 'Fichar ENTRADA',
      desc: open ? 'Cerrar tu jornada' : 'Empezar tu jornada',
      color: open ? 'bg-orange-50 border-orange-200 hover:border-orange-400' : 'bg-[#F5E9D9] border-[#E5D4B7] hover:border-[#7C1A1A]',
      enabled: true,
    },
    {
      id: 'horario' as SubPage,
      icon: '📅',
      title: 'Mi horario',
      desc: 'Tus turnos de la semana',
      color: 'bg-white border-gray-200 hover:border-blue-400',
      enabled: true,
    },
    {
      id: 'turnos' as SubPage,
      icon: '🪑',
      title: 'Turnos abiertos',
      desc: 'Coger turnos disponibles',
      color: 'bg-white border-gray-200 hover:border-[#F39C2A]',
      enabled: true,
    },
    {
      id: 'fichajes' as SubPage,
      icon: '⏰',
      title: 'Mis fichajes',
      desc: 'Historial de tus fichajes',
      color: 'bg-white border-gray-200 hover:border-purple-400',
      enabled: true,
    },
    ...(showBolsaHoras ? [{
      id: 'bolsa' as SubPage,
      icon: '⚖️',
      title: 'Mi bolsa de horas',
      desc: 'Saldo de horas extra/pendientes',
      color: 'bg-white border-gray-200 hover:border-[#7C1A1A]',
      enabled: true,
    }] : []),
    {
      id: 'documentos' as SubPage,
      icon: '📄',
      title: 'Mis documentos',
      desc: 'Nóminas, contratos, partes',
      color: 'bg-white border-gray-200 hover:border-amber-400',
      enabled: true,
    },
    {
      id: 'vacaciones' as SubPage,
      icon: '🏖️',
      title: 'Mis vacaciones',
      desc: 'Solicitar y consultar saldo',
      color: 'bg-white border-gray-200 hover:border-emerald-400',
      enabled: true,
    },
  ]

  const now = new Date()
  const greeting = now.getHours() < 14 ? 'Buenos días' : now.getHours() < 21 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] pb-8">
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{greeting}</p>
            <p className="text-xl font-bold text-gray-900" style={{ fontFamily: 'Instrument Serif, serif' }}>{employee.name.split(' ')[0]}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell employeeId={employee.id} />
            <button
              onClick={onLogout}
              className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-700"
            >
              Salir
            </button>
          </div>
        </div>

        {open && (
          <div className="mt-3 bg-emerald-100 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-800 font-medium">Tienes una jornada abierta</span>
          </div>
        )}
      </div>

      {/* Menú */}
      <div className="px-4 space-y-3">
        {menuItems.map(item => (
          <button
            key={item.id}
            disabled={!item.enabled}
            onClick={() => item.enabled && onNavigate(item.id)}
            className={`w-full p-4 rounded-2xl border-2 ${item.color} text-left transition-all active:scale-95 ${
              !item.enabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{item.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
              </div>
              {!item.enabled && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 font-medium">Próximamente</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-gray-300 mt-6">Andy App · Hostelería Pro</p>
    </div>
  )
}
