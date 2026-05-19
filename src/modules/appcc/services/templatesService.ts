// src/modules/appcc/services/templatesService.ts
// Servicio de acceso a datos del catálogo APPCC:
// - Planes (los 14 maestros)
// - Plantillas (30 seeds + las que cree cada cuenta)
// - Items y opciones
//
// Las RLS de Supabase ya filtran por cuenta: este servicio no necesita
// pasar account_id explícitamente, lo aplica la política de la base de datos.

import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import type {
  AppccPlan,
  AppccTemplate,
  AppccTemplateItem,
  AppccTemplateItemOption,
  AppccTemplateWithItems,
  AppccFieldType,
  AppccSeverity,
} from '@/modules/appcc/types'

// Tipos helper para updates tipados
type TemplateUpdate = Database['public']['Tables']['appcc_templates']['Update']
type TemplateItemUpdate = Database['public']['Tables']['appcc_template_items']['Update']

/**
 * Devuelve los 14 planes APPCC activos, ordenados por display_order.
 */
export async function listPlans(): Promise<AppccPlan[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_plans')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (error) {
    console.error('[appcc/templatesService] listPlans error', error)
    throw error
  }
  return (data ?? []) as AppccPlan[]
}

/**
 * Devuelve todas las plantillas visibles (seeds globales + las de la cuenta del usuario).
 * Las RLS de Supabase filtran automáticamente.
 */
export async function listTemplates(): Promise<AppccTemplate[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_templates')
    .select('*')
    .eq('is_active', true)
    .order('code', { ascending: true })

  if (error) {
    console.error('[appcc/templatesService] listTemplates error', error)
    throw error
  }
  return (data ?? []) as AppccTemplate[]
}

/**
 * Devuelve las plantillas de un plan concreto.
 */
export async function listTemplatesByPlan(planId: string): Promise<AppccTemplate[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_templates')
    .select('*')
    .eq('plan_id', planId)
    .eq('is_active', true)
    .order('code', { ascending: true })

  if (error) {
    console.error('[appcc/templatesService] listTemplatesByPlan error', error)
    throw error
  }
  return (data ?? []) as AppccTemplate[]
}

/**
 * Devuelve una plantilla con todos sus datos (plan, items, opciones de select).
 * Pensado para la pantalla de ejecución, que necesita todo en una sola llamada.
 */
export async function getTemplateWithItems(
  templateId: string
): Promise<AppccTemplateWithItems | null> {
  if (!supabase) return null

  // 1. La plantilla y su plan
  const { data: tpl, error: tplErr } = await supabase
    .from('appcc_templates')
    .select('*, plan:appcc_plans(*)')
    .eq('id', templateId)
    .single()

  if (tplErr) {
    console.error('[appcc/templatesService] getTemplateWithItems (tpl) error', tplErr)
    throw tplErr
  }
  if (!tpl) return null

  // 2. Items de la plantilla
  const { data: items, error: itemsErr } = await supabase
    .from('appcc_template_items')
    .select('*')
    .eq('template_id', templateId)
    .order('display_order', { ascending: true })

  if (itemsErr) {
    console.error('[appcc/templatesService] getTemplateWithItems (items) error', itemsErr)
    throw itemsErr
  }

  // 3. Opciones de los items tipo select (en una sola query)
  const selectItemIds = (items ?? [])
    .filter(i => i.field_type === 'select')
    .map(i => i.id)

  let options: AppccTemplateItemOption[] = []
  if (selectItemIds.length > 0) {
    const { data: opts, error: optsErr } = await supabase
      .from('appcc_template_item_options')
      .select('*')
      .in('item_id', selectItemIds)
      .order('display_order', { ascending: true })

    if (optsErr) {
      console.error('[appcc/templatesService] getTemplateWithItems (options) error', optsErr)
      throw optsErr
    }
    options = (opts ?? []) as AppccTemplateItemOption[]
  }

  // 4. Asociar opciones a sus items
  const itemsWithOptions = (items ?? []).map((item) => ({
    ...(item as AppccTemplateItem),
    options: options.filter(o => o.item_id === item.id),
  }))

  return {
    ...(tpl as unknown as AppccTemplate),
    plan: (tpl as unknown as { plan: AppccPlan }).plan,
    items: itemsWithOptions,
  }
}

// ============================================================
// CRUD — PLANTILLAS
// ============================================================

export interface CreateTemplateInput {
  accountId: string
  planId: string
  code: string
  name: string
  description?: string
  estimatedMinutes?: number
}

