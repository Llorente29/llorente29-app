// src/modules/appcc/audits/auditsService.ts
// Servicio de auditorías APPCC: CRUD + scoring + integración con incidencias.
import { supabase } from '@/lib/supabase'
import * as incidentsService from '@/modules/appcc/services/incidentsService'
import type { Database } from '@/types/database'
import type {
  Audit,
  AuditResponse,
  AuditResponsePhoto,
  AuditStatus,
  AuditTemplate,
  AuditTemplateWithItems,
  AuditItem,
  AuditSection,
} from './types'
import { valueToScore, isFailureResponse } from './types'

// Tipo helper para updates tipados de la tabla appcc_audits
type AuditUpdate = Database['public']['Tables']['appcc_audits']['Update']

// ============================================================
// PLANTILLAS
// ============================================================
/** Lista plantillas activas */
export async function listTemplates(): Promise<AuditTemplate[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('appcc_audit_templates')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) {
    console.error('[auditsService] listTemplates error', error)
    throw error
  }
  return (data ?? []) as AuditTemplate[]
}

// ============================================================
// CRUD PLANTILLAS (Bloque B+: editor de plantillas)
// ============================================================

export interface CreateTemplateInput {
  code: string
  name: string
  description?: string | null
  recurrence: 'monthly' | 'quarterly' | 'yearly' | 'on_demand'
  pass_score: number
  accountId: string
}

export async function createTemplate(input: CreateTemplateInput): Promise<AuditTemplate> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_templates')
    .insert({
      account_id: input.accountId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      recurrence: input.recurrence,
      pass_score: input.pass_score,
      is_seed: false,
      is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as AuditTemplate
}

export async function updateTemplate(
  templateId: string,
  patch: Partial<Pick<AuditTemplate, 'name' | 'description' | 'recurrence' | 'pass_score' | 'is_active'>>,
): Promise<AuditTemplate> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', templateId)
    .select()
    .single()
  if (error) throw error
  return data as AuditTemplate
}

export async function deleteTemplate(templateId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase
    .from('appcc_audit_templates')
    .update({ is_active: false })
    .eq('id', templateId)
  if (error) throw error
}

/** Clonar una plantilla (incluye secciones e ítems) */
export async function cloneTemplate(
  sourceTemplateId: string,
  accountId: string,
  newName: string,
  newCode: string,
): Promise<AuditTemplate> {
  if (!supabase) throw new Error('Supabase no disponible')

  const source = await getTemplateWithItems(sourceTemplateId)
  if (!source) throw new Error('Plantilla origen no encontrada')

  // Crear plantilla
  const newTpl = await createTemplate({
    accountId,
    code: newCode,
    name: newName,
    description: source.description,
    recurrence: source.recurrence,
    pass_score: source.pass_score,
  })

  // Crear secciones e ítems
  for (const section of source.sections) {
    const newSection = await createSection({
      templateId: newTpl.id,
      code: section.code,
      name: section.name,
      description: section.description,
      display_order: section.display_order,
      weight: section.weight,
    })
    for (const item of section.items) {
      await createItem({
        sectionId: newSection.id,
        code: item.code,
        question: item.question,
        help_text: item.help_text,
        scoring_type: item.scoring_type,
        weight: item.weight,
        creates_incident_on_fail: item.creates_incident_on_fail,
        incident_severity: item.incident_severity,
        display_order: item.display_order,
      })
    }
  }
  return newTpl
}

// ============================================================
// CRUD SECCIONES
// ============================================================

export interface CreateSectionInput {
  templateId: string
  code: string
  name: string
  description?: string | null
  display_order: number
  weight: number
}

export async function createSection(input: CreateSectionInput): Promise<AuditSection> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_sections')
    .insert({
      template_id: input.templateId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      display_order: input.display_order,
      weight: input.weight,
    })
    .select()
    .single()
  if (error) throw error
  return data as AuditSection
}

export async function updateSection(
  sectionId: string,
  patch: Partial<Pick<AuditSection, 'name' | 'description' | 'display_order' | 'weight'>>,
): Promise<AuditSection> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_sections')
    .update(patch)
    .eq('id', sectionId)
    .select()
    .single()
  if (error) throw error
  return data as AuditSection
}

