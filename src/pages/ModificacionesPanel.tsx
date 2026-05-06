import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Card } from '../components/ui'
import { DAY_CODES, DAY_LABELS, getBaseTemplate, buildScheduleFromManual, applyModifications } from '../services/scheduler'
import type { GeneratedSchedule, ScheduleModification, DayCode } from '../services/scheduler'

const ABSENCE_TYPES = [
  { value: 'libre',    label: 'Libre',         color: 'bg-gray-100 text-gray-500',   icon: '😴' },
  { value: 'baja',     label: 'Baja médica',   color: 'bg-red-100 text-red-700',     icon: '🏥' },
  { value: 'vacacion', label: 'Vacaciones',    color: 'bg-blue-100 text-blue-700',   icon: '🏖' },
  { value: 'permiso',  label: 'Permiso',       color: 'bg-amber-100 text-amber-700', icon: '🙋' },
]

type AbsenceType = 'libre' | 'baja' | 'vacacion' | 'permiso' | null

interface CellState {
  type: AbsenceType
  onlyManana?: boolean  // solo falta a mediodía
  onlyTarde?: boolean   // solo falta a la noche
}

export default function ModificacionesPanel({ tMapping, onApply }: {
  tMapping: [string,string,string]
  onApply: (result: GeneratedSchedule, mods: ScheduleModification[]) => void
}) {
  const { staff } = useApp()

  const employees = tMapping
    .map(id => staff.find(e => e.id === id && e.active))
    .filter(Boolean) as typeof staff

  // Estado: para cada (empleado, día) qué ausencia tiene
  const [cells, setCells] = useState<Record<string, CellState>>({})
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const key = (empId: string, day: DayCode) => `${empId}-${day}`

  function cycleCell(empId: string, day: DayCode) {
    const cur = cells[key(empId, day)]?.type || null
    const types: AbsenceType[] = [null, 'libre', 'baja', 'vacacion', 'permiso']
    const next = types[(types.indexOf(cur) + 1) % types.length]
    setCells(prev => ({ ...prev, [key(empId, day)]: { type: next } }))
  }

  function toggleHalf(empId: string, day: DayCode, part: 'onlyManana' | 'onlyTarde') {
    setCells(prev => {
      const cur = prev[key(empId, day)] || { type: null }
      return { ...prev, [key(empId, day)]: { ...cur, [part]: !cur[part], type: cur.type || 'libre' } }
    })
  }

  function clearAll() {
    setCells({})
    setApplied(false)
  }

  function apply() {
    setApplying(true)
    setTimeout(() => {
      const mods: ScheduleModification[] = []
      employees.forEach(emp => {
        DAY_CODES.forEach(day => {
          const cell = cells[key(emp.id, day)]
          if (!cell?.type) return
          if (cell.onlyManana) {
            mods.push({ id: `m-${emp.id}-${day}`, employeeId: emp.id, dayCode: day, type: 'ausencia_manana', reason: ABSENCE_TYPES.find(t=>t.value===cell.type)?.label||'Libre', createdAt: new Date().toISOString() })
          } else if (cell.onlyTarde) {
            mods.push({ id: `m-${emp.id}-${day}`, employeeId: emp.id, dayCode: day, type: 'ausencia_tarde', reason: ABSENCE_TYPES.find(t=>t.value===cell.type)?.label||'Libre', createdAt: new Date().toISOString() })
          } else {
            mods.push({ id: `m-${emp.id}-${day}`, employeeId: emp.id, dayCode: day, type: 'ausencia_dia', reason: ABSENCE_TYPES.find(t=>t.value===cell.type)?.label||'Libre', createdAt: new Date().toISOString() })
          }
        })
      })
      const result = mods.length > 0 ? applyModifications(employees, mods) : buildScheduleFromManual(employees, getBaseTemplate(employees))
      onApply(result, mods)
      setApplied(true)
      setApplying(false)
    }, 200)
  }

  // Obtener horario base para mostrar referencia
  const baseTemplate = getBaseTemplate(employees)

  const modCount = Object.values(cells).filter(c => c.type).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-semibold text-gray-800">Modificaciones de la semana</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Haz clic en una celda para marcar ausencia. El sistema reajusta automáticamente.
          </p>
        </div>
        <div className="flex gap-2">
          {modCount > 0 && <Button size="sm" variant="outline" onClick={clearAll}>Limpiar todo</Button>}
          <Button size="sm" onClick={apply} disabled={applying}>
            {applying ? '⚙️ Calculando...' : applied ? '✅ Aplicado' : `⚡ Aplicar${modCount > 0 ? ` (${modCount} cambios)` : ' horario base'}`}
          </Button>
        </div>
      </div>

      {employees.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-400 text-sm">Configura el mapeo T1/T2/T3 en la sección de Parámetros primero</p>
        </Card>
      ) : (
        <>
          {/* Tabla de modificaciones */}
          <div className="border rounded-2xl overflow-x-auto bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 w-36">Trabajador</th>
                  {DAY_CODES.map(day => (
                    <th key={day} className={`p-2 text-center text-xs font-semibold min-w-[90px] ${day==='sabado'||day==='domingo'||day==='viernes' ? 'text-teal-700 bg-teal-50' : 'text-gray-500'}`}>
                      {DAY_LABELS[day].slice(0,3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, empIdx) => {
                  const baseWorker = baseTemplate.find(b => b.employeeId === emp.id)
                  return (
                    <tr key={emp.id} className="border-b last:border-0">
                      <td className="p-3">
                        <p className="font-semibold text-sm">{emp.name}</p>
                        <p className="text-xs text-gray-400">T{empIdx + 1}</p>
                      </td>
                      {DAY_CODES.map(day => {
                        const cell = cells[key(emp.id, day)]
                        const baseDay = baseWorker?.days[day]
                        const absence = ABSENCE_TYPES.find(t => t.value === cell?.type)
                        const isBaseLibre = baseDay?.libre
                        const hasManana = baseDay && !baseDay.libre && baseDay.manana
                        const hasTarde = baseDay && !baseDay.libre && baseDay.tarde

                        return (
                          <td key={day} className="p-1.5 align-top">
                            {isBaseLibre ? (
                              // Día libre en la plantilla — no se puede modificar
                              <div className="min-h-[60px] flex items-center justify-center">
                                <span className="text-[10px] text-gray-300 font-medium">LIBRE</span>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {/* Celda principal: clic para ciclar ausencia */}
                                <button
                                  onClick={() => cycleCell(emp.id, day)}
                                  className={`w-full rounded-lg border px-1 py-1.5 text-center transition-all ${
                                    cell?.type
                                      ? `${absence?.color} border-current font-semibold`
                                      : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  <p className="text-[11px] font-bold leading-tight">
                                    {cell?.type ? `${absence?.icon} ${absence?.label}` : '✓ Trabaja'}
                                  </p>
                                  {!cell?.type && baseDay && (
                                    <div className="mt-0.5 space-y-0.5">
                                      {hasManana && <p className="text-[9px] opacity-60">{baseDay.manana!.start}–{baseDay.manana!.end}</p>}
                                      {hasTarde && <p className="text-[9px] opacity-60">{baseDay.tarde!.start}–{baseDay.tarde!.end}</p>}
                                    </div>
                                  )}
                                </button>

                                {/* Si hay ausencia: opción de solo mañana o solo noche */}
                                {cell?.type && (hasManana || hasTarde) && (
                                  <div className="flex gap-1">
                                    {hasManana && (
                                      <button
                                        onClick={() => toggleHalf(emp.id, day, 'onlyManana')}
                                        className={`flex-1 text-[9px] rounded px-1 py-0.5 border transition-all ${cell.onlyManana ? 'bg-amber-200 border-amber-400 text-amber-900 font-bold' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
                                      >
                                        {cell.onlyManana ? '☀️ solo mañ' : '☀️'}
                                      </button>
                                    )}
                                    {hasTarde && (
                                      <button
                                        onClick={() => toggleHalf(emp.id, day, 'onlyTarde')}
                                        className={`flex-1 text-[9px] rounded px-1 py-0.5 border transition-all ${cell.onlyTarde ? 'bg-violet-200 border-violet-400 text-violet-900 font-bold' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
                                      >
                                        {cell.onlyTarde ? '🌙 solo noch' : '🌙'}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Leyenda */}
          <div className="flex flex-wrap gap-2 text-xs text-gray-500 items-center">
            <span className="font-medium text-gray-600">Clic en celda para marcar:</span>
            {ABSENCE_TYPES.map(t => (
              <span key={t.value} className={`px-2 py-0.5 rounded-full border ${t.color}`}>{t.icon} {t.label}</span>
            ))}
            <span className="text-gray-300">· Otro clic = siguiente tipo · ☀️🌙 = solo turno</span>
          </div>

          {/* Resumen de modificaciones */}
          {modCount > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs font-semibold text-amber-800 mb-1.5">Cambios marcados:</p>
              <div className="flex flex-wrap gap-2">
                {employees.flatMap(emp =>
                  DAY_CODES.filter(day => cells[key(emp.id, day)]?.type).map(day => {
                    const cell = cells[key(emp.id, day)]
                    const ab = ABSENCE_TYPES.find(t => t.value === cell?.type)
                    const half = cell?.onlyManana ? ' (solo mañana)' : cell?.onlyTarde ? ' (solo noche)' : ''
                    return (
                      <span key={`${emp.id}-${day}`} className="text-xs bg-white border border-amber-200 px-2 py-0.5 rounded-lg">
                        <strong>{emp.name}</strong> · {DAY_LABELS[day]} · {ab?.icon} {ab?.label}{half}
                      </span>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Info de reajuste */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
            <p className="font-semibold mb-1">¿Cómo funciona el reajuste?</p>
            <p>Si alguien falta en un día donde el local no tiene cobertura mínima, el sistema busca a los compañeros disponibles ese día y les asigna el turno de noche. Si aún no hay suficiente: cierra 30 min antes (L-J) o alerta crítica (V-S-D).</p>
          </div>
        </>
      )}
    </div>
  )
}
