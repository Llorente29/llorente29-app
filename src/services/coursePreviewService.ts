// src/services/coursePreviewService.ts
// ENCARGO CODE — Vista previa de curso: lectura directa de contenido de un
// curso (global o de cuenta) para que el admin lo revise antes de publicar.
// Solo lectura — NO crea course_attempt/course_assignment/course_signature,
// no pasa por ninguna RPC. Acceso vía RLS normal (belongs_to_account /
// account_id IS NULL para plantillas globales), igual que coursesService.
//
// A diferencia de mobileCoursesService (start_course_attempt), aquí SÍ viaja
// course_option.is_correct al cliente: es vista previa para quien va a
// publicar el curso, no un test real que un empleado pueda inspeccionar.

import { supabase } from '../lib/supabase'

export interface PreviewSection {
  id: string
  ord: number
  title: string
  body: string
  mediaUrl: string | null
}

export interface PreviewOption {
  id: string
  text: string
  isCorrect: boolean
  explanation: string | null
}

export interface PreviewQuestion {
  id: string
  ord: number
  text: string
  options: PreviewOption[]
}

export interface PreviewPracticalItem {
  id: string
  ord: number
  text: string
  helpText: string | null
}

export interface CoursePreview {
  id: string
  title: string
  code: string
  status: string
  passThresholdPct: number
  requiresPractical: boolean
  sections: PreviewSection[]
  questions: PreviewQuestion[]
  practicalItems: PreviewPracticalItem[]
}

interface QuestionWithOptionsRow {
  id: string
  ord: number
  text: string
  course_option: { id: string; text: string; is_correct: boolean; explanation: string | null }[] | null
}

export async function fetchCoursePreview(courseId: string): Promise<CoursePreview> {
  if (!supabase) throw new Error('Supabase no disponible')

  const [courseRes, sectionsRes, questionsRes, practicalRes] = await Promise.all([
    supabase.from('course').select('id, title, code, status, pass_threshold_pct, requires_practical').eq('id', courseId).single(),
    supabase.from('course_section').select('id, ord, title, body, media_url').eq('course_id', courseId).order('ord', { ascending: true }),
    // course_option no tiene columna ord (mismo criterio que coursesService.getCourseWithContent):
    // el orden que devuelve Postgres es el de inserción, y es justo el orden "original" que este
    // encargo exige no barajar.
    supabase.from('course_question').select('id, ord, text, course_option(id, text, is_correct, explanation)').eq('course_id', courseId).order('ord', { ascending: true }),
    supabase.from('course_practical_item').select('id, ord, text, help_text').eq('course_id', courseId).order('ord', { ascending: true }),
  ])

  if (courseRes.error || !courseRes.data) {
    console.error('[coursePreviewService] fetchCoursePreview (course)', courseRes.error)
    throw courseRes.error ?? new Error('Curso no encontrado')
  }
  if (sectionsRes.error) { console.error('[coursePreviewService] fetchCoursePreview (sections)', sectionsRes.error); throw sectionsRes.error }
  if (questionsRes.error) { console.error('[coursePreviewService] fetchCoursePreview (questions)', questionsRes.error); throw questionsRes.error }
  if (practicalRes.error) { console.error('[coursePreviewService] fetchCoursePreview (practicalItems)', practicalRes.error); throw practicalRes.error }

  const course = courseRes.data

  return {
    id: course.id,
    title: course.title,
    code: course.code,
    status: course.status,
    passThresholdPct: course.pass_threshold_pct,
    requiresPractical: course.requires_practical,
    sections: (sectionsRes.data ?? []).map(s => ({
      id: s.id, ord: s.ord, title: s.title, body: s.body, mediaUrl: s.media_url,
    })),
    questions: ((questionsRes.data ?? []) as unknown as QuestionWithOptionsRow[]).map(q => ({
      id: q.id,
      ord: q.ord,
      text: q.text,
      options: (q.course_option ?? []).map(o => ({
        id: o.id, text: o.text, isCorrect: o.is_correct, explanation: o.explanation,
      })),
    })),
    practicalItems: (practicalRes.data ?? []).map(p => ({
      id: p.id, ord: p.ord, text: p.text, helpText: p.help_text,
    })),
  }
}
