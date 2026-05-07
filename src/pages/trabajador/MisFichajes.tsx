// src/pages/trabajador/MisFichajes.tsx
import { useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee, ClockEntry } from '../../types'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MisFichajes({ employee, onBack }: Props) {
  const { staff, locations } = useApp()
  const current = staff.find(e => e.id === employee.id) || employee
  const entries = current.clockEntries || []

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
  }, [entries])

  // Agrupar por día
  const grouped = useMemo(() => {
    const groups = new Map<string, ClockEntry[]>()
    for (const e of sorted) {
      const day = e.datetime.slice(0, 10)
      if (!groups.has(day)) groups.set(day, [])
      groups.get(day)!.push(e)
    }
    return Array.from(groups.entries())
  }, [sorted])

  // Calcular horas trabajadas por día (suma de pares entrada-salida)
  function hoursWorked(entries: ClockEntry[]): number {
    const sortedAsc = [...entries].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    let total = 0
    let lastEntry: ClockEntry | null = null
    for (const e of sortedAsc) {
      if (e.type === 'entrada') {
        lastEntry = e
      } else if (e.type === 'salida' && lastEntry) {
        const ms = new Date(e.datetime).getTime() - new Date(lastEntry.datetime).getTime()
        total += ms / (1000 * 60 * 60)
        lastEntry = null
      }
    }
    return total
  }

  function locationName(id?: string): string {
    if (!id) return ''
    return locations.find(l => l.id === id)?.name || ''
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-4 pb-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Mis fichajes</p>
            <p className="font-bold text-gray-900">{current.name.split(' ')[0]}</p>
          </div>
        </div>

        {grouped.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-4xl mb-2">⏰</p>
            <p className="font-semibold text-gray-700">Sin fichajes aún</p>
            <p className="text-xs text-gray-500 mt-1">Tus fichajes aparecerán aquí</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {grouped.map(([day, dayEntries]) => {
              const date = new Date(day)
              const hrs = hoursWorked(dayEntries)
              const dayLabel = date.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' })
              return (
                <div key={day}>
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{dayLabel}</p>
                    {hrs > 0 && <p className="text-xs font-bold text-teal-600">{hrs.toFixed(1)}h</p>}
                  </div>
                  <Card className="overflow-hidden">
                    {dayEntries.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()).map((e, i) => (
                      <div key={e.id || i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                        <span className={`w-2 h-2 rounded-full ${e.type === 'entrada' ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {e.type === 'entrada' ? '→ Entrada' : '← Salida'}
                          </p>
                          {e.locationIdAtClock && (
                            <p className="text-[10px] text-gray-400">{locationName(e.locationIdAtClock)}</p>
                          )}
                        </div>
                        <p className="text-sm tabular-nums text-gray-600 font-medium">
                          {new Date(e.datetime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </Card>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
