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

export type RowRecipeItemStep         = Tables['recipe_item_step']['Row']
export type RowRecipeItemStepInsert   = Tables['recipe_item_step']['Insert']
export type RowRecipeItemStepUpdate   = Tables['recipe_item_step']['Update']

export type RowRecipeItemStepLine        = Tables['recipe_item_step_line']['Row']
export type RowRecipeItemStepLineInsert  = Tables['recipe_item_step_line']['Insert']
export type RowRecipeItemStepLineUpdate  = Tables['recipe_item_step_line']['Update']

export type RowRecipeItemUnitConversion       = Tables['recipe_item_unit_conversion']['Row']
export type RowRecipeItemUnitConversionInsert = Tables['recipe_item_unit_conversion']['Insert']
export type RowRecipeItemUnitConversionUpdate = Tables['recipe_item_unit_conversion']['Update']

export type RowSupplier              = Tables['supplier']['Row']
export type RowSupplierInsert        = Tables['supplier']['Insert']
export type RowSupplierUpdate        = Tables['supplier']['Update']

export type RowArticleSupplier       = Tables['article_supplier']['Row']
export type RowArticleSupplierInsert = Tables['article_supplier']['Insert']
export type RowArticleSupplierUpdate = Tables['article_supplier']['Update']

export type RowPurchaseFormat        = Tables['recipe_item_purchase_format']['Row']
export type RowPurchaseFormatInsert  = Tables['recipe_item_purchase_format']['Insert']
export type RowPurchaseFormatUpdate  = Tables['recipe_item_purchase_format']['Update']

export type RowKitchenSettings        = Tables['kitchen_settings']['Row']
export type RowKitchenSettingsInsert  = Tables['kitchen_settings']['Insert']
export type RowKitchenSettingsUpdate  = Tables['kitchen_settings']['Update']

export type RowMenuItem        = Tables['menu_item']['Row']
export type RowMenuItemInsert  = Tables['menu_item']['Insert']
export type RowMenuItemUpdate  = Tables['menu_item']['Update']

export type RowBrandLicensingAgreement        = Tables['brand_licensing_agreement']['Row']
export type RowBrandLicensingAgreementInsert  = Tables['brand_licensing_agreement']['Insert']
export type RowBrandLicensingAgreementUpdate  = Tables['brand_licensing_agreement']['Update']

export type RowBrandChannelRate        = Tables['brand_channel_rate']['Row']
export type RowBrandChannelRateInsert  = Tables['brand_channel_rate']['Insert']
export type RowBrandChannelRateUpdate  = Tables['brand_channel_rate']['Update']

// ─────────────────────────────────────────────────────────────────────
// Uniones de literales (reflejan los CHECK constraints de la BBDD).
// NO son enums (regla §6.2: verbatimModuleSyntax/erasableSyntaxOnly).
// ─────────────────────────────────────────────────────────────────────
export type RecipeItemType   = 'raw' | 'recipe' | 'tool' | 'dish'
export type CostStrategy     = 'fixed' | 'last_purchase' | 'average_weighted' | 'average_window'
export type ConservationType = 'fridge' | 'freezer' | 'dry' | 'hot'
export type ServiceType      = 'platform_delivery' | 'own_delivery' | 'pickup'
export type CommissionBase   = 'pvp_con_iva' | 'pvp_sin_iva'
export type UnitDimension    = 'weight' | 'volume' | 'unit'
export type ItemSource       = 'manual' | 'ai_recipe' | 'ocr_invoice' | 'import'
export type ConversionSource = 'manual' | 'ai_suggested' | 'import'
export type PurchaseFormatSource = 'manual' | 'ai_suggested' | 'import'

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
// review_notes (jsonb): diagnóstico estructurado de una incidencia.
// Generado por el script de diagnóstico (S2-A) o por la app.
// Claves en camelCase (el jsonb se guarda y lee directo, sin traducción).
// ─────────────────────────────────────────────────────────────────────
export type ReviewNoteKind = 'cost_suspect' | 'missing_recipe' | 'other'

