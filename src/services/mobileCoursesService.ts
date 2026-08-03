// src/services/mobileCoursesService.ts
// Formación C1 — Servicio del MÓVIL del empleado (MiFormacion.tsx).
//
// Todo pasa por las RPC (SECURITY DEFINER): el empleado nunca resuelve su
// propia identidad, ni lee is_correct/explanation antes de responder, ni
// escribe course_attempt/course_signature directo. auth.uid() se resuelve
// SIEMPRE server-side dentro de cada función — por eso ninguna de estas
// llamadas recibe employeeId como parámetro.

import { supabase } from '../lib/supabase'

export type PendingCourseStatus = 'pendiente' | 'en_curso' | 'suspendido' | 'firmado'

export interface PendingCourse {
  assignmentId: string
  courseId: string
  courseCode: string
  courseTitle: string
  deliveryMode: string
  estimatedMinutes: number | null
  reevalMonths: number | null
  dueAt: string | null
  status: PendingCourseStatus
  attemptId: string | null
  scorePct: number | null
  passed: boolean | null
  signedAt: string | null
}

interface PendingCourseRpcRow {
  assignment_id: string
  course_id: string
  course_code: string
  course_title: string
  delivery_mode: string
  estimated_minutes: number | null
  reeval_months: number | null
  due_at: string | null
  status: string
  attempt_id: string | null
  score_pct: number | null
  passed: boolean | null
  signed_at: string | null
}

export async function fetchMyPendingCourses(): Promise<PendingCourse[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('my_pending_courses')
  if (error) { console.error('[mobileCoursesService] fetchMyPendingCourses', error); throw error }
  return ((data ?? []) as PendingCourseRpcRow[]).map(r => ({
    assignmentId: r.assignment_id,
    courseId: r.course_id,
    courseCode: r.course_code,
    courseTitle: r.course_title,
    deliveryMode: r.delivery_mode,
    estimatedMinutes: r.estimated_minutes,
    reevalMonths: r.reeval_months,
    dueAt: r.due_at,
    status: r.status as PendingCourseStatus,
    attemptId: r.attempt_id,
    scorePct: r.score_pct,
    passed: r.passed,
    signedAt: r.signed_at,
  }))
}

export interface AttemptOption { id: string; text: string }
export interface AttemptQuestion { id: string; ord: number; text: string; options: AttemptOption[] }
export interface AttemptSection { id: string; ord: number; title: string; body: string; mediaUrl: string | null }
export interface AttemptCourse {
  id: string; code: string; title: string; summary: string | null; legalBasis: string | null
  deliveryMode: string; estimatedMinutes: number | null; passThresholdPct: number; version: number
}
export interface StartAttemptResult {
  attemptId: string
  course: AttemptCourse
  sections: AttemptSection[]
  questions: AttemptQuestion[]
}

export async function startAttempt(assignmentId: string): Promise<StartAttemptResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('start_course_attempt', { p_assignment_id: assignmentId })
  if (error) { console.error('[mobileCoursesService] startAttempt', error); throw error }
  const d = data as unknown as {
    attemptId: string
    course: { id: string; code: string; title: string; summary: string | null; legalBasis: string | null; deliveryMode: string; estimatedMinutes: number | null; passThresholdPct: number; version: number }
    sections: AttemptSection[]
    questions: AttemptQuestion[]
  }
  return { attemptId: d.attemptId, course: d.course, sections: d.sections, questions: d.questions }
}

export interface SubmitResultItem {
  questionId: string
  givenOptionId: string | null
  isCorrect: boolean
  explanation: string | null
  correctOptionId: string | null
  correctText: string | null
}
export interface SubmitResult {
  scorePct: number
  passed: boolean
  total: number
  correct: number
  passThresholdPct: number
  results: SubmitResultItem[]
}

/** answers: { [questionId]: optionId } */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, string>,
  timeSpentSeconds?: number,
): Promise<SubmitResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('submit_course_attempt', {
    p_attempt_id: attemptId,
    p_answers: answers,
    p_time_spent_seconds: timeSpentSeconds ?? null,
  })
  if (error) { console.error('[mobileCoursesService] submitAttempt', error); throw error }
  return data as unknown as SubmitResult
}

const SIGNATURES_BUCKET = 'course-signatures'

/**
 * Sube el PNG de la firma al bucket privado. Path: {accountId}/{employeeId}/{attemptId}-{ts}.png
 * (la RLS de storage exige exactamente esos dos primeros segmentos de carpeta).
 */
export async function uploadSignaturePng(
  accountId: string,
  employeeId: string,
  attemptId: string,
  pngBlob: Blob,
): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')
  const path = `${accountId}/${employeeId}/${attemptId}-${Date.now()}.png`
  const { error } = await supabase.storage.from(SIGNATURES_BUCKET).upload(path, pngBlob, {
    contentType: 'image/png',
    upsert: false,
  })
  if (error) { console.error('[mobileCoursesService] uploadSignaturePng', error); throw error }
  return path
}

export interface SignAttemptResult { signatureId: string; signedAt: string }

export async function signAttempt(
  attemptId: string,
  signaturePath: string,
  signerName: string,
  signerDocId: string,
): Promise<SignAttemptResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('sign_course_attempt', {
    p_attempt_id: attemptId,
    p_signature_path: signaturePath,
    p_signer_name: signerName,
    p_signer_doc_id: signerDocId,
  })
  if (error) { console.error('[mobileCoursesService] signAttempt', error); throw error }
  return data as unknown as SignAttemptResult
}
