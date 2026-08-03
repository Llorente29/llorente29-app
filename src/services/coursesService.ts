// src/services/coursesService.ts
// Formación C1 — Servicio de oficina (Team) para el motor de cursos internos.
// CRUD de curso/secciones/preguntas/opciones (autoría) + asignación + lectura
// de seguimiento (intentos y firmas). El móvil del empleado NO usa este
// servicio: usa las RPC start_course_attempt/submit_course_attempt/
// sign_course_attempt/my_pending_courses (ver mobileCoursesService.ts), que
// son las únicas que pueden escribir en course_attempt/course_signature.
//
// Si una consulta falla, se lanza el error (nunca se esconde devolviendo []
// silenciosamente: una lista vacía por error se leería como "no hay nada que
// asignar/seguir", que es mentira).

import { supabase } from '../lib/supabase'
import type { Employee } from '../types'
import type { Database } from '../types/database'

type CourseUpdate = Database['public']['Tables']['course']['Update']
type CourseSectionUpdate = Database['public']['Tables']['course_section']['Update']
type CourseQuestionUpdate = Database['public']['Tables']['course_question']['Update']
type CourseOptionUpdate = Database['public']['Tables']['course_option']['Update']

export type DeliveryMode = 'folvy_imparte' | 'solo_archivo' | 'mixto'
export type CourseStatus = 'draft' | 'published' | 'archived'
export type AssignmentOrigin = 'manual' | 'onboarding' | 'reeval_periodica' | 'reeval_evento'

export interface Course {
  id: string
  accountId: string | null
  /** Si esta es una copia adoptada de una plantilla global, el course.id de origen. */
  adoptedFromCourseId: string | null
  code: string
  title: string
  summary: string | null
  legalBasis: string | null
  deliveryMode: DeliveryMode
  reevalMonths: number | null
  isMandatory: boolean
  appccPrerequisite: boolean
  estimatedMinutes: number | null
  passThresholdPct: number
  version: number
  status: CourseStatus
  createdAt: string
}

export interface CourseOption {
  id: string
  questionId: string
  text: string
  isCorrect: boolean
  explanation: string | null
}

export interface CourseQuestion {
  id: string
  courseId: string
  ord: number
  text: string
  options: CourseOption[]
}

export interface CourseSection {
  id: string
  courseId: string
  ord: number
  title: string
  body: string
  mediaUrl: string | null
}

export interface CourseWithContent extends Course {
  sections: CourseSection[]
  questions: CourseQuestion[]
}

export interface CourseAssignment {
  id: string
  courseId: string
  accountId: string
  employeeId: string | null
  role: string | null
  locationId: string | null
  dueAt: string | null
  origin: AssignmentOrigin
  sourceIncidentId: string | null
  createdAt: string
}

export interface CourseAttempt {
  id: string
  assignmentId: string
  employeeId: string
  startedAt: string
  finishedAt: string | null
  scorePct: number | null
  passed: boolean | null
  timeSpentSeconds: number | null
}

export interface CourseSignatureRow {
  id: string
  attemptId: string
  employeeId: string
  signerName: string
  signerDocId: string
  signedAt: string
  courseVersion: number
  /** Path dentro del bucket privado course-signatures (para servir por URL firmada). */
  signaturePng: string
}

// ============================================================
// CURSOS
// ============================================================

interface CourseRow {
  id: string
  account_id: string | null
  adopted_from_course_id: string | null
  code: string
  title: string
  summary: string | null
  legal_basis: string | null
  delivery_mode: string
  reeval_months: number | null
  is_mandatory: boolean
  appcc_prerequisite: boolean
  estimated_minutes: number | null
  pass_threshold_pct: number
  version: number
  status: string
  created_at: string
}

function rowToCourse(r: CourseRow): Course {
  return {
    id: r.id,
    accountId: r.account_id,
    adoptedFromCourseId: r.adopted_from_course_id,
    code: r.code,
    title: r.title,
    summary: r.summary,
    legalBasis: r.legal_basis,
    deliveryMode: r.delivery_mode as DeliveryMode,
    reevalMonths: r.reeval_months,
    isMandatory: r.is_mandatory,
    appccPrerequisite: r.appcc_prerequisite,
    estimatedMinutes: r.estimated_minutes,
    passThresholdPct: r.pass_threshold_pct,
    version: r.version,
    status: r.status as CourseStatus,
    createdAt: r.created_at,
  }
}