export interface RecipeItemReviewNote {
  source: string
  kind: ReviewNoteKind
  diagnosedAt?: string | null
  costFolvy?: number | null
  costReference?: number | null
  referenceSource?: string | null
  deltaEur?: number | null
  deltaPct?: number | null
  sampleCount?: number | null
  locations?: string[] | null
  summary?: string | null
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
  familyId: string | null
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
  defaultWastePct: number | null
  // nativo-IA
  source: ItemSource
  aiConfidence: number | null
  needsReview: boolean
  reviewNotes: RecipeItemReviewNote | null
  reviewDismissedAt: string | null
  reviewDismissedBy: string | null
  reviewDismissedReason: string | null
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
  familyId?: string | null
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
  defaultWastePct?: number | null
  needsReview?: boolean
  reviewNotes?: RecipeItemReviewNote | null
  reviewDismissedAt?: string | null
  reviewDismissedBy?: string | null
  reviewDismissedReason?: string | null
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
// recipe_item_step (un paso de elaboración de la receta) + el puente
// recipe_item_step_line (qué líneas/ingredientes usa cada paso, N:N).
// OJO: recipe_item_step NO tiene account_id (cuelga de recipe_item_id);
// por eso RecipeItemStep/Insert NO llevan accountId (a diferencia de
// RecipeLine). El puente recipe_item_step_line SÍ tiene account_id.
// ─────────────────────────────────────────────────────────────────────
export interface RecipeItemStep {
  id: string
  recipeItemId: string
  position: number
  kind: string
  text: string
  durationMin: number | null
  temperatureC: number | null
  photoUrl: string | null
  createdAt: string
  updatedAt: string
  // lineIds: líneas del escandallo vinculadas a este paso (vía el puente).
  // Lo resuelve el service al listar; no es una columna de recipe_item_step.
  lineIds: string[]
}
export interface RecipeItemStepInsert {
  recipeItemId: string
  text: string
  position?: number
  kind?: string
  durationMin?: number | null
  temperatureC?: number | null
  photoUrl?: string | null
}
export interface RecipeItemStepUpdate {
  text?: string
  position?: number
  kind?: string
  durationMin?: number | null
  temperatureC?: number | null
  photoUrl?: string | null
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

// ── supplier ──────────────────────────────────────────────────────────
export interface Supplier {
  id: string
  accountId: string
  name: string
  taxId: string | null
  email: string | null
  phone: string | null
  address: string | null
  healthRegistryNo: string | null
  notes: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface SupplierInsert {
  accountId: string
  name: string
  taxId?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  healthRegistryNo?: string | null
  notes?: string | null
  createdBy?: string | null
  createdByName?: string | null
}
export interface SupplierUpdate {
  name?: string
  taxId?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  healthRegistryNo?: string | null
  notes?: string | null
  isActive?: boolean
  archivedAt?: string | null
}

// ── recipe_item_purchase_format (el árbol de empaquetado) ─────────────
// qtyInBase es la ÚNICA verdad numérica que consume el coste: cuánto vale
// ESTE nodo en la unidad base del ingrediente (Caja=6000 g, Bolsa=1000 g).
// parentFormatId arma el árbol (Caja→Bolsa); null = nodo raíz.
export interface PurchaseFormat {
  id: string
  accountId: string
  itemId: string
  name: string
  parentFormatId: string | null
  qtyPerParent: number | null
  qtyInBase: number
  isPiece: boolean
  isWeighted: boolean
  source: PurchaseFormatSource
  aiConfidence: number | null
  needsReview: boolean
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface PurchaseFormatInsert {
  accountId: string
  itemId: string
  name: string
  qtyInBase: number
  parentFormatId?: string | null
  qtyPerParent?: number | null
  isPiece?: boolean
  isWeighted?: boolean
  source?: PurchaseFormatSource
  aiConfidence?: number | null
  needsReview?: boolean
  createdBy?: string | null
  createdByName?: string | null
}
export interface PurchaseFormatUpdate {
  name?: string
  parentFormatId?: string | null
  qtyPerParent?: number | null
  qtyInBase?: number
  isPiece?: boolean
  isWeighted?: boolean
  needsReview?: boolean
  isActive?: boolean
  archivedAt?: string | null
}

// ── article_supplier (proveedor ↔ formato que vende, con precio) ──────
// purchaseFormatId apunta a UN nodo del árbol (opción A: un solo camino).
// lastPrice es el precio pagado por ESE formato → coste base = precio / qtyInBase.
export interface ArticleSupplier {
  id: string
  accountId: string
  recipeItemId: string
  supplierId: string
  supplierCode: string | null
  purchaseFormatId: string | null
  lastPrice: number | null
  isPreferred: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}
export interface ArticleSupplierInsert {
  accountId: string
  recipeItemId: string
  supplierId: string
  purchaseFormatId: string
  supplierCode?: string | null
  lastPrice?: number | null
  isPreferred?: boolean
}
export interface ArticleSupplierUpdate {
  supplierCode?: string | null
  purchaseFormatId?: string | null
  lastPrice?: number | null
  isPreferred?: boolean
  isActive?: boolean
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
  channelId: string | null
  recipeItemId: string | null
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

// ─────────────────────────────────────────────────────────────────────
// brand_channel_rate (Capa A / EP1: tarifa de comisión por marca×canal×reparto)
// Cuelga de brand_channel. UNIQUE(brand_channel_id, service_type) → hasta 3 filas.
// commission_base default 'pvp_con_iva' (P1: el % se aplica sobre PVP con IVA).
// own_customer_fee / own_courier_cost solo aplican a service_type='own_delivery'.
// ─────────────────────────────────────────────────────────────────────
export interface BrandChannelRate {
  id: string
  accountId: string
  brandChannelId: string
  serviceType: ServiceType
  commissionPct: number | null
  commissionFixed: number | null
  commissionBase: CommissionBase
  ownCustomerFee: number | null
  ownCourierCost: number | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface BrandChannelRateInsert {
  accountId: string
  brandChannelId: string
  serviceType: ServiceType
  commissionPct?: number | null
  commissionFixed?: number | null
  commissionBase?: CommissionBase
  ownCustomerFee?: number | null
  ownCourierCost?: number | null
  isActive?: boolean
  createdBy?: string | null
  createdByName?: string | null
}
export interface BrandChannelRateUpdate {
  serviceType?: ServiceType
  commissionPct?: number | null
  commissionFixed?: number | null
  commissionBase?: CommissionBase
  ownCustomerFee?: number | null
  ownCourierCost?: number | null
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// menu_item_economics (resultado de la función SQL homónima)
// NO es una tabla: es la forma que devuelve la RPC. Ramifica por flowType:
//   'own'      → food cost %, comisión de plataforma del canal
//   'licensed' → revenue share + reembolso de consumos
// Campos que no aplican a un flujo vienen null (honestidad del cálculo).
// ─────────────────────────────────────────────────────────────────────
export type MenuItemFlowType = 'own' | 'licensed'
export type FoodCostStatus = 'under' | 'over' | 'no_target' | 'no_cost' | 'n_a'

export interface MenuItemEconomics {
  menuItemId: string
  menuItemName: string
  recipeItemId: string
  channelId: string
  channelName: string
  flowType: MenuItemFlowType
  cost: number | null
  costAvailable: boolean
  price: number
  vatRate: number
  priceWithVat: number
  foodCostPct: number | null
  contributionMargin: number | null
  commissionPct: number | null
  commissionAmount: number | null
  commissionFixed: number | null
  deliveryFee: number | null
  revenueSharePct: number | null
  revenueShareAmount: number | null
  consumptionReimb: number | null
  netMargin: number | null
  netMarginPct: number | null
  targetFoodCostPct: number | null
  foodCostStatus: FoodCostStatus
}
