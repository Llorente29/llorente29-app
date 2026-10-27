// src/services/kioskoPinService.ts
//
// L00 · Respuesta 1 (27/10/2026). El PIN del kiosko ya no se lee desde el
// cliente: vive en employee_kiosk_pin, que solo ve el servidor. La tablet
// pregunta al servidor quién tiene PIN y si el que se ha tecleado es el bueno.
// Las dos funciones piden ser el administrador o el encargado de la cuenta (la
// sesión del kiosko).
//
// MIENTRAS LA BASE NO TENGA LA 1215 (staging desde una rama, o si el front
// llega antes que la tanda): las funciones no existen (PGRST202) y se hace lo
// de antes, con el PIN de la ficha, que en esa base sigue estando ahí. Con la
// 1215 aplicada, employees.pin está vacío y solo vale el servidor.
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

// Aún no están en database.ts: cliente laxo local.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase
}

interface ErrorRpc { code?: string; message?: string }

/** La función no existe todavía en esta base (PostgREST: PGRST202). */
export function esFuncionQueNoExiste(e: ErrorRpc | null | undefined): boolean {
  return !!e && (e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? ''))
}

/** De estas personas, las que tienen PIN de kiosko. */
export async function conPinDeKiosko(personas: Pick<Employee, 'id' | 'pin'>[]): Promise<Set<string>> {
  if (personas.length === 0) return new Set()
  const { data, error } = await db().rpc('kiosko_con_pin', { p_employee_ids: personas.map(p => p.id) })
  if (esFuncionQueNoExiste(error)) return new Set(personas.filter(p => !!p.pin).map(p => p.id))
  if (error) throw new Error('No se ha podido saber quién tiene PIN: ' + error.message)
  return new Set(((data ?? []) as unknown[]).map(x => (typeof x === 'string' ? x : String((x as Record<string, unknown>).kiosko_con_pin ?? ''))))
}

/** ¿Es este el PIN de esta persona? Lo comprueba el servidor. */
export async function comprobarPinDeKiosko(persona: Pick<Employee, 'id' | 'pin'>, pin: string): Promise<boolean> {
  const { data, error } = await db().rpc('kiosko_comprobar_pin', { p_employee_id: persona.id, p_pin: pin })
  if (esFuncionQueNoExiste(error)) return !!persona.pin && persona.pin === pin
  if (error) throw new Error('No se ha podido comprobar el PIN: ' + error.message)
  return data === true
}
