import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Location, Employee, Task, Template, Incident, Audit, NotifConfig, WeeklySchedule, WeeklySchedulePlan, ClockEntry } from '../types'
import type { ActiveLocationId, BrandFilter, Account, UserProfile, UserProfileRole, ManagerPermissions } from '../types/multitenancy'
import { supabase } from '../lib/supabase'
import {
  isSupabaseEnabled,
  fetchLocations, upsertLocation, deleteLocation,
  fetchEmployees, upsertEmployee, deleteEmployee,
  fetchClockEntries, insertClockEntry,
  subscribeToChanges,
} from '../services/supabaseSync'
import { listAccounts } from '../modules/multitenancy/services/accountsService'
import { listUserProfilesByUser, getUserProfile } from '../modules/multitenancy/services/userProfilesService'
import { getPermissions } from '../modules/multitenancy/services/managerPermissionsService'
import { parseRoute, buildRoute, isValidSlugShape } from '../routes'

const DEFAULT_SCHEDULE: WeeklySchedule = {
  lunes: { active: true, start: '09:00', end: '17:00' },
  martes: { active: true, start: '09:00', end: '17:00' },
  miercoles: { active: true, start: '09:00', end: '17:00' },
  jueves: { active: true, start: '09:00', end: '17:00' },
  viernes: { active: true, start: '09:00', end: '17:00' },
  sabado: { active: false, start: '', end: '' },
  domingo: { active: false, start: '', end: '' },
}

const DEFAULT_NOTIF: NotifConfig = {
  whatsappEnabled: false, whatsappNumber: '',
  emailEnabled: false, emailAddress: '',
  pushEnabled: false, smsEnabled: false, smsNumber: '',
  reminderMinutes: 30, overdueMinutes: 15,
  escalateEnabled: false, escalateTo: '', escalateMinutes: 60,
  gestoriaEmail: '', gestoriaEnabled: false, gestoriaDayOfMonth: 25,
  gestoriaNombre: '', gestoriaLastSent: '',
}

const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'tpl-1', name: 'Control de Temperaturas APPCC',
    description: 'Registro obligatorio de temperaturas según normativa APPCC.',
    category: 'APPCC', priority: 'alta', frequency: 'diaria', estimatedMinutes: 15,
    requiresPhoto: false, requiresSignature: true,
    checklist: [
      { id: 'cl-1', text: 'Cámara frigorífica 1 - Carnes (0-4°C)', required: true },
      { id: 'cl-2', text: 'Cámara frigorífica 2 - Pescados (0-2°C)', required: true },
      { id: 'cl-3', text: 'Cámara frigorífica 3 - Lácteos (2-6°C)', required: true },
      { id: 'cl-4', text: 'Congelador 1 (-18°C o menos)', required: true },
    ],
    fields: [
      { id: 'f-1', label: 'Temperatura Cámara 1', type: 'temperature', required: true, min: -5, max: 10, unit: '°C' },
      { id: 'f-2', label: 'Temperatura Congelador', type: 'temperature', required: true, min: -30, max: -10, unit: '°C' },
      { id: 'f-3', label: 'Observaciones', type: 'text', required: false, placeholder: 'Anotar incidencias...' },
    ],
    assignableRoles: ['Encargado', 'Cocinero'], locations: ['all'],
    tags: ['obligatorio', 'APPCC'], active: true,
    createdAt: '2026-01-15', updatedAt: '2026-04-20', color: '#0d9488', icon: '🌡️'
  },
  {
    id: 'tpl-2', name: 'Checklist Apertura Local',
    description: 'Verificación para apertura del establecimiento.',
    category: 'apertura', priority: 'alta', frequency: 'diaria', estimatedMinutes: 20,
    requiresPhoto: false, requiresSignature: true,
    checklist: [
      { id: 'cl-1', text: 'Verificar limpieza general', required: true },
      { id: 'cl-2', text: 'Encender equipos de cocina', required: true },
      { id: 'cl-3', text: 'Comprobar stock mínimo', required: true },
      { id: 'cl-4', text: 'Revisar reservas del día', required: true },
      { id: 'cl-5', text: 'Verificar estado de baños', required: true },
      { id: 'cl-6', text: 'Comprobar TPV operativo', required: true },
    ],
    fields: [
      { id: 'f-1', label: 'Hora de apertura real', type: 'datetime', required: true },
      { id: 'f-2', label: 'Personal presente', type: 'number', required: true, min: 1, max: 30 },
      { id: 'f-3', label: 'Incidencias', type: 'text', required: false, placeholder: 'Describir si hubo incidencias...' },
    ],
    assignableRoles: ['Encargado', 'Gerente'], locations: ['all'],
    tags: ['apertura', 'obligatorio'], active: true,
    createdAt: '2026-01-10', updatedAt: '2026-03-15', color: '#ec4899', icon: '🔓'
  },
  {
    id: 'tpl-3', name: 'Limpieza Profunda Cocina',
    description: 'Limpieza exhaustiva semanal de cocina.',
    category: 'limpieza', priority: 'media', frequency: 'semanal', estimatedMinutes: 90,
    requiresPhoto: true, requiresSignature: false,
    checklist: [
      { id: 'cl-1', text: 'Limpiar campana extractora', required: true },
      { id: 'cl-2', text: 'Fregar suelos con desengrasante', required: true },
      { id: 'cl-3', text: 'Limpiar freidoras a fondo', required: true },
      { id: 'cl-4', text: 'Desinfectar superficies de trabajo', required: true },
      { id: 'cl-5', text: 'Limpiar desagües', required: true },
    ],
    fields: [
      { id: 'f-1', label: 'Productos utilizados', type: 'text', required: false },
      { id: 'f-2', label: 'Incidencias encontradas', type: 'textarea', required: false },
    ],
    assignableRoles: ['Cocinero', 'Ayudante cocina'], locations: ['all'],
    tags: ['limpieza', 'semanal'], active: true,
    createdAt: '2026-01-10', updatedAt: '2026-03-10', color: '#3b82f6', icon: '🧹'
  },
]

