// src/modules/appcc/services/templatesService.ts
// Servicio de acceso a datos del catálogo APPCC:
// - Planes (los 14 maestros)
// - Plantillas (30 seeds + las que cree cada cuenta)
// - Items y opciones
//
// Las RLS de Supabase ya filtran por cuenta: este servicio no necesita
// pasar account_id explícitamente, lo aplica la política de la base de datos.

import { supabase } from '@/lib/supabase'
import type {
  AppccPlan,
  AppccTemplate,
  AppccTemplateItem,
  AppccTemplateItemOption,
  AppccTemplateWithItems,
} from '@/modules/appcc/types'

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