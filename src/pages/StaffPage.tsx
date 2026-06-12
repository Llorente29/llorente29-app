import { useState, useMemo, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import type { Employee, ClockEntry, WeeklySchedule } from '../types'
import DocumentosTab from '../components/personal/DocumentosTab'
import VacacionesTab from '../components/personal/VacacionesTab'
import FormacionesTab from '../components/personal/FormacionesTab'
import SendMessageModal from '../components/personal/SendMessageModal'
import AccesoTrabajadorPanel from '../components/personal/AccesoTrabajadorPanel'
import InsightsPage from './InsightsPage'
import {
  createEmployeeWithAccount,
  deactivateEmployeeAccount,
  reactivateEmployeeAccount,
  deletePermanentEmployee,
  setEmployeePassword,
  grantEmployeeAccess,
} from '../services/employeeAuthService'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import {
  BarChart3, Users, AlertTriangle, Search, LogOut, Trash2, RefreshCw,
  Camera, LogIn, Square, Mail, X, ShieldCheck, Calendar, Sun, Moon, Ban,
  User, UserMinus, UserX, FileText, Key, UserPlus,
  type LucideIcon,
} from 'lucide-react'


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

const TERMINATION_OPTIONS: { id: TerminationType; label: string; Icon: LucideIcon; description: string }[] = [
  { id: 'voluntaria', label: 'Voluntaria', Icon: UserMinus, description: 'El empleado ha decidido marcharse' },
  { id: 'fin_contrato', label: 'Fin de contrato', Icon: Calendar, description: 'Contrato temporal que llega a su fin' },
  { id: 'despido', label: 'Despido', Icon: UserX, description: 'Por causas objetivas o disciplinarias' },
  { id: 'jubilacion', label: 'Jubilación', Icon: User, description: 'Jubilación ordinaria o anticipada' },
  { id: 'otro', label: 'Otro', Icon: FileText, description: 'Otra causa de baja' },
]

function getScheduledMinutes(str: string) {
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

export default function StaffPage() {
  const { staff, locations, createEmployee, saveEmployee, removeEmployee, gestoriaConfig, activeAccountId, userProfile } = useApp()
  const [mainTab, setMainTab] = useState<'insights' | 'list'>('insights')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [locFilter, setLocFilter] = useState('todas')
  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'inactive'>('active')

  // El selector global de local manda: local activo → filtra a ese local;
  // consolidado (null) → 'todas'. El select propio sigue disponible.
  const { resolvedLocationId } = useLocationScope()
  useEffect(() => {
    setLocFilter(resolvedLocationId ?? 'todas')
  }, [resolvedLocationId])
  const [contractFilter, setContractFilter] = useState('todos')
  const [showNewEmployeeModal, setShowNewEmployeeModal] = useState(false)

  // Permisos del usuario logueado en la cuenta activa.
  // BLOQUE B-7 (16/05/2026): migrado de fetch directo al service viejo
  // (con dynamic import + getManagerPermissions) a hook usePermissions().
  // - Reactivo: si cambian los permisos en otra pestaña, se actualiza solo.
  // - Sin query Supabase adicional: AppContext ya tiene permissions cargados.
  // - hasPermission() ya considera isFullAccess (admin bypasea permisos).
  const { hasPermission } = usePermissions()
  const canSeeSalaries = hasPermission('show_salaries')
  const canManageEmployees = hasPermission('can_manage_employees')

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
          <h1 className="text-2xl font-display text-text-primary">Personal</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {staff.length} empleados · {staff.filter(e => e.active).length} activos · {workingNow} trabajando ahora
          </p>
        </div>
        {canManageEmployees && (
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
        )}
      </div>

      {/* Pestañas principales: Insights / Empleados */}
      <div className="flex items-center gap-1 bg-accent-bg rounded-lg p-1 w-fit">
        <button
          onClick={() => setMainTab('insights')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-base ${
            mainTab === 'insights'
              ? 'bg-card shadow-sm text-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <BarChart3 size={14} /> Insights
        </button>
        <button
          onClick={() => setMainTab('list')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-base ${
            mainTab === 'list'
              ? 'bg-card shadow-sm text-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Users size={14} /> Empleados
        </button>
      </div>

      {/* Contenido según pestaña */}
      {mainTab === 'insights' && <InsightsPage />}

      {mainTab === 'list' && (
        <>
          {/* Banner de contratos / periodos de prueba próximos a vencer */}
          {expiringEvents.length > 0 && (
            <div className="bg-warning-bg border-2 border-warning/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-warning" />
                <span className="font-semibold text-warning text-sm">
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
                    className={`w-full text-left text-xs px-2 py-1.5 rounded-md border transition-base hover:opacity-80 ${
                      ev.urgency === 'red' ? 'border-danger/30 bg-danger-bg text-danger' :
                      ev.urgency === 'orange' ? 'border-warning/40 bg-warning-bg text-warning' :
                      'border-warning/30 bg-warning-bg text-warning'
                    }`}
                  >
                    <strong>{ev.employeeName}</strong> · {ev.label} · vence en{' '}
                    <strong>{ev.daysLeft === 0 ? 'hoy' : ev.daysLeft === 1 ? 'mañana' : `${ev.daysLeft} días`}</strong>
                  </button>
                ))}
                {expiringEvents.length > 5 && (
                  <p className="text-xs text-warning italic">y {expiringEvents.length - 5} más...</p>
                )}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
              <Input
                placeholder="Buscar nombre, DNI, puesto..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={locFilter} onChange={e => setLocFilter(e.target.value)} className="w-44">
              <option value="todas">Todos los locales</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={stateFilter} onChange={e => setStateFilter(e.target.value as 'all' | 'active' | 'inactive')} className="w-36">
              <option value="active">Activos</option>
              <option value="inactive">Bajas</option>
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
              <p className="text-text-secondary">Primero crea un local en la sección Locales</p>
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-text-secondary">{search || locFilter !== 'todas' || contractFilter !== 'todos' ? 'No se encontraron empleados con esos filtros' : 'No hay empleados. Crea uno arriba.'}</p>
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
                    className={`p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-base ${!emp.active ? 'opacity-60' : ''}`}
                  >
                    <EmployeeAvatar employee={emp} size="md" showWorkingDot={isWorking} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-text-primary">{emp.name || 'Sin nombre'}</p>
                      <p className="text-xs text-text-secondary truncate">
                        {emp.position || '(sin puesto)'} · {loc?.name || '—'}
                        {emp.contractType && <> · <span className="text-text-secondary">{emp.contractType}</span></>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {!emp.active && <Badge color="gray">Baja</Badge>}
                      {isWorking && <Badge color="green">Trabajando</Badge>}
                      {empExpiring.map((ev, i) => (
                        <Badge
                          key={i}
                          color={ev.urgency === 'red' ? 'red' : 'yellow'}
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
          gestoriaEmail={gestoriaConfig?.gestoriaEmail ?? ''}
          canSeeSalaries={canSeeSalaries}
          canManageEmployees={canManageEmployees}
          accountId={activeAccountId}
          senderEmployeeId={userProfile?.employeeId ?? null}
          senderName={userProfile?.displayName ?? null}
        />
      )}

      {/* Modal "Nuevo Empleado": pide datos mínimos y crea cuenta con Magic Link */}
      {showNewEmployeeModal && (
        <NewEmployeeModal
          locations={locations}
          onCancel={() => setShowNewEmployeeModal(false)}
          onCreated={(employeeId) => {
            setShowNewEmployeeModal(false)
            const exists = staff.some(e => e.id === employeeId)
            if (exists) {
              setSelectedId(employeeId)
            }
            setMainTab('list')
          }}
          onCreateLocal={async ({ name, locationId, assignedLocations, pin }) => {
            // FIX P6: construir el empleado con los datos reales del formulario.
            // Antes se llamaba a createEmployee(locationId) que solo conocía el
            // locationId → empleado vacío con name='', PIN=''.
            const base = createEmployee(locationId)
            const emp: Employee = {
              ...base,
              name,
              pin: pin ?? '',
              assignedLocations: assignedLocations.length > 1 ? assignedLocations : undefined,
            }
            await saveEmployee(emp)
            return emp.id
          }}
        />
      )}
    </div>
  )
}


// ─── Employee Detail Modal ────────────────────────────────────────────────────

function EmployeeModal({ employee, onClose, onSave, onDelete, locations, gestoriaEmail, canSeeSalaries, canManageEmployees, accountId, senderEmployeeId, senderName }: {
  employee: Employee
  onClose: () => void
  onSave: (e: Employee) => void
  onDelete: (id: string) => void
  locations: ReturnType<typeof useApp>['locations']
  gestoriaEmail: string
  canSeeSalaries: boolean
  canManageEmployees: boolean
  accountId: string | null
  senderEmployeeId: string | null
  senderName: string | null
}) {
  const [emp, setEmp] = useState<Employee>({ ...employee, clockEntries: [...employee.clockEntries] })
  const [tab, setTab] = useState('info')
  const [clocking, setClocking] = useState(false)
  const [clockWarn, setClockWarn] = useState<{ type: 'blocked' | 'rounded' | 'real'; msg: string } | null>(null)
  const [showTerminationModal, setShowTerminationModal] = useState(false)
  const [showSendMessage, setShowSendMessage] = useState(false)
  const [regeneratedPassword, setRegeneratedPassword] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [copiedRegenerated, setCopiedRegenerated] = useState(false)
  const [showGrantAccess, setShowGrantAccess] = useState(false)
  const [grantUsername, setGrantUsername] = useState('')
  const [grantPassword, setGrantPassword] = useState('')
  const [grantRole, setGrantRole] = useState<'worker' | 'manager'>('worker')
  const [grantSubmitting, setGrantSubmitting] = useState(false)
  const [grantedCredentials, setGrantedCredentials] = useState<{ username: string; password: string } | null>(null)
  const [grantError, setGrantError] = useState<string | null>(null)
  const [grantCopied, setGrantCopied] = useState(false)

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
    { value: 'info', label: 'Datos' },
    { value: 'fichajes', label: 'Fichajes' },
    { value: 'documentos', label: 'Docs' },
    { value: 'ausencias', label: 'Ausencias' },
    { value: 'formaciones', label: 'Formaciones' },
    { value: 'contrato', label: 'Contrato' },
    { value: 'disponibilidad', label: 'Disponibilidad' },
  ]

  return (
    <Modal open onClose={onClose} size="xl" title={emp.name || 'Nuevo empleado'}>
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} tabs={TABS} />

        {/* ── DATOS ── */}
        {tab === 'info' && (
          <div className="grid grid-cols-2 gap-4">
            {/* Foto + cabecera */}
            <div className="col-span-2 flex items-center gap-4 pb-3 border-b border-border-default">
              <EmployeeAvatar employee={emp} size="xl" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg truncate text-text-primary">{emp.name || '(sin nombre)'}</p>
                <p className="text-sm text-text-secondary">{emp.position || '(sin puesto)'} · {emp.contractType || '(sin contrato)'}</p>
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
              <p className="text-xs text-text-secondary mb-2">Si rota entre varios locales, marca todos. Si está vacío, solo podrá fichar en su local principal.</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {locations.map(l => {
                  const assigned = emp.assignedLocations || []
                  const checked = assigned.includes(l.id)
                  return (
                    <label key={l.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-base ${checked ? 'bg-accent-bg border-accent text-accent' : 'border-border-default text-text-secondary hover:border-text-secondary'}`}>
                      <input type="checkbox" checked={checked}
                        className="accent-accent"
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
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-success-bg border border-success/20">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-sm font-medium text-success">Empleado en activo</span>
                </div>
              ) : (
                <div className="px-3 py-2 rounded-md bg-page border border-border-default">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Calendar size={16} className="text-text-secondary" />
                        <span className="text-sm font-bold text-text-primary">Empleado dado de baja</span>
                      </div>
                      <p className="text-xs text-text-secondary">
                        {emp.terminationType ? (
                          <>
                            Tipo: <strong>{TERMINATION_LABELS[emp.terminationType as TerminationType]}</strong>
                            {emp.endDate && ` · ${new Date(emp.endDate + 'T00:00:00').toLocaleDateString('es-ES')}`}
                          </>
                        ) : 'Sin tipo registrado'}
                      </p>
                      {emp.terminationReason && (
                        <p className="text-xs text-text-secondary italic mt-1">"{emp.terminationReason}"</p>
                      )}
                      {emp.terminationCommunicatedToGestoria && (
                        <p className="text-xs text-success mt-1">✓ Comunicado a gestoría</p>
                      )}
                    </div>
                    {canManageEmployees && (
                      <button
                        onClick={async () => {
                          update('active', true)
                          update('terminationType', undefined)
                          update('terminationReason', undefined)
                          update('terminationCommunicatedToGestoria', false)
                          try {
                            await reactivateEmployeeAccount(emp.id)
                          } catch (e) {
                            console.warn('[Reactivate] No se pudo reactivar cuenta auth:', e)
                          }
                        }}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-card border border-success/30 text-success hover:bg-success-bg font-medium shrink-0 transition-base"
                      >
                        <RefreshCw size={12} /> Reactivar
                      </button>
                    )}
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
              <Card className="p-4 text-center text-sm text-text-secondary">
                Guarda primero los datos del empleado para poder fichar.
              </Card>
            ) : (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs text-text-secondary">Estado actual</p>
                    <p className="text-sm font-semibold text-accent inline-flex items-center gap-1.5">
                      {isWorking
                        ? <><span className="w-2 h-2 rounded-full bg-success" /> Trabajando</>
                        : <><span className="w-2 h-2 rounded-full bg-text-secondary" /> Sin entrada</>
                      }
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-secondary">Hoy</p>
                    <p className="text-sm font-semibold tabular-nums text-text-primary">{hoursToday.toFixed(1)}h</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => handleClock('entrada')} disabled={clocking || isWorking}>
                    <LogIn size={14} /> Entrada
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleClock('salida')} disabled={clocking || !isWorking}>
                    <Square size={14} /> Salida
                  </Button>
                </div>
                {clockWarn && (
                  <Alert type={clockWarn.type === 'blocked' ? 'error' : clockWarn.type === 'rounded' ? 'warning' : 'info'}>
                    {clockWarn.msg}
                  </Alert>
                )}
              </Card>
            )}

            <div className="border border-border-default rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-border-default">
                  <tr>
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary">Fecha y hora</th>
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary">Tipo</th>
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.clockEntries.length === 0 ? (
                    <tr><td colSpan={3} className="p-4 text-center text-text-secondary italic">Sin fichajes</td></tr>
                  ) : (
                    emp.clockEntries.slice(0, 30).map((ce, i) => (
                      <tr key={i} className="border-b border-border-default last:border-0">
                        <td className="p-2 text-xs text-text-primary">{new Date(ce.datetime).toLocaleString('es-ES')}</td>
                        <td className="p-2"><Badge color={ce.type === 'entrada' ? 'green' : 'red'}>{ce.type}</Badge></td>
                        <td className="p-2 text-xs text-text-secondary">
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
                <p className="text-xs text-text-secondary mt-1">
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
                    className="text-xs px-2 py-2 rounded-md border border-border-default text-text-secondary hover:bg-page whitespace-nowrap transition-base"
                    title="Restaurar valor por defecto del tipo de contrato"
                  >
                    Por defecto
                  </button>
                </div>
                <p className="text-xs text-text-secondary mt-1">
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
                <p className="text-xs text-text-secondary mt-1">
                  Positivo: la empresa le debe horas. Negativo: él debe.
                </p>
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={emp.showHoursBalance ?? true}
                    onChange={e => update('showHoursBalance', e.target.checked)}
                    className="w-4 h-4 rounded accent-accent"
                  />
                  <span className="text-sm text-text-primary">El trabajador ve su bolsa de horas en la app</span>
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
                <p className="text-xs text-text-secondary mt-1">
                  Los descansos siempre caen entre Lunes y Jueves. Viernes, sábado y
                  domingo no descansa nadie por política del local.
                </p>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Horario por días</Label>
              <div className="border border-border-default rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {DAYS.map(day => {
                      const sched = emp.weeklySchedule?.[day] || { active: false, start: '', end: '' }
                      const hours = sched.active && sched.start && sched.end
                        ? ((getScheduledMinutes(sched.end) - getScheduledMinutes(sched.start)) / 60).toFixed(1)
                        : null
                      return (
                        <tr key={day} className={`border-b border-border-default last:border-0 ${!sched.active ? 'bg-page' : ''}`}>
                          <td className="p-2 w-8">
                            <input
                              type="checkbox"
                              checked={sched.active}
                              className="accent-accent"
                              onChange={e => update('weeklySchedule', { ...emp.weeklySchedule, [day]: { ...sched, active: e.target.checked } })}
                            />
                          </td>
                          <td className={`p-2 w-28 font-medium text-sm ${!sched.active ? 'text-text-secondary' : 'text-text-primary'}`}>{DAY_LABELS[day]}</td>
                          <td className="p-2">
                            {sched.active ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="time"
                                  value={sched.start}
                                  onChange={e => update('weeklySchedule', { ...emp.weeklySchedule, [day]: { ...sched, start: e.target.value } })}
                                  className="border border-border-default rounded px-2 py-1 text-xs bg-card text-text-primary"
                                />
                                <span className="text-text-secondary">→</span>
                                <input
                                  type="time"
                                  value={sched.end}
                                  onChange={e => update('weeklySchedule', { ...emp.weeklySchedule, [day]: { ...sched, end: e.target.value } })}
                                  className="border border-border-default rounded px-2 py-1 text-xs bg-card text-text-primary"
                                />
                              </div>
                            ) : null}
                          </td>
                          <td className="p-2 text-xs text-text-secondary w-16">
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
            <p className="text-xs text-text-secondary">Marca en qué turnos está disponible este trabajador. El generador de horarios lo respetará.</p>
            <div className="border border-border-default rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-page border-b border-border-default">
                  <th className="p-3 text-left text-xs font-semibold text-text-secondary">Día</th>
                  <th className="p-3 text-center text-xs font-semibold text-warning">
                    <span className="inline-flex items-center gap-1.5 justify-center"><Sun size={14} /> Mediodía</span>
                  </th>
                  <th className="p-3 text-center text-xs font-semibold text-accent">
                    <span className="inline-flex items-center gap-1.5 justify-center"><Moon size={14} /> Noche</span>
                  </th>
                  <th className="p-3 text-center text-xs font-semibold text-danger">
                    <span className="inline-flex items-center gap-1.5 justify-center"><Ban size={14} /> No disponible</span>
                  </th>
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
                      <tr key={day} className={`border-b border-border-default last:border-0 ${isNoDisp ? 'bg-danger-bg' : ''}`}>
                        <td className="p-3 font-medium text-sm text-text-primary">{labels[day]}</td>
                        {['manana','tarde'].map(t => (
                          <td key={t} className="p-3 text-center">
                            <input type="checkbox" checked={avail.includes(t) && !isNoDisp}
                              onChange={()=>toggle(t)} disabled={isNoDisp}
                              className={`w-4 h-4 rounded ${t==='manana'?'accent-warning':'accent-accent'}`} />
                          </td>
                        ))}
                        <td className="p-3 text-center">
                          <input type="checkbox" checked={isNoDisp} onChange={()=>toggle('no_disponible')} className="w-4 h-4 accent-danger rounded" />
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
        <div className="flex items-center justify-between pt-3 border-t border-border-default">
          <div className="flex gap-2">
            {canManageEmployees && employee.active && accountId && (
              <Button variant="outline" size="sm" onClick={() => setShowSendMessage(true)}>
                <Mail size={14} /> Enviar mensaje
              </Button>
            )}
            {canManageEmployees && emp.active && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const locName = locations.find(l => l.id === employee.locationId)?.name
                  setGrantUsername(suggestUsername(employee.name, locName))
                  setGrantPassword(generatePassword())
                  setGrantRole(suggestRoleByPosition(employee.position))
                  setGrantError(null)
                  setGrantedCredentials(null)
                  setGrantCopied(false)
                  setShowGrantAccess(true)
                }}
              >
                <UserPlus size={14} /> Dar acceso a la app
              </Button>
            )}
            {canManageEmployees && emp.active && (
              <AccesoTrabajadorPanel employeeId={emp.id} employeeName={emp.name} />
            )}
            {canManageEmployees && emp.active && (
              <Button
                variant="outline"
                size="sm"
                disabled={regenerating}
                onClick={async () => {
                  setRegenerating(true)
                  const nueva = generatePassword()
                  const result = await setEmployeePassword(emp.id, nueva)
                  setRegenerating(false)
                  if (result.ok) {
                    setRegeneratedPassword(nueva)
                  } else {
                    alert(`No se pudo regenerar la contraseña: ${result.error || 'desconocido'}`)
                  }
                }}
              >
                <Key size={14} /> {regenerating ? 'Regenerando…' : 'Regenerar contraseña'}
              </Button>
            )}
            {canManageEmployees && emp.active && (
              <Button variant="outline" size="sm" onClick={() => setShowTerminationModal(true)}>
                <LogOut size={14} /> Dar de baja
              </Button>
            )}
            {canManageEmployees && (
              <Button variant="danger" size="sm" onClick={async () => {
                if (!confirm('¿ELIMINAR PERMANENTEMENTE este empleado?\n\nSe perderán TODOS sus datos: fichajes, vacaciones, documentos Y su cuenta de acceso.\n\nNormalmente prefieres "Dar de baja" en su lugar.')) return
                if (!confirm('Confirma una vez más: esta acción NO se puede deshacer. ¿Continuar?')) return

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
                onDelete(emp.id)
              }}>
                <Trash2 size={14} /> Eliminar permanente
              </Button>
            )}
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

              try {
                await deactivateEmployeeAccount(emp.id)
              } catch (e) {
                console.warn('[Termination] No se pudo desactivar cuenta auth:', e)
              }

              if (data.communicated) {
                try {
                  const gmailUrl = buildGestoriaMailto(updated, locations, gestoriaEmail)
                  setTimeout(() => { window.open(gmailUrl, '_blank') }, 100)
                } catch (e) {
                  console.warn('[Termination] No se pudo abrir Gmail:', e)
                }
              }

              onSave(updated)
            }}
          />
        )}
        {showSendMessage && accountId && (
          <SendMessageModal
            employee={employee}
            accountId={accountId}
            senderEmployeeId={senderEmployeeId}
            senderName={senderName}
            onClose={() => setShowSendMessage(false)}
          />
        )}
        {showGrantAccess && (
          <Modal
            open={true}
            onClose={() => {
              setShowGrantAccess(false)
              setGrantedCredentials(null)
              setGrantError(null)
              setGrantCopied(false)
            }}
            title="Dar acceso a la app"
            size="md"
          >
            {grantedCredentials ? (
              <div className="flex flex-col gap-4">
                <Alert type="success">
                  Acceso creado correctamente. Apunta estos datos y entrégaselos al empleado:
                  la contraseña <strong>no se volverá a mostrar</strong>.
                </Alert>

                <div className="rounded-lg border border-border-default p-4 bg-page">
                  <div className="mb-3">
                    <p className="text-xs text-text-secondary mb-1">Usuario</p>
                    <p className="font-mono text-base font-semibold">{grantedCredentials.username}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary mb-1">Contraseña</p>
                    <p className="font-mono text-base font-semibold">{grantedCredentials.password}</p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!grantedCredentials) return
                      const text = `Usuario: ${grantedCredentials.username}\nContraseña: ${grantedCredentials.password}`
                      try {
                        await navigator.clipboard.writeText(text)
                        setGrantCopied(true)
                        setTimeout(() => setGrantCopied(false), 2000)
                      } catch {
                        setGrantCopied(false)
                      }
                    }}
                  >
                    {grantCopied ? 'Copiado ✓' : 'Copiar credenciales'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setShowGrantAccess(false)
                      setGrantedCredentials(null)
                      setGrantError(null)
                      setGrantCopied(false)
                    }}
                  >
                    Cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <Label>Tipo de acceso</Label>
                  <div className="mt-1 flex flex-col gap-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="grantRole"
                        value="worker"
                        checked={grantRole === 'worker'}
                        onChange={() => setGrantRole('worker')}
                        disabled={grantSubmitting}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary">Trabajador</p>
                        <p className="text-xs text-text-secondary">Accede a su portal (fichar, turnos, documentos).</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="grantRole"
                        value="manager"
                        checked={grantRole === 'manager'}
                        onChange={() => setGrantRole('manager')}
                        disabled={grantSubmitting}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary">Encargado</p>
                        <p className="text-xs text-text-secondary">Accede a gestión y también a su portal.</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div>
                  <Label>Usuario</Label>
                  <Input
                    value={grantUsername}
                    placeholder="pamela.alcala"
                    onChange={(e) => setGrantUsername(e.target.value)}
                    disabled={grantSubmitting}
                  />
                </div>

                <div>
                  <Label>Contraseña</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={grantPassword}
                      onChange={(e) => setGrantPassword(e.target.value)}
                      disabled={grantSubmitting}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGrantPassword(generatePassword())}
                      disabled={grantSubmitting}
                    >
                      Regenerar
                    </Button>
                  </div>
                  <p className="text-xs text-text-secondary mt-1">
                    El empleado entrará con este usuario y contraseña. La verás una vez al crear.
                  </p>
                </div>

                {grantError && <Alert type="error">{grantError}</Alert>}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={grantSubmitting}
                    onClick={() => {
                      setShowGrantAccess(false)
                      setGrantedCredentials(null)
                      setGrantError(null)
                      setGrantCopied(false)
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={grantSubmitting}
                    onClick={async () => {
                      setGrantError(null)
                      const cleanUsername = slugForUsername(grantUsername)
                      if (cleanUsername.length < 3) {
                        setGrantError('El usuario debe tener al menos 3 caracteres válidos (a-z, 0-9, punto, guion bajo).')
                        return
                      }
                      if (grantPassword.length < 6) {
                        setGrantError('La contraseña debe tener al menos 6 caracteres.')
                        return
                      }
                      setGrantSubmitting(true)
                      const result = await grantEmployeeAccess(emp.id, cleanUsername, grantPassword, grantRole)
                      setGrantSubmitting(false)
                      if (result.ok) {
                        setGrantedCredentials({ username: result.username || cleanUsername, password: grantPassword })
                      } else {
                        setGrantError(result.error || 'No se pudo dar acceso.')
                      }
                    }}
                  >
                    {grantSubmitting ? 'Procesando…' : 'Dar acceso'}
                  </Button>
                </div>
              </div>
            )}
          </Modal>
        )}
        {regeneratedPassword !== null && (
          <Modal
            open={true}
            onClose={() => { setRegeneratedPassword(null); setCopiedRegenerated(false) }}
            title="Nueva contraseña"
            size="md"
          >
            <div className="flex flex-col gap-4">
              <Alert type="success">
                Contraseña regenerada correctamente. Apunta esta contraseña y entrégasela al empleado:
                <strong> no se volverá a mostrar</strong>.
              </Alert>

              <div className="rounded-lg border border-border-default p-4 bg-page">
                <p className="text-xs text-text-secondary mb-1">Nueva contraseña</p>
                <p className="font-mono text-base font-semibold">{regeneratedPassword}</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(regeneratedPassword)
                      setCopiedRegenerated(true)
                      setTimeout(() => setCopiedRegenerated(false), 2000)
                    } catch {
                      setCopiedRegenerated(false)
                    }
                  }}
                >
                  {copiedRegenerated ? 'Copiado ✓' : 'Copiar contraseña'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => { setRegeneratedPassword(null); setCopiedRegenerated(false) }}
                >
                  Cerrar
                </Button>
              </div>
            </div>
          </Modal>
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
      <div className="bg-card rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="px-5 py-3 border-b border-border-default bg-accent text-text-on-accent">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-base inline-flex items-center gap-2">
                <LogOut size={16} /> Dar de baja empleado
              </div>
              <div className="text-xs opacity-90">{employee.name}</div>
            </div>
            <button onClick={onCancel} className="text-white/80 hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <Label>Tipo de baja</Label>
            <div className="mt-1 space-y-1.5">
              {TERMINATION_OPTIONS.map(opt => {
                const Icon = opt.Icon
                return (
                  <button
                    key={opt.id}
                    onClick={() => setType(opt.id)}
                    className={`w-full text-left px-3 py-2 rounded-md border-2 transition-base ${
                      type === opt.id
                        ? 'border-accent bg-accent-bg'
                        : 'border-border-default bg-card hover:border-text-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={18} className={type === opt.id ? 'text-accent' : 'text-text-secondary'} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{opt.label}</div>
                        <div className="text-xs text-text-secondary">{opt.description}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
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
            <p className="text-xs text-text-secondary mt-1">
              Día en el que el empleado deja de trabajar.
            </p>
          </div>

          <div>
            <Label>Motivo {type === 'despido' && <span className="text-danger">(recomendado)</span>}</Label>
            <Textarea
              className="mt-1"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={placeholderByType[type]}
            />
          </div>

          <div className="bg-page rounded-md p-3">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={communicated}
                onChange={e => setCommunicated(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-accent"
              />
              <div>
                <span className="text-sm font-medium text-text-primary inline-flex items-center gap-1.5">
                  <Mail size={14} /> Enviar comunicación a la gestoría
                </span>
                <p className="text-xs text-text-secondary mt-0.5">
                  Al confirmar, se abrirá Gmail en una pestaña nueva con un email prerellenado para la gestoría.
                </p>
              </div>
            </label>
            {communicated && (
              <div className="mt-2 ml-6 pl-3 text-xs text-text-secondary border-l-2 border-accent py-1">
                <strong>Destinatario:</strong>{' '}
                <span className="font-mono">configurado en Informes Gestoría</span>
              </div>
            )}
          </div>

          <div className="bg-warning-bg border border-warning/30 rounded-md p-3 text-xs text-warning">
            <strong>Importante:</strong> el empleado quedará marcado como inactivo pero sus datos
            (fichajes, vacaciones, documentos, bolsa de horas) se conservarán. Podrás reactivarlo en
            cualquier momento desde su ficha.
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border-default bg-page flex justify-end gap-2">
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

  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: gestoriaEmail.trim(),
    su: subject,
    body: body,
  })

  return `https://mail.google.com/mail/?${params.toString()}`
}

// ─── EmployeeAvatar: foto o iniciales con fondo accent ────────────────────────

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
        className={`${s.wrap} rounded-full overflow-hidden flex items-center justify-center text-text-on-accent font-semibold ${s.text} border-2 border-card shadow-sm ${!hasPhoto ? 'bg-accent' : ''}`}
      >
        {hasPhoto ? (
          <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </div>
      {showWorkingDot && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${s.dot} bg-success rounded-full border-2 border-card animate-pulse`}
        />
      )}
    </div>
  )
}

// ─── Compresión de imagen para subida de foto ───────────────────────────────

async function compressImageToBase64(file: File, maxSize = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
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
  label: string
  shortLabel: string
  daysLeft: number
  urgency: 'red' | 'orange' | 'yellow'
}

function getExpiringEvents(staff: Employee[]): ExpiringEvent[] {
  const events: ExpiringEvent[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const emp of staff) {
    if (!emp.active) continue

    if (emp.endDate) {
      const endDate = new Date(emp.endDate + 'T00:00:00')
      const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / 86400000)
      if (daysLeft >= 0 && daysLeft <= 30) {
        events.push({
          employeeId: emp.id,
          employeeName: emp.name || '(sin nombre)',
          type: 'contract',
          label: 'Fin de contrato',
          shortLabel: `Contrato ${daysLeft}d`,
          daysLeft,
          urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        })
      }
    }

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
          shortLabel: `Prueba ${daysLeft}d`,
          daysLeft,
          urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        })
      }
    }
  }

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
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border-default text-text-primary hover:bg-page disabled:opacity-40 transition-base"
      >
        {uploading
          ? <>Subiendo...</>
          : employee.photo
            ? <><RefreshCw size={12} /> Cambiar foto</>
            : <><Camera size={12} /> Subir foto</>
        }
      </button>
      {employee.photo && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-xs text-text-secondary hover:text-danger transition-base"
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

  const banners: { label: string; daysLeft: number; color: string; Icon: LucideIcon }[] = []

  if (employee.endDate) {
    const endDate = new Date(employee.endDate + 'T00:00:00')
    const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / 86400000)
    if (daysLeft >= 0 && daysLeft <= 30) {
      banners.push({
        label: 'Fin de contrato',
        daysLeft,
        color: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
        Icon: Calendar,
      })
    }
  }

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
        Icon: ShieldCheck,
      })
    }
  }

  if (banners.length === 0) return null

  return (
    <div className="col-span-2 space-y-1.5">
      {banners.map((b, i) => (
        <div
          key={i}
          className={`px-3 py-2 rounded-md border-2 text-sm flex items-center gap-2 ${
            b.color === 'red' ? 'border-danger/30 bg-danger-bg text-danger' :
            'border-warning/30 bg-warning-bg text-warning'
          }`}
        >
          <b.Icon size={18} />
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

interface NewEmployeeModalProps {
  locations: ReturnType<typeof useApp>['locations']
  onCancel: () => void
  onCreated: (employeeId: string) => void
  // El path "sin acceso a la app" (solo kiosko/PIN). Firma SIN CAMBIOS.
  onCreateLocal: (data: {
    name: string
    locationId: string
    assignedLocations: string[]
    pin?: string
  }) => Promise<string>
}

// ── Helpers C1 (sugerencia de credenciales) ───────────────────────────────────

// Normaliza para username: minúsculas, sin tildes, solo [a-z0-9._].
// Espejo (best-effort en cliente) de normalizeUsername del server; el server
// tiene la última palabra y devuelve el canónico.
function slugForUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._]+|[._]+$/g, '')
}

// Sugiere username "nombre.local". Toma el primer token del nombre y un slug
// corto del nombre del local. Si no hay local usable, cae a "nombre".
function suggestUsername(name: string, locationName: string | undefined): string {
  const first = slugForUsername(name.split(/\s+/)[0] || '')
  const loc = slugForUsername((locationName || '').split(/\s+/)[0] || '')
  if (!first) return ''
  return loc ? `${first}.${loc}` : first
}

// Genera una contraseña legible: "Palabra-NNNN" con dígitos sin confusión.
// Evita O/0/I/l/1 para facilitar el tecleo en móvil.
function generatePassword(): string {
  const words = [
    'Mesa', 'Plato', 'Fuego', 'Sal', 'Pan', 'Vino', 'Cafe', 'Horno',
    'Barra', 'Cocina', 'Turno', 'Hielo', 'Sopa', 'Brasa', 'Menu', 'Tapa',
  ]
  const digits = '23456789' // sin 0/1
  const word = words[Math.floor(Math.random() * words.length)]
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += digits[Math.floor(Math.random() * digits.length)]
  }
  return `${word}-${suffix}`
}

// Sugiere rol por puesto: si el puesto incluye palabras de gestión (encargad*,
// gerente, jefe, responsable) → 'manager'; en cualquier otro caso → 'worker'.
// Heurística; el manager puede cambiarlo en el sub-modal de "Dar acceso".
function suggestRoleByPosition(position: string | undefined): 'worker' | 'manager' {
  const p = (position || '').toLowerCase()
  if (p.includes('encargad') || p.includes('gerente') || p.includes('jefe') || p.includes('responsable')) {
    return 'manager'
  }
  return 'worker'
}

type CreatedCredentials = { username: string; password: string; employeeId: string }

function NewEmployeeModal({ locations, onCancel, onCreated, onCreateLocal }: NewEmployeeModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [additionalLocations, setAdditionalLocations] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // C1: acceso a la app
  const [withAppAccess, setWithAppAccess] = useState(true) // ON por defecto (R2)
  const [username, setUsername] = useState('')
  const [usernameEdited, setUsernameEdited] = useState(false) // si el manager lo tocó, no autorrellenar
  const [password, setPassword] = useState(() => generatePassword())
  const [appRole, setAppRole] = useState<'worker' | 'manager'>('worker') // Trabajador por defecto

  // Tras crear con acceso: credenciales a mostrar (sustituye el form por la
  // pantalla de "apunta estos datos"). Si es null, se muestra el formulario.
  const [created, setCreated] = useState<CreatedCredentials | null>(null)
  const [copied, setCopied] = useState(false)

  function toggleAdditional(id: string) {
    setAdditionalLocations(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  // Sugerencia de username on-blur del nombre (R3), solo si el manager no lo editó.
  function handleNameBlur() {
    if (!withAppAccess || usernameEdited) return
    const locName = locations.find(l => l.id === locationId)?.name
    const suggestion = suggestUsername(name, locName)
    if (suggestion) setUsername(suggestion)
  }

  async function handleSubmit() {
    setError(null)

    if (!name.trim()) {
      setError('El nombre es obligatorio.')
      return
    }
    if (!locationId) {
      setError('Selecciona un local.')
      return
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      setError('El PIN debe tener 4 dígitos.')
      return
    }

    const assigned = [locationId, ...additionalLocations.filter(id => id !== locationId)]

    // ── Path A: empleado CON acceso a la app (C1) ──────────────────────────
    if (withAppAccess) {
      const cleanUsername = slugForUsername(username)
      if (cleanUsername.length < 3) {
        setError('El usuario debe tener al menos 3 caracteres válidos (a-z, 0-9, punto, guion bajo).')
        return
      }
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres.')
        return
      }

      setSubmitting(true)
      const result = await createEmployeeWithAccount({
        name: name.trim(),
        username: cleanUsername,
        password,
        role: appRole,
        email: email.trim() || undefined,
        pin: pin || undefined,
        locationId,
        assignedLocations: assigned.length > 1 ? assigned : undefined,
      })
      setSubmitting(false)

      if (!result.ok) {
        setError(result.error || 'No se pudo crear el empleado.')
        return
      }

      // Éxito: mostrar credenciales antes de cerrar. Usamos el username canónico
      // que devuelve el server (puede diferir tras normalización).
      setCreated({ username: result.username || cleanUsername, password, employeeId: result.employee?.id || '' })
      // Avisar al padre del nuevo empleado para que refresque su lista, pero NO
      // cerramos: el manager debe ver/copiar las credenciales primero.
      if (result.employee?.id) onCreated(result.employee.id)
      return
    }

    // ── Path B: empleado SIN acceso (solo kiosko/PIN). Sin cambios. ────────
    setSubmitting(true)
    try {
      const newId = await onCreateLocal({
        name: name.trim(),
        locationId,
        assignedLocations: assigned,
        pin: pin || undefined,
      })
      onCreated(newId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el empleado.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyCredentials() {
    if (!created) return
    const text = `Usuario: ${created.username}\nContraseña: ${created.password}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Si el portapapeles falla, el manager puede copiar a mano; no es bloqueante.
      setCopied(false)
    }
  }

  // ── Pantalla de credenciales (tras crear con acceso) ───────────────────────
  if (created) {
    return (
      <Modal open={true} onClose={onCancel} title="Acceso creado" size="md">
        <div className="flex flex-col gap-4">
          <Alert type="success">
            Acceso creado correctamente. Apunta estos datos y entrégaselos al empleado:
            la contraseña <strong>no se volverá a mostrar</strong>.
          </Alert>

          <div className="rounded-lg border border-border-default p-4 bg-page">
            <div className="mb-3">
              <p className="text-xs text-text-secondary mb-1">Usuario</p>
              <p className="font-mono text-base font-semibold">{created.username}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary mb-1">Contraseña</p>
              <p className="font-mono text-base font-semibold">{created.password}</p>
            </div>
          </div>

          {created.employeeId && (
            <AccesoTrabajadorPanel employeeId={created.employeeId} employeeName={name} />
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
            <Button variant="outline" size="sm" onClick={handleCopyCredentials}>
              {copied ? 'Copiado ✓' : 'Copiar credenciales'}
            </Button>
            <Button variant="primary" size="sm" onClick={onCancel}>
              Cerrar
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── Formulario de alta ──────────────────────────────────────────────────────
  return (
    <Modal open={true} onClose={onCancel} title="Nuevo empleado" size="md">
      <div className="flex flex-col gap-4">
        <div>
          <Label>Nombre completo</Label>
          <Input
            value={name}
            autoFocus
            placeholder="Ej. Pamela Guzmán"
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameBlur}
            disabled={submitting}
          />
        </div>

        <div>
          <Label>Local principal</Label>
          <Select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            disabled={submitting}
          >
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </Select>
        </div>

        {locations.length > 1 && (
          <div>
            <Label>Locales adicionales</Label>
            <div className="flex flex-col gap-1 mt-1">
              {locations
                .filter(loc => loc.id !== locationId)
                .map(loc => (
                  <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={additionalLocations.includes(loc.id)}
                      onChange={() => toggleAdditional(loc.id)}
                      disabled={submitting}
                    />
                    {loc.name}
                  </label>
                ))}
            </div>
          </div>
        )}

        <div>
          <Label>PIN kiosko (4 dígitos, opcional)</Label>
          <Input
            value={pin}
            placeholder="0000"
            maxLength={4}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            disabled={submitting}
          />
        </div>

        <div>
          <Label>Email (opcional)</Label>
          <Input
            type="email"
            value={email}
            placeholder="Para notificaciones (no es el acceso a la app)"
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* ── Toggle acceso a la app (C1) ─────────────────────────────── */}
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-2 border-t border-border-default">
          <input
            type="checkbox"
            checked={withAppAccess}
            onChange={(e) => setWithAppAccess(e.target.checked)}
            disabled={submitting}
          />
          <span className="font-medium">Dar acceso a la app</span>
        </label>

        {withAppAccess ? (
          <>
            <div>
              <Label>Tipo de acceso</Label>
              <div className="mt-1 flex flex-col gap-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="appRole"
                    value="worker"
                    checked={appRole === 'worker'}
                    onChange={() => setAppRole('worker')}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">Trabajador</p>
                    <p className="text-xs text-text-secondary">Accede a su portal (fichar, turnos, documentos).</p>
                  </div>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="appRole"
                    value="manager"
                    checked={appRole === 'manager'}
                    onChange={() => setAppRole('manager')}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">Encargado</p>
                    <p className="text-xs text-text-secondary">Accede a gestión y también a su portal.</p>
                  </div>
                </label>
              </div>
            </div>
            <div>
              <Label>Usuario</Label>
              <Input
                value={username}
                placeholder="pamela.alcala"
                onChange={(e) => { setUsername(e.target.value); setUsernameEdited(true) }}
                disabled={submitting}
              />
            </div>
            <div>
              <Label>Contraseña</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPassword(generatePassword())}
                  disabled={submitting}
                >
                  Regenerar
                </Button>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                El empleado entrará con este usuario y contraseña. La verás una vez al crear.
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs text-text-secondary">
            Sin acceso a la app: el empleado solo podrá fichar en el kiosko con su PIN.
          </p>
        )}

        {error && <Alert type="error">{error}</Alert>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creando…' : 'Crear empleado'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
