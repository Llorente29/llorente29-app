// src/modules/appcc/services/complianceDocumentService.ts
//
// Archivo documental de cumplimiento — servicio (T2).
// ============================================================================
// CRUD sobre compliance_document (+ el puente compliance_document_link, que se
// usará en T4 al enlazar con ingredientes). Subida DIRECTA al bucket privado
// 'compliance-docs' (mismo patrón que photosService), con URLs firmadas.
//   Path de Storage: {account_id}/{doc_family}/{uuid}.{ext}
//   — la 1ª carpeta ES la cuenta: lo exige la política de storage.objects
//     (compliance_docs_insert/select/update/delete), scope por cuenta.
// La RLS de la tabla ya garantiza: leer = miembro; escribir = admin/manager.
// ============================================================================

import { supabase } from '@/lib/supabase'

const BUCKET = 'compliance-docs'
const SIGNED_URL_TTL = 3600
const MAX_FILE_MB = 25

// ⚠️ DEUDA (2026-08-06): el CLI de Supabase (versión corrupta, sin número) generó un
// database.ts inválido en su sección PostGIS, así que NO se pudo regenerar con las
// tablas nuevas. Hasta regenerar con el CLI actualizado, compliance_document no está
// en los tipos: se accede con un cliente laxo. Se llama SIEMPRE inline (no se guarda
// .from en variable → `this` intacto). DISPARADOR para quitarlo: database.ts regenerado OK.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cdoc = (): any => (supabase as any).from('compliance_document')

export const DOC_FAMILIES = [
  'food_spec', 'chemical_spec', 'chemical_sds', 'pest_contract', 'pest_spec',
  'water_analysis', 'oil_manager', 'supplier_approval', 'other',
] as const
export type DocFamily = typeof DOC_FAMILIES[number]

export const DOC_FAMILY_LABEL: Record<DocFamily, string> = {
  food_spec: 'Fichas técnicas de alimentos',
  chemical_spec: 'Fichas técnicas de químicos',
  chemical_sds: 'Fichas de seguridad (FDS)',
  pest_contract: 'Contrato de plagas',
  pest_spec: 'Fichas de plaguicidas',
  water_analysis: 'Análisis de agua',
  oil_manager: 'Gestor de aceite usado',
  supplier_approval: 'Homologación de proveedores',
  other: 'Otros',
}

export type DocStatus = 'pending_ocr' | 'pending_review' | 'active' | 'superseded' | 'expired'

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  pending_ocr: 'Leyendo…',
  pending_review: 'Por revisar',
  active: 'Vigente',
  superseded: 'Sustituido',
  expired: 'Caducado',
}

export interface ComplianceDocument {
  id: string
  account_id: string
  location_id: string | null
  doc_family: DocFamily
  title: string
  supplier_id: string | null
  reference: string | null
  issued_at: string | null
  expires_at: string | null
  review_due_at: string | null
  file_path: string
  file_size_kb: number | null
  mime_type: string | null
  status: DocStatus
  supersedes_id: string | null
  notes: string | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
  // enriquecidos en lectura
  supplier_name?: string | null
  url?: string
}

export interface SupplierLite { id: string; name: string }
export interface LocationLite { id: string; name: string }

export interface NewComplianceDocument {
  accountId: string
  docFamily: DocFamily
  title: string
  file: File
  locationId?: string | null
  supplierId?: string | null
  reference?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
  reviewDueAt?: string | null
  notes?: string | null
}

function extOf(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName.replace(/[^a-z0-9]/g, '') || 'bin'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/jpeg') return 'jpg'
  return 'bin'
}

