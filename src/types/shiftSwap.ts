// src/types/shiftSwap.ts
// Tipos para el sistema de cambios/intercambios de turno entre empleados.

/**
 * Tipo de cambio:
 * - cesion: A libra un turno y cualquiera lo puede coger
 * - intercambio: A propone cambiar SU turno por OTRO turno específico de B
 * - peticion_directa: A pide a B específicamente que coja su turno (sin intercambio)
 */
export type SwapType = 'cesion' | 'intercambio' | 'peticion_directa'

/**
 * Estado del flujo de la solicitud:
 *
 *  abierta   →  esperando interesado (solo en cesión)
 *  propuesta →  alguien interesado o petición directa enviada, espera aprob. gestor
 *  aprobada  →  gestor aprobó, schedule actualizado
 *  rechazada →  gestor rechazó
 *  cancelada →  solicitante canceló antes de aprobación
 */
export type SwapStatus = 'abierta' | 'propuesta' | 'aprobada' | 'rechazada' | 'cancelada'

/**
 * Atribución de horas tras aprobación del gestor:
 * - 'worker':    Las horas se computan a quien trabaja efectivamente el turno (default, Modelo A).
 *                Es el modelo legalmente correcto en España (convenio Hostelería).
 * - 'requester': Las horas se computan al cedente original (uso excepcional con acuerdo previo).
 *                Útil si el trabajador A quería conservar sus horas y B le hace el favor.
 */
export type HoursAttribution = 'worker' | 'requester'

/**
 * Solicitud de cambio de turno.
 *
 * Para cesión: solo se rellena requesterXxx; targetId queda null hasta que alguien lo coge.
 * Para intercambio: requesterXxx + targetXxx + targetId (todos rellenos).
 * Para peticion_directa: requesterXxx + targetId. targetXxx queda null (no hay turno a cambio).
 */
export interface ShiftSwapRequest {
  id: string
  swapType: SwapType

  // Empleado que solicita el cambio (libra el turno o pide cambio)
  requesterId: string
  requesterScheduleId: string
  requesterTemplateId: string
  requesterDayKey: string             // '0'..'6' índice del día en la matriz
  requesterDate: string               // 'YYYY-MM-DD'

  // Empleado destino (en cesión está vacío hasta que alguien la coge)
  targetId?: string
  targetScheduleId?: string           // solo en intercambio
  targetTemplateId?: string           // solo en intercambio
  targetDayKey?: string               // solo en intercambio
  targetDate?: string                 // solo en intercambio

  status: SwapStatus

  requestNotes?: string               // motivo del solicitante
  acceptorNotes?: string              // mensaje de quien acepta (opcional)
  managerNotes?: string               // motivo de aprobación/rechazo

  reviewedBy?: string                 // gestor que aprobó/rechazó
  hoursAttribution?: HoursAttribution // atribución de horas si está aprobada
  createdAt: string
  updatedAt: string
  reviewedAt?: string
}

/**
 * Etiqueta legible por tipo.
 */
export const SWAP_TYPE_LABELS: Record<SwapType, string> = {
  cesion: 'Cesión de turno',
  intercambio: 'Intercambio de turnos',
  peticion_directa: 'Petición directa',
}

export const SWAP_TYPE_DESCRIPTIONS: Record<SwapType, string> = {
  cesion: 'Libras tu turno y cualquier compañero puede cogerlo.',
  intercambio: 'Propones cambiar TU turno por OTRO turno específico de un compañero.',
  peticion_directa: 'Pides a un compañero concreto que coja tu turno (sin contrapartida).',
}

export const SWAP_TYPE_ICONS: Record<SwapType, string> = {
  cesion: '🚪',
  intercambio: '🔄',
  peticion_directa: '🙏',
}

/**
 * Etiqueta y color por estado.
 */
export const SWAP_STATUS_LABELS: Record<SwapStatus, string> = {
  abierta: '🌐 Abierta',
  propuesta: '⏳ Pendiente del gestor',
  aprobada: '✅ Aprobada',
  rechazada: '❌ Rechazada',
  cancelada: '⊘ Cancelada',
}

export const SWAP_STATUS_COLORS: Record<SwapStatus, string> = {
  abierta: 'bg-blue-50 text-blue-700 border-blue-200',
  propuesta: 'bg-amber-50 text-amber-700 border-amber-200',
  aprobada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rechazada: 'bg-red-50 text-red-700 border-red-200',
  cancelada: 'bg-gray-50 text-gray-500 border-gray-200',
}
