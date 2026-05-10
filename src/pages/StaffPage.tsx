import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import type { Employee, ClockEntry, WeeklySchedule } from '../types'
import DocumentosTab from '../components/personal/DocumentosTab'
import VacacionesTab from '../components/personal/VacacionesTab'

const POSITIONS = ['Encargado', 'Jefe de cocina', 'Cocinero', 'Ayudante cocina', 'Camarero', 'Barra', 'Hostess', 'Limpieza', 'Gerente', 'Otro']
const CONTRACT_TYPES = ['Indefinido', 'Temporal', 'Prácticas', 'Beca', 'Autónomo', 'Otro']
const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
const DAY_LABELS: Record<string, string> = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles',
  jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo'
}

type TerminationType = 'despido' | 'fin_contrato' | 'voluntaria' | 'jubilacion' | 'otro'

const TERMINATION_LABELS: Record<TerminationType, string> = {
  despido: 'Despido',
  fin_contrato: 'Fin de contrato',
  voluntaria: 'Voluntaria',
  jubilacion: 'Jubilación',
  otro: 'Otro',
}

const TERMINATION_OPTIONS: { id: TerminationType; label: string; icon: string; description: string }[] = [
  { id: 'voluntaria', label: 'Voluntaria', icon: '🚶', description: 'El empleado ha decidido marcharse' },
  { id: 'fin_contrato', label: 'Fin de contrato', icon: '📅', description: 'Contrato temporal que llega a su fin' },
  { id: 'despido', label: 'Despido', icon: '⚠️', description: 'Por causas objetivas o disciplinarias' },
  { id: 'jubilacion', label: 'Jubilación', icon: '👴', description: 'Jubilación ordinaria o anticipada' },
  { id: 'otro', label: 'Otro', icon: '📋', description: 'Otra causa de baja' },
]