const STORAGE_KEY = 'andy-app-v4'

// Key separada para activeLocationId. NO se mezcla con STORAGE_KEY porque
// es un valor independiente (selector global del header) y queremos poder
// migrar/limpiar cada cosa sin afectar a la otra.
const ACTIVE_LOCATION_KEY = 'andy-app-active-location'

// Key para la cuenta activa multi-tenant (Bloque B). Persiste el UUID, NO el slug:
//   - El UUID es estable; el slug puede cambiar (rebrand, decisión administrativa).
//   - El binding URL↔slug es asunto de Bloque C (routing).
// Prefijo "andy-app-" mantenido por consistencia con keys legacy; renombrar
// a "foodint-active-account" se hará en Bloque F (limpieza naming).
const ACTIVE_ACCOUNT_KEY = 'andy-app-active-account'

interface AppContextType {
  locations: Location[]
  staff: Employee[]; setStaff: React.Dispatch<React.SetStateAction<Employee[]>>
  tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  templates: Template[]; setTemplates: React.Dispatch<React.SetStateAction<Template[]>>
  incidents: Incident[]; setIncidents: React.Dispatch<React.SetStateAction<Incident[]>>
  audits: Audit[]; setAudits: React.Dispatch<React.SetStateAction<Audit[]>>
  notifConfig: NotifConfig; setNotifConfig: React.Dispatch<React.SetStateAction<NotifConfig>>
  schedules: WeeklySchedulePlan[]; setSchedules: React.Dispatch<React.SetStateAction<WeeklySchedulePlan[]>>
  createEmployee: (locationId: string) => Employee
  defaultSchedule: WeeklySchedule
  // Estado de sincronización
  syncing: boolean
  cloudEnabled: boolean
  lastSync: Date | null
  // Acciones que sincronizan con Supabase
  saveEmployee: (e: Employee) => Promise<void>
  removeEmployee: (id: string) => Promise<void>
  saveLocation: (l: Location) => Promise<void>
  removeLocation: (id: string) => Promise<void>
  addClockEntry: (employeeId: string, entry: ClockEntry) => Promise<void>
  // Identidad operativa (quién está actuando ahora en la UI)
  currentEmployee: Employee | null
  currentEmployeeId: string | null
  setCurrentEmployeeId: (id: string | null) => void
  isAdmin: boolean
  adminEmail: string | null
  // authUserId: UUID de auth.users.id del user logueado en Supabase Auth.
  // null si no hay sesión activa. Útil para componentes que necesitan
  // identificar al user sin pasar por user_profile (que es scope-cuenta).
  // Ejemplo: detectar "este es el row del propio user" en una lista
  // de usuarios global.
  authUserId: string | null
  // authResolved: false al arrancar, true en cuanto Supabase responde a la
  // primera consulta de sesión. Permite distinguir "aún cargando auth"
  // de "no hay sesión" — ambos casos tienen authUserId=null pero significan
  // cosas distintas para el caller (Cargando vs LoginPage).
  authResolved: boolean
  // ─── Scope del módulo Stock / multitenancy (añadido sesión 16-may-2026) ─
  // activeLocationId: selector global del header. 'all' = modo consolidado
  //   (lectura agregada, escrituras de Stock bloqueadas).
  //   UUID = un local concreto.
  //   PERSISTE en localStorage entre recargas.
  activeLocationId: ActiveLocationId
  setActiveLocationId: (id: ActiveLocationId) => void
  // activeBrandFilter: filtro multi-select de marcas para vistas analíticas.
  //   [] = sin filtro (todas).
  //   NO persiste (intencionado: el admin reentra sin filtros confusos).
  activeBrandFilter: BrandFilter
  setActiveBrandFilter: (filter: BrandFilter) => void
  // ─── Shell multi-tenant (Bloque B fase 2 — añadido 16-may-2026) ─────────
  // accounts: cuentas a las que pertenece el user logueado.
  //   Se cargan cuando hay sesión Supabase (adminEmail !== null).
  //   [] = aún no cargadas / user sin perfiles / fallo de carga.
  accounts: Account[]
  // accountsLoading: true mientras se cargan las cuentas tras login.
  //   Componentes que asuman activeAccount no nulo DEBEN respetar este flag.
  accountsLoading: boolean
  // activeAccountId: UUID de la cuenta activa. null si no hay sesión o el
  //   user no tiene cuentas. Persiste en localStorage (ACTIVE_ACCOUNT_KEY).
  //   Si el id persistido ya no es accesible, se auto-selecciona la primera
  //   cuenta disponible y se emite console.warn.
  activeAccountId: string | null
  setActiveAccountId: (id: string) => void
  // activeAccount: derivado de accounts.find(id). null mientras carga.
  activeAccount: Account | null
  // userProfile: perfil del user en la cuenta activa. null si:
  //   - No hay cuenta activa (accountsLoading o sin cuentas).
  //   - No se ha podido resolver el perfil (inconsistencia BBDD).
  userProfile: UserProfile | null
  // roleInActiveAccount: rol del user en la cuenta activa.
  //   NO es el sustituto de isAdmin todavía (migración progresiva): isAdmin
  //   sigue siendo !!adminEmail. roleInActiveAccount expone el rol granular
  //   para código nuevo que lo necesite. La migración de isAdmin se hará
  //   en una sesión posterior tras auditar todos sus usos.
  roleInActiveAccount: UserProfileRole | null
  // permissions: manager_permissions del user en la cuenta activa.
  //   null si:
  //   - No hay cuenta activa.
  //   - El user_profile aún no tiene fila de permisos (perfil sin seed).
  //   - El rol del user no requiere permisos (admin global / worker).
  permissions: ManagerPermissions | null
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const saved = (() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null }
    catch { return null }
  })()

  const [locations, setLocations] = useState<Location[]>(saved?.locations || [])
  const [staff, setStaff] = useState<Employee[]>(saved?.staff || [])
  const [tasks, setTasks] = useState<Task[]>(saved?.tasks || [])
  const [templates, setTemplates] = useState<Template[]>(saved?.templates || DEFAULT_TEMPLATES)
  const [incidents, setIncidents] = useState<Incident[]>(saved?.incidents || [])
  const [audits, setAudits] = useState<Audit[]>(saved?.audits || [])
  const [notifConfig, setNotifConfig] = useState<NotifConfig>(saved?.notifConfig || DEFAULT_NOTIF)
  const [schedules, setSchedules] = useState<WeeklySchedulePlan[]>(saved?.schedules || [])

  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  // ─── Router hooks (Bloque C completo Fase 1) ────────────────────────────
  //
  // useLocation/useNavigate provienen del <BrowserRouter> de main.tsx.
  // Usados más abajo para:
  //   - Leer el slug de cuenta de la URL al arrancar (prioridad sobre
  //     localStorage).
  //   - Actualizar la URL cuando el user cambia de cuenta vía dropdown.
  //   - Reaccionar a botón "atrás" del navegador.
  const location = useLocation()
  const navigate = useNavigate()

  // ─── Cuenta activa (declaración adelantada para Bloque B-3) ────────────
  //
  // activeAccountId tiene que declararse ANTES del syncFromCloudRef porque
  // el useEffect del sync lo usa como dependencia. TypeScript estricto
  // bloquea referencias forward (TS2448/TS2454).
  //
  // El SETTER y los useEffects de carga (accounts/userProfile/permissions)
  // viven más abajo en la sección "Shell multi-tenant" — no son dependencias
  // hoist-críticas.
  //
  // Inicial: lee localStorage. Si el valor persistido no es accesible para
  // este user, el useEffect de Shell lo corrige más tarde (auto-select +
  // console.warn).
  const [activeAccountId, setActiveAccountIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_ACCOUNT_KEY) } catch { return null }
  })

  // ─── Sincronización con Supabase ───────────────────────────────────────
  //
  // BLOQUE B-3: syncFromCloudRef recibe accountId por argumento (NO captura
  // activeAccountId del closure). Esto facilita que los callbacks de
  // subscribeToChanges() capturen el accountId correcto vía useEffect.
  const syncFromCloudRef = useRef<(accountId: string) => Promise<void>>(async () => {})

  syncFromCloudRef.current = async (accountId: string) => {
    if (!isSupabaseEnabled) return
    setSyncing(true)
    try {
      const [cloudLocs, cloudEmps, cloudClocks] = await Promise.all([
        fetchLocations(accountId),
        fetchEmployees(accountId),
        fetchClockEntries(accountId),
      ])
      if (cloudLocs) setLocations(cloudLocs)
      if (cloudEmps && cloudClocks) {
        // Adjuntar fichajes a sus empleados
        const byEmp = new Map<string, ClockEntry[]>()
        for (const { employeeId, entry } of cloudClocks) {
          if (!byEmp.has(employeeId)) byEmp.set(employeeId, [])
          byEmp.get(employeeId)!.push(entry)
        }
        const enriched = cloudEmps.map(e => ({
          ...e,
          clockEntries: byEmp.get(e.id) || [],
        }))
        setStaff(enriched)
      }
      setLastSync(new Date())
    } catch (e) {
      console.error('Error sincronizando desde Supabase:', e)
    } finally {
      setSyncing(false)
    }
  }

  // Carga inicial + suscripción a cambios en tiempo real.
  //
  // BLOQUE B-3: depende de activeAccountId.
  //   - Sin cuenta activa → no sincroniza ni suscribe (efecto vacío).
  //   - Al cambiar de cuenta → unsub del canal anterior, sync de la nueva,
  //     suscribe con callbacks que capturan el nuevo accountId.
  //
  // CACHE: STORAGE_KEY global, no por cuenta. Al cambiar, durante ~500ms se
  // ven datos viejos hasta que el sync termine. Deuda apuntada.
  useEffect(() => {
    if (!isSupabaseEnabled) return
    if (!activeAccountId) return
    const accountId = activeAccountId  // captura local para los callbacks
    syncFromCloudRef.current(accountId)
    const unsub = subscribeToChanges(
      () => syncFromCloudRef.current(accountId),
      () => syncFromCloudRef.current(accountId),
      () => syncFromCloudRef.current(accountId),
    )
    return unsub
  }, [activeAccountId])

  // Persistir todo en localStorage como cache local
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        locations, staff, tasks, templates, incidents, audits, notifConfig, schedules
      }))
    } catch { console.warn('localStorage full') }
  }, [locations, staff, tasks, templates, incidents, audits, notifConfig, schedules])

  // ─── Acciones que escriben a Supabase ──────────────────────────────────

  const saveEmployee = async (e: Employee) => {
    // Actualización optimista local
    setStaff(prev => {
      const idx = prev.findIndex(p => p.id === e.id)
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = e; return copy
      }
      return [...prev, e]
    })
    if (isSupabaseEnabled) {
      const result = await upsertEmployee(e)
      if (result && result.id !== e.id) {
        // Supabase asignó un id nuevo (UUID), actualizamos localmente
        setStaff(prev => prev.map(p => p.id === e.id ? { ...result, clockEntries: p.clockEntries } : p))
      }
    }
  }

  const removeEmployee = async (id: string) => {
    setStaff(prev => prev.filter(p => p.id !== id))
    if (isSupabaseEnabled) await deleteEmployee(id)
  }

  const saveLocation = async (l: Location) => {
    setLocations(prev => {
      const idx = prev.findIndex(p => p.id === l.id)
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = l; return copy
      }
      return [...prev, l]
    })
    if (isSupabaseEnabled) {
      // upsertLocation requiere accountId obligatorio (INSERT necesita scope).
      // Si no hay cuenta activa, lanzamos: es un error programático llamar
      // saveLocation antes de tener cuenta resuelta. El optimistic update
      // local ya se aplicó arriba.
      if (!activeAccountId) {
        throw new Error('saveLocation: no hay cuenta activa. Espera a accountsLoading=false.')
      }
      const result = await upsertLocation(activeAccountId, l)
      if (result && result.id !== l.id) {
        setLocations(prev => prev.map(p => p.id === l.id ? result : p))
      }
    }
  }

  const removeLocation = async (id: string) => {
    setLocations(prev => prev.filter(p => p.id !== id))
    if (isSupabaseEnabled) await deleteLocation(id)
  }

  const addClockEntry = async (employeeId: string, entry: ClockEntry) => {
    setStaff(prev => prev.map(e =>
      e.id === employeeId
        ? { ...e, clockEntries: [...(e.clockEntries || []), entry] }
        : e
    ))
    if (isSupabaseEnabled) await insertClockEntry(employeeId, entry)
  }

  const createEmployee = (locationId: string): Employee => ({
    id: `s-${Date.now()}`, name: '', dni: '', phone: '', email: '', photo: '',
    locationId, position: 'Camarero', department: 'Sala', contractType: 'Indefinido',
    startDate: new Date().toISOString().slice(0, 10), endDate: '',
    salary: 0, weeklyHours: 40, schedule: 'L-V 9:00-17:00',
    weeklySchedule: DEFAULT_SCHEDULE, active: true, notes: '',
    clockEntries: [], documents: [], vacations: [], formations: [],
  })

  // ─── Identidad operativa ───────────────────────────────────────────────
  // currentEmployeeId: empleado seleccionado en la UI (persistido).
  // - Cuando un trabajador entra con PIN, se setea aquí.
  // - Cuando un admin opera, queda null (es admin, no employee).
  // - Cuando un admin actúa "en nombre de" un trabajador (p.ej. registrar
  //   una incidencia que ha visto un camarero), puede seleccionarlo.
  const CURRENT_EMP_KEY = 'andy-app-current-employee'
  const [currentEmployeeId, setCurrentEmployeeIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(CURRENT_EMP_KEY) } catch { return null }
  })
  const setCurrentEmployeeId = (id: string | null) => {
    setCurrentEmployeeIdState(id)
    try {
      if (id) localStorage.setItem(CURRENT_EMP_KEY, id)
      else localStorage.removeItem(CURRENT_EMP_KEY)
    } catch { /* localStorage no disponible */ }
  }

  const currentEmployee = useMemo(
    () => staff.find(e => e.id === currentEmployeeId) ?? null,
    [staff, currentEmployeeId]
  )

  // isAdmin: hay sesión Supabase Auth activa (los admins se logean con email).
  //
  // NOTA (Bloque B): este flag NO se migra todavía a userProfile.role === 'admin'.
  // Razón: 30+ componentes lo usan asumiendo "hay sesión Supabase", romperlo
  // sin auditar todos los usos puede tumbar Llorente29. Migración programada
  // para fase posterior (ver §10 de CONTEXTO_CLAUDE.md). Mientras tanto,
  // código nuevo que necesite rol granular usa roleInActiveAccount.
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  // authResolved: false al montar, true en cuanto Supabase devuelve la primera
  // respuesta de auth. Permite a los consumidores distinguir "aún cargando"
  // de "no hay sesión". Añadido en Bloque B-6b (17/05/2026).
  const [authResolved, setAuthResolved] = useState<boolean>(false)
  useEffect(() => {
    if (!supabase) {
      // Modo sin Supabase: nunca habrá auth. Marcamos como "resuelto" para
      // que la app no se quede en "Cargando..." indefinidamente.
      setAuthResolved(true)
      return
    }
    void supabase.auth.getUser().then(({ data }) => {
      setAdminEmail(data.user?.email ?? null)
      setAuthUserId(data.user?.id ?? null)
      setAuthResolved(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAdminEmail(session?.user?.email ?? null)
      setAuthUserId(session?.user?.id ?? null)
      // Si llega un evento sin haber resuelto, marcamos también:
      setAuthResolved(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])
  const isAdmin = !!adminEmail

  // ─── Scope del módulo Stock / multitenancy ─────────────────────────────
  // activeLocationId: selector global del header. Persiste en localStorage
  // bajo su propia key (no en STORAGE_KEY del JSON principal).
  //
  // Valor inicial: 'all' (modo consolidado, lectura agregada).
  //   - Las páginas de Stock con escritura deben usar un hook que valide
  //     que activeLocationId !== 'all' antes de operar (futuro:
  //     useLocationScope().requireLocation()).
  //   - Las páginas de lectura/analítica funcionan en cualquier modo.
  const [activeLocationId, setActiveLocationIdState] = useState<ActiveLocationId>(() => {
    try {
      const stored = localStorage.getItem(ACTIVE_LOCATION_KEY)
      // Valores válidos: 'all' o un UUID. Si está vacío o corrupto → 'all'.
      if (stored && (stored === 'all' || stored.length > 8)) {
        return stored as ActiveLocationId
      }
    } catch { /* localStorage no disponible */ }
    return 'all'
  })
  const setActiveLocationId = (id: ActiveLocationId) => {
    setActiveLocationIdState(id)
    try {
      localStorage.setItem(ACTIVE_LOCATION_KEY, id)
    } catch { /* localStorage no disponible */ }
  }

  // activeBrandFilter: filtro multi-select de marcas. Vive solo en memoria.
  // Si la app recarga, vuelve a [] (sin filtro). Decisión consciente para
  // evitar confusión cuando el admin entra otro día con datos distintos.
  const [activeBrandFilter, setActiveBrandFilter] = useState<BrandFilter>([])

  // ─── Shell multi-tenant (Bloque B fase 2) ──────────────────────────────
  //
  // Flujo de arranque:
  //   1. useEffect detecta authUserId (vía onAuthStateChange).
  //   2. Carga accounts del user (vía user_profiles).
  //   3. Resuelve activeAccountId (localStorage si válido, primera si no).
  //   4. Cargado activeAccountId, resuelve userProfile y permissions en paralelo.
  //
  // Si authUserId === null (sin sesión Supabase, p.ej. trabajador con PIN):
  //   accounts=[], activeAccountId=null. La UI multi-tenant queda inerte.
  //   La identidad de trabajador sigue funcionando vía currentEmployee.

  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountsLoading, setAccountsLoading] = useState<boolean>(false)
  // NOTA: activeAccountId se declara ARRIBA (antes del syncFromCloudRef de
  // Bloque B-3) para evitar TS2448/TS2454. Solo queda aquí su uso.
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [permissions, setPermissions] = useState<ManagerPermissions | null>(null)

  // Ref para acceder a `accounts` desde callbacks sin recreate por dep.
  const accountsRef = useRef<Account[]>([])

  // Setter expuesto: persiste a localStorage, actualiza URL si conocemos el
  // slug, y dispara re-resolución de userProfile/permissions vía useEffect
  // dependiente de activeAccountId.
  //
  // BLOQUE C completo Fase 1: además de localStorage, actualiza la URL para
  // que la barra del navegador refleje la cuenta activa. Esto permite:
  //   - Compartir el link con otro usuario sin que cambie por su localStorage.
  //   - Múltiples pestañas con cuentas distintas (cada pestaña tiene su URL).
  //   - Botón "atrás" del navegador para deshacer cambios de cuenta.
  const setActiveAccountId = useCallback((id: string) => {
    setActiveAccountIdState(id)
    try {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, id)
    } catch { /* localStorage no disponible */ }

    // Actualizar URL si conocemos el slug. accountsRef se mantiene al día
    // vía un useEffect más abajo (sin dispararnos a nosotros mismos).
    // Nota: location.pathname de useLocation YA viene sin basename.
    const acc = accountsRef.current.find(a => a.id === id)
    if (acc) {
      const parsed = parseRoute(location.pathname)
      // Si el slug ya es el correcto, no navegamos (evita loop).
      if (parsed.slug !== acc.slug) {
        navigate(buildRoute(acc.slug, parsed.rest), { replace: false })
      }
    }
  }, [navigate, location.pathname])

  // Carga de cuentas del user al detectar authUserId.
  // Cuando authUserId pasa de null → uuid, cargamos sus user_profiles y de
  // ahí derivamos las accounts. Hacemos 1 query a user_profiles (filtrada
  // por user_id) y 1 query a accounts (filtrada por los account_ids).
  // Las 2 queries respetan RLS naturalmente.
  useEffect(() => {
    if (!authUserId) {
      // Sin sesión: limpiar todo el estado multi-tenant.
      setAccounts([])
      setUserProfile(null)
      setPermissions(null)
      return
    }

    let cancelled = false
    setAccountsLoading(true)

    ;(async () => {
      try {
        // Resolver cuentas vía user_profiles → accounts.
        const profiles = await listUserProfilesByUser(authUserId, { includeInactive: false })
        const accountIds = profiles
          .map(p => p.accountId)
          .filter((id): id is string => id !== null)

        if (accountIds.length === 0) {
          if (!cancelled) {
            console.warn('[AppContext] User sin user_profiles activos. accounts=[]')
            setAccounts([])
          }
          return
        }

        // Listar las accounts. listAccounts respeta RLS y filtra por las
        // accesibles; aún así, includeInternal=true por si el user es admin
        // global y debe ver Foodint Interno.
        const allVisible = await listAccounts({ includeInternal: true })
        const mine = allVisible.filter(a => accountIds.includes(a.id))

        if (cancelled) return

        // Ordenar: internas al final (UX: mostrar primero las cuentas operativas).
        mine.sort((a, b) => {
          if (a.isInternal !== b.isInternal) return a.isInternal ? 1 : -1
          return a.name.localeCompare(b.name)
        })

        setAccounts(mine)

        // Resolver activeAccountId — BLOQUE C completo Fase 1:
        //   1. Si la URL trae un slug válido Y la cuenta es accesible → URL gana.
        //   2. Si no, valor persistido en localStorage (si accesible).
        //   3. Si no, primera cuenta de la lista ordenada.
        //   4. Si no hay cuentas → null.

        const urlParsed = parseRoute(location.pathname)
        const urlAccount = (urlParsed.slug && isValidSlugShape(urlParsed.slug))
          ? mine.find(a => a.slug === urlParsed.slug)
          : undefined

        if (urlAccount) {
          // URL manda. Re-sincronizamos state + localStorage.
          if (activeAccountId !== urlAccount.id) {
            setActiveAccountIdState(urlAccount.id)
          }
          try { localStorage.setItem(ACTIVE_ACCOUNT_KEY, urlAccount.id) } catch { /* no-op */ }
        } else {
          // URL sin slug o inválido. Vamos a localStorage / fallback.
          const persisted = (() => {
            try { return localStorage.getItem(ACTIVE_ACCOUNT_KEY) } catch { return null }
          })()
          const persistedIsValid = persisted && mine.some(a => a.id === persisted)

          let chosenId: string | null
          if (persistedIsValid) {
            chosenId = persisted
            if (activeAccountId !== persisted) {
              setActiveAccountIdState(persisted)
            }
          } else {
            if (persisted) {
              console.warn(
                `[AppContext] activeAccountId persistido "${persisted}" no accesible. ` +
                'Auto-seleccionando primera cuenta disponible.'
              )
            }
            chosenId = mine[0]?.id ?? null
            setActiveAccountIdState(chosenId)
            try {
              if (chosenId) localStorage.setItem(ACTIVE_ACCOUNT_KEY, chosenId)
              else localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
            } catch { /* localStorage no disponible */ }
          }

          // Si la URL NO trae slug pero hay cuenta resuelta → añadir el slug
          // a la URL para que la barra del navegador sea consistente.
          // Si la URL trae slug INVÁLIDO (no encontrado en mine) → corregir.
          if (chosenId) {
            const chosenAccount = mine.find(a => a.id === chosenId)
            if (chosenAccount && urlParsed.slug !== chosenAccount.slug) {
              const newPath = buildRoute(chosenAccount.slug, urlParsed.rest)
              navigate(newPath, { replace: true })
            }
          }
        }
      } catch (e) {
        console.error('[AppContext] Error cargando accounts:', e)
        if (!cancelled) setAccounts([])
      } finally {
        if (!cancelled) setAccountsLoading(false)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId])

  // ─── Sincronización accountsRef + listener de cambios externos de URL ──
  //
  // BLOQUE C completo Fase 1:
  //   1. Mantener accountsRef.current al día con accounts. Necesario para que
  //      setActiveAccountId pueda mapear id→slug sin re-crear el callback.
  //   2. Si la URL cambia EXTERNAMENTE (botón atrás del navegador, link
  //      manual, paste de URL), y el slug actual ya no coincide con la cuenta
  //      activa, re-sincronizamos.
  //      - Solo aplica si accounts ya están cargadas.
  //      - Solo aplica si el slug de la URL es válido en shape y existe en mine.
  //      - Comparamos contra activeAccountId actual para evitar loop:
  //        setActiveAccountId → navigate → useEffect (location cambió) →
  //        setActiveAccountId (mismo id, no-op) → fin.
  useEffect(() => {
    accountsRef.current = accounts

    if (accounts.length === 0) return

    const urlParsed = parseRoute(location.pathname)
    if (!urlParsed.slug || !isValidSlugShape(urlParsed.slug)) return

    const urlAccount = accounts.find(a => a.slug === urlParsed.slug)
    if (!urlAccount) return

    if (urlAccount.id !== activeAccountId) {
      setActiveAccountIdState(urlAccount.id)
      try { localStorage.setItem(ACTIVE_ACCOUNT_KEY, urlAccount.id) } catch { /* no-op */ }
    }
  }, [accounts, location.pathname, activeAccountId])

  // Resolución de userProfile + permissions cuando cambia activeAccountId
  // (o cuando termina la carga inicial de cuentas).
  useEffect(() => {
    if (!authUserId || !activeAccountId) {
      setUserProfile(null)
      setPermissions(null)
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        const profile = await getUserProfile(authUserId, activeAccountId)
        if (cancelled) return
        setUserProfile(profile)

        if (!profile) {
          setPermissions(null)
          return
        }

        // Solo cargamos permissions si el rol potencialmente los necesita.
        // Workers no tienen panel de manager_permissions; admin global tampoco
        // (ve todo por su rol). Conservador: cargamos siempre para manager
        // y admin de cuenta; workers se saltan.
        if (profile.role === 'worker') {
          setPermissions(null)
          return
        }

        const perms = await getPermissions(profile.id)
        if (!cancelled) setPermissions(perms)
      } catch (e) {
        console.error('[AppContext] Error resolviendo perfil/permisos:', e)
        if (!cancelled) {
          setUserProfile(null)
          setPermissions(null)
        }
      }
    })()

    return () => { cancelled = true }
  }, [authUserId, activeAccountId])

  const activeAccount = useMemo<Account | null>(
    () => accounts.find(a => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId]
  )

  const roleInActiveAccount: UserProfileRole | null = userProfile?.role ?? null

  return (
    <AppContext.Provider value={{
      locations, staff, setStaff, tasks, setTasks,
      templates, setTemplates, incidents, setIncidents, audits, setAudits,
      notifConfig, setNotifConfig, schedules, setSchedules,
      createEmployee, defaultSchedule: DEFAULT_SCHEDULE,
      syncing, cloudEnabled: isSupabaseEnabled, lastSync,
      saveEmployee, removeEmployee, saveLocation, removeLocation, addClockEntry,
      currentEmployee, currentEmployeeId, setCurrentEmployeeId,
      isAdmin, adminEmail, authUserId, authResolved,
      activeLocationId, setActiveLocationId,
      activeBrandFilter, setActiveBrandFilter,
      accounts, accountsLoading, activeAccountId, setActiveAccountId,
      activeAccount, userProfile, roleInActiveAccount, permissions,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