/** Plantillas globales de Folvy (account_id NULL) + cursos propios de la cuenta. */
export async function listCourses(accountId: string): Promise<Course[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course')
    .select('*')
    .or(`account_id.is.null,account_id.eq.${accountId}`)
    .order('title', { ascending: true })
  if (error) { console.error('[coursesService] listCourses', error); throw error }
  return (data as CourseRow[]).map(rowToCourse)
}

export async function getCourseWithContent(courseId: string): Promise<CourseWithContent | null> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data: courseRow, error: courseErr } = await supabase
    .from('course')
    .select('*')
    .eq('id', courseId)
    .maybeSingle()
  if (courseErr) { console.error('[coursesService] getCourseWithContent (course)', courseErr); throw courseErr }
  if (!courseRow) return null

  const { data: sections, error: sectionsErr } = await supabase
    .from('course_section')
    .select('*')
    .eq('course_id', courseId)
    .order('ord', { ascending: true })
  if (sectionsErr) { console.error('[coursesService] getCourseWithContent (sections)', sectionsErr); throw sectionsErr }

  const { data: questions, error: questionsErr } = await supabase
    .from('course_question')
    .select('*')
    .eq('course_id', courseId)
    .order('ord', { ascending: true })
  if (questionsErr) { console.error('[coursesService] getCourseWithContent (questions)', questionsErr); throw questionsErr }

  const questionIds = (questions ?? []).map((q: { id: string }) => q.id)
  let options: { id: string; question_id: string; text: string; is_correct: boolean; explanation: string | null }[] = []
  if (questionIds.length > 0) {
    const { data: opts, error: optsErr } = await supabase
      .from('course_option')
      .select('*')
      .in('question_id', questionIds)
    if (optsErr) { console.error('[coursesService] getCourseWithContent (options)', optsErr); throw optsErr }
    options = opts ?? []
  }

  return {
    ...rowToCourse(courseRow as CourseRow),
    sections: (sections ?? []).map((s: { id: string; course_id: string; ord: number; title: string; body: string; media_url: string | null }) => ({
      id: s.id, courseId: s.course_id, ord: s.ord, title: s.title, body: s.body, mediaUrl: s.media_url,
    })),
    questions: (questions ?? []).map((q: { id: string; course_id: string; ord: number; text: string }) => ({
      id: q.id, courseId: q.course_id, ord: q.ord, text: q.text,
      options: options
        .filter(o => o.question_id === q.id)
        .map(o => ({ id: o.id, questionId: o.question_id, text: o.text, isCorrect: o.is_correct, explanation: o.explanation })),
    })),
  }
}

export interface CreateCourseInput {
  code: string
  title: string
  summary?: string
  legalBasis?: string
  deliveryMode: DeliveryMode
  reevalMonths?: number
  isMandatory?: boolean
  appccPrerequisite?: boolean
  estimatedMinutes?: number
  passThresholdPct?: number
}

export async function createCourse(accountId: string, input: CreateCourseInput): Promise<Course> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course')
    .insert({
      account_id: accountId,
      code: input.code,
      title: input.title,
      summary: input.summary ?? null,
      legal_basis: input.legalBasis ?? null,
      delivery_mode: input.deliveryMode,
      reeval_months: input.reevalMonths ?? null,
      is_mandatory: input.isMandatory ?? true,
      appcc_prerequisite: input.appccPrerequisite ?? false,
      estimated_minutes: input.estimatedMinutes ?? null,
      pass_threshold_pct: input.passThresholdPct ?? 70,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) { console.error('[coursesService] createCourse', error); throw error }
  return rowToCourse(data as CourseRow)
}

export interface UpdateCourseInput {
  title?: string
  summary?: string | null
  legalBasis?: string | null
  reevalMonths?: number | null
  isMandatory?: boolean
  appccPrerequisite?: boolean
  estimatedMinutes?: number | null
  passThresholdPct?: number
  status?: CourseStatus
}

