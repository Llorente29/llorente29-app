import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { Location, Employee, Task, Template, Incident, Audit, NotifConfig, WeeklySchedule, WeeklySchedulePlan, ClockEntry } from '../types'
import {
  isSupabaseEnabled,
  fetchLocations, upsertLocation, deleteLocation,
  fetchEmployees, upsertEmployee, deleteEmployee,
  fetchClockEntries, insertClockEntry,
  subscribeToChanges,
} from '../services/supabaseSync'

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

interface AppContextType {
  locations: Location[]; setLocations: React.Dispatch<React.SetStateAction<Location[]>>
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

  // ─── Sincronización con Supabase ───────────────────────────────────────
  const syncFromCloudRef = useRef(async () => {})

  syncFromCloudRef.current = async () => {
    if (!isSupabaseEnabled) return
    setSyncing(true)
    try {
      const [cloudLocs, cloudEmps, cloudClocks] = await Promise.all([
        fetchLocations(),
        fetchEmployees(),
        fetchClockEntries(),
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

  // Carga inicial + suscripción a cambios en tiempo real
  useEffect(() => {
    if (!isSupabaseEnabled) return
    syncFromCloudRef.current()
    const unsub = subscribeToChanges(
      () => syncFromCloudRef.current(),
      () => syncFromCloudRef.current(),
      () => syncFromCloudRef.current(),
    )
    return unsub
  }, [])

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
      const result = await upsertLocation(l)
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

  return (
    <AppContext.Provider value={{
      locations, setLocations, staff, setStaff, tasks, setTasks,
      templates, setTemplates, incidents, setIncidents, audits, setAudits,
      notifConfig, setNotifConfig, schedules, setSchedules,
      createEmployee, defaultSchedule: DEFAULT_SCHEDULE,
      syncing, cloudEnabled: isSupabaseEnabled, lastSync,
      saveEmployee, removeEmployee, saveLocation, removeLocation, addClockEntry,
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
