export type Page =
  | 'dashboard' | 'staff' | 'fichajes_global' | 'informes_personal' | 'calendario'
  | 'plantilla_turnos'
  | 'tasks' | 'scheduled' | 'templates' | 'incidents'
  | 'locations' | 'audits' | 'history' | 'tspoon'
  | 'inventory' | 'tspoon_settings' | 'ventas_analisis' | 'prediccion_personal'
  | 'zonas_pedido' | 'kiosko_fichaje' | 'solicitudes_pendientes'
  | 'ahora_mismo' | 'turnos_abiertos'
  | 'bolsa_horas'

export interface Location {
  id: string; name: string; address: string; phone: string; active: boolean
  // Coordenadas para geofencing del kiosko
  lat?: number; lng?: number
  // === Configuración de bolsa de horas ===
  hoursBalanceCloseDay?: number              // día del mes en que cierra el periodo (1-31, default 25)
  hoursBalanceSyncWithGestoria?: boolean     // si true, usa el día configurado en Informes Gestoría
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
  // Datos del fichaje en kiosko
  source?: 'kiosko' | 'movil' | 'manual'
  locationIdAtClock?: string         // local en el que fichó (puede no ser el principal)
  photoDataUrl?: string              // foto opcional al fichar (base64)
}

export interface StaffDocument {
  id: string; name: string
  type: 'contrato' | 'nomina' | 'certificado' | 'formacion' | 'sancion' | 'otro'
  date: string; url?: string
}

export interface Vacation {
  id: string; type: 'Vacaciones' | 'Baja médica' | 'Permiso' | 'Asuntos propios'
  startDate: string; endDate: string; status: 'solicitada' | 'aprobada' | 'rechazada'; notes?: string
  alerts?: unknown[]; adjustments?: string[]
  // Si true (default), la ausencia es retribuida y cuenta como horas trabajadas.
  // Si false, no cuenta y descuenta del contrato del periodo.
  // Aplicable principalmente a 'Permiso' que puede ser retribuido o no según el convenio.
  paid?: boolean
}

// === Tipos del scheduler en la ficha del empleado (sub-fase 3.2) ===
export type ShiftPeriod = 'manana' | 'tarde' | 'partido'
// rest_pattern: cadena "<dia>:<tipo>"
//   día: 'lun','mar','mie'
//   tipo: 'tarde_dia' (tarde del día + día siguiente entero)
//         'dia_manana' (día entero + mañana del día siguiente)
// Ej: 'mar:dia_manana' = "Martes entero libre + Miércoles mañana libre" (Natacha)
// Ej: 'lun:tarde_dia'  = "Lunes tarde libre + Martes entero libre"      (Yohanny)
// Ej: 'mie:dia_manana' = "Miércoles entero libre + Jueves mañana libre" (Pamela)
export type RestPattern =
  | 'lun:tarde_dia' | 'lun:dia_manana'
  | 'mar:tarde_dia' | 'mar:dia_manana'
  | 'mie:tarde_dia' | 'mie:dia_manana'

export interface Employee {
  id: string; name: string; dni: string; phone: string; email: string; photo: string
  locationId: string; position: string; department: string; contractType: string
  startDate: string; endDate: string; salary: number; weeklyHours: number
  schedule: string; weeklySchedule: WeeklySchedule; active: boolean; notes: string
  clockEntries: ClockEntry[]; documents: StaffDocument[]; vacations: Vacation[]
  formations: { id: string; name: string; date: string; expiry?: string; issuer?: string }[]
  availability?: { lunes:string[]; martes:string[]; miercoles:string[]; jueves:string[]; viernes:string[]; sabado:string[]; domingo:string[] }
  // === Campos para fichaje en kiosko/móvil ===
  pin?: string                       // PIN de 4 dígitos para fichar
  assignedLocations?: string[]       // locales donde puede fichar (si vacío, usa locationId)
  // === Campos para el scheduler (sub-fase 3.2) ===
  shiftCode?: string                 // código corto T1/T2/T3 para visualización en matriz
  shiftPeriod?: ShiftPeriod          // franja habitual
  restPattern?: RestPattern          // patrón de descanso fijo
  // === Campos para bolsa de horas ===
  initialHoursBalance?: number       // saldo inicial al empezar a usar Foodint (puede ser negativo)
  showHoursBalance?: boolean         // si true, el trabajador ve su saldo en su app móvil (default true)
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
  alerts?: unknown[]; adjustments?: string[]
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
  alerts?: unknown[]; adjustments?: string[]
}

export interface ScheduleDay { date: string; shifts: Shift[] }

export interface WeeklySchedulePlan {
  id: string; locationId: string; weekStart: string
  days: ScheduleDay[]; published: boolean; createdAt: string; notes?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  alerts?: any[]; adjustments?: string[]
}

// === Zonas de Pedido ===
export interface DeliveryRecord {
  id: string; locationId: string; locationName: string
  date: string; amount: number; source: string; barrio: string
  lat?: number; lng?: number; address?: string
  distanceKm?: number; closestLocationId?: string
}

export interface DeliveryZoneConfig {
  locationId: string; radiusKm: number; lat: number; lng: number
}

// === Configuración del kiosko ===
export interface KioskoConfig {
  locationId: string                 // local activo del kiosko
  geofenceRadiusM: number            // radio en metros (default 200)
  requirePhoto: boolean              // pedir foto al fichar (default false)
  blockOutsideGeofence: boolean      // bloquear si fuera de zona (default true)
}
