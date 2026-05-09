import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import type { Employee, ClockEntry, WeeklySchedule } from '../types'
import DocumentosTab from '../components/personal/DocumentosTab'
import VacacionesTab from '../components/personal/VacacionesTab'
import BolsaHorasView from '../components/personal/BolsaHorasView'

const POSITIONS = ['Encargado', 'Jefe de cocina', 'Cocinero', 'Ayudante cocina', 'Camarero', 'Barra', 'Hostess', 'Limpieza', 'Gerente', 'Otro']
const CONTRACT_TYPES = ['Indefinido', 'Temporal', 'Prácticas', 'Beca', 'Autónomo', 'Otro']
const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
const DAY_LABELS: Record<string, string> = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles',
  jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo'
}

function getScheduledMinutes(str: string) {
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

export default function StaffPage() {
  const { staff, locations, createEmployee, saveEmployee, removeEmployee } = useApp()
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
        />
      )}
    </div>
  )
}

// ─── Employee Detail Modal ────────────────────────────────────────────────────

function EmployeeModal({ employee, onClose, onSave, onDelete, locations }: {
  employee: Employee
  onClose: () => void
  onSave: (e: Employee) => void
  onDelete: (id: string) => void
  locations: ReturnType<typeof useApp>['locations']
}) {
  const [emp, setEmp] = useState<Employee>({ ...employee, clockEntries: [...employee.clockEntries] })
  const [tab, setTab] = useState('info')
  const [clocking, setClocking] = useState(false)
  const [clockWarn, setClockWarn] = useState<{ type: 'blocked' | 'rounded' | 'real'; msg: string } | null>(null)

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
    { value: 'bolsa', label: '⏳ Bolsa horas' },
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
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" id="active" checked={emp.active} onChange={e => update('active', e.target.checked)} className="rounded" />
              <Label htmlFor="active" className="cursor-pointer">Empleado activo</Label>
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

        {/* ── BOLSA DE HORAS ── */}
        {tab === 'bolsa' && (
          <div className="space-y-4">
            <BolsaHorasView employee={emp} variant="desktop" />

            <Card className="p-4">
              <p className="text-xs font-semibold text-gray-700 mb-2">Ajuste manual</p>
              <p className="text-[11px] text-gray-500 mb-3">
                Si necesitas registrar horas que no se reflejan en los fichajes (ej: día de baja compensado, festivo trabajado), añade un ajuste manual. Se sumará/restará al cálculo automático.
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wide">Saldo manual (horas)</label>
                  <p className={`text-2xl font-bold tabular-nums ${(emp.hourBank||0)>0?'text-emerald-600':(emp.hourBank||0)<0?'text-red-600':'text-gray-400'}`}>
                    {(emp.hourBank||0)>0?'+':''}{(emp.hourBank||0).toFixed(1)}h
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-1">
                    <input type="number" step="0.5" placeholder="±h"
                      className="w-20 border rounded-lg px-2 py-1.5 text-sm"
                      id={`hourbank-adj-${emp.id}`} />
                    <button onClick={() => {
                      const inp = document.getElementById(`hourbank-adj-${emp.id}`) as HTMLInputElement
                      const val = parseFloat(inp?.value||'0')
                      if(isNaN(val)) return
                      update('hourBank', (emp.hourBank||0) + val)
                      if(inp) inp.value = ''
                    }} className="px-3 py-1.5 bg-[#7C1A1A] text-white text-xs rounded-lg hover:bg-[#5A1212]">
                      Añadir
                    </button>
                  </div>
                  <button onClick={()=>update('hourBank',0)} className="text-[10px] text-gray-400 hover:text-red-500">
                    Resetear a 0
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t">
          <Button variant="danger" size="sm" onClick={() => {
            if (confirm('¿Eliminar este empleado?')) onDelete(emp.id)
          }}>Eliminar</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => onSave(emp)}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
