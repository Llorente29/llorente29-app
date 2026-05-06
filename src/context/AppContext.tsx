import React, { createContext, useContext, useState, useEffect } from 'react'
import type {
  Location, Employee, Task, Template, Incident, Audit, NotifConfig, WeeklySchedule
} from '../types'

const DEFAULT_SCHEDULE: WeeklySchedule = {
  lunes: { active: true, start: '09:00', end: '17:00' },
  martes: { active: true, start: '09:00', end: '17:00' },
  miercoles: { active: true, start: '09:00', end: '17:00' },
  jueves: { active: true, start: '09:00', end: '17:00' },
  viernes: { active: true, start: '09:00', end: '17:00' },
  sabado: { active: false, start: '', end: '' },
  domingo: { active: false, start: '', end: '' },
}

const DEFAULT_NOTIF_CONFIG: NotifConfig = {
  whatsappEnabled: false,
  whatsappNumber: '',
  emailEnabled: false,
  emailAddress: '',
  pushEnabled: false,
  smsEnabled: false,
  smsNumber: '',
  reminderMinutes: 30,
  overdueMinutes: 15,
  escalateEnabled: false,
  escalateTo: '',
  escalateMinutes: 60,
  gestoriaEmail: '',
  gestoriaEnabled: false,
  gestoriaDayOfMonth: 25,
  gestoriaNombre: '',
  gestoriaLastSent: '',
}

const STORAGE_KEY = 'andy-app-v3'

interface AppContextType {
  locations: Location[]
  setLocations: React.Dispatch<React.SetStateAction<Location[]>>
  staff: Employee[]
  setStaff: React.Dispatch<React.SetStateAction<Employee[]>>
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  templates: Template[]
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>
  incidents: Incident[]
  setIncidents: React.Dispatch<React.SetStateAction<Incident[]>>
  audits: Audit[]
  setAudits: React.Dispatch<React.SetStateAction<Audit[]>>
  notifConfig: NotifConfig
  setNotifConfig: React.Dispatch<React.SetStateAction<NotifConfig>>
  createEmployee: (locationId: string) => Employee
  defaultSchedule: WeeklySchedule
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const saved = (() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      return s ? JSON.parse(s) : null
    } catch { return null }
  })()

  const [locations, setLocations] = useState<Location[]>(saved?.locations || [])
  const [staff, setStaff] = useState<Employee[]>(saved?.staff || [])
  const [tasks, setTasks] = useState<Task[]>(saved?.tasks || [])
  const [templates, setTemplates] = useState<Template[]>(saved?.templates || [])
  const [incidents, setIncidents] = useState<Incident[]>(saved?.incidents || [])
  const [audits, setAudits] = useState<Audit[]>(saved?.audits || [])
  const [notifConfig, setNotifConfig] = useState<NotifConfig>(saved?.notifConfig || DEFAULT_NOTIF_CONFIG)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        locations, staff, tasks, templates, incidents, audits, notifConfig
      }))
    } catch {
      console.warn('localStorage full')
    }
  }, [locations, staff, tasks, templates, incidents, audits, notifConfig])

  const createEmployee = (locationId: string): Employee => ({
    id: `s-${Date.now()}`,
    name: '',
    dni: '',
    phone: '',
    email: '',
    photo: '',
    locationId,
    position: 'Camarero',
    department: 'Sala',
    contractType: 'Indefinido',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    salary: 0,
    weeklyHours: 40,
    schedule: 'L-V 9:00-17:00',
    weeklySchedule: DEFAULT_SCHEDULE,
    active: true,
    notes: '',
    clockEntries: [],
    documents: [],
    vacations: [],
    formations: [],
  })

  return (
    <AppContext.Provider value={{
      locations, setLocations,
      staff, setStaff,
      tasks, setTasks,
      templates, setTemplates,
      incidents, setIncidents,
      audits, setAudits,
      notifConfig, setNotifConfig,
      createEmployee,
      defaultSchedule: DEFAULT_SCHEDULE,
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
