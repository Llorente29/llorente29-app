// src/types/kitchen.ts
//
// Capa de dominio (camelCase) del módulo Folvy Kitchen.
// Espejo de multitenancy.ts: define las interfaces de dominio + sus
// Insert/Update, y deriva los tipos Row* del database.ts autogenerado.
//
// Los servicios mapean Row (snake_case BBDD) ↔ dominio (camelCase) y
// exponen SOLO los tipos de dominio al resto del frontend.
//
// Tablas cubiertas (8): kitchen_unit, kitchen_cut_type, recipe_item,
// recipe_line, recipe_item_unit_conversion, kitchen_settings, menu_item,
// brand_licensing_agreement.

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

export type RowMenuItem        = Tables['menu_item']['Row']
export type RowMenuItemInsert  = Tables['menu_item']['Insert']
export type RowMenuItemUpdate  = Tables['menu_item']['Update']

export type RowBrandLicensingAgreement        = Tables['brand_licensing_agreement']['Row']
export type RowBrandLicensingAgreementInsert  = Tables['brand_licensing_agreement']['Insert']
export type RowBrandLicensingAgreementUpdate  = Tables['brand_licensing_agreement']['Update']

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

// Unión nueva, NO reusar ItemSource: las fuentes de un ítem de carta
// difieren de las de una receta (no hay ocr_invoice aquí).
export type MenuItemSource = 'manual' | 'ai_suggested' | 'import'

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

// ─────────────────────────────────────────────────────────────────────
// menu_item (Capa 2: ítem de carta por marca — aquí vive el PVP)
// El precio se guarda SIN IVA (base imponible); con IVA se deriva.
// Margen y food cost % NO viven aquí: los calcula la función SQL.
// ─────────────────────────────────────────────────────────────────────
export interface MenuItem {
  id: string
  accountId: string
  brandId: string
  channelId: string
  recipeItemId: string
  name: string
  description: string | null
  category: string | null
  photoUrl: string | null
  position: number
  price: number
  vatRate: number
  consumptionPrice: number | null
  isActive: boolean
  isAvailable: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
  source: MenuItemSource
  aiConfidence: number | null
  needsReview: boolean
  aiSuggestedPrice: number | null
}
export interface MenuItemInsert {
  accountId: string
  brandId: string
  channelId: string
  recipeItemId: string
  name: string
  price: number
  description?: string | null
  category?: string | null
  photoUrl?: string | null
  position?: number
  vatRate?: number
  consumptionPrice?: number | null
  isAvailable?: boolean
  source?: MenuItemSource
  aiConfidence?: number | null
  needsReview?: boolean
  aiSuggestedPrice?: number | null
  createdBy?: string | null
  createdByName?: string | null
}
export interface MenuItemUpdate {
  name?: string
  description?: string | null
  category?: string | null
  photoUrl?: string | null
  position?: number
  price?: number
  vatRate?: number
  consumptionPrice?: number | null
  isActive?: boolean
  isAvailable?: boolean
  archivedAt?: string | null
  needsReview?: boolean
  aiSuggestedPrice?: number | null
}

// ─────────────────────────────────────────────────────────────────────
// brand_licensing_agreement (Capa 2: acuerdo de cesión / host kitchen)
// Tú cocinas la marca de un tercero y cobras revenue_share sobre PVP sin IVA.
// ─────────────────────────────────────────────────────────────────────
export interface BrandLicensingAgreement {
  id: string
  accountId: string
  brandId: string
  ownerName: string
  revenueSharePct: number
  reimbursesConsumption: boolean
  startsOn: string | null
  endsOn: string | null
  notes: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface BrandLicensingAgreementInsert {
  accountId: string
  brandId: string
  ownerName: string
  revenueSharePct: number
  reimbursesConsumption?: boolean
  startsOn?: string | null
  endsOn?: string | null
  notes?: string | null
  createdBy?: string | null
  createdByName?: string | null
}
export interface BrandLicensingAgreementUpdate {
  ownerName?: string
  revenueSharePct?: number
  reimbursesConsumption?: boolean
  startsOn?: string | null
  endsOn?: string | null
  notes?: string | null
  isActive?: boolean
  archivedAt?: string | null
}