/** Sube UN documento al bucket y crea la fila. status='active' (clasificado a mano por el manager). */
export async function uploadComplianceDocument(input: NewComplianceDocument): Promise<ComplianceDocument> {
  if (!supabase) throw new Error('Supabase no disponible')
  if (input.file.size > MAX_FILE_MB * 1_000_000) {
    throw new Error(`El archivo "${input.file.name}" supera ${MAX_FILE_MB} MB.`)
  }

  const { data: userData } = await supabase.auth.getUser()
  const uploadedBy = userData?.user?.id ?? null

  const uuid = crypto.randomUUID()
  const path = `${input.accountId}/${input.docFamily}/${uuid}.${extOf(input.file)}`

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  })
  if (upErr) throw upErr

  const row = {
    account_id: input.accountId,
    location_id: input.locationId ?? null,
    doc_family: input.docFamily,
    title: input.title.trim(),
    supplier_id: input.supplierId ?? null,
    reference: input.reference?.trim() || null,
    issued_at: input.issuedAt || null,
    expires_at: input.expiresAt || null,
    review_due_at: input.reviewDueAt || null,
    file_path: path,
    file_size_kb: Math.max(1, Math.round(input.file.size / 1024)),
    mime_type: input.file.type || null,
    status: 'active' as DocStatus,
    uploaded_by: uploadedBy,
  }

  const { data, error: dbErr } = await cdoc().insert(row).select('*').single()
  if (dbErr) {
    // Rollback del fichero para no dejar huérfanos si la fila falla.
    await supabase.storage.from(BUCKET).remove([path])
    throw dbErr
  }
  return data as ComplianceDocument
}

export interface ListOpts { locationId?: string | null; family?: DocFamily }

/** Lista los documentos de una cuenta (con nombre de proveedor y URL firmada). */
export async function listComplianceDocuments(
  accountId: string, opts: ListOpts = {},
): Promise<ComplianceDocument[]> {
  if (!supabase) throw new Error('Supabase no disponible')

  let q = cdoc()
    .select('*')
    .eq('account_id', accountId)
    .order('doc_family', { ascending: true })
    .order('created_at', { ascending: false })
  if (opts.family) q = q.eq('doc_family', opts.family)
  if (opts.locationId) q = q.eq('location_id', opts.locationId)

  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) return []

  const paths = rows.map((r) => r.file_path as string)
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)

  return rows.map((r, i) => ({
    id: r.id as string,
    account_id: r.account_id as string,
    location_id: (r.location_id as string | null) ?? null,
    doc_family: r.doc_family as DocFamily,
    title: r.title as string,
    supplier_id: (r.supplier_id as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    issued_at: (r.issued_at as string | null) ?? null,
    expires_at: (r.expires_at as string | null) ?? null,
    review_due_at: (r.review_due_at as string | null) ?? null,
    file_path: r.file_path as string,
    file_size_kb: (r.file_size_kb as number | null) ?? null,
    mime_type: (r.mime_type as string | null) ?? null,
    status: r.status as DocStatus,
    supersedes_id: (r.supersedes_id as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    uploaded_by: (r.uploaded_by as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    url: signed?.[i]?.signedUrl ?? undefined,
  }))
}

export interface UpdatePatch {
  title?: string
  docFamily?: DocFamily
  supplierId?: string | null
  reference?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
  reviewDueAt?: string | null
  notes?: string | null
  status?: DocStatus
}

export async function updateComplianceDocument(id: string, patch: UpdatePatch): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) row.title = patch.title.trim()
  if (patch.docFamily !== undefined) row.doc_family = patch.docFamily
  if (patch.supplierId !== undefined) row.supplier_id = patch.supplierId
  if (patch.reference !== undefined) row.reference = patch.reference?.trim() || null
  if (patch.issuedAt !== undefined) row.issued_at = patch.issuedAt || null
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt || null
  if (patch.reviewDueAt !== undefined) row.review_due_at = patch.reviewDueAt || null
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.status !== undefined) row.status = patch.status
  const { error } = await cdoc().update(row).eq('id', id)
  if (error) throw error
}

export async function deleteComplianceDocument(
  doc: Pick<ComplianceDocument, 'id' | 'file_path'>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error: sErr } = await supabase.storage.from(BUCKET).remove([doc.file_path])
  if (sErr) console.warn('[complianceDocumentService] storage remove', sErr)
  const { error } = await cdoc().delete().eq('id', doc.id)
  if (error) throw error
}

export async function listSuppliers(accountId: string): Promise<SupplierLite[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('supplier')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))
}

export async function listLocations(accountId: string): Promise<LocationLite[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map((l) => ({ id: l.id as string, name: l.name as string }))
}

// ── Semáforo "qué falta" (agregado en cliente) ──────────────────────────────
export interface FamilyCoverage {
  family: DocFamily
  label: string
  total: number
  expiringSoon: number  // caduca/revisa en <= 30 días
  expired: number
  status: 'missing' | 'expired' | 'expiring' | 'ok'
}

const SOON_DAYS = 30

