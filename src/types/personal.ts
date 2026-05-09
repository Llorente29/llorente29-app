// src/types/personal.ts
// Tipos específicos del módulo Personal: documentos, vacaciones, ajustes.

export interface DocumentFile {
  id: string
  employeeId: string
  type: string                // 'nomina', 'contrato', 'baja_medica', 'certificado_medico', 'formacion', 'otro' o cualquier custom
  name: string
  filePath: string            // ruta dentro del bucket employee-documents
  fileSizeKb: number
  uploadedBy?: string         // id del empleado que lo subió (null si fue gestor sin sesión empleado)
  uploadedRole: 'gestor' | 'trabajador'
  notes?: string
  createdAt: string
}

export type VacationType = 'vacaciones' | 'asuntos_propios' | 'baja_medica' | 'permiso_matrimonio' | 'permiso_fallecimiento' | 'permiso_mudanza' | 'otro'

export type VacationStatus = 'solicitada' | 'aprobada' | 'rechazada' | 'cancelada'

export interface VacationRequest {
  id: string
  employeeId: string
  type: VacationType
  startDate: string           // YYYY-MM-DD
  endDate: string             // YYYY-MM-DD
  days: number                // días laborables descontados
  status: VacationStatus
  notes?: string
  requestedAt: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNotes?: string
  alertMinStaff?: boolean
  alertLeadTime?: boolean
  // Si true (default), la ausencia es retribuida y cuenta como horas trabajadas en la bolsa de horas.
  // Si false, no cuenta y descuenta del contrato del periodo.
  paid?: boolean
  createdAt: string
}

export interface VacationSettings {
  id: string
  scope: 'global' | 'employee'
  employeeId?: string
  vacationDaysPerYear: number       // default 22
  asuntosPropiosPerYear: number     // default 3
  minStaffPerLocation: number       // default 2
  minLeadDays: number               // default 30
  createdAt: string
  updatedAt: string
}

// Lista de tipos de ausencia con metadata útil:
// - descontable: si descuenta del cupo anual (vacaciones, asuntos propios)
// - defaultPaid: si por defecto es retribuida (puede cambiarse al aprobar)
export const VACATION_TYPES: { id: VacationType; label: string; descontable: boolean; defaultPaid: boolean }[] = [
  { id: 'vacaciones',           label: 'Vacaciones',           descontable: true,  defaultPaid: true  },
  { id: 'asuntos_propios',      label: 'Asuntos propios',      descontable: true,  defaultPaid: true  },
  { id: 'baja_medica',          label: 'Baja médica',          descontable: false, defaultPaid: true  },
  { id: 'permiso_matrimonio',   label: 'Matrimonio (15 días)', descontable: false, defaultPaid: true  },
  { id: 'permiso_fallecimiento',label: 'Fallecimiento familiar', descontable: false, defaultPaid: true  },
  { id: 'permiso_mudanza',      label: 'Mudanza',              descontable: false, defaultPaid: true  },
  { id: 'otro',                 label: 'Otro permiso',         descontable: false, defaultPaid: false },
]

export const DOCUMENT_TYPES: { id: string; label: string; icon: string }[] = [
  { id: 'nomina',             label: 'Nómina',              icon: '💰' },
  { id: 'contrato',           label: 'Contrato',            icon: '📋' },
  { id: 'baja_medica',        label: 'Baja médica',         icon: '🏥' },
  { id: 'certificado_medico', label: 'Certificado médico',  icon: '🩺' },
  { id: 'formacion',          label: 'Formación / curso',   icon: '🎓' },
  { id: 'otro',               label: 'Otro',                icon: '📄' },
]