export async function updateCourse(courseId: string, patch: UpdateCourseInput): Promise<Course> {
  if (!supabase) throw new Error('Supabase no disponible')
  const update: CourseUpdate = {}
  if (patch.title !== undefined) update.title = patch.title
  if (patch.summary !== undefined) update.summary = patch.summary
  if (patch.legalBasis !== undefined) update.legal_basis = patch.legalBasis
  if (patch.reevalMonths !== undefined) update.reeval_months = patch.reevalMonths
  if (patch.isMandatory !== undefined) update.is_mandatory = patch.isMandatory
  if (patch.appccPrerequisite !== undefined) update.appcc_prerequisite = patch.appccPrerequisite
  if (patch.estimatedMinutes !== undefined) update.estimated_minutes = patch.estimatedMinutes
  if (patch.passThresholdPct !== undefined) update.pass_threshold_pct = patch.passThresholdPct
  if (patch.status !== undefined) {
    update.status = patch.status
    // Publicar un curso ya publicado antes = nueva versión (el acta de quien
    // firmó la versión anterior sigue diciendo qué firmó exactamente).
  }

  const { data, error } = await supabase
    .from('course')
    .update(update)
    .eq('id', courseId)
    .select('*')
    .single()
  if (error) { console.error('[coursesService] updateCourse', error); throw error }
  return rowToCourse(data as CourseRow)
}

/** Publica el curso incrementando su versión (contenido ya no cambia sin volver a incrementar). */
export async function publishCourseNewVersion(courseId: string, currentVersion: number): Promise<Course> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course')
    .update({ status: 'published', version: currentVersion + 1 })
    .eq('id', courseId)
    .select('*')
    .single()
  if (error) { console.error('[coursesService] publishCourseNewVersion', error); throw error }
  return rowToCourse(data as CourseRow)
}

// ============================================================
// SECCIONES DE TEORÍA
// ============================================================

export async function createSection(
  courseId: string,
  input: { ord: number; title: string; body: string; mediaUrl?: string },
): Promise<CourseSection> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course_section')
    .insert({ course_id: courseId, ord: input.ord, title: input.title, body: input.body, media_url: input.mediaUrl ?? null })
    .select('*')
    .single()
  if (error) { console.error('[coursesService] createSection', error); throw error }
  return { id: data.id, courseId: data.course_id, ord: data.ord, title: data.title, body: data.body, mediaUrl: data.media_url }
}

export async function updateSection(
  sectionId: string,
  patch: { ord?: number; title?: string; body?: string; mediaUrl?: string | null },
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const update: CourseSectionUpdate = {}
  if (patch.ord !== undefined) update.ord = patch.ord
  if (patch.title !== undefined) update.title = patch.title
  if (patch.body !== undefined) update.body = patch.body
  if (patch.mediaUrl !== undefined) update.media_url = patch.mediaUrl
  const { error } = await supabase.from('course_section').update(update).eq('id', sectionId)
  if (error) { console.error('[coursesService] updateSection', error); throw error }
}

export async function deleteSection(sectionId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase.from('course_section').delete().eq('id', sectionId)
  if (error) { console.error('[coursesService] deleteSection', error); throw error }
}

// ============================================================
// PREGUNTAS Y OPCIONES DEL TEST
// ============================================================

export async function createQuestion(courseId: string, ord: number, text: string): Promise<CourseQuestion> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course_question')
    .insert({ course_id: courseId, ord, text })
    .select('*')
    .single()
  if (error) { console.error('[coursesService] createQuestion', error); throw error }
  return { id: data.id, courseId: data.course_id, ord: data.ord, text: data.text, options: [] }
}

export async function updateQuestion(questionId: string, patch: { ord?: number; text?: string }): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const update: CourseQuestionUpdate = {}
  if (patch.ord !== undefined) update.ord = patch.ord
  if (patch.text !== undefined) update.text = patch.text
  const { error } = await supabase.from('course_question').update(update).eq('id', questionId)
  if (error) { console.error('[coursesService] updateQuestion', error); throw error }
}

