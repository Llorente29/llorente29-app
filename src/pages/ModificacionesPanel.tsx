import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Modal, Alert, Badge } from '../components/ui'
import type { DayCode, ScheduleModification, ModType } from '../services/scheduler'
import { DAY_CODES, DAY_LABELS, applyModifications, getBaseTemplate, buildScheduleFromManual } from '../services/scheduler'
import type { GeneratedSchedule } from '../services/scheduler'

const MOD_TYPES: { value: ModType; label: string; icon: string; color: string }[] = [
  { value: 'ausencia_dia',     label: 'Ausencia día completo', icon: '🏥', color: 'red' },
  { value: 'ausencia_manana',  label: 'Libre mañana',          icon: '☀️', color: 'yellow' },
  { value: 'ausencia_tarde',   label: 'Libre noche',           icon: '🌙', color: 'yellow' },
  { value: 'dia_libre_extra',  label: 'Día libre (petición)',  icon: '🙋', color: 'blue' },
  { value: 'cambio_horario',   label: 'Cambio de horario',     icon: '🔄', color: 'violet' },
]

const REASONS = ['Baja médica', 'Vacaciones', 'Permiso personal', 'Asuntos propios', 'Petición cambio', 'Otro']

const SEV_COLOR: Record<string, string> = {
  critical: 'bg-red-50 border-red-300 text-red-800',
  error:    'bg-orange-50 border-orange-300 text-orange-800',
  warning:  'bg-amber-50 border-amber-300 text-amber-800',
  info:     'bg-blue-50 border-blue-300 text-blue-800',
}

export interface ModPanelProps {
  locationId: string
  weekStart?: string
  onApply: (result: GeneratedSchedule, mods: ScheduleModification[]) => void
  existingMods?: ScheduleModification[]
}