function getScheduledMinutes(str: string) {
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

export default function StaffPage() {
  const { staff, locations, createEmployee, saveEmployee, removeEmployee, notifConfig } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [locFilter, setLocFilter] = useState('todas')

  const filtered = staff.filter(e =>
    (locFilter === 'todas' || e.locationId === locFilter) &&
    (e.name.toLowerCase().includes(search.toLowerCase()) ||
     e.dni.toLowerCase().includes(search.toLowerCase()) ||
     e.position.toLowerCase().includes(search.toLowerCase()))
  )

  const workingNow = staff.filter(e => e.clockEntries[0]?.type === 'entrada').length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Personal</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {staff.length} empleados · {staff.filter(e => e.active).length} activos · {workingNow} trabajando ahora
          </p>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            if (locations.length === 0) return
            const emp = createEmployee(locations[0].id)
            await saveEmployee(emp)
            setSelectedId(emp.id)
          }}
          disabled={locations.length === 0}
        >
          + Nuevo Empleado
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar por nombre, DNI, puesto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={locFilter} onChange={e => setLocFilter(e.target.value)} className="w-48">
          <option value="todas">Todos los locales</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      {/* Employee list */}
      {locations.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-500">Primero crea un local en la sección Locales</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-500">{search ? 'No se encontraron empleados' : 'No hay empleados. Crea uno arriba.'}</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(emp => {
            const loc = locations.find(l => l.id === emp.locationId)
            const isWorking = emp.clockEntries[0]?.type === 'entrada'
            return (
              <Card
                key={emp.id}
                onClick={() => setSelectedId(emp.id)}
                className="p-4 flex items-center gap-4"
              >
                <div className="relative">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-white font-semibold text-lg">
                    {emp.name ? emp.name[0].toUpperCase() : '?'}
                  </div>
                  {isWorking && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white animate-pulse" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{emp.name || 'Sin nombre'}</p>
                  <p className="text-xs text-gray-500">{emp.position} · {loc?.name || '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!emp.active && <Badge color="gray">Baja</Badge>}
                  {isWorking && <Badge color="green">Trabajando</Badge>}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Employee Detail Modal */}
      {selectedId && (
        <EmployeeModal
          employee={staff.find(e => e.id === selectedId)!}
          onClose={() => setSelectedId(null)}
          onSave={async emp => {
            await saveEmployee(emp)
            setSelectedId(null)
          }}
          onDelete={async id => {
            await removeEmployee(id)
            setSelectedId(null)
          }}
          locations={locations}
          notifConfig={notifConfig}
        />
      )}
    </div>
  )
}

// ─── Employee Detail Modal ────────────────────────────────────────────────────

function EmployeeModal({ employee, onClose, onSave, onDelete, locations, notifConfig }: {
  employee: Employee
  onClose: () => void
  onSave: (e: Employee) => void
  onDelete: (id: string) => void
  locations: ReturnType<typeof useApp>['locations']
  notifConfig: ReturnType<typeof useApp>['notifConfig']
}) {
  const [emp, setEmp] = useState<Employee>({ ...employee, clockEntries: [...employee.clockEntries] })
  const [tab, setTab] = useState('info')
  const [clocking, setClocking] = useState(false)
  const [clockWarn, setClockWarn] = useState<{ type: 'blocked' | 'rounded' | 'real'; msg: string } | null>(null)
  const [showTerminationModal, setShowTerminationModal] = useState(false)

  const update = (field: keyof Employee, value: unknown) => setEmp(prev => ({ ...prev, [field]: value }))

  const isWorking = emp.clockEntries[0]?.type === 'entrada'
  const todayEntries = emp.clockEntries.filter(e => e.datetime.startsWith(new Date().toISOString().slice(0, 10)))
  let hoursToday = 0
  for (let i = todayEntries.length - 1; i >= 0; i--) {
    if (todayEntries[i].type === 'entrada' && todayEntries[i - 1]?.type === 'salida') {
      hoursToday += (new Date(todayEntries[i - 1].datetime).getTime() - new Date(todayEntries[i].datetime).getTime()) / 3600000
    }
  }

  const todaySchedule = (() => {
    const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    const key = days[new Date().getDay()] as keyof WeeklySchedule
    return emp.weeklySchedule?.[key]
  })()

  function handleClock(type: 'entrada' | 'salida') {
    setClockWarn(null)

    if (type === 'entrada' && todaySchedule?.active && todaySchedule.start) {
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const scheduled = getScheduledMinutes(todaySchedule.start)
      const diff = nowMin - scheduled

      if (diff < -10) {
        const allowFrom = scheduled - 10
        const hh = Math.floor(allowFrom / 60).toString().padStart(2, '0')
        const mm = (allowFrom % 60).toString().padStart(2, '0')
        setClockWarn({ type: 'blocked', msg: `Fichaje bloqueado: faltan ${Math.abs(diff)} min para tu turno (${todaySchedule.start}). Puedes fichar desde las ${hh}:${mm}.` })
        return
      }

      let finalTime = new Date(now)
      if (diff >= -10 && diff <= 10) {
        finalTime = new Date(now)
        finalTime.setHours(Math.floor(scheduled / 60), scheduled % 60, 0, 0)
        setClockWarn({ type: 'rounded', msg: `Entrada redondeada a ${todaySchedule.start} (diferencia: ${diff > 0 ? '+' : ''}${diff} min)` })
      } else {
        setClockWarn({ type: 'real', msg: `Entrada con hora real: ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} (+${diff} min sobre turno)` })
      }

      const doRegister = (coords: Partial<ClockEntry>) => {
        const entry: ClockEntry = {
          id: `ck-${Date.now()}`,
          type,
          datetime: finalTime.toISOString(),
          realDatetime: now.toISOString(),
          scheduled: todaySchedule.start,
          roundingApplied: diff >= -10 && diff <= 10,
          diffMinutes: diff,
          ...coords,
        }
        setEmp(prev => ({ ...prev, clockEntries: [entry, ...prev.clockEntries] }))
        setClocking(false)
      }

      setClocking(true)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => doRegister({ lat: pos.coords.latitude, lng: pos.coords.longitude, address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}` }),
          () => doRegister({}),
          { enableHighAccuracy: true, timeout: 10000 }
        )
      } else doRegister({})
      return
    }

    setClocking(true)
    const now = new Date()
    const doRegister = (coords: Partial<ClockEntry>) => {
      const entry: ClockEntry = {
        id: `ck-${Date.now()}`,
        type,
        datetime: now.toISOString(),
        ...coords,
      }
      setEmp(prev => ({ ...prev, clockEntries: [entry, ...prev.clockEntries] }))
      setClocking(false)
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => doRegister({ lat: pos.coords.latitude, lng: pos.coords.longitude, address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}` }),
        () => doRegister({}),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    } else doRegister({})
  }

  const TABS = [
    { value: 'info', label: '👤 Datos' },
    { value: 'fichajes', label: '⏰ Fichajes' },
    { value: 'documentos', label: '📄 Docs' },
    { value: 'ausencias', label: '🏖 Ausencias' },
    { value: 'contrato', label: '📋 Contrato' },
    { value: 'disponibilidad', label: '📅 Disponibilidad' },
  ]

  return (
    <Modal open onClose={onClose} size="xl" title={emp.name || 'Nuevo empleado'}>
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} tabs={TABS} />

        {/* ── DATOS ── */}
        {tab === 'info' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Nombre completo</Label>
              <Input className="mt-1" value={emp.name} onChange={e => update('name', e.target.value)} placeholder="Nombre apellidos" />
            </div>
            <div>
              <Label>DNI / NIE</Label>
              <Input className="mt-1" value={emp.dni} onChange={e => update('dni', e.target.value)} placeholder="12345678A" />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input className="mt-1" value={emp.phone} onChange={e => update('phone', e.target.value)} placeholder="600000000" />
            </div>
            <div className="col-span-2">
              <Label>Email</Label>
              <Input className="mt-1" type="email" value={emp.email} onChange={e => update('email', e.target.value)} placeholder="email@ejemplo.com" />
            </div>
            <div>
              <Label>Puesto</Label>
              <Select className="mt-1" value={emp.position} onChange={e => update('position', e.target.value)}>
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
            <div>
              <Label>Local principal</Label>
              <Select className="mt-1" value={emp.locationId} onChange={e => update('locationId', e.target.value)}>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Locales donde puede fichar</Label>
              <p className="text-xs text-gray-400 mb-2">Si rota entre varios locales, marca todos. Si está vacío, solo podrá fichar en su local principal.</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {locations.map(l => {
                  const assigned = emp.assignedLocations || []
                  const checked = assigned.includes(l.id)
                  return (
                    <label key={l.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-all ${checked ? 'bg-teal-50 border-teal-300 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <input type="checkbox" checked={checked}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...assigned, l.id]
                            : assigned.filter(x => x !== l.id)
                          update('assignedLocations', next)
                        }} />
                      {l.name}
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <Label>PIN (4 dígitos)</Label>
              <Input className="mt-1" type="text" inputMode="numeric" maxLength={4}
                value={emp.pin || ''}
                onChange={e => update('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0000" />
            </div>
            <div className="col-span-2">
              {emp.active ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-medium text-emerald-800">Empleado en activo</span>
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-base">📅</span>
                        <span className="text-sm font-bold text-gray-700">Empleado dado de baja</span>
                      </div>
                      <p className="text-xs text-gray-600">
                        {emp.terminationType ? (
                          <>
                            Tipo: <strong>{TERMINATION_LABELS[emp.terminationType]}</strong>
                            {emp.endDate && ` · ${new Date(emp.endDate + 'T00:00:00').toLocaleDateString('es-ES')}`}
                          </>
                        ) : 'Sin tipo registrado'}
                      </p>
                      {emp.terminationReason && (
                        <p className="text-[11px] text-gray-500 italic mt-1">"{emp.terminationReason}"</p>
                      )}
                      {emp.terminationCommunicatedToGestoria && (
                        <p className="text-[10px] text-emerald-700 mt-1">✓ Comunicado a gestoría</p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        update('active', true)
                        update('terminationType', undefined)
                        update('terminationReason', undefined)
                        update('terminationCommunicatedToGestoria', false)
                      }}
                      className="text-xs px-3 py-1.5 rounded bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-medium shrink-0"
                    >
                      🔄 Reactivar
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="col-span-2">
              <Label>Notas</Label>
              <Textarea className="mt-1" rows={3} value={emp.notes} onChange={e => update('notes', e.target.value)} placeholder="Notas internas..." />
            </div>
          </div>
        )}

        {/* ── FICHAJES ── */}
        {tab === 'fichajes' && (
          <div className="space-y-4">
            {!emp.id || !emp.locationId ? (
              <Card className="p-4 text-center text-sm text-gray-500">
                Guarda primero los datos del empleado para poder fichar.
              </Card>
            ) : (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs text-gray-500">Estado actual</p>
                    <p className="text-sm font-semibold" style={{ color: '#7C1A1A' }}>
                      {isWorking ? '🟢 Trabajando' : '⚫ Sin entrada'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Hoy</p>
                    <p className="text-sm font-semibold tabular-nums">{hoursToday.toFixed(1)}h</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => handleClock('entrada')} disabled={clocking || isWorking}>
                    ▶ Entrada
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleClock('salida')} disabled={clocking || !isWorking}>
                    ⏹ Salida
                  </Button>
                </div>
                {clockWarn && (
                  <Alert type={clockWarn.type === 'blocked' ? 'error' : clockWarn.type === 'rounded' ? 'warning' : 'info'}>
                    {clockWarn.type === 'blocked' ? '🚫 ' : clockWarn.type === 'rounded' ? '🔄 ' : '✅ '}{clockWarn.msg}
                  </Alert>
                )}
              </Card>
            )}

            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-3 text-left text-xs font-semibold text-gray-500">Fecha y hora</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-500">Tipo</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-500">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.clockEntries.length === 0 ? (
                    <tr><td colSpan={3} className="p-4 text-center text-gray-400 italic">Sin fichajes</td></tr>
                  ) : (
                    emp.clockEntries.slice(0, 30).map((ce, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2 text-xs">{new Date(ce.datetime).toLocaleString('es-ES')}</td>
                        <td className="p-2"><Badge color={ce.type === 'entrada' ? 'green' : 'red'}>{ce.type}</Badge></td>
                        <td className="p-2 text-xs text-gray-500">
                          {ce.roundingApplied && '↻ redondeo · '}
                          {ce.diffMinutes != null && `${ce.diffMinutes > 0 ? '+' : ''}${ce.diffMinutes} min`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DOCUMENTOS ── */}
        {tab === 'documentos' && (
          <DocumentosTab employee={emp} />
        )}

        {/* ── AUSENCIAS / VACACIONES ── */}
        {tab === 'ausencias' && (
          <VacacionesTab employee={emp} />
        )}

        {/* ── CONTRATO ── */}
        {tab === 'contrato' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo de contrato</Label>
                <Select className="mt-1" value={emp.contractType} onChange={e => update('contractType', e.target.value)}>
                  {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label>Fecha de alta</Label>
                <Input className="mt-1" type="date" value={emp.startDate} onChange={e => update('startDate', e.target.value)} />
              </div>
              <div>
                <Label>Salario bruto anual (€)</Label>
                <Input className="mt-1" type="number" value={emp.salary} onChange={e => update('salary', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Horas semanales contratadas</Label>
                <Input className="mt-1" type="number" step="0.25" value={emp.weeklyHours} onChange={e => update('weeklyHours', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Saldo inicial bolsa de horas</Label>
                <Input
                  className="mt-1"
                  type="number"
                  step="0.25"
                  value={emp.initialHoursBalance ?? 0}
                  onChange={e => update('initialHoursBalance', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Positivo: la empresa le debe horas. Negativo: él debe.
                </p>
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={emp.showHoursBalance ?? true}
                    onChange={e => update('showHoursBalance', e.target.checked)}
                    className="w-4 h-4 rounded accent-[#7C1A1A]"
                  />
                  <span className="text-sm">El trabajador ve su bolsa de horas en la app</span>
                </label>
              </div>
              <div>
                <Label>Código en cuadrante (T1, T2, T3...)</Label>
                <Input
                  className="mt-1"
                  maxLength={4}
                  placeholder="T1"
                  value={emp.shiftCode || ''}
                  onChange={e => update('shiftCode', e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <Label>Franja habitual</Label>
                <Select
                  className="mt-1"
                  value={emp.shiftPeriod || ''}
                  onChange={e => update('shiftPeriod', (e.target.value || undefined) as ('manana' | 'tarde' | 'partido' | undefined))}
                >
                  <option value="">— sin definir —</option>
                  <option value="manana">Mañana (mediodía)</option>
                  <option value="tarde">Tarde / Noche</option>
                  <option value="partido">Partido (mañana + tarde)</option>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Patrón de descanso fijo</Label>
                <Select
                  className="mt-1"
                  value={emp.restPattern || ''}
                  onChange={e => {
                    const v = e.target.value
                    update('restPattern', v ? (v as 'lun:tarde_dia'|'lun:dia_manana'|'mar:tarde_dia'|'mar:dia_manana'|'mie:tarde_dia'|'mie:dia_manana') : undefined)
                  }}
                >
                  <option value="">— sin descanso fijo —</option>
                  <option value="lun:tarde_dia">Lun tarde libre + Mar entero libre</option>
                  <option value="lun:dia_manana">Lun entero libre + Mar mañana libre</option>
                  <option value="mar:tarde_dia">Mar tarde libre + Mié entero libre</option>
                  <option value="mar:dia_manana">Mar entero libre + Mié mañana libre</option>
                  <option value="mie:tarde_dia">Mié tarde libre + Jue entero libre</option>
                  <option value="mie:dia_manana">Mié entero libre + Jue mañana libre</option>
                </Select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Los descansos siempre caen entre Lunes y Jueves. Viernes, sábado y
                  domingo no descansa nadie por política del local.
                </p>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Horario por días</Label>
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {DAYS.map(day => {
                      const sched = emp.weeklySchedule?.[day] || { active: false, start: '', end: '' }
                      const hours = sched.active && sched.start && sched.end
                        ? ((getScheduledMinutes(sched.end) - getScheduledMinutes(sched.start)) / 60).toFixed(1)
                        : null
                      return (
                        <tr key={day} className={`border-b last:border-0 ${!sched.active ? 'bg-gray-50' : ''}`}>
                          <td className="p-2 w-8">
                            <input
                              type="checkbox"
                              checked={sched.active}
                              onChange={e => update('weeklySchedule', { ...emp.weeklySchedule, [day]: { ...sched, active: e.target.checked } })}
                            />
                          </td>
                          <td className={`p-2 w-28 font-medium text-sm ${!sched.active ? 'text-gray-400' : ''}`}>{DAY_LABELS[day]}</td>
                          <td className="p-2">
                            {sched.active ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="time"
                                  value={sched.start}
                                  onChange={e => update('weeklySchedule', { ...emp.weeklySchedule, [day]: { ...sched, start: e.target.value } })}
                                  className="border rounded px-2 py-1 text-xs bg-white"
                                />
                                <span className="text-gray-400">→</span>
                                <input
                                  type="time"
                                  value={sched.end}
                                  onChange={e => update('weeklySchedule', { ...emp.weeklySchedule, [day]: { ...sched, end: e.target.value } })}
                                  className="border rounded px-2 py-1 text-xs bg-white"
                                />
                              </div>
                            ) : null}
                          </td>
                          <td className="p-2 text-xs text-gray-400 w-16">
                            {hours ? `${hours}h` : sched.active ? '' : 'Libre'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── DISPONIBILIDAD ── */}
        {tab === 'disponibilidad' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Marca en qué turnos está disponible este trabajador. El generador de horarios lo respetará.</p>
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500">Día</th>
                  <th className="p-3 text-center text-xs font-semibold text-amber-600">☀️ Mediodía</th>
                  <th className="p-3 text-center text-xs font-semibold text-violet-600">🌙 Noche</th>
                  <th className="p-3 text-center text-xs font-semibold text-red-500">🚫 No disponible</th>
                </tr></thead>
                <tbody>
                  {(['lunes','martes','miercoles','jueves','viernes','sabado','domingo'] as const).map(day => {
                    const labels: Record<string,string> = {lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes',sabado:'Sábado',domingo:'Domingo'}
                    const avail = emp.availability?.[day] || ['manana','tarde']
                    const toggle = (val: string) => {
                      const cur = avail.includes(val) ? avail.filter((v: string)=>v!==val) : [...avail, val]
                      update('availability', {...(emp.availability||{}), [day]: cur})
                    }
                    const isNoDisp = avail.includes('no_disponible')
                    return (
                      <tr key={day} className={`border-b last:border-0 ${isNoDisp?'bg-red-50':''}`}>
                        <td className="p-3 font-medium text-sm">{labels[day]}</td>
                        {['manana','tarde'].map(t => (
                          <td key={t} className="p-3 text-center">
                            <input type="checkbox" checked={avail.includes(t) && !isNoDisp}
                              onChange={()=>toggle(t)} disabled={isNoDisp}
                              className={`w-4 h-4 rounded ${t==='manana'?'accent-amber-500':'accent-violet-500'}`} />
                          </td>
                        ))}
                        <td className="p-3 text-center">
                          <input type="checkbox" checked={isNoDisp} onChange={()=>toggle('no_disponible')} className="w-4 h-4 accent-red-500 rounded" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t">
          <div className="flex gap-2">
            {emp.active && (
              <Button variant="outline" size="sm" onClick={() => setShowTerminationModal(true)}>
                🚪 Dar de baja
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => {
              if (!confirm('¿ELIMINAR PERMANENTEMENTE este empleado?\n\nSe perderán todos sus datos: fichajes, vacaciones, documentos.\n\nNormalmente prefieres "Dar de baja" en su lugar.')) return
              if (!confirm('Confirma una vez más: esta acción NO se puede deshacer. ¿Continuar?')) return
              onDelete(emp.id)
            }}>
              🗑️ Eliminar permanente
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => onSave(emp)}>Guardar</Button>
          </div>
        </div>

        {showTerminationModal && (
          <TerminationModal
            employee={emp}
            onCancel={() => setShowTerminationModal(false)}
            onConfirm={(data) => {
              const updated: Employee = {
                ...emp,
                active: false,
                endDate: data.endDate,
                terminationType: data.type,
                terminationReason: data.reason || undefined,
                terminationCommunicatedToGestoria: data.communicated,
              }
              setShowTerminationModal(false)

              // Si el gestor marcó "Comunicado a gestoría", abrir cliente de correo con email prerellenado
              if (data.communicated) {
                try {
                  const mailtoUrl = buildGestoriaMailto(updated, locations, notifConfig?.gestoriaEmail || '')
                  // Pequeño delay para que se vea el feedback visual del confirm antes de saltar al correo
                  setTimeout(() => { window.location.href = mailtoUrl }, 100)
                } catch (e) {
                  console.warn('[Termination] No se pudo abrir cliente de correo:', e)
                }
              }

              onSave(updated)
            }}
          />
        )}
      </div>
    </Modal>
  )
}


// ─── Termination Modal ────────────────────────────────────────────────────────

interface TerminationModalProps {
  employee: Employee
  onCancel: () => void
  onConfirm: (data: {
    type: TerminationType
    endDate: string
    reason: string
    communicated: boolean
  }) => void
}

function TerminationModal({ employee, onCancel, onConfirm }: TerminationModalProps) {
  const [type, setType] = useState<TerminationType>('voluntaria')
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [communicated, setCommunicated] = useState(false)

  const placeholderByType: Record<TerminationType, string> = {
    voluntaria: 'Ej: cambio de ciudad, otro empleo, motivos personales...',
    fin_contrato: 'Ej: fin de contrato temporal del 15/05/2026',
    despido: 'Ej: bajo rendimiento reiterado, faltas injustificadas... (importante para defensa legal)',
    jubilacion: 'Ej: jubilación ordinaria a los 65 años',
    otro: 'Describe el motivo de la baja',
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b" style={{ backgroundColor: '#7C1A1A', color: 'white' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">🚪 Dar de baja empleado</div>
              <div className="text-xs opacity-90">{employee.name}</div>
            </div>
            <button onClick={onCancel} className="text-white/80 hover:text-white text-lg">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <Label>Tipo de baja</Label>
            <div className="mt-1 space-y-1.5">
              {TERMINATION_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setType(opt.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border-2 transition ${
                    type === opt.id
                      ? 'border-[#7C1A1A] bg-[#F5E9D9]'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{opt.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                      <div className="text-[11px] text-gray-500">{opt.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Fecha efectiva de baja</Label>
            <Input
              className="mt-1"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Día en el que el empleado deja de trabajar.
            </p>
          </div>

          <div>
            <Label>Motivo {type === 'despido' && <span className="text-red-600">(recomendado)</span>}</Label>
            <Textarea
              className="mt-1"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={placeholderByType[type]}
            />
          </div>

          <div className="bg-gray-50 rounded-lg p-3">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={communicated}
                onChange={e => setCommunicated(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#7C1A1A]"
              />
              <div>
                <span className="text-sm font-medium">📧 Enviar comunicación a la gestoría</span>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Al confirmar, se abrirá tu cliente de correo con un email prerellenado para la gestoría.
                </p>
              </div>
            </label>
            {communicated && (
              <div className="mt-2 pl-6 text-[11px] text-gray-600 border-l-2 border-[#7C1A1A] py-1 pl-3">
                <strong>Destinatario:</strong>{' '}
                <span className="font-mono">
                  {/* destino del email */}
                  {/* Mostrar email gestoría desde notifConfig si existe (lo coge el parent al construir mailto) */}
                  configurado en Informes Gestoría
                </span>
              </div>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <strong>📌 Importante:</strong> el empleado quedará marcado como inactivo pero sus datos
            (fichajes, vacaciones, documentos, bolsa de horas) se conservarán. Podrás reactivarlo en
            cualquier momento desde su ficha.
          </div>
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button
            onClick={() => onConfirm({ type, endDate, reason, communicated })}
            disabled={!endDate}
          >
            Confirmar baja
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Helper para construir mailto: con datos de baja ──────────────────────────

/**
 * Construye un URL `mailto:` con asunto y cuerpo prerellenados para enviar
 * a la gestoría la comunicación de baja del empleado. Al disparar
 * window.location.href = mailtoUrl, se abre el cliente de correo del usuario
 * (Gmail, Outlook, Mail, etc.) con todo listo para enviar.
 */
function buildGestoriaMailto(
  employee: Employee,
  locations: ReturnType<typeof useApp>['locations'],
  gestoriaEmail: string
): string {
  const location = locations.find(l => l.id === employee.locationId)
  const locationName = location?.name || '(sin local)'
  const tipoLabel = employee.terminationType
    ? TERMINATION_LABELS[employee.terminationType as TerminationType]
    : '(no especificado)'

  const fechaAlta = employee.startDate
    ? new Date(employee.startDate + 'T00:00:00').toLocaleDateString('es-ES')
    : '(no registrada)'
  const fechaBaja = employee.endDate
    ? new Date(employee.endDate + 'T00:00:00').toLocaleDateString('es-ES')
    : '(no especificada)'

  const subject = `Baja de empleado: ${employee.name} - ${fechaBaja}`

  const bodyLines = [
    'Buenos días,',
    '',
    'Os comunico la baja del siguiente empleado para que tramitéis la baja en SS:',
    '',
    `Nombre: ${employee.name}`,
    `DNI: ${employee.dni || '(no registrado)'}`,
    `Local: ${locationName}`,
    `Puesto: ${employee.position || '(no especificado)'}`,
    `Tipo de contrato: ${employee.contractType || '(no especificado)'}`,
    `Fecha de alta: ${fechaAlta}`,
    `Fecha efectiva de baja: ${fechaBaja}`,
    `Tipo de baja: ${tipoLabel}`,
  ]

  if (employee.terminationReason) {
    bodyLines.push(`Motivo: ${employee.terminationReason}`)
  }

  bodyLines.push('')
  bodyLines.push('Quedo a la espera de la documentación correspondiente.')
  bodyLines.push('')
  bodyLines.push('Saludos.')

  const body = bodyLines.join('\n')

  // encodeURIComponent codifica espacios, saltos de línea, acentos, etc.
  const encodedSubject = encodeURIComponent(subject)
  const encodedBody = encodeURIComponent(body)
  const to = gestoriaEmail.trim()

  return `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`
}