export async function deleteQuestion(questionId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  // Las opciones caen por ON DELETE CASCADE (course_option -> course_question).
  const { error } = await supabase.from('course_question').delete().eq('id', questionId)
  if (error) { console.error('[coursesService] deleteQuestion', error); throw error }
}

export async function createOption(
  questionId: string,
  input: { text: string; isCorrect: boolean; explanation?: string },
): Promise<CourseOption> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course_option')
    .insert({ question_id: questionId, text: input.text, is_correct: input.isCorrect, explanation: input.explanation ?? null })
    .select('*')
    .single()
  if (error) { console.error('[coursesService] createOption', error); throw error }
  return { id: data.id, questionId: data.question_id, text: data.text, isCorrect: data.is_correct, explanation: data.explanation }
}

export async function updateOption(
  optionId: string,
  patch: { text?: string; isCorrect?: boolean; explanation?: string | null },
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const update: CourseOptionUpdate = {}
  if (patch.text !== undefined) update.text = patch.text
  if (patch.isCorrect !== undefined) update.is_correct = patch.isCorrect
  if (patch.explanation !== undefined) update.explanation = patch.explanation
  const { error } = await supabase.from('course_option').update(update).eq('id', optionId)
  if (error) { console.error('[coursesService] updateOption', error); throw error }
}

export async function deleteOption(optionId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase.from('course_option').delete().eq('id', optionId)
  if (error) { console.error('[coursesService] deleteOption', error); throw error }
}

// ============================================================
// ASIGNACIÓN
// ============================================================

interface AssignmentRow {
  id: string
  course_id: string
  account_id: string
  employee_id: string | null
  role: string | null
  location_id: string | null
  due_at: string | null
  origin: string
  source_incident_id: string | null
  created_at: string
}

function rowToAssignment(r: AssignmentRow): CourseAssignment {
  return {
    id: r.id, courseId: r.course_id, accountId: r.account_id,
    employeeId: r.employee_id, role: r.role, locationId: r.location_id,
    dueAt: r.due_at, origin: r.origin as AssignmentOrigin,
    sourceIncidentId: r.source_incident_id, createdAt: r.created_at,
  }
}

export interface CreateAssignmentInput {
  courseId: string
  accountId: string
  employeeId?: string
  role?: string
  locationId?: string
  dueAt?: string
  origin?: AssignmentOrigin
}

export async function createAssignment(input: CreateAssignmentInput): Promise<CourseAssignment> {
  if (!supabase) throw new Error('Supabase no disponible')
  if (!input.employeeId && !input.role && !input.locationId) {
    throw new Error('La asignación necesita al menos un destino: empleado, puesto o local')
  }
  const { data, error } = await supabase
    .from('course_assignment')
    .insert({
      course_id: input.courseId,
      account_id: input.accountId,
      employee_id: input.employeeId ?? null,
      role: input.role ?? null,
      location_id: input.locationId ?? null,
      due_at: input.dueAt ?? null,
      origin: input.origin ?? 'manual',
    })
    .select('*')
    .single()
  if (error) { console.error('[coursesService] createAssignment', error); throw error }
  return rowToAssignment(data as AssignmentRow)
}

export async function listAssignments(courseId: string): Promise<CourseAssignment[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('course_assignment')
    .select('*')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[coursesService] listAssignments', error); throw error }
  return (data as AssignmentRow[]).map(rowToAssignment)
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase.from('course_assignment').delete().eq('id', assignmentId)
  if (error) { console.error('[coursesService] deleteAssignment', error); throw error }
}

// ============================================================
// SEGUIMIENTO — intentos y firmas de las asignaciones de un curso
// ============================================================

