// src/modules/conta/services/impuestosService.ts
//
// I01a · Impuestos por dentro. Lo que el front escribe de Impuestos va por
// funciones de la base (security definer): aquí, las respuestas del alta, que
// hasta el I01a se usaban para proponer los modelos y se tiraban.

import { rpc } from '@/modules/conta/services/bd'

/** Las preguntas del paso «impuestos» del alta que deciden modelos. */
const CLAVES_DEL_ALTA = ['retiene', 'alquiler', 'retenido70'] as const

/**
 * Guarda, como datos de la empresa con quién y cuándo, las respuestas del
 * paso «impuestos»: «sí», «no» o «No lo sé» (__nolose). Las que no se
 * preguntaron no se envían. Devuelve cuántas se guardaron.
 */
export async function guardarRespuestasDelAlta(companyId: string, respuestas: Partial<Record<string, string>>): Promise<number> {
  const p: Record<string, string> = {}
  for (const k of CLAVES_DEL_ALTA) {
    const v = respuestas[k]
    if (v === 'si' || v === 'no' || v === '__nolose') p[k] = v
  }
  if (Object.keys(p).length === 0) return 0
  return rpc<number>('conta_impuesto_datos_del_alta', { p_company: companyId, p_respuestas: p })
}
