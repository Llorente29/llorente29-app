// src/modules/kds/lib/reasonCode.ts
//
// DISPONIBILIDAD · C3b — motivo tipificado (puebla availability_event.reason_code,
// C1). Mismo enum que valida la RPC (sin_stock|incidencia|fin_servicio|
// promocion|mantenimiento|otro). '' = sin especificar -> se envía como
// p_reason_code=null (no bloquea el flujo rápido).

export type ReasonCode = 'sin_stock' | 'incidencia' | 'fin_servicio' | 'promocion' | 'mantenimiento' | 'otro'

export const REASON_OPTIONS: { value: ReasonCode | ''; label: string }[] = [
  { value: '', label: 'Sin especificar' },
  { value: 'sin_stock', label: 'Sin stock' },
  { value: 'incidencia', label: 'Incidencia' },
  { value: 'fin_servicio', label: 'Fin de servicio' },
  { value: 'promocion', label: 'Promoción' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'otro', label: 'Otro' },
]

/** '' -> null para el parámetro p_reason_code de las RPC. */
export function reasonCodeParam(v: ReasonCode | ''): ReasonCode | null {
  return v === '' ? null : v
}
