export type Page =
  | 'dashboard' | 'staff' | 'fichajes_global' | 'informes_personal' | 'calendario'
  | 'tasks' | 'scheduled' | 'templates' | 'incidents'
  | 'locations' | 'audits' | 'history' | 'tspoon'
  | 'inventory' | 'tspoon_settings'

export interface Location {
  id: string; name: string; address: string; phone: string; active: boolean
}

export interface DaySchedule { active: boolean; start: string; end: string }

export interface WeeklySchedule {
  lunes: DaySchedule; martes: DaySchedule; miercoles: DaySchedule
  jueves: DaySchedule; viernes: DaySchedule; sabado: DaySchedule; domingo: DaySchedule
}

export interface ClockEntry {
  id: string; type: 'entrada' | 'salida'; datetime: string; realDatetime?: string
  lat?: number; lng?: number; address?: string; scheduled?: string
  roundingApplied?: boolean; diffMinutes?: number
}

export interface StaffDocument {
  id: string; name: string
  type: 'contrato' | 'nomina' | 'certificado' | 'formacion' | 'sancion' | 'otro'
  date: string; url?: string
}

export interface Vacation {
  id: string; type: 'Vacaciones' | 'Baja médica' | 'Permiso' | 'Asuntos propios'
  startDate: string; endDate: string; status: 'solicitada' | 'aprobada' | 'rechazada'; notes?: string
}

export interface Employee {
  id: string; name: string; dni: string; phone: string; email: string; photo: string
  locationId: string; position: string; department: string; contractType: string
  startDate: string; endDate: string; salary: number; weeklyHours: number
  schedule: string; weeklySchedule: WeeklySchedule; active: boolean; notes: string
  clockEntries: ClockEntry[]; documents: StaffDocument[]; vacations: Vacation[]
  formations: { id: string; name: string; date: string; expiry?: string; issuer?: string }[]
}

export interface ChecklistItem {
  id: string; text: string; required: boolean; completed?: boolean; completedAt?: string
}

export interface TaskField {
  id: string; label: string
  type: 'text' | 'number' | 'datetime' | 'select' | 'textarea' | 'temperature'
  required: boolean; value?: string; min?: number; max?: number
  unit?: string; options?: string[]; placeholder?: string
}

export interface Task {
  id: string; title: string; description: string; locationId: string
  assignedTo: string; role: string
  status: 'pendiente' | 'en_progreso' | 'completada' | 'vencida'
  priority: 'baja' | 'media' | 'alta' | 'critica'
  dueDate: string; completedAt?: string; templateId?: string
  checklistItems: ChecklistItem[]; fields: TaskField[]
  history: { id: string; action: string; user: string; timestamp: string; notes?: string }[]
  tags: string[]; createdAt: string
}

export interface Template {
  id: string; name: string; description: string; category: string
  priority: 'baja' | 'media' | 'alta' | 'critica'
  frequency: 'diaria' | 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'anual'
  estimatedMinutes: number; requiresPhoto: boolean; requiresSignature: boolean
  checklist: Omit<ChecklistItem, 'completed' | 'completedAt'>[]
  fields: Omit<TaskField, 'value'>[]
  assignableRoles: string[]; locations: string[]; tags: string[]
  active: boolean; createdAt: string; updatedAt: string; color: string; icon: string
}

export interface Incident {
  id: string; title: string; description: string; locationId: string; type: string
  severity: 'leve' | 'moderada' | 'grave' | 'critica'
  status: 'abierta' | 'en_proceso' | 'resuelta'
  reportedBy: string; assignedTo?: string; createdAt: string
  resolvedAt?: string; notes?: string; photos: string[]
}

export interface AuditItem {
  id: string; category: string; description: string
  score: number; maxScore: number; notes?: string; photo?: string
}

export interface Audit {
  id: string; title: string; locationId: string; type: string
  score: number; maxScore: number
  status: 'pendiente' | 'en_progreso' | 'completada'
  auditor: string; date: string; items: AuditItem[]; notes?: string
}

export interface NotifConfig {
  whatsappEnabled: boolean; whatsappNumber: string
  emailEnabled: boolean; emailAddress: string
  pushEnabled: boolean; smsEnabled: boolean; smsNumber: string
  reminderMinutes: number; overdueMinutes: number
  escalateEnabled: boolean; escalateTo: string; escalateMinutes: number
  gestoriaEmail: string; gestoriaEnabled: boolean; gestoriaDayOfMonth: number
  gestoriaNombre: string; gestoriaLastSent: string
}

export type ShiftType = 'manana' | 'partido' | 'tarde_noche' | 'libre'

export interface Shift {
  employeeId: string; type: ShiftType; start: string; end: string; hours: number; notes?: string
}

export interface ScheduleDay { date: string; shifts: Shift[] }

export interface WeeklySchedulePlan {
  id: string; locationId: string; weekStart: string
  days: ScheduleDay[]; published: boolean; createdAt: string; notes?: string
}
