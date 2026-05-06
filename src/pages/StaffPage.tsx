import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import type { Employee, ClockEntry, WeeklySchedule } from '../types'

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
  const { staff, setStaff, locations, createEmployee } = useApp()
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
          onClick={() => {
            if (locations.length === 0) return
            const emp = createEmployee(locations[0].id)
            setStaff(prev => [emp, ...prev])
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
          onSave={emp => {
            setStaff(prev => prev.map(e => e.id === emp.id ? emp : e))
            setSelectedId(null)
          }}
          onDelete={id => {
            setStaff(prev => prev.filter(e => e.id !== id))
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

    // Salida or no schedule: plain clock
    setClocking(true)
    const now = new Date()
    const doRegister = (coords: Partial<ClockEntry>) => {
      const entry: ClockEntry = { id: `ck-${Date.now()}`, type, datetime: now.toISOString(), ...coords }
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
              <Label>Local</Label>
              <Select className="mt-1" value={emp.locationId} onChange={e => update('locationId', e.target.value)}>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <input type="checkbox" id="active" checked={emp.active} onChange={e => update('active', e.target.checked)} className="rounded" />
              <label htmlFor="active" className="text-sm cursor-pointer">Activo (desmarcar para dar de baja)</label>
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
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{isWorking ? '🟢 Trabajando ahora' : '⚪ Fuera de turno'}</p>
                  <p className="text-xs text-gray-500">Hoy: {hoursToday.toFixed(1)}h</p>
                  {todaySchedule?.active && todaySchedule.start && (
                    <p className="text-xs font-medium text-teal-600 mt-0.5">
                      Turno: {todaySchedule.start} – {todaySchedule.end} · Fichar desde: {(() => {
                        const m = getScheduledMinutes(todaySchedule.start) - 10
                        return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`
                      })()}
                    </p>
                  )}
                  {todaySchedule?.active === false && (
                    <p className="text-xs text-gray-400 mt-0.5">Hoy no trabaja según horario</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleClock('entrada')} disabled={clocking || isWorking} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {clocking ? '📍...' : '▶ Entrada'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleClock('salida')} disabled={clocking || !isWorking}>
                    ⏹ Salida
                  </Button>
                </div>
              </div>
              {clockWarn && (
                <Alert type={clockWarn.type === 'blocked' ? 'error' : clockWarn.type === 'rounded' ? 'warning' : 'info'}>
                  {clockWarn.type === 'blocked' ? '🚫 ' : clockWarn.type === 'rounded' ? '🔄 ' : '✅ '}{clockWarn.msg}
                </Alert>
              )}
            </Card>

            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500">Tipo</th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500">Fecha y hora</th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">Turno</th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">GPS</th>
                </tr></thead>
                <tbody>
                  {emp.clockEntries.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400 text-sm">Sin fichajes</td></tr>
                  ) : emp.clockEntries.map(ce => (
                    <tr key={ce.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-3">
                        <Badge color={ce.type === 'entrada' ? 'green' : 'red'}>
                          {ce.type === 'entrada' ? '▶ Entrada' : '⏹ Salida'}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{new Date(ce.datetime).toLocaleString('es-ES')}</span>
                        {ce.roundingApplied && <Badge color="yellow" className="ml-1">redondeado</Badge>}
                        {ce.scheduled && !ce.roundingApplied && (ce.diffMinutes || 0) > 10 && (
                          <Badge color="red" className="ml-1">+{ce.diffMinutes}min</Badge>
                        )}
                      </td>
                      <td className="p-3 text-xs text-gray-500 hidden sm:table-cell">{ce.scheduled || '—'}</td>
                      <td className="p-3 text-xs text-gray-500 hidden sm:table-cell">{ce.address || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DOCUMENTOS ── */}
        {tab === 'documentos' && (
          <div className="space-y-3">
            <Button size="sm" variant="outline" onClick={() => {
              const doc = { id: `d-${Date.now()}`, name: 'Nuevo documento', type: 'otro' as const, date: new Date().toISOString().slice(0, 10) }
              setEmp(prev => ({ ...prev, documents: [doc, ...prev.documents] }))
            }}>+ Añadir documento</Button>
            {emp.documents.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-400 text-sm">Sin documentos</p></Card>
            ) : emp.documents.map(doc => (
              <Card key={doc.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 grid grid-cols-3 gap-3">
                  <Input value={doc.name} onChange={e => setEmp(prev => ({ ...prev, documents: prev.documents.map(d => d.id === doc.id ? { ...d, name: e.target.value } : d) }))} placeholder="Nombre del documento" />
                  <Select value={doc.type} onChange={e => setEmp(prev => ({ ...prev, documents: prev.documents.map(d => d.id === doc.id ? { ...d, type: e.target.value as typeof doc.type } : d) }))}>
                    {['contrato', 'nomina', 'certificado', 'formacion', 'sancion', 'otro'].map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                  <Input type="date" value={doc.date} onChange={e => setEmp(prev => ({ ...prev, documents: prev.documents.map(d => d.id === doc.id ? { ...d, date: e.target.value } : d) }))} />
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEmp(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== doc.id) }))}>✕</Button>
              </Card>
            ))}
          </div>
        )}

        {/* ── AUSENCIAS ── */}
        {tab === 'ausencias' && (
          <div className="space-y-3">
            <Button size="sm" variant="outline" onClick={() => {
              const v = { id: `v-${Date.now()}`, type: 'Vacaciones' as const, startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), status: 'solicitada' as const }
              setEmp(prev => ({ ...prev, vacations: [v, ...prev.vacations] }))
            }}>+ Añadir ausencia</Button>
            {emp.vacations.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-400 text-sm">Sin ausencias</p></Card>
            ) : emp.vacations.map(v => (
              <Card key={v.id} className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
                <Select value={v.type} onChange={e => setEmp(prev => ({ ...prev, vacations: prev.vacations.map(x => x.id === v.id ? { ...x, type: e.target.value as typeof v.type } : x) }))}>
                  {['Vacaciones', 'Baja médica', 'Permiso', 'Asuntos propios'].map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Input type="date" value={v.startDate} onChange={e => setEmp(prev => ({ ...prev, vacations: prev.vacations.map(x => x.id === v.id ? { ...x, startDate: e.target.value } : x) }))} />
                <Input type="date" value={v.endDate} onChange={e => setEmp(prev => ({ ...prev, vacations: prev.vacations.map(x => x.id === v.id ? { ...x, endDate: e.target.value } : x) }))} />
                <div className="flex items-center gap-2">
                  <Select value={v.status} onChange={e => setEmp(prev => ({ ...prev, vacations: prev.vacations.map(x => x.id === v.id ? { ...x, status: e.target.value as typeof v.status } : x) }))}>
                    {['solicitada', 'aprobada', 'rechazada'].map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => setEmp(prev => ({ ...prev, vacations: prev.vacations.filter(x => x.id !== v.id) }))}>✕</Button>
                </div>
              </Card>
            ))}
          </div>
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
                <Label>Horas semanales</Label>
                <Input className="mt-1" type="number" value={emp.weeklyHours} onChange={e => update('weeklyHours', parseInt(e.target.value) || 0)} />
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
            <p className="text-xs text-gray-500">Horas acumuladas en la bolsa. Positivo = el trabajador tiene horas a su favor. Negativo = debe horas.</p>
            <div className="flex items-center gap-4 p-4 rounded-2xl border bg-gray-50">
              <div className="text-center flex-1">
                <p className={`text-4xl font-bold ${(emp.hourBank||0)>0?'text-emerald-600':(emp.hourBank||0)<0?'text-red-600':'text-gray-400'}`}>
                  {(emp.hourBank||0)>0?'+':''}{(emp.hourBank||0).toFixed(1)}h
                </p>
                <p className="text-xs text-gray-500 mt-1">Saldo actual</p>
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <label className="text-xs text-gray-500 uppercase font-medium">Ajuste manual (horas)</label>
                  <div className="flex gap-2 mt-1">
                    <input type="number" step="0.5" placeholder="+2.5 o -1.0"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                      id={`hourbank-adj-${emp.id}`} />
                    <button onClick={() => {
                      const inp = document.getElementById(`hourbank-adj-${emp.id}`) as HTMLInputElement
                      const val = parseFloat(inp?.value||'0')
                      if(isNaN(val)) return
                      update('hourBank', (emp.hourBank||0) + val)
                      if(inp) inp.value = ''
                    }} className="px-3 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700">
                      Añadir
                    </button>
                  </div>
                </div>
                <button onClick={()=>update('hourBank',0)} className="w-full text-xs text-gray-400 hover:text-red-500 border border-gray-200 rounded-lg py-1.5">
                  Resetear bolsa a 0
                </button>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
              💡 La bolsa de horas permite compensar semanas con más o menos trabajo sin necesidad de pagar horas extras inmediatamente. Se actualiza automáticamente cada vez que un empleado trabaja por encima o por debajo de sus horas contratadas.
            </div>
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
