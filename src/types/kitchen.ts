// src/types/kitchen.ts
//
// Capa de dominio (camelCase) del módulo Folvy Kitchen.
// Espejo de multitenancy.ts: define las interfaces de dominio + sus
// Insert/Update, y deriva los tipos Row* del database.ts autogenerado.
//
// Los servicios mapean Row (snake_case BBDD) ↔ dominio (camelCase) y
// exponen SOLO los tipos de dominio al resto del frontend.
//
// Tablas cubiertas (6): kitchen_unit, kitchen_cut_type, recipe_item,
// recipe_line, recipe_item_unit_conversion, kitchen_settings.

import type { Database } from './database'

// ─────────────────────────────────────────────────────────────────────
// Tipos Row crudos (snake_case) derivados del schema autogenerado.
// Uso interno de los services; el resto del frontend usa los de dominio.
// ─────────────────────────────────────────────────────────────────────
type Tables = Database['public']['Tables']

export type RowKitchenUnit            = Tables['kitchen_unit']['Row']
export type RowKitchenUnitInsert      = Tables['kitchen_unit']['Insert']
export type RowKitchenUnitUpdate      = Tables['kitchen_unit']['Update']

export type RowKitchenCutType         = Tables['kitchen_cut_type']['Row']
export type RowKitchenCutTypeInsert   = Tables['kitchen_cut_type']['Insert']
export type RowKitchenCutTypeUpdate   = Tables['kitchen_cut_type']['Update']

export type RowRecipeItem             = Tables['recipe_item']['Row']
export type RowRecipeItemInsert       = Tables['recipe_item']['Insert']
export type RowRecipeItemUpdate       = Tables['recipe_item']['Update']

export type RowRecipeLine             = Tables['recipe_line']['Row']
export type RowRecipeLineInsert       = Tables['recipe_line']['Insert']
export type RowRecipeLineUpdate       = Tables['recipe_line']['Update']

export type RowRecipeItemUnitConversion       = Tables['recipe_item_unit_conversion']['Row']
export type RowRecipeItemUnitConversionInsert = Tables['recipe_item_unit_conversion']['Insert']
export type RowRecipeItemUnitConversionUpdate = Tables['recipe_item_unit_conversion']['Update']

export type RowKitchenSettings        = Tables['kitchen_settings']['Row']
export type RowKitchenSettingsInsert  = Tables['kitchen_settings']['Insert']
export type RowKitchenSettingsUpdate  = Tables['kitchen_settings']['Update']

// ─────────────────────────────────────────────────────────────────────
// Uniones de literales (reflejan los CHECK constraints de la BBDD).
// NO son enums (regla §6.2: verbatimModuleSyntax/erasableSyntaxOnly).
// ─────────────────────────────────────────────────────────────────────
export type RecipeItemType   = 'raw' | 'recipe' | 'tool' | 'dish'
export type CostStrategy     = 'fixed' | 'last_purchase' | 'average_weighted' | 'average_window'
export type ConservationType = 'fridge' | 'freezer' | 'dry' | 'hot'
export type UnitDimension    = 'weight' | 'volume' | 'unit'
export type ItemSource       = 'manual' | 'ai_recipe' | 'ocr_invoice' | 'import'
export type ConversionSource = 'manual' | 'ai_suggested' | 'import'

