// src/modules/kitchen/services/ingredientTemplateService.ts
//
// Lectura y BÚSQUEDA del master global de ingredientes (ingredient_template +
// ingredient_template_allergen). Scope GLOBAL (sin account_id): todas las
// cuentas leen el mismo catálogo. La escritura/sembrado del master NO vive
// aquí (se hace con service_role, fuera de la sesión del cliente).
//
// Sigue el patrón canónico de los services de kitchen (purchaseFormatService,
// kitchenUnitService): requireSupabase, mapeadores rowToX, errores con
// throw new Error, mapeo snake<->camel.
//
// Este service es la BASE de la adopción al vuelo (T1b): el buscador de
// ingredientes consultará searchTemplates() y, al elegir uno inexistente en la
// cuenta, otro service materializará un recipe_item copiando estos datos
// (con needs_review). Aquí solo LEEMOS el master.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { Database } from '../../../types/database'
import type { AllergenCode, AllergenState } from '../lib/allergens'

// Filas DERIVADAS del esquema generado (fuente de verdad), no declaradas a
// mano: así nunca divergen del esquema real (p. ej. nutrition es Json, no un
// Record estrecho). Si cambia la tabla y se regenera database.ts, estos tipos
// se ajustan solos.
type RowIngredientTemplate =
  Database['public']['Tables']['ingredient_template']['Row']
type RowIngredientTemplateAllergen =
  Database['public']['Tables']['ingredient_template_allergen']['Row']

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// ─── Tipos de cliente (camelCase) ──────────────────────────────────────────

export type TemplateBaseDimension = 'weight' | 'volume' | 'unit'
export type TemplateSource = 'bedca' | 'usda' | 'off' | 'ai' | 'manual'

export interface IngredientTemplateAllergen {
  templateId: string
  allergenCode: AllergenCode
  state: AllergenState
  source: string
}

export interface IngredientTemplate {
  id: string
  code: string
  nameEs: string
  nameEn: string | null
  aliases: string[]
  familyCode: string | null
  defaultBaseDimension: TemplateBaseDimension | null
  densityGPerMl: number | null
  defaultWastePct: number | null
  shelfLifeDays: number | null
  conservationType: string | null
  nutrition: Record<string, unknown> | null
  photoUrl: string | null
  gtin: string | null
  gpcBrickCode: string | null
  source: TemplateSource
  version: number
  publishedAt: string | null
  position: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ─── Filas de BBDD: derivadas arriba de database.ts ────────────────────────

// ─── Mapeadores ──────────────────────────────────────────────────────────

// nutrition se guarda como jsonb (tipo Json: puede ser objeto, array, escalar
// o null). En cliente lo tratamos como un objeto plano de métricas por 100 g;
// si no es un objeto plano, devolvemos null (no inventamos forma).
function toNutritionRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

export function rowToTemplate(row: RowIngredientTemplate): IngredientTemplate {
  return {
    id: row.id,
    code: row.code,
    nameEs: row.name_es,
    nameEn: row.name_en,
    aliases: row.aliases ?? [],
    familyCode: row.family_code,
    defaultBaseDimension:
      (row.default_base_dimension as TemplateBaseDimension | null) ?? null,
    densityGPerMl: row.density_g_per_ml,
    defaultWastePct: row.default_waste_pct,
    shelfLifeDays: row.shelf_life_days,
    conservationType: row.conservation_type,
    nutrition: toNutritionRecord(row.nutrition),
    photoUrl: row.photo_url,
    gtin: row.gtin,
    gpcBrickCode: row.gpc_brick_code,
    source: (row.source as TemplateSource) ?? 'manual',
    version: row.version,
    publishedAt: row.published_at,
    position: row.position,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToTemplateAllergen(
  row: RowIngredientTemplateAllergen,
): IngredientTemplateAllergen {
  return {
    templateId: row.template_id,
    allergenCode: row.allergen_code as AllergenCode,
    state: row.state as AllergenState,
    source: row.source,
  }
}

// ─── Lectura / búsqueda ────────────────────────────────────────────────────

/**
 * Busca en el master por término (nombre ES/EN o alias). Pensado para el
 * buscador de la adopción al vuelo: teclea "albah" -> devuelve coincidencias.
 * Usa los índices trigram de la tabla. Vacío -> devuelve [] (no error).
 *
 * NOTA: quien llame debe aplicar debounce (no llamar en cada tecla). El límite
 * por defecto (20) evita traer el catálogo entero.
 */
export async function searchTemplates(
  term: string,
  limit = 20,
): Promise<IngredientTemplate[]> {
  requireSupabase()
  const q = term.trim()
  if (q.length === 0) return []
  const pattern = `%${q}%`
  // OR sobre nombre ES, nombre EN y aliases (array -> usa el operador de texto
  // de PostgREST sobre la representación; el GIN de aliases acelera el ILIKE).
  const { data, error } = await supabase!
    .from('ingredient_template')
    .select('*')
    .eq('is_active', true)
    .or(`name_es.ilike.${pattern},name_en.ilike.${pattern}`)
    .order('position', { ascending: true })
    .order('name_es', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Error buscando en el master: ${error.message}`)
  return (data ?? []).map(rowToTemplate)
}

/** Lista paginada del master (para una pantalla de "catálogo base"). */
export async function listTemplates(
  opts: { familyCode?: string; limit?: number; offset?: number } = {},
): Promise<IngredientTemplate[]> {
  requireSupabase()
  let query = supabase!
    .from('ingredient_template')
    .select('*')
    .eq('is_active', true)
  if (opts.familyCode) query = query.eq('family_code', opts.familyCode)
  query = query
    .order('position', { ascending: true })
    .order('name_es', { ascending: true })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50) - 1)
  const { data, error } = await query
  if (error) throw new Error(`Error listando el master: ${error.message}`)
  return (data ?? []).map(rowToTemplate)
}

/** Un template por id (para la ficha de detalle del catálogo base). */
export async function getTemplateById(
  id: string,
): Promise<IngredientTemplate | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('ingredient_template')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Error obteniendo template ${id}: ${error.message}`)
  return data ? rowToTemplate(data) : null
}

/** Un template por su code estable (para casar por código en OCR/EDI). */
export async function getTemplateByCode(
  code: string,
): Promise<IngredientTemplate | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('ingredient_template')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(`Error obteniendo template ${code}: ${error.message}`)
  return data ? rowToTemplate(data) : null
}

/** Alérgenos de un template (para mostrarlos y para sembrarlos al adoptar). */
export async function getTemplateAllergens(
  templateId: string,
): Promise<IngredientTemplateAllergen[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('ingredient_template_allergen')
    .select('*')
    .eq('template_id', templateId)
  if (error)
    throw new Error(
      `Error obteniendo alérgenos del template ${templateId}: ${error.message}`,
    )
  return (data ?? []).map(rowToTemplateAllergen)
}