export async function listAttemptsForCourse(courseId: string): Promise<CourseAttempt[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  // course_attempt no tiene course_id directo: se filtra por los assignment_id
  // de este curso (RLS ya exige que el caller sea admin/manager de la cuenta).
  const { data: assignments, error: assignErr } = await supabase
    .from('course_assignment')
    .select('id')
    .eq('course_id', courseId)
  if (assignErr) { console.error('[coursesService] listAttemptsForCourse (assignments)', assignErr); throw assignErr }
  const assignmentIds = (assignments ?? []).map((a: { id: string }) => a.id)
  if (assignmentIds.length === 0) return []

  const { data, error } = await supabase
    .from('course_attempt')
    .select('*')
    .in('assignment_id', assignmentIds)
    .order('started_at', { ascending: false })
  if (error) { console.error('[coursesService] listAttemptsForCourse', error); throw error }
  return (data ?? []).map((r: {
    id: string; assignment_id: string; employee_id: string; started_at: string
    finished_at: string | null; score_pct: number | null; passed: boolean | null; time_spent_seconds: number | null
  }) => ({
    id: r.id, assignmentId: r.assignment_id, employeeId: r.employee_id,
    startedAt: r.started_at, finishedAt: r.finished_at, scorePct: r.score_pct,
    passed: r.passed, timeSpentSeconds: r.time_spent_seconds,
  }))
}

export async function listSignaturesForAttempts(attemptIds: string[]): Promise<CourseSignatureRow[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  if (attemptIds.length === 0) return []
  const { data, error } = await supabase
    .from('course_signature')
    .select('*')
    .in('attempt_id', attemptIds)
    .order('signed_at', { ascending: false })
  if (error) { console.error('[coursesService] listSignaturesForAttempts', error); throw error }
  return (data ?? []).map((r: {
    id: string; attempt_id: string; employee_id: string; signer_name: string
    signer_doc_id: string; signed_at: string; course_version: number; signature_png: string
  }) => ({
    id: r.id, attemptId: r.attempt_id, employeeId: r.employee_id,
    signerName: r.signer_name, signerDocId: r.signer_doc_id,
    signedAt: r.signed_at, courseVersion: r.course_version,
    signaturePng: r.signature_png,
  }))
}

// ============================================================
// RESOLUCIÓN DE SEGUIMIENTO (pura, sin red) — combina asignaciones,
// intentos, firmas y la plantilla YA CARGADA de empleados (staff del
// AppContext) para pintar "quién ha hecho qué, quién va tarde".
// ============================================================

export type TrackingStatus = 'pendiente' | 'en_curso' | 'suspendido' | 'firmado'

export interface TrackingRow {
  assignmentId: string
  employeeId: string
  employeeName: string
  dueAt: string | null
  overdue: boolean
  status: TrackingStatus
  scorePct: number | null
  signedAt: string | null
}

/**
 * Expande cada asignación a sus empleados destino (directo, por puesto o por
 * local) y cruza con el último intento/firma de cada uno. Empleados inactivos
 * se excluyen (no tiene sentido perseguir formación de alguien de baja).
 */
export function resolveTrackingRows(
  assignments: CourseAssignment[],
  attempts: CourseAttempt[],
  signatures: CourseSignatureRow[],
  employees: Employee[],
): TrackingRow[] {
  const now = Date.now()
  const activeEmployees = employees.filter(e => e.active)
  const rows: TrackingRow[] = []

  for (const a of assignments) {
    const targets = activeEmployees.filter(e =>
      (a.employeeId && e.id === a.employeeId)
      || (a.role && e.position === a.role)
      || (a.locationId && e.locationId === a.locationId),
    )
    for (const emp of targets) {
      const empAttempts = attempts
        .filter(at => at.assignmentId === a.id && at.employeeId === emp.id)
        .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime())
      const lastAttempt = empAttempts[0]
      const lastSignature = lastAttempt
        ? signatures
          .filter(s => s.attemptId === lastAttempt.id)
          .sort((x, y) => new Date(y.signedAt).getTime() - new Date(x.signedAt).getTime())[0]
        : undefined

      let status: TrackingStatus = 'pendiente'
      if (lastSignature) status = 'firmado'
      else if (lastAttempt?.finishedAt && lastAttempt.passed === false) status = 'suspendido'
      else if (lastAttempt?.startedAt && !lastAttempt.finishedAt) status = 'en_curso'

      rows.push({
        assignmentId: a.id,
        employeeId: emp.id,
        employeeName: emp.name,
        dueAt: a.dueAt,
        overdue: !!a.dueAt && status !== 'firmado' && new Date(a.dueAt).getTime() < now,
        status,
        scorePct: lastAttempt?.scorePct ?? null,
        signedAt: lastSignature?.signedAt ?? null,
      })
    }
  }

  return rows
}
