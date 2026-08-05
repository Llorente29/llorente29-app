// src/services/employeeSelfService.ts
// ENCARGO CODE — Ajustes personales que el propio empleado cambia desde su
// portal (magic link). La lectura va por RLS normal (employees_read); la
// escritura pasa siempre por RPC SECURITY DEFINER (set_my_clockout_reminder)
// porque employees_write exige rol admin — un empleado nunca puede hacer
// UPDATE directo a su propia fila.

import { supabase } from '../lib/supabase'

/** Valor actual de employees.forgot_clockout_reminder para un empleado. RLS ya limita a su propia cuenta. */
export async function getMyReminderPref(employeeId: string): Promise<boolean> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('employees')
    .select('forgot_clockout_reminder')
    .eq('id', employeeId)
    .single()
  if (error) { console.error('[employeeSelfService] getMyReminderPref', error); throw error }
  return data.forgot_clockout_reminder ?? true
}

/**
 * Activa/desactiva el recordatorio de olvido de fichaje para EL EMPLEADO QUE
 * LLAMA (resuelto server-side vía auth.uid(), no recibe employeeId — así no
 * hay forma de tocar el ajuste de otra persona).
 */
export async function setMyReminderPref(enabled: boolean): Promise<boolean> {
  if (!supabase) throw new Error('Supabase no disponible')
  // set_my_clockout_reminder es una migración NUEVA (supabase/migrations/
  // 20260815T1200_clockout_reminder_self_service.sql) todavía sin aplicar por
  // Julio -> no existe aún en database.ts. Cast temporal; quitar el `as any`
  // en cuanto se aplique y se regenere types:gen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('set_my_clockout_reminder', { p_enabled: enabled })
  if (error) { console.error('[employeeSelfService] setMyReminderPref', error); throw error }
  return data as boolean
}
