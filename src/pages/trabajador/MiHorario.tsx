// src/pages/trabajador/MiHorario.tsx
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee } from '../../types'

interface Props {
  employee: Employee
  onBack: () => void
}

const DAYS = [
  { key: 'lunes',     label: 'Lunes' },
  { key: 'martes',    label: 'Martes' },
  { key: 'miercoles', label: 'Miércoles' },
  { key: 'jueves',    label: 'Jueves' },
  { key: 'viernes',   label: 'Viernes' },
  { key: 'sabado',    label: 'Sábado' },
  { key: 'domingo',   label: 'Domingo' },
] as const

export default function MiHorario({ employee, onBack }: Props) {
  const { staff } = useApp()
  const current = staff.find(e => e.id === employee.id) || employee
  const ws = current.weeklySchedule

  // Calcular horas semanales
  function hoursOfDay(day: { active: boolean; start: string; end: string }): number {
    if (!day.active || !day.start || !day.end) return 0
    const [sh, sm] = day.start.split(':').map(Number)
    const [eh, em] = day.end.split(':').map(Number)
    return Math.max(0, (eh + em / 60) - (sh + sm / 60))
  }

  const totalHours = DAYS.reduce((acc, d) => acc + hoursOfDay(ws[d.key]), 0)
  const today = new Date().getDay() // 0=domingo, 1=lunes...
  const todayKey = today === 0 ? 'domingo' : ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][today - 1]

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] p-4 pb-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Mi horario</p>
            <p className="font-bold text-gray-900">{current.name.split(' ')[0]}</p>
          </div>
        </div>

        {/* Resumen */}
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Horas semanales</p>
              <p className="text-2xl font-bold text-[#7C1A1A]">{totalHours.toFixed(1)}h</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Contrato</p>
              <p className="text-2xl font-bold text-gray-700">{current.weeklyHours || 40}h</p>
            </div>
          </div>
        </Card>

        {/* Días de la semana */}
        <div className="space-y-2">
          {DAYS.map(d => {
            const sched = ws[d.key]
            const hours = hoursOfDay(sched)
            const isToday = d.key === todayKey
            return (
              <Card key={d.key} className={`p-3 ${isToday ? 'border-2 border-[#7C1A1A] bg-[#F5E9D9]/50' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-10 rounded-full ${sched.active ? 'bg-[#F5E9D9]0' : 'bg-gray-200'}`} />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">
                        {d.label}
                        {isToday && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-[#7C1A1A] text-white font-medium">HOY</span>}
                      </p>
                      {sched.active ? (
                        <p className="text-xs text-gray-500 mt-0.5">{sched.start} – {sched.end}</p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-0.5">Libre</p>
                      )}
                    </div>
                  </div>
                  {sched.active && (
                    <span className="text-sm font-medium text-gray-700">{hours.toFixed(1)}h</span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>

        {totalHours === 0 && (
          <Card className="p-4 mt-4 bg-amber-50 border-amber-200">
            <p className="text-xs text-amber-800 text-center">
              Aún no tienes horario asignado. Habla con tu encargado.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