// ─────────────────────────────────────────────────────────────────────
// kitchen_unit
// ─────────────────────────────────────────────────────────────────────
export interface KitchenUnit {
  id: string
  accountId: string | null   // null = semilla global (is_seed)
  name: string
  abbreviation: string
  dimension: UnitDimension
  factorToBase: number
  isBase: boolean
  isSeed: boolean
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface KitchenUnitInsert {
  accountId: string
  name: string
  abbreviation: string
  dimension: UnitDimension
  factorToBase: number
  isBase?: boolean
  createdBy?: string | null
  createdByName?: string | null
}
export interface KitchenUnitUpdate {
  name?: string
  abbreviation?: string
  factorToBase?: number
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// kitchen_cut_type
// ─────────────────────────────────────────────────────────────────────
export interface KitchenCutType {
  id: string
  accountId: string
  name: string
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface KitchenCutTypeInsert {
  accountId: string
  name: string
  createdBy?: string | null
  createdByName?: string | null
}
export interface KitchenCutTypeUpdate {
  name?: string
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// recipe_item (ingrediente / receta / herramienta / plato)
// ─────────────────────────────────────────────────────────────────────
export interface RecipeItem {
  id: string
  accountId: string
  type: RecipeItemType
  name: string
  altName: string | null
  code: string | null
  baseUnitId: string
  costStrategy: CostStrategy
  costWindowDays: number | null
  fixedCost: number | null
  computedCost: number | null
  costUpdatedAt: string | null
  indirectCostPct: number | null
  // ficha técnica
  prepTimeMinutes: number | null
  cookTimeMinutes: number | null
  procedureText: string | null
  platingNotes: string | null
  kitchenPhotoUrl: string | null
  yieldPortions: number | null
  conservationType: ConservationType | null
  serviceTempC: number | null
  notes: string | null
  // nativo-IA
  source: ItemSource
  aiConfidence: number | null
  needsReview: boolean
  // estándar
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface RecipeItemInsert {
  accountId: string
  type: RecipeItemType
  name: string
  baseUnitId: string
  altName?: string | null
  code?: string | null
  costStrategy?: CostStrategy
  fixedCost?: number | null
  indirectCostPct?: number | null
  prepTimeMinutes?: number | null
  cookTimeMinutes?: number | null
  procedureText?: string | null
  platingNotes?: string | null
  kitchenPhotoUrl?: string | null
  yieldPortions?: number | null
  conservationType?: ConservationType | null
  serviceTempC?: number | null
  notes?: string | null
  source?: ItemSource
  aiConfidence?: number | null
  needsReview?: boolean
  createdBy?: string | null
  createdByName?: string | null
}
export interface RecipeItemUpdate {
  type?: RecipeItemType
  name?: string
  altName?: string | null
  code?: string | null
  baseUnitId?: string
  costStrategy?: CostStrategy
  costWindowDays?: number | null
  fixedCost?: number | null
  indirectCostPct?: number | null
  prepTimeMinutes?: number | null
  cookTimeMinutes?: number | null
  procedureText?: string | null
  platingNotes?: string | null
  kitchenPhotoUrl?: string | null
  yieldPortions?: number | null
  conservationType?: ConservationType | null
  serviceTempC?: number | null
  notes?: string | null
  needsReview?: boolean
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// recipe_line (una línea de la receta: padre usa hijo)
// ─────────────────────────────────────────────────────────────────────
export interface RecipeLine {
  id: string
  accountId: string
  parentItemId: string
  childItemId: string
  quantityNet: number
  quantityGross: number | null
  unitId: string
  cutTypeId: string | null
  comment: string | null
  position: number
  createdAt: string
  updatedAt: string
}
export interface RecipeLineInsert {
  accountId: string
  parentItemId: string
  childItemId: string
  quantityNet: number
  unitId: string
  quantityGross?: number | null
  cutTypeId?: string | null
  comment?: string | null
  position?: number
}
export interface RecipeLineUpdate {
  quantityNet?: number
  quantityGross?: number | null
  unitId?: string
  cutTypeId?: string | null
  comment?: string | null
  position?: number
}

// ─────────────────────────────────────────────────────────────────────
// recipe_item_unit_conversion (conversiones pieza↔peso por ingrediente)
// ─────────────────────────────────────────────────────────────────────
export interface RecipeItemUnitConversion {
  id: string
  accountId: string
  itemId: string
  fromUnitId: string
  qtyInBase: number
  source: ConversionSource
  aiConfidence: number | null
  needsReview: boolean
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface RecipeItemUnitConversionInsert {
  accountId: string
  itemId: string
  fromUnitId: string
  qtyInBase: number
  source?: ConversionSource
  aiConfidence?: number | null
  needsReview?: boolean
  createdBy?: string | null
  createdByName?: string | null
}
export interface RecipeItemUnitConversionUpdate {
  qtyInBase?: number
  needsReview?: boolean
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// kitchen_settings (1 fila por cuenta)
// ─────────────────────────────────────────────────────────────────────
export interface KitchenSettings {
  id: string
  accountId: string
  indirectCostPctDefault: number
  targetFoodCostPct: number | null
  currency: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface KitchenSettingsInsert {
  accountId: string
  indirectCostPctDefault?: number
  targetFoodCostPct?: number | null
  currency?: string
  createdBy?: string | null
  createdByName?: string | null
}
export interface KitchenSettingsUpdate {
  indirectCostPctDefault?: number
  targetFoodCostPct?: number | null
  currency?: string
}