export async function createTemplate(input: CreateTemplateInput): Promise<AppccTemplate> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_templates')
    .insert({
      account_id: input.accountId,
      plan_id: input.planId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      estimated_minutes: input.estimatedMinutes ?? null,
      is_seed: false,
      is_active: true,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as AppccTemplate
}

export interface UpdateTemplateInput {
  name?: string
  description?: string | null
  estimatedMinutes?: number | null
  isActive?: boolean
  planId?: string
}

export async function updateTemplate(
  templateId: string,
  patch: UpdateTemplateInput,
): Promise<AppccTemplate> {
  if (!supabase) throw new Error('Supabase no disponible')

  // FIX: tipado fuerte del update en lugar de Record<string, unknown>
  const update: TemplateUpdate = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description
  if (patch.estimatedMinutes !== undefined) update.estimated_minutes = patch.estimatedMinutes
  if (patch.isActive !== undefined) update.is_active = patch.isActive
  if (patch.planId !== undefined) update.plan_id = patch.planId

  const { data, error } = await supabase
    .from('appcc_templates')
    .update(update)
    .eq('id', templateId)
    .select('*')
    .single()

  if (error) throw error
  return data as AppccTemplate
}

export async function deleteTemplate(templateId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Soft delete: desactivar en vez de borrar (preserva histórico de executions)
  const { error } = await supabase
    .from('appcc_templates')
    .update({ is_active: false })
    .eq('id', templateId)

  if (error) throw error
}

// ============================================================
// CRUD — ITEMS DE PLANTILLA
// ============================================================

export interface CreateItemInput {
  templateId: string
  code: string
  label: string
  helpText?: string
  fieldType: AppccFieldType
  isRequired: boolean
  displayOrder: number
  numericMin?: number | null
  numericMax?: number | null
  numericUnit?: string | null
  expectedBoolean?: boolean | null
  createsIncidentOnFail: boolean
  incidentSeverity?: AppccSeverity | null
}

export async function createItem(input: CreateItemInput): Promise<AppccTemplateItem> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_template_items')
    .insert({
      template_id: input.templateId,
      code: input.code,
      label: input.label,
      help_text: input.helpText ?? null,
      field_type: input.fieldType,
      is_required: input.isRequired,
      display_order: input.displayOrder,
      numeric_min: input.numericMin ?? null,
      numeric_max: input.numericMax ?? null,
      numeric_unit: input.numericUnit ?? null,
      expected_boolean: input.expectedBoolean ?? null,
      creates_incident_on_fail: input.createsIncidentOnFail,
      incident_severity: input.incidentSeverity ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as AppccTemplateItem
}

export interface UpdateItemInput {
  label?: string
  helpText?: string | null
  fieldType?: AppccFieldType
  isRequired?: boolean
  displayOrder?: number
  numericMin?: number | null
  numericMax?: number | null
  numericUnit?: string | null
  expectedBoolean?: boolean | null
  createsIncidentOnFail?: boolean
  incidentSeverity?: AppccSeverity | null
}

export async function updateItem(
  itemId: string,
  patch: UpdateItemInput,
): Promise<AppccTemplateItem> {
  if (!supabase) throw new Error('Supabase no disponible')

  // FIX: tipado fuerte del update en lugar de Record<string, unknown>
  const update: TemplateItemUpdate = {}
  if (patch.label !== undefined) update.label = patch.label
  if (patch.helpText !== undefined) update.help_text = patch.helpText
  if (patch.fieldType !== undefined) update.field_type = patch.fieldType
  if (patch.isRequired !== undefined) update.is_required = patch.isRequired
  if (patch.displayOrder !== undefined) update.display_order = patch.displayOrder
  if (patch.numericMin !== undefined) update.numeric_min = patch.numericMin
  if (patch.numericMax !== undefined) update.numeric_max = patch.numericMax
  if (patch.numericUnit !== undefined) update.numeric_unit = patch.numericUnit
  if (patch.expectedBoolean !== undefined) update.expected_boolean = patch.expectedBoolean
  if (patch.createsIncidentOnFail !== undefined) update.creates_incident_on_fail = patch.createsIncidentOnFail
  if (patch.incidentSeverity !== undefined) update.incident_severity = patch.incidentSeverity

  const { data, error } = await supabase
    .from('appcc_template_items')
    .update(update)
    .eq('id', itemId)
    .select('*')
    .single()

  if (error) throw error
  return data as AppccTemplateItem
}

export async function deleteItem(itemId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Borrar opciones primero (FK)
  await supabase
    .from('appcc_template_item_options')
    .delete()
    .eq('item_id', itemId)

  const { error } = await supabase
    .from('appcc_template_items')
    .delete()
    .eq('id', itemId)

  if (error) throw error
}

export async function reorderItems(
  items: { id: string; displayOrder: number }[],
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  for (const item of items) {
    await supabase
      .from('appcc_template_items')
      .update({ display_order: item.displayOrder })
      .eq('id', item.id)
  }
}

// ============================================================
// CRUD — OPCIONES DE ITEM (select)
// ============================================================

export interface CreateOptionInput {
  itemId: string
  code: string
  label: string
  isFailure: boolean
  displayOrder: number
}

export async function createOption(input: CreateOptionInput): Promise<AppccTemplateItemOption> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_template_item_options')
    .insert({
      item_id: input.itemId,
      code: input.code,
      label: input.label,
      is_failure: input.isFailure,
      display_order: input.displayOrder,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as AppccTemplateItemOption
}

export async function deleteOption(optionId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { error } = await supabase
    .from('appcc_template_item_options')
    .delete()
    .eq('id', optionId)

  if (error) throw error
}
