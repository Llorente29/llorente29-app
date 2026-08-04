// src/services/courseAdoptionService.ts
// Formación C3-A — ADOPCIÓN de un curso plantilla global a la cuenta.
//
// Mismo patrón que src/modules/kitchen/services/ingredientAdoptionService.ts
// (ingredient_template → recipe_item propio): materializa una copia propia
// de la cuenta (course + course_section + course_question + course_option)
// a partir de la plantilla global, con anti-duplicado por
// (account_id, adopted_from_course_id) — primera red aquí (comprobar antes
// de crear), segunda red el índice único de la migración C3-A.
//
// NUNCA escribe en la plantilla global (account_id IS NULL): solo lee de
// ahí. Necesario porque course_section_write (RLS, C1) exige
// account_id IS NOT NULL para poder escribir — sin una copia propia, no hay
// forma de personalizar nada de un curso global (ver "Usar foto propia" en
// courseImagesService.ts, que depende de este servicio).

import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

type CourseRow = Database['public']['Tables']['course']['Row']

export interface AdoptCourseResult {
  courseId: string
  alreadyExisted: boolean
}

async function findAdoptedCourseId(accountId: string, globalCourseId: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('course')
    .select('id')
    .eq('account_id', accountId)
    .eq('adopted_from_course_id', globalCourseId)
    .maybeSingle()
  if (error) { console.error('[courseAdoptionService] findAdoptedCourseId', error); throw error }
  return data?.id ?? null
}

/**
 * Adopta un curso plantilla global (account_id IS NULL) a la cuenta:
 * clona course + sus secciones/preguntas/opciones. Idempotente respecto al
 * curso global: si ya estaba adoptado, devuelve la copia existente
 * (alreadyExisted=true) sin duplicar nada.
 */
export async function adoptCourseForAccount(
  accountId: string,
  globalCourseId: string,
): Promise<AdoptCourseResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const sb = supabase

  const existingId = await findAdoptedCourseId(accountId, globalCourseId)
  if (existingId) return { courseId: existingId, alreadyExisted: true }

  const { data: globalCourse, error: courseErr } = await sb
    .from('course')
    .select('*')
    .eq('id', globalCourseId)
    .single()
  if (courseErr) { console.error('[courseAdoptionService] leer curso global', courseErr); throw courseErr }
  const g = globalCourse as CourseRow
  if (g.account_id !== null) {
    throw new Error('Solo se pueden adoptar cursos plantilla globales (account_id NULL).')
  }

  const { data: newCourse, error: insertErr } = await sb
    .from('course')
    .insert({
      account_id: accountId,
      adopted_from_course_id: globalCourseId,
      code: g.code,
      title: g.title,
      summary: g.summary,
      legal_basis: g.legal_basis,
      delivery_mode: g.delivery_mode,
      reeval_months: g.reeval_months,
      is_mandatory: g.is_mandatory,
      appcc_prerequisite: g.appcc_prerequisite,
      estimated_minutes: g.estimated_minutes,
      pass_threshold_pct: g.pass_threshold_pct,
      version: 1,
      status: g.status,
      // Campos añadidos en C4/C5, posteriores a este servicio (C3-A): sin
      // copiarlos, la copia nacía con category/level/recommended_order NULL
      // ("Sin clasificar" en el catálogo) y — más grave — requires_practical
      // en false aunque la plantilla exigiera práctica, dejando "vigente"
      // sin verificación real (bug C5 pieza A).
      category: g.category,
      business_types: g.business_types,
      level: g.level,
      recommended_order: g.recommended_order,
      requires_practical: g.requires_practical,
      cover_url: g.cover_url,
    })
    .select('id')
    .single()
  if (insertErr) { console.error('[courseAdoptionService] crear copia de la cuenta', insertErr); throw insertErr }
  const newCourseId = newCourse.id as string

  try {
    const { data: sections, error: sectionsErr } = await sb
      .from('course_section')
      .select('*')
      .eq('course_id', globalCourseId)
      .order('ord', { ascending: true })
    if (sectionsErr) throw sectionsErr
    if (sections && sections.length > 0) {
      const { error } = await sb.from('course_section').insert(
        sections.map(s => ({ course_id: newCourseId, ord: s.ord, title: s.title, body: s.body, media_url: s.media_url })),
      )
      if (error) throw error
    }

    const { data: questions, error: questionsErr } = await sb
      .from('course_question')
      .select('*')
      .eq('course_id', globalCourseId)
      .order('ord', { ascending: true })
    if (questionsErr) throw questionsErr

    for (const q of questions ?? []) {
      const { data: newQuestion, error: qErr } = await sb
        .from('course_question')
        .insert({ course_id: newCourseId, ord: q.ord, text: q.text })
        .select('id')
        .single()
      if (qErr) throw qErr

      const { data: options, error: optErr } = await sb
        .from('course_option')
        .select('*')
        .eq('question_id', q.id)
      if (optErr) throw optErr
      if (options && options.length > 0) {
        const { error } = await sb.from('course_option').insert(
          options.map(o => ({ question_id: newQuestion.id, text: o.text, is_correct: o.is_correct, explanation: o.explanation })),
        )
        if (error) throw error
      }
    }

    // Gestos de verificación práctica (C4): si no se clonan, una copia de un
    // curso con requires_practical=true nace SIN items — practical_ok se
    // calcula "vacuamente true" (ver training_compliance_matrix), así que la
    // cuenta vería "vigente" sin que nadie verifique nada. Mismo bug de fondo
    // que el de category/requires_practical, sobre datos en vez de columnas.
    const { data: practicalItems, error: practicalErr } = await sb
      .from('course_practical_item')
      .select('*')
      .eq('course_id', globalCourseId)
      .order('ord', { ascending: true })
    if (practicalErr) throw practicalErr
    if (practicalItems && practicalItems.length > 0) {
      const { error } = await sb.from('course_practical_item').insert(
        practicalItems.map(p => ({ course_id: newCourseId, ord: p.ord, text: p.text, help_text: p.help_text })),
      )
      if (error) throw error
    }
  } catch (e) {
    // Limpieza best-effort: si algo falló a mitad de la clonación, no dejar
    // una copia a medias. ON DELETE CASCADE (C1) se lleva por delante
    // secciones/preguntas/opciones ya insertadas.
    await sb.from('course').delete().eq('id', newCourseId)
    throw e
  }

  return { courseId: newCourseId, alreadyExisted: false }
}