export async function deleteSection(sectionId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase
    .from('appcc_audit_sections')
    .delete()
    .eq('id', sectionId)
  if (error) throw error
}

// ============================================================
// CRUD ÍTEMS
// ============================================================

export interface CreateItemInput {
  sectionId: string
  code: string
  question: string
  help_text?: string | null
  scoring_type: 'binary' | 'scale_0_5' | 'na_allowed'
  weight: number
  creates_incident_on_fail: boolean
  incident_severity: 'low' | 'medium' | 'high' | 'critical' | null
  display_order: number
}

export async function createItem(input: CreateItemInput): Promise<AuditItem> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_items')
    .insert({
      section_id: input.sectionId,
      code: input.code,
      question: input.question,
      help_text: input.help_text ?? null,
      scoring_type: input.scoring_type,
      weight: input.weight,
      creates_incident_on_fail: input.creates_incident_on_fail,
      incident_severity: input.incident_severity,
      display_order: input.display_order,
    })
    .select()
    .single()
  if (error) throw error
  return data as AuditItem
}

export async function updateItem(
  itemId: string,
  patch: Partial<Omit<AuditItem, 'id' | 'section_id'>>,
): Promise<AuditItem> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data as AuditItem
}

export async function deleteItem(itemId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase
    .from('appcc_audit_items')
    .delete()
    .eq('id', itemId)
  if (error) throw error
}

/** Plantilla con secciones e ítems anidados (para ejecutar la auditoría) */
export async function getTemplateWithItems(
  templateId: string
): Promise<AuditTemplateWithItems | null> {
  if (!supabase) return null

  const [tplRes, secRes, itmRes] = await Promise.all([
    supabase.from('appcc_audit_templates').select('*').eq('id', templateId).single(),
    supabase
      .from('appcc_audit_sections')
      .select('*')
      .eq('template_id', templateId)
      .order('display_order'),
    supabase
      .from('appcc_audit_items')
      .select(`
        *,
        section:appcc_audit_sections!inner(template_id)
      `)
      .eq('section.template_id', templateId)
      .order('display_order'),
  ])

  if (tplRes.error || !tplRes.data) {
    console.error('[auditsService] getTemplateWithItems error', tplRes.error)
    return null
  }

  const sections = (secRes.data ?? []) as AuditSection[]
  const items = (itmRes.data ?? []) as (AuditItem & { section?: unknown })[]

  return {
    ...(tplRes.data as AuditTemplate),
    sections: sections.map(s => ({
      ...s,
      items: items
        .filter(i => i.section_id === s.id)
        .map(({ section: _section, ...rest }) => rest as AuditItem),
    })),
  } as AuditTemplateWithItems
}

// ============================================================
// AUDITORÍAS (instancias)
// ============================================================

export interface CreateAuditInput {
  accountId: string
  locationId: string
  templateId: string
  scheduledDate: string  // YYYY-MM-DD
  /** Auditor pre-asignado (opcional). Si no se pasa, se rellena al startAudit. */
  auditorId?: string | null
  auditorName?: string | null
}

/** Crear auditoría programada */
export async function createAudit(input: CreateAuditInput): Promise<Audit> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audits')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      template_id: input.templateId,
      scheduled_date: input.scheduledDate,
      status: 'scheduled',
      auditor_id: input.auditorId ?? null,
      auditor_name: input.auditorName ?? null,
    })
    .select()
    .single()
  if (error) {
    console.error('[auditsService] createAudit error', error)
    throw error
  }
  return data as Audit
}

/** Lista auditorías de un local (todas o filtradas por estado) */
export async function listAudits(
  locationId: string,
  statuses?: AuditStatus[],
): Promise<Audit[]> {
  if (!supabase) return []
  let q = supabase
    .from('appcc_audits')
    .select('*')
    .eq('location_id', locationId)
    .order('scheduled_date', { ascending: false })
  if (statuses && statuses.length > 0) {
    q = q.in('status', statuses)
  }
  const { data, error } = await q
  if (error) {
    console.error('[auditsService] listAudits error', error)
    throw error
  }
  return (data ?? []) as Audit[]
}

/** Detalle completo: auditoría + plantilla + respuestas + fotos */
export interface AuditDetail {
  audit: Audit
  template: AuditTemplateWithItems
  responses: AuditResponse[]
  photos: AuditResponsePhoto[]
}

