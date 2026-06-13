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
  days: number                // días naturales descontados
  status: VacationStatus
  notes?: string
  requestedAt: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNotes?: string
  alertMinStaff?: boolean
  alertLeadTime?: boolean
  // Si true (default), la ausencia es retribuida y cuenta como horas trabajadas en bolsa de horas.
  // Si false, no cuenta como trabajada y descuenta del contrato del periodo.
  paid?: boolean
  createdAt: string
}

export interface VacationSettings {
  id: string
  scope: 'global' | 'employee'
  employeeId?: string
  vacationDaysPerYear: number       // default 30
  asuntosPropiosPerYear: number     // default 3
  minStaffPerLocation: number       // default 2
  minLeadDays: number               // default 30
  // LISTA NEGRA: tipos de ausencia que el trabajador NO puede solicitar desde el
  // portal. Vacío = todos visibles. 'vacaciones' nunca debe aparecer aquí
  // (es núcleo, siempre disponible — ver ALWAYS_AVAILABLE_VACATION_TYPE).
  // Solo afecta al selector del trabajador; el gestor sigue pudiendo registrar
  // cualquier tipo manualmente.
  requestTypesDisabled: VacationType[]
  createdAt: string
  updatedAt: string
}

export const VACATION_TYPES: { id: VacationType; label: string; descontable: boolean; defaultPaid: boolean }[] = [
  { id: 'vacaciones',           label: 'Vacaciones',             descontable: true,  defaultPaid: true  },
  { id: 'asuntos_propios',      label: 'Asuntos propios',        descontable: true,  defaultPaid: true  },
  { id: 'baja_medica',          label: 'Baja médica',            descontable: false, defaultPaid: true  },
  { id: 'permiso_matrimonio',   label: 'Matrimonio (15 días)',   descontable: false, defaultPaid: true  },
  { id: 'permiso_fallecimiento',label: 'Fallecimiento familiar', descontable: false, defaultPaid: true  },
  { id: 'permiso_mudanza',      label: 'Mudanza',                descontable: false, defaultPaid: true  },
  { id: 'otro',                 label: 'Otro permiso',           descontable: false, defaultPaid: false },
]

// 'vacaciones' es NÚCLEO: siempre disponible para el trabajador y no se puede
// apagar desde la configuración. El selector del trabajador y el panel de
// configuración del gestor comparten esta constante para no desincronizarse.
export const ALWAYS_AVAILABLE_VACATION_TYPE: VacationType = 'vacaciones'

export const DOCUMENT_TYPES: { id: string; label: string; icon: string }[] = [
  { id: 'nomina',             label: 'Nómina',              icon: '💰' },
  { id: 'contrato',           label: 'Contrato',            icon: '📋' },
  { id: 'baja_medica',        label: 'Baja médica',         icon: '🏥' },
  { id: 'certificado_medico', label: 'Certificado médico',  icon: '🩺' },
  { id: 'formacion',          label: 'Formación / curso',   icon: '🎓' },
  { id: 'otro',               label: 'Otro',                icon: '📄' },
]

// ─── FORMACIONES ─────────────────────────────────────────────────────────────

export type FormationType =
  | 'manipulador_alimentos'
  | 'prl'
  | 'appcc'
  | 'alergenos'
  | 'igualdad'
  | 'primeros_auxilios'
  | 'incendios'
  | 'manipulador_especial'
  | 'otro'

export interface Formation {
  id: string
  employeeId: string
  type: FormationType
  name: string                    // nombre legible (puede personalizarse en 'otro')
  issuer?: string                 // entidad emisora
  issueDate: string               // YYYY-MM-DD
  expiryDate?: string             // YYYY-MM-DD; si NULL, no caduca
  documentUrl?: string            // URL al PDF/imagen subido (opcional)
  notes?: string
  createdAt: string
  updatedAt: string
}

/**
 * Catálogo de formaciones obligatorias y recomendadas en hostelería (España).
 * Las primeras 5 son obligatorias por ley, las siguientes 3 muy recomendadas,
 * y "otro" permite añadir formaciones personalizadas.
 */
export const FORMATION_CATALOG: {
  id: FormationType
  label: string
  icon: string
  description: string
  recommendedExpiryYears?: number  // años por defecto para caducidad (ej: 4 para manipulador)
  mandatory: boolean               // true si es obligatoria por ley
  category: 'higiene' | 'seguridad' | 'legal' | 'tecnica' | 'otro'
}[] = [
  {
    id: 'manipulador_alimentos',
    label: 'Manipulador de alimentos',
    icon: '🍴',
    description: 'Obligatorio para todo el personal que toque alimentos. RD 109/2010.',
    recommendedExpiryYears: 4,
    mandatory: true,
    category: 'higiene',
  },
  {
    id: 'prl',
    label: 'Prevención de Riesgos Laborales (PRL)',
    icon: '⛑️',
    description: 'Obligatorio para todos los empleados. Ley 31/1995.',
    recommendedExpiryYears: 3,
    mandatory: true,
    category: 'seguridad',
  },
  {
    id: 'appcc',
    label: 'Plan APPCC / Higiene',
    icon: '🧼',
    description: 'Análisis de Peligros y Puntos Críticos de Control. Reg. CE 852/2004.',
    recommendedExpiryYears: 1,
    mandatory: true,
    category: 'higiene',
  },
  {
    id: 'alergenos',
    label: 'Alérgenos',
    icon: '🚨',
    description: 'Información a clientes sobre alérgenos. Reg. UE 1169/2011.',
    recommendedExpiryYears: 1,
    mandatory: true,
    category: 'higiene',
  },
  {
    id: 'igualdad',
    label: 'Igualdad y acoso laboral',
    icon: '⚖️',
    description: 'Obligatorio en empresas de más de 50 empleados. LO 3/2007.',
    recommendedExpiryYears: 2,
    mandatory: true,
    category: 'legal',
  },
  {
    id: 'primeros_auxilios',
    label: 'Primeros auxilios + DESA',
    icon: '🚑',
    description: 'Recomendado mínimo 1 persona por turno. Caduca a los 2 años.',
    recommendedExpiryYears: 2,
    mandatory: false,
    category: 'seguridad',
  },
  {
    id: 'incendios',
    label: 'Extinción de incendios',
    icon: '🔥',
    description: 'Recomendado para encargados. Renovación anual.',
    recommendedExpiryYears: 1,
    mandatory: false,
    category: 'seguridad',
  },
  {
    id: 'manipulador_especial',
    label: 'Manipulador especial (alérgenos críticos)',
    icon: '🥜',
    description: 'Para cocineros que manejen alérgenos críticos.',
    recommendedExpiryYears: 4,
    mandatory: false,
    category: 'higiene',
  },
  {
    id: 'otro',
    label: 'Otra formación',
    icon: '📚',
    description: 'Formación personalizada (idiomas, coctelería, etc.)',
    mandatory: false,
    category: 'otro',
  },
]
