import { useState, useMemo, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import type { Employee, ClockEntry, WeeklySchedule } from '../types'
import DocumentosTab from '../components/personal/DocumentosTab'
import VacacionesTab from '../components/personal/VacacionesTab'
import FormacionesTab from '../components/personal/FormacionesTab'
import InsightsPage from './InsightsPage'
import {
  createEmployeeWithAccount,
  deactivateEmployeeAccount,
  reactivateEmployeeAccount,
  deletePermanentEmployee,
} from '../services/employeeAuthService'
import { getCurrentProfile } from '../services/authService'


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
  const [mainTab, setMainTab] = useState<'insights' | 'list'>('insights')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [locFilter, setLocFilter] = useState('todas')
  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [contractFilter, setContractFilter] = useState('todos')
  const [showNewEmployeeModal, setShowNewEmployeeModal] = useState(false)
  const [canSeeSalaries, setCanSeeSalaries] = useState(false)

  // Cargar perfil del usuario actual (para permisos)
  useEffect(() => {
    async function loadProfile() {
      const p = await getCurrentProfile()
      // Si es manager, verificar permiso show_salaries
      if (p?.role === 'manager') {
        try {
          const mod = await import('../services/managerPermissionsService')
          const perms = await mod.getManagerPermissions(p.id)
          setCanSeeSalaries(perms.show_salaries)
        } catch {
          setCanSeeSalaries(false)
        }
      } else if (p?.role === 'admin') {
        setCanSeeSalaries(true)
      }
    }
    loadProfile()
  }, [])

  const filtered = staff.filter(e => {
    if (locFilter !== 'todas' && e.locationId !== locFilter) return false
    if (stateFilter === 'active' && !e.active) return false
    if (stateFilter === 'inactive' && e.active) return false
    if (contractFilter !== 'todos' && e.contractType !== contractFilter) return false
    const q = search.toLowerCase()
    if (q && !(e.name.toLowerCase().includes(q) || e.dni.toLowerCase().includes(q) || e.position.toLowerCase().includes(q))) return false
    return true
  })

  const workingNow = staff.filter(e => e.clockEntries[0]?.type === 'entrada').length

  // Detectar empleados con contrato o periodo de prueba próximos a vencer
  const expiringEvents = useMemo(() => {
    return getExpiringEvents(staff)
  }, [staff])

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
            setShowNewEmployeeModal(true)
          }}
          disabled={locations.length === 0}
        >
          + Nuevo Empleado
        </Button>
      </div>

      {/* Pestañas principales: Insights / Empleados */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setMainTab('insights')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
            mainTab === 'insights'
              ? 'bg-white shadow text-[#7C1A1A]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          📊 Insights
        </button>
        <button
          onClick={() => setMainTab('list')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
            mainTab === 'list'
              ? 'bg-white shadow text-[#7C1A1A]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          👥 Empleados
        </button>
      </div>

      {/* Contenido según pestaña */}
      {mainTab === 'insights' && <InsightsPage />}

      {mainTab === 'list' && (
        <>
          {/* Banner de contratos / periodos de prueba próximos a vencer */}
          {expiringEvents.length > 0 && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <span className="font-semibold text-amber-900 text-sm">
                  {expiringEvents.length === 1
                    ? '1 evento próximo'
                    : `${expiringEvents.length} eventos próximos`}
                </span>
              </div>
              <div className="space-y-1">
                {expiringEvents.slice(0, 5).map((ev, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedId(ev.employeeId)}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded border ${
                      ev.urgency === 'red' ? 'border-red-300 bg-red-50 text-red-800' :
                      ev.urgency === 'orange' ? 'border-orange-300 bg-orange-50 text-orange-800' :
                      'border-amber-300 bg-amber-50 text-amber-800'
                    } hover:opacity-80`}
                  >
                    <strong>{ev.employeeName}</strong> · {ev.label} · vence en{' '}
                    <strong>{ev.daysLeft === 0 ? 'hoy' : ev.daysLeft === 1 ? 'mañana' : `${ev.daysLeft} días`}</strong>
                  </button>
                ))}
                {expiringEvents.length > 5 && (
                  <p className="text-[11px] text-amber-700 italic">y {expiringEvents.length - 5} más...</p>
                )}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="🔍 Buscar nombre, DNI, puesto..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] max-w-xs"
            />
            <Select value={locFilter} onChange={e => setLocFilter(e.target.value)} className="w-44">
              <option value="todas">Todos los locales</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={stateFilter} onChange={e => setStateFilter(e.target.value as 'all' | 'active' | 'inactive')} className="w-36">
              <option value="active">✅ Activos</option>
              <option value="inactive">📅 Bajas</option>
              <option value="all">Todos</option>
            </Select>
            <Select value={contractFilter} onChange={e => setContractFilter(e.target.value)} className="w-44">
              <option value="todos">Todos los contratos</option>
              {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          {/* Employee list */}
          {locations.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-500">Primero crea un local en la sección Locales</p>
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-500">{search || locFilter !== 'todas' || contractFilter !== 'todos' ? 'No se encontraron empleados con esos filtros' : 'No hay empleados. Crea uno arriba.'}</p>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filtered.map(emp => {
                const loc = locations.find(l => l.id === emp.locationId)
                const isWorking = emp.clockEntries[0]?.type === 'entrada' && emp.active
                const empExpiring = expiringEvents.filter(ev => ev.employeeId === emp.id)
                return (
                  <Card
                    key={emp.id}
                    onClick={() => setSelectedId(emp.id)}
                    className={`p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition ${!emp.active ? 'opacity-60' : ''}`}
                  >
                    <EmployeeAvatar employee={emp} size="md" showWorkingDot={isWorking} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{emp.name || 'Sin nombre'}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {emp.position || '(sin puesto)'} · {loc?.name || '—'}
                        {emp.contractType && <> · <span className="text-gray-400">{emp.contractType}</span></>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {!emp.active && <Badge color="gray">📅 Baja</Badge>}
                      {isWorking && <Badge color="green">🟢 Trabajando</Badge>}
                      {empExpiring.map((ev, i) => (
                        <Badge
                          key={i}
                          color={ev.urgency === 'red' ? 'red' : ev.urgency === 'orange' ? 'amber' : 'amber'}
                        >
                          {ev.shortLabel}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Employee Detail Modal (siempre disponible, abierto desde cualquier pestaña) */}
      {selectedId && staff.find(e => e.id === selectedId) && (
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
          canSeeSalaries={canSeeSalaries}
        />
      )}

      {/* Modal "Nuevo Empleado": pide datos mínimos y crea cuenta con Magic Link */}
      {showNewEmployeeModal && (
        <NewEmployeeModal
          locations={locations}
          onCancel={() => setShowNewEmployeeModal(false)}
          onCreated={(employeeId) => {
            setShowNewEmployeeModal(false)
            // Solo intentamos abrir la ficha si el empleado YA está en el array staff.
            // Si fue creado vía Edge Function, puede tardar 1-2s en aparecer (vía realtime/sync),
            // en ese caso no abrimos ficha — el usuario lo verá en el listado al refrescarse.
            const exists = staff.some(e => e.id === employeeId)
            if (exists) {
              setSelectedId(employeeId)
            }
            // Forzar pestaña de listado para que el usuario vea su empleado
            setMainTab('list')
          }}
          onCreateLocal={async (locationId) => {
            // Caso "sin email": crear local-only (sin cuenta auth)
            const emp = createEmployee(locationId)
            await saveEmployee(emp)
            return emp.id
          }}
        />
      )}
    </div>
  )
}


// ─── Employee Detail Modal ────────────────────────────────────────────────────

function EmployeeModal({ employee, onClose, onSave, onDelete, locations, notifConfig, canSeeSalaries }: {
  employee: Employee
  onClose: () => void
  onSave: (e: Employee) => void
  onDelete: (id: string) => void
  locations: ReturnType<typeof useApp>['locations']
  notifConfig: ReturnType<typeof useApp>['notifConfig']
  canSeeSalaries: boolean
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
    { value: 'formaciones', label: '🎓 Formaciones' },
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
            {/* Foto + cabecera */}
            <div className="col-span-2 flex items-center gap-4 pb-3 border-b">
              <EmployeeAvatar employee={emp} size="xl" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg truncate">{emp.name || '(sin nombre)'}</p>
                <p className="text-sm text-gray-500">{emp.position || '(sin puesto)'} · {emp.contractType || '(sin contrato)'}</p>
              </div>
              <PhotoUploader employee={emp} onChange={photo => update('photo', photo)} />
            </div>

            {/* Avisos de eventos próximos del empleado */}
            <EmployeeExpiryBanners employee={emp} />

            <div className="col-span-2">
              <Label>Nombre completo</Label>
              <Input className="mt-1" value={emp.name} onChange={e => update('name', e.target.value)} placeholder="Nombre apellidos" />
            </div>
            <div>
              <Label>DNI / NIE</Label>
              <Input className="mt-1" value={emp.dni} onChange={e => update('dni', e.target.value)} placeholder="12345678A" />
            </div>
            <div>
              <Label>Fecha de nacimiento</Label>
              <Input className="mt-1" type="date" value={emp.birthDate || ''} onChange={e => update('birthDate', e.target.value)} />
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
                            Tipo: <strong>{TERMINATION_LABELS[emp.terminationType as TerminationType]}</strong>
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
                      onClick={async () => {
                        update('active', true)
                        update('terminationType', undefined)
                        update('terminationReason', undefined)
                        update('terminationCommunicatedToGestoria', false)
                        // Reactivar cuenta de acceso (auth) si existe + enviar email.
                        try {
                          await reactivateEmployeeAccount(emp.id)
                        } catch (e) {
                          console.warn('[Reactivate] No se pudo reactivar cuenta auth:', e)
                        }
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

        {/* ── FORMACIONES ── */}
        {tab === 'formaciones' && (
          <FormacionesTab employee={emp} />
        )}

        {/* ── CONTRATO ── */}
        {tab === 'contrato' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo de contrato</Label>
                <Select className="mt-1" value={emp.contractType} onChange={e => {
                  const newType = e.target.value
                  update('contractType', newType)
                  // Si no hay periodo de prueba aún, autocompletar con el valor por defecto del tipo
                  if (!emp.trialPeriodDays) {
                    update('trialPeriodDays', defaultTrialDays(newType))
                  }
                }}>
                  {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label>Fecha de alta</Label>
                <Input className="mt-1" type="date" value={emp.startDate} onChange={e => update('startDate', e.target.value)} />
              </div>
              <div>
                <Label>Fecha fin contrato (opcional)</Label>
                <Input className="mt-1" type="date" value={emp.endDate || ''} onChange={e => update('endDate', e.target.value)} />
                <p className="text-[11px] text-gray-500 mt-1">
                  Solo para contratos temporales/prácticas. Verás aviso 30/15/5 días antes.
                </p>
              </div>
              <div>
                <Label>Periodo de prueba (días)</Label>
                <div className="flex gap-2 items-start mt-1">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={emp.trialPeriodDays ?? ''}
                    onChange={e => update('trialPeriodDays', parseInt(e.target.value, 10) || undefined)}
                    placeholder={String(defaultTrialDays(emp.contractType))}
                  />
                  <button
                    type="button"
                    onClick={() => update('trialPeriodDays', defaultTrialDays(emp.contractType))}
                    className="text-xs px-2 py-2 rounded border border-gray-300 hover:bg-gray-50 whitespace-nowrap"
                    title="Restaurar valor por defecto del tipo de contrato"
                  >
                    Por defecto
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  {emp.startDate && emp.trialPeriodDays
                    ? <>Termina el <strong>{new Date(new Date(emp.startDate + 'T00:00:00').getTime() + emp.trialPeriodDays * 86400000).toLocaleDateString('es-ES')}</strong></>
                    : 'Recomendado: 90 indef. · 30 temp. · 60 prácticas'}
                </p>
              </div>
              {canSeeSalaries && (
                <div>
                  <Label>Salario bruto anual (€)</Label>
                  <Input className="mt-1" type="number" value={emp.salary} onChange={e => update('salary', parseFloat(e.target.value) || 0)} />
                </div>
              )}
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
            <Button variant="danger" size="sm" onClick={async () => {
              if (!confirm('¿ELIMINAR PERMANENTEMENTE este empleado?\n\nSe perderán TODOS sus datos: fichajes, vacaciones, documentos Y su cuenta de acceso.\n\nNormalmente prefieres "Dar de baja" en su lugar.')) return
              if (!confirm('Confirma una vez más: esta acción NO se puede deshacer. ¿Continuar?')) return

              // Eliminación COMPLETA vía Edge Function:
              // borra employee + user_profile + manager_locations + manager_permissions + auth.user
              try {
                const result = await deletePermanentEmployee(emp.id)
                if (!result.ok) {
                  alert(`Error al eliminar: ${result.error || 'desconocido'}`)
                  return
                }
              } catch (e) {
                alert(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
                return
              }
              // Cerrar modal y refrescar listado (el sync de Supabase actualizará staff)
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
            onConfirm={async (data) => {
              const updated: Employee = {
                ...emp,
                active: false,
                endDate: data.endDate,
                terminationType: data.type,
                terminationReason: data.reason || undefined,
                terminationCommunicatedToGestoria: data.communicated,
              }
              setShowTerminationModal(false)

              // Desactivar cuenta de acceso (auth) si existe.
              // No bloquear si falla — la baja se aplica igualmente.
              try {
                await deactivateEmployeeAccount(emp.id)
              } catch (e) {
                console.warn('[Termination] No se pudo desactivar cuenta auth:', e)
              }

              // Si el gestor marcó "Comunicado a gestoría", abrir Gmail con email prerellenado
              if (data.communicated) {
                try {
                  const gmailUrl = buildGestoriaMailto(updated, locations, notifConfig?.gestoriaEmail || '')
                  // Pequeño delay para que se vea el feedback visual del confirm antes de saltar a Gmail
                  setTimeout(() => { window.open(gmailUrl, '_blank') }, 100)
                } catch (e) {
                  console.warn('[Termination] No se pudo abrir Gmail:', e)
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
                  Al confirmar, se abrirá Gmail en una pestaña nueva con un email prerellenado para la gestoría.
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

// ─── Helper para construir URL de Gmail Compose con datos de baja ────────────

/**
 * Construye un URL directo de Gmail Compose con asunto y cuerpo prerellenados.
 * Ventaja sobre `mailto:`: NO depende de la configuración del navegador.
 * Funciona siempre abriendo Gmail web en una pestaña nueva.
 *
 * Formato: https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...
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

  // URL directa de Gmail Compose (no requiere configuración del navegador)
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: gestoriaEmail.trim(),
    su: subject,
    body: body,
  })

  return `https://mail.google.com/mail/?${params.toString()}`
}

// ─── EmployeeAvatar: foto o iniciales con fondo granate ───────────────────────

function EmployeeAvatar({
  employee,
  size = 'md',
  showWorkingDot = false,
}: {
  employee: Employee
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showWorkingDot?: boolean
}) {
  const sizes = {
    sm: { wrap: 'w-8 h-8', text: 'text-sm', dot: 'w-2 h-2' },
    md: { wrap: 'w-11 h-11', text: 'text-lg', dot: 'w-3 h-3' },
    lg: { wrap: 'w-16 h-16', text: 'text-2xl', dot: 'w-4 h-4' },
    xl: { wrap: 'w-24 h-24', text: 'text-3xl', dot: 'w-5 h-5' },
  }
  const s = sizes[size]
  const initial = employee.name ? employee.name.trim()[0]?.toUpperCase() : '?'
  const hasPhoto = !!employee.photo

  return (
    <div className="relative shrink-0">
      <div
        className={`${s.wrap} rounded-full overflow-hidden flex items-center justify-center text-white font-semibold ${s.text} border-2 border-white shadow-sm`}
        style={!hasPhoto ? { backgroundColor: '#7C1A1A' } : undefined}
      >
        {hasPhoto ? (
          <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </div>
      {showWorkingDot && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${s.dot} bg-emerald-500 rounded-full border-2 border-white animate-pulse`}
        />
      )}
    </div>
  )
}

// ─── Compresión de imagen para subida de foto ───────────────────────────────

/**
 * Comprime una imagen al tamaño máximo dado y la devuelve como base64.
 * - Mantiene proporciones
 * - Convierte siempre a JPEG con calidad 0.85 para reducir tamaño
 * - Por defecto max 800x800px
 */
async function compressImageToBase64(file: File, maxSize = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        // Reducir manteniendo proporciones
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('No se pudo obtener el contexto canvas')); return }
        ctx.drawImage(img, 0, 0, width, height)
        // JPEG con calidad 85% (buen equilibrio tamaño/calidad)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        resolve(dataUrl)
      }
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

// ─── Detector de eventos próximos a vencer ───────────────────────────────────

interface ExpiringEvent {
  employeeId: string
  employeeName: string
  type: 'contract' | 'trial'
  label: string         // "Contrato termina" o "Periodo de prueba termina"
  shortLabel: string    // "📅 Contrato 30d" o "🛡️ Prueba 5d"
  daysLeft: number
  urgency: 'red' | 'orange' | 'yellow'  // <=5 / 6-15 / 16-30
}

/**
 * Devuelve la lista de empleados con eventos (fin de contrato / fin periodo prueba)
 * en los próximos 30 días. Solo considera empleados activos.
 */
function getExpiringEvents(staff: Employee[]): ExpiringEvent[] {
  const events: ExpiringEvent[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const emp of staff) {
    if (!emp.active) continue

    // 1) Fin de contrato (endDate)
    if (emp.endDate) {
      const endDate = new Date(emp.endDate + 'T00:00:00')
      const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / 86400000)
      if (daysLeft >= 0 && daysLeft <= 30) {
        events.push({
          employeeId: emp.id,
          employeeName: emp.name || '(sin nombre)',
          type: 'contract',
          label: 'Fin de contrato',
          shortLabel: `📅 Contrato ${daysLeft}d`,
          daysLeft,
          urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        })
      }
    }

    // 2) Fin de periodo de prueba (startDate + trialPeriodDays)
    if (emp.startDate && emp.trialPeriodDays && emp.trialPeriodDays > 0) {
      const startDate = new Date(emp.startDate + 'T00:00:00')
      const trialEnd = new Date(startDate)
      trialEnd.setDate(trialEnd.getDate() + emp.trialPeriodDays)
      const daysLeft = Math.floor((trialEnd.getTime() - today.getTime()) / 86400000)
      if (daysLeft >= 0 && daysLeft <= 30) {
        events.push({
          employeeId: emp.id,
          employeeName: emp.name || '(sin nombre)',
          type: 'trial',
          label: 'Fin periodo de prueba',
          shortLabel: `🛡️ Prueba ${daysLeft}d`,
          daysLeft,
          urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        })
      }
    }
  }

  // Ordenar por urgencia (menos días primero)
  events.sort((a, b) => a.daysLeft - b.daysLeft)
  return events
}

// ─── Default trial period según tipo de contrato ─────────────────────────────

function defaultTrialDays(contractType: string): number {
  if (contractType === 'Indefinido') return 90
  if (contractType === 'Temporal') return 30
  if (contractType === 'Prácticas') return 60
  return 30
}

// ─── Subir foto del empleado con compresión automática ────────────────────────

function PhotoUploader({
  employee,
  onChange,
}: {
  employee: Employee
  onChange: (photoBase64: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      alert('El archivo debe ser una imagen (JPG, PNG, etc.)')
      return
    }
    setUploading(true)
    try {
      const base64 = await compressImageToBase64(file, 800)
      onChange(base64)
    } catch (e) {
      console.error('[PhotoUploader] Error:', e)
      alert('No se pudo procesar la imagen. Intenta con otra.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
      >
        {uploading ? '⏳ Subiendo...' : employee.photo ? '🔄 Cambiar foto' : '📸 Subir foto'}
      </button>
      {employee.photo && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-[11px] text-gray-400 hover:text-red-600"
        >
          Quitar foto
        </button>
      )}
    </div>
  )
}

// ─── Banners de aviso en la pestaña Datos ────────────────────────────────────

function EmployeeExpiryBanners({ employee }: { employee: Employee }) {
  if (!employee.active) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const banners: { label: string; daysLeft: number; color: string; icon: string }[] = []

  // Fin de contrato
  if (employee.endDate) {
    const endDate = new Date(employee.endDate + 'T00:00:00')
    const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / 86400000)
    if (daysLeft >= 0 && daysLeft <= 30) {
      banners.push({
        label: 'Fin de contrato',
        daysLeft,
        color: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        icon: '📅',
      })
    }
  }

  // Fin periodo de prueba
  if (employee.startDate && employee.trialPeriodDays && employee.trialPeriodDays > 0) {
    const startDate = new Date(employee.startDate + 'T00:00:00')
    const trialEnd = new Date(startDate)
    trialEnd.setDate(trialEnd.getDate() + employee.trialPeriodDays)
    const daysLeft = Math.floor((trialEnd.getTime() - today.getTime()) / 86400000)
    if (daysLeft >= 0 && daysLeft <= 30) {
      banners.push({
        label: 'Fin periodo de prueba',
        daysLeft,
        color: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        icon: '🛡️',
      })
    }
  }

  if (banners.length === 0) return null

  return (
    <div className="col-span-2 space-y-1.5">
      {banners.map((b, i) => (
        <div
          key={i}
          className={`px-3 py-2 rounded-lg border-2 text-sm flex items-center gap-2 ${
            b.color === 'red' ? 'border-red-300 bg-red-50 text-red-800' :
            b.color === 'orange' ? 'border-orange-300 bg-orange-50 text-orange-800' :
            'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          <span className="text-lg">{b.icon}</span>
          <div className="flex-1">
            <strong>{b.label}</strong> en{' '}
            <strong>{b.daysLeft === 0 ? 'hoy' : b.daysLeft === 1 ? 'mañana' : `${b.daysLeft} días`}</strong>
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── New Employee Modal ───────────────────────────────────────────────────────
// Pide datos mínimos (nombre, local, email opcional) para crear empleado.
// Si email → crea cuenta Auth + envía Magic Link.
// Si no email → crea solo empleado local.

interface NewEmployeeModalProps {
  locations: ReturnType<typeof useApp>['locations']
  onCancel: () => void
  onCreated: (employeeId: string) => void
  onCreateLocal: (locationId: string) => Promise<string>
}

function NewEmployeeModal({ locations, onCancel, onCreated, onCreateLocal }: NewEmployeeModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [additionalLocations, setAdditionalLocations] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleAdditional(locId: string) {
    setAdditionalLocations(prev =>
      prev.includes(locId) ? prev.filter(x => x !== locId) : [...prev, locId]
    )
  }

  async function handleSubmit() {
    setError(null)
    if (!name.trim()) {
      setError('Falta el nombre')
      return
    }
    if (!locationId) {
      setError('Selecciona un local')
      return
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      setError('El PIN debe ser 4 dígitos')
      return
    }

    setSubmitting(true)

    // Combinar local principal + adicionales (sin duplicar)
    const allAssigned = [locationId, ...additionalLocations.filter(id => id !== locationId)]

    // Caso 1: con email → Edge Function (crea Auth + Magic Link)
    if (email.trim()) {
      const result = await createEmployeeWithAccount({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        locationId,
        assignedLocations: allAssigned,
        pin: pin || undefined,
      }, true)

      setSubmitting(false)
      if (!result.ok || !result.employee) {
        setError(result.error || 'Error al crear empleado')
        return
      }
      onCreated(result.employee.id)
      return
    }

    // Caso 2: sin email → empleado local (sin cuenta acceso)
    try {
      const empId = await onCreateLocal(locationId)
      setSubmitting(false)
      onCreated(empId)
    } catch (e) {
      setSubmitting(false)
      setError(e instanceof Error ? e.message : 'Error al crear empleado')
    }
  }

  return (
    <Modal open onClose={onCancel} title="Nuevo empleado">
      <div className="space-y-4">
        <div>
          <Label>Nombre completo *</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ej: Pamela García"
            autoFocus
          />
        </div>

        <div>
          <Label>Local principal *</Label>
          <Select value={locationId} onChange={e => setLocationId(e.target.value)}>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>

        {locations.length > 1 && (
          <div>
            <Label>Locales adicionales (opcional)</Label>
            <div className="space-y-1.5 mt-1">
              {locations.filter(l => l.id !== locationId).map(l => (
                <label
                  key={l.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-[#7C1A1A] cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={additionalLocations.includes(l.id)}
                    onChange={() => toggleAdditional(l.id)}
                  />
                  <span>{l.name}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Marca otros locales donde también puede trabajar y fichar.
            </p>
          </div>
        )}

        <div>
          <Label>Email (opcional, recomendado)</Label>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="ej: pamela@email.com"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            {email
              ? '✉️ Recibirá un enlace de acceso a la app por email.'
              : '⚠️ Sin email solo podrá fichar en kiosko, no acceder a la app personal.'}
          </p>
        </div>

        <div>
          <Label>PIN (4 dígitos, opcional)</Label>
          <Input
            type="text"
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="Ej: 1234"
            maxLength={4}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Necesario para fichar en el kiosko.
          </p>
        </div>

        {error && (
          <Alert type="error">{error}</Alert>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creando...' : email ? 'Crear y enviar acceso' : 'Crear empleado'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