export async function getAuditDetail(auditId: string): Promise<AuditDetail | null> {
  if (!supabase) return null

  const { data: audit, error: auditErr } = await supabase
    .from('appcc_audits')
    .select('*')
    .eq('id', auditId)
    .single()
  if (auditErr || !audit) {
    console.error('[auditsService] getAuditDetail audit error', auditErr)
    return null
  }

  const template = await getTemplateWithItems((audit as Audit).template_id)
  if (!template) return null

  const [respRes, phRes] = await Promise.all([
    supabase.from('appcc_audit_responses').select('*').eq('audit_id', auditId),
    supabase
      .from('appcc_audit_response_photos')
      .select('*, appcc_audit_responses!inner(audit_id)')
      .eq('appcc_audit_responses.audit_id', auditId),
  ])

  return {
    audit: audit as Audit,
    template,
    responses: (respRes.data ?? []) as AuditResponse[],
    photos: (phRes.data ?? []) as AuditResponsePhoto[],
  }
}

/** Marca como en curso. Si no había auditor asignado, lo setea con el actor actual. */
export async function startAudit(
  auditId: string,
  actorId: string | null,
  actorName?: string | null,
): Promise<Audit> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Leer estado actual para no sobreescribir auditor ya asignado
  const { data: current } = await supabase
    .from('appcc_audits')
    .select('auditor_id, auditor_name')
    .eq('id', auditId)
    .single()

  // FIX: tipado fuerte del update en lugar de Record<string, unknown>
  const update: AuditUpdate = {
    status: 'in_progress',
    started_at: new Date().toISOString(),
    started_by: actorId,
  }
  // Solo setear auditor si no había ninguno asignado
  if (!current?.auditor_id) {
    update.auditor_id = actorId
    update.auditor_name = actorName ?? null
  }

  const { data, error } = await supabase
    .from('appcc_audits')
    .update(update)
    .eq('id', auditId)
    .select()
    .single()
  if (error) throw error
  return data as Audit
}

/** Guarda/actualiza una respuesta. Si genera incidencia, también la crea. */
export async function upsertResponse(input: {
  auditId: string
  itemId: string
  value: string | null
  notes?: string | null
  actorId: string | null
  // Para crear incidencia si procede
  item: AuditItem
  audit: Audit
  templateName: string
  sectionName: string
}): Promise<AuditResponse> {
  if (!supabase) throw new Error('Supabase no disponible')

  const isFailure = isFailureResponse(input.value, input.item.scoring_type)
  let incidentId: string | null = null

  // Si el ítem genera incidencia al fallar y la respuesta es fallo
  if (isFailure && input.item.creates_incident_on_fail && input.item.incident_severity) {
    try {
      const incident = await incidentsService.createManualIncident({
        accountId: input.audit.account_id,
        locationId: input.audit.location_id,
        title: `[Auditoría] ${input.item.question}`,
        description: `Detectado en auditoría "${input.templateName}" — sección ${input.sectionName}.${input.notes ? `\n\nNotas: ${input.notes}` : ''}`,
        severity: input.item.incident_severity,
        category: 'auditoría',
        createdBy: input.actorId,
      })
      incidentId = incident.id
    } catch (err) {
      console.warn('[auditsService] no se pudo crear incidencia desde auditoría', err)
    }
  }

  // Upsert de la respuesta (única por audit_id + item_id)
  const { data, error } = await supabase
    .from('appcc_audit_responses')
    .upsert(
      {
        audit_id: input.auditId,
        item_id: input.itemId,
        value: input.value,
        notes: input.notes ?? null,
        incident_id: incidentId,
        answered_by: input.actorId,
        answered_at: new Date().toISOString(),
      },
      { onConflict: 'audit_id,item_id' }
    )
    .select()
    .single()

  if (error) {
    console.error('[auditsService] upsertResponse error', error)
    throw error
  }
  return data as AuditResponse
}

// ============================================================
// SCORING
// ============================================================