export default function ModificacionesPanel({ locationId, onApply, existingMods = [] }: ModPanelProps) {
  const { staff } = useApp()
  const employees = staff.filter(e => e.active && e.locationId === locationId)
  const [mods, setMods] = useState<ScheduleModification[]>(existingMods)
  const [showAdd, setShowAdd] = useState(false)
  const [preview, setPreview] = useState<GeneratedSchedule | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Form state
  const [fEmp, setFEmp] = useState(employees[0]?.id || '')
  const [fDay, setFDay] = useState<DayCode>('lunes')
  const [fType, setFType] = useState<ModType>('ausencia_dia')
  const [fReason, setFReason] = useState('Baja médica')
  const [fStart, setFStart] = useState('19:45')
  const [fEnd, setFEnd] = useState('00:15')

  function addMod() {
    const mod: ScheduleModification = {
      id: `mod-${Date.now()}`,
      employeeId: fEmp,
      dayCode: fDay,
      type: fType,
      reason: fReason,
      newSlot: fType === 'cambio_horario' ? { start: fStart, end: fEnd } : undefined,
      createdAt: new Date().toISOString()
    }
    setMods(prev => [...prev, mod])
    setShowAdd(false)
  }

  function removeMod(id: string) {
    setMods(prev => prev.filter(m => m.id !== id))
  }

  function handlePreview() {
    const result = applyModifications(employees, mods)
    setPreview(result)
    setShowPreview(true)
  }

  function handleApply() {
    const result = applyModifications(employees, mods)
    onApply(result, mods)
    setShowPreview(false)
  }

  function handleReset() {
    setMods([])
    const base = getBaseTemplate(employees)
    const result = buildScheduleFromManual(employees, base)
    onApply(result, [])
  }

  const empName = (id: string) => employees.find(e => e.id === id)?.name || id

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            🔧 Modificaciones sobre el horario base
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            El sistema reajusta automáticamente el resto del equipo para mantener la cobertura mínima
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {mods.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleReset}>
              ↩ Restaurar plantilla base
            </Button>
          )}
          {mods.length > 0 && (
            <Button size="sm" variant="outline" onClick={handlePreview}>
              👁 Ver resultado
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + Añadir modificación
          </Button>
        </div>
      </div>

      {employees.length === 0 ? (
        <Alert type="warning">No hay empleados activos en este local</Alert>
      ) : mods.length === 0 ? (
        <Card className="p-6 text-center border-dashed">
          <p className="text-gray-400 text-sm">Sin modificaciones — usando el horario plantilla base</p>
          <p className="text-xs text-gray-300 mt-1">Añade cambios cuando un trabajador falte o cambie su turno</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {mods.map(mod => {
            const mt = MOD_TYPES.find(t => t.value === mod.type)
            return (
              <div key={mod.id} className="flex items-center gap-3 p-3 bg-white border rounded-xl hover:shadow-sm transition-shadow">
                <span className="text-xl shrink-0">{mt?.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{empName(mod.employeeId)}</p>
                    <Badge color={mt?.color || 'gray'}>{mt?.label}</Badge>
                    <span className="text-xs text-gray-500">{DAY_LABELS[mod.dayCode]}</span>
                    <span className="text-xs text-gray-400">· {mod.reason}</span>
                    {mod.newSlot && <span className="text-xs text-violet-600">{mod.newSlot.start}–{mod.newSlot.end}</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(mod.createdAt).toLocaleString('es-ES')}</p>
                </div>
                <button onClick={() => removeMod(mod.id)} className="text-gray-300 hover:text-red-500 shrink-0 text-lg leading-none">×</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Botón aplicar siempre visible si hay mods */}
      {mods.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-teal-50 border border-teal-200 rounded-2xl">
          <div className="flex-1">
            <p className="font-medium text-teal-800 text-sm">{mods.length} modificación(es) pendiente(s) de aplicar</p>
            <p className="text-xs text-teal-600 mt-0.5">El horario se reajustará manteniendo la cobertura mínima obligatoria</p>
          </div>
          <Button onClick={handleApply} className="shrink-0">
            ⚡ Aplicar y reajustar
          </Button>
        </div>
      )}

      {/* Modal añadir modificación */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Añadir modificación" size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase">Trabajador</label>
            <Select className="mt-1" value={fEmp} onChange={e => setFEmp(e.target.value)}>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name || '(Sin nombre)'}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase">Día</label>
            <Select className="mt-1" value={fDay} onChange={e => setFDay(e.target.value as DayCode)}>
              {DAY_CODES.map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase">Tipo de modificación</label>
            <div className="mt-2 space-y-1.5">
              {MOD_TYPES.map(t => (
                <button key={t.value} onClick={() => setFType(t.value)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left text-sm transition-all ${fType === t.value ? 'bg-teal-50 border-teal-400 text-teal-800 font-medium' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                  <span className="text-base">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          {fType === 'cambio_horario' && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">Nuevo horario</label>
              <div className="flex items-center gap-2 mt-1">
                <input type="time" value={fStart} onChange={e => setFStart(e.target.value)} className="border rounded-lg px-3 py-2 text-sm flex-1" />
                <span className="text-gray-400">–</span>
                <input type="time" value={fEnd} onChange={e => setFEnd(e.target.value)} className="border rounded-lg px-3 py-2 text-sm flex-1" />
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase">Motivo</label>
            <Select className="mt-1" value={fReason} onChange={e => setFReason(e.target.value)}>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1">Cancelar</Button>
            <Button onClick={addMod} className="flex-1">Añadir</Button>
          </div>
        </div>
      </Modal>

      {/* Modal preview del resultado */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Vista previa del reajuste" size="lg">
        {preview && (
          <div className="space-y-4">
            {/* Alertas */}
            {preview.alerts.length > 0 && (
              <div className="space-y-2">
                {preview.alerts.map((a, i) => (
                  <div key={i} className={`p-3 rounded-xl border text-sm ${SEV_COLOR[a.severity]}`}>
                    <p className="font-medium">{a.severity==='critical'?'🚨':a.severity==='error'?'❌':'⚠️'} {a.message}</p>
                    {a.suggestion && <p className="text-xs mt-1 opacity-75">💡 {a.suggestion}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Ajustes aplicados */}
            {preview.adjustments.filter(a => !a.startsWith('Horario importado')).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Cambios automáticos aplicados</p>
                <div className="space-y-1">
                  {preview.adjustments.filter(a => !a.startsWith('Horario importado')).map((adj, i) => (
                    <div key={i} className="text-xs p-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">📋 {adj}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Tabla resumen */}
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-xs min-w-[600px]">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="p-2 text-left font-semibold text-gray-500">Trabajador</th>
                    {DAY_CODES.map(d => <th key={d} className="p-2 text-center font-semibold text-gray-500">{DAY_LABELS[d].slice(0,3)}</th>)}
                    <th className="p-2 text-center font-semibold text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.workers.map(w => (
                    <tr key={w.employeeId} className="border-b last:border-0">
                      <td className="p-2 font-medium">{w.employeeName}</td>
                      {DAY_CODES.map(day => {
                        const shift = w.days[day]
                        const hasMod = mods.some(m => m.employeeId === w.employeeId && m.dayCode === day)
                        const hasAdj = shift?.notes?.includes('Reajustado') || shift?.notes?.includes('reajuste')
                        return (
                          <td key={day} className={`p-1 text-center ${hasMod ? 'bg-amber-50' : hasAdj ? 'bg-blue-50' : ''}`}>
                            {shift?.libre ? (
                              <span className="text-gray-300 text-[10px]">{shift.notes ? '📋' : 'L'}</span>
                            ) : (
                              <div className="space-y-0.5">
                                {shift?.manana && <div className="bg-amber-100 text-amber-700 rounded px-1 text-[9px] font-medium">{shift.manana.start}</div>}
                                {shift?.tarde && <div className="bg-violet-100 text-violet-700 rounded px-1 text-[9px] font-medium">{shift.tarde.start}</div>}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="p-2 text-center font-bold text-sm">
                        <span className={w.totalHours > 40 ? 'text-orange-600' : 'text-emerald-600'}>{w.totalHours.toFixed(1)}h</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400 flex gap-3">
              <span className="bg-amber-50 px-2 py-0.5 rounded border">🟡 Modificación</span>
              <span className="bg-blue-50 px-2 py-0.5 rounded border">🔵 Reajuste automático</span>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowPreview(false)} className="flex-1">Cancelar</Button>
              <Button onClick={handleApply} className="flex-1">✅ Aplicar este horario</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
