// src/services/courseHookService.ts
// ENCARGO CODE — IA propone el gancho de WhatsApp de un curso (Edge Function
// suggest-course-hook, patrón calcado de enrich-ingredient/suggest-item).
// "IA propone, humano decide": esta función solo devuelve el texto propuesto;
// quien llama lo pinta en el campo editable y es el admin quien guarda.

import { supabase } from '../lib/supabase'

interface SuggestHookResponse {
  hook?: string
}

/** Pide a la IA un gancho de WhatsApp para el curso (título + secciones + is_mandatory). No guarda nada. */
export async function suggestCourseHook(courseId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.functions.invoke('suggest-course-hook', {
    body: { course_id: courseId },
  })
  if (error) throw new Error(`Error al proponer el gancho: ${error.message}`)
  const hook = (data as SuggestHookResponse | null)?.hook
  if (!hook || !hook.trim()) throw new Error('La IA no devolvió una propuesta válida')
  return hook.trim()
}