export interface AuditScoring {
  totalScore: number       // 0-100
  passed: boolean
  sectionScores: {
    sectionId: string
    sectionName: string
    score: number          // 0-100
    answered: number       // respuestas que cuentan
    total: number          // ítems totales (no excluye NA)
  }[]
  itemsTotal: number
  itemsAnswered: number    // sin NA
  itemsNa: number
  itemsFailures: number    // respuestas marcadas como fallo
}

/**
 * Calcula el scoring de una auditoría a partir de la plantilla con secciones,
 * los items, las respuestas y el pass_score. NO consulta BBDD.
 */
export function calculateScoring(
  template: AuditTemplateWithItems,
  responses: AuditResponse[],
): AuditScoring {
  const respByItem = new Map(responses.map(r => [r.item_id, r]))

  let weightedSum = 0
  let totalWeight = 0
  let itemsAnswered = 0
  let itemsNa = 0
  let itemsFailures = 0
  let itemsTotal = 0

  const sectionScores: AuditScoring['sectionScores'] = []

  for (const section of template.sections) {
    let secWeightedSum = 0
    let secTotalWeight = 0
    let secAnswered = 0

    for (const item of section.items) {
      itemsTotal++
      const r = respByItem.get(item.id)
      const score = r ? valueToScore(r.value, item.scoring_type) : null

      if (score === null) {
        // No respondida o NA
        if (r && r.value === 'na') itemsNa++
        continue
      }

      // Cuenta para el scoring
      const combinedWeight = section.weight * item.weight
      weightedSum += score * combinedWeight
      totalWeight += combinedWeight
      secWeightedSum += score * item.weight
      secTotalWeight += item.weight
      itemsAnswered++

      if (isFailureResponse(r?.value ?? null, item.scoring_type)) {
        itemsFailures++
      }
    }

    sectionScores.push({
      sectionId: section.id,
      sectionName: section.name,
      score: secTotalWeight > 0 ? Math.round((secWeightedSum / secTotalWeight) * 100) : 0,
      answered: secAnswered, // se queda a 0; lo dejamos como métrica futura
      total: section.items.length,
    })
  }

  const totalScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0

  return {
    totalScore,
    passed: totalScore >= template.pass_score,
    sectionScores,
    itemsTotal,
    itemsAnswered,
    itemsNa,
    itemsFailures,
  }
}

/** Completar auditoría: calcula scoring, persiste y firma con SHA-256 */
export async function completeAudit(
  auditId: string,
  actorId: string | null,
  notes: string | null,
): Promise<Audit> {
  if (!supabase) throw new Error('Supabase no disponible')

  const detail = await getAuditDetail(auditId)
  if (!detail) throw new Error('Auditoría no encontrada')

  const scoring = calculateScoring(detail.template, detail.responses)

  // Firma SHA-256
  const payload = `${auditId}|${actorId ?? 'admin'}|${scoring.totalScore}|${Date.now()}`
  const buf = new TextEncoder().encode(payload)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  const signature = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  const { data, error } = await supabase
    .from('appcc_audits')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: actorId,
      final_score: scoring.totalScore,
      passed: scoring.passed,
      notes,
      signature,
    })
    .eq('id', auditId)
    .select()
    .single()

  if (error) throw error
  return data as Audit
}

/** Cancelar (no se borra, queda histórico) */
export async function cancelAudit(auditId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase
    .from('appcc_audits')
    .update({ status: 'cancelled' })
    .eq('id', auditId)
  if (error) throw error
}

// ============================================================
// FOTOS POR RESPUESTA
// ============================================================

export async function addResponsePhoto(
  responseId: string,
  storagePath: string,
  actorId: string | null,
  caption?: string | null,
): Promise<AuditResponsePhoto> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('appcc_audit_response_photos')
    .insert({
      response_id: responseId,
      storage_path: storagePath,
      caption: caption ?? null,
      taken_by: actorId,
    })
    .select()
    .single()
  if (error) throw error
  return data as AuditResponsePhoto
}

export async function listResponsePhotos(
  auditId: string,
): Promise<AuditResponsePhoto[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('appcc_audit_response_photos')
    .select('*, appcc_audit_responses!inner(audit_id)')
    .eq('appcc_audit_responses.audit_id', auditId)
  if (error) {
    console.error('[auditsService] listResponsePhotos error', error)
    return []
  }
  return (data ?? []) as AuditResponsePhoto[]
}
