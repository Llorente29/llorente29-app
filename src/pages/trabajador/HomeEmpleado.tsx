// src/pages/trabajador/HomeEmpleado.tsx
import type { Employee } from '../../types'
import { hasOpenShift } from '../../services/fichajeKiosko'

type SubPage = 'home' | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones'

interface Props {
  employee: Employee
  onNavigate: (page: SubPage) => void
  onLogout: () => void
}

export default function HomeEmpleado({ employee, onNavigate, onLogout }: Props) {
  const open = hasOpenShift(employee)

  const menuItems = [
    {
      id: 'fichar' as SubPage,
      icon: open ? '🛑' : '🟢',
      title: open ? 'Fichar SALIDA' : 'Fichar ENTRADA',
      desc: open ? 'Cerrar tu jornada' : 'Empezar tu jornada',
      color: open ? 'bg-orange-50 border-orange-200 hover:border-orange-400' : 'bg-teal-50 border-teal-200 hover:border-teal-400',
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
      id: 'fichajes' as SubPage,
      icon: '⏰',
      title: 'Mis fichajes',
      desc: 'Historial de tus fichajes',
      color: 'bg-white border-gray-200 hover:border-purple-400',
      enabled: true,
    },
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
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 pb-8">
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">{greeting}</p>
            <p className="text-xl font-bold text-gray-900" style={{ fontFamily: 'Instrument Serif, serif' }}>{employee.name.split(' ')[0]}</p>
          </div>
          <button
            onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-700"
          >
            Salir
          </button>
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