export function coverageByFamily(docs: ComplianceDocument[]): FamilyCoverage[] {
  const now = Date.now()
  const soon = now + SOON_DAYS * 24 * 3600 * 1000
  return DOC_FAMILIES.map((family) => {
    const list = docs.filter((d) => d.doc_family === family && d.status !== 'superseded')
    let expiringSoon = 0
    let expired = 0
    for (const d of list) {
      const dates = [d.expires_at, d.review_due_at].filter(Boolean) as string[]
      for (const ds of dates) {
        const t = new Date(ds).getTime()
        if (Number.isNaN(t)) continue
        if (t < now) expired++
        else if (t <= soon) expiringSoon++
      }
    }
    let status: FamilyCoverage['status']
    if (list.length === 0) status = 'missing'
    else if (expired > 0) status = 'expired'
    else if (expiringSoon > 0) status = 'expiring'
    else status = 'ok'
    return { family, label: DOC_FAMILY_LABEL[family], total: list.length, expiringSoon, expired, status }
  })
}


// ── OCR (T3): lee el documento con IA y guarda la lectura en extracted ──────
export interface OcrReview { needs_review: boolean; reasons: string[] }
export interface OcrParsed {
  doc_family_detected: string | null
  legal_name: string | null
  reference: string | null
  manufacturer_name: string | null
  manufacturer_address: string | null
  health_registry: string | null
  issued_at: string | null
  expires_at: string | null
  ingredients: string[] | null
  allergens_contains: string[] | null
  allergens_may_contain: string[] | null
  product_registry: string | null
  food_contact_authorized: boolean | null
  provider_name: string | null
  valid_from: string | null
  valid_to: string | null
  handwritten: boolean
  confidence: number
  notes: string | null
}
export interface OcrResult {
  document_id: string
  doc_family: DocFamily
  parsed: OcrParsed
  review: OcrReview
  ai_model: string
  ai_latency_ms: number
}

/** Dispara ocr-compliance-doc para un documento. NO aplica nada al escandallo (eso es T4). */
export async function ocrComplianceDoc(documentId: string): Promise<OcrResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.functions.invoke('ocr-compliance-doc', {
    body: { document_id: documentId },
  })
  if (error) {
    // Saca el mensaje real del cuerpo de la respuesta si se puede.
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const b = (await ctx.json()) as { error?: string }
        if (b?.error) msg = b.error
      }
    } catch { /* noop */ }
    throw new Error(msg)
  }
  return data as OcrResult
}


// ── T4: enlazar al ingrediente y aplicar (con respaldo) ─────────────────────
export interface IngredientLite { id: string; name: string }

/** Busca ingredientes (recipe_item type='raw') de la cuenta por nombre. */
export async function searchIngredients(accountId: string, query: string): Promise<IngredientLite[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const q = query.trim()
  let sel = supabase
    .from('recipe_item')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('type', 'raw')
    .eq('is_active', true)
  if (q) sel = sel.ilike('name', `%${q}%`)
  const { data, error } = await sel.order('name', { ascending: true }).limit(15)
  if (error) throw error
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }))
}

export interface ApplyResult {
  ingredient_id: string
  applied_contains: number
  applied_may_contain: number
  applied_free: number
  dishes_recomputed: number
}

/**
 * Aplica los alérgenos de la ficha al ingrediente (source='manual' + respaldo),
 * enlaza ficha<->ingrediente y recomputa los platos. RPC atómica y guardada.
 */
export async function applyComplianceDocAllergens(
  documentId: string,
  recipeItemId: string,
  contains: string[],
  mayContain: string[],
): Promise<ApplyResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'apply_compliance_doc_allergens',
    {
      p_document_id: documentId,
      p_recipe_item_id: recipeItemId,
      p_contains: contains,
      p_may_contain: mayContain,
    },
  )
  if (error) throw new Error(error.message)
  return data as ApplyResult
}


// ── T6: datos fiscales de la cuenta para la carpeta de inspección ───────────
export interface AccountFiscal { legalName: string | null; cif: string | null }
export async function getAccountFiscal(accountId: string): Promise<AccountFiscal> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('accounts')
    .select('name, legal_name, cif')
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw error
  return {
    legalName: (data?.legal_name as string | null) ?? (data?.name as string | null) ?? null,
    cif: (data?.cif as string | null) ?? null,
  }
}
