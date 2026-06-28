// src/modules/kitchen/services/recipeImportService.ts
//
// FUNCIÓN ESTRELLA: importar un escandallo desde la ficha del cocinero, en
// CUALQUIER formato habitual:
//   · Imagen (jpg/png/webp) → visión IA.
//   · PDF                   → visión IA (Claude lo lee nativo como documento).
//   · Excel (.xlsx/.xls/.csv) → se lee a texto en el cliente (SheetJS) → IA texto.
//   · Word (.docx)          → se lee a texto en el cliente (mammoth) → IA texto.
//
// FLUJO EN TRES PASOS (B2 — pantalla de revisión anti-duplicados):
//   1. extractRecipeSession()  → sube + Edge `extract-recipe` → sesión
//      `recipe_item_ai_session` (pending_review) + una `mapping_proposal` por
//      línea (status 'pending', sin chosen_target_id). NO materializa.
//   2. [pantalla de revisión]  → por cada línea, findIngredientMatches() llama a
//      run_mapping y el humano elige el ingrediente existente (o crea nuevo).
//      resolveImportProposal() escribe chosen_target_id + status 'human_confirmed'.
//   3. materializeRecipeSession() → recipe_item (dish) + recipe_line. Como la RPC
//      respeta chosen_target_id, NO duplica: enlaza al existente.
//
// Por qué este paso intermedio: sin él, materialize cae al ELSE (crea nuevo) en
// CADA línea porque las propuestas nacen 'pending' (no en su lista de estados),
// y duplica ingredientes que ya existen ("Salsa de tomate" cuando ya hay
// "Tomate Frito"). La pantalla de revisión rellena la decisión que materialize
// ya sabe leer. Anti-invención: nada se crea si hay un equivalente elegido.
//
// COMPAT: importRecipeFromFile() se conserva (extract + materialize en uno, sin
// revisión) para no romper llamadas existentes; las pantallas usan el flujo de
// tres pasos.

import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

const BUCKET = 'recipe-uploads'

// ── Detección de formato ──────────────────────────────────────────────────────

type RecipeFileKind = 'image' | 'pdf' | 'excel' | 'word' | 'unsupported'

function detectKind(file: File): RecipeFileKind {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf'
  if (
    type.includes('spreadsheet') ||
    type.includes('excel') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    name.endsWith('.csv')
  ) {
    return 'excel'
  }
  if (
    type.includes('word') ||
    type.includes('officedocument.wordprocessing') ||
    name.endsWith('.docx')
  ) {
    return 'word'
  }
  return 'unsupported'
}

// ── Compresión de imagen (igual patrón que recipePhotoService) ────────────────

function compressImage(file: File, maxWidthPx = 1600, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height
      if (w > maxWidthPx) {
        h = Math.round(h * (maxWidthPx / w))
        w = maxWidthPx
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('No se pudo procesar la imagen (canvas).'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo cargar la imagen.'))
    }
    img.src = url
  })
}

// ── Conversión de Excel a texto plano (todas las hojas, formato CSV) ──────────

async function excelToText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const parts: string[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    if (csv.trim() !== '') {
      parts.push(`# Hoja: ${sheetName}\n${csv}`)
    }
  }
  const text = parts.join('\n\n')
  if (text.trim() === '') {
    throw new Error('La hoja de cálculo está vacía o no se pudo leer.')
  }
  return text
}

// ── Conversión de Word a texto plano (mammoth, import dinámico) ───────────────

async function wordToText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  const text = (result?.value ?? '').trim()
  if (text === '') {
    throw new Error('El documento de Word está vacío o no se pudo leer.')
  }
  return text
}

// ── Normalización de nombre de ingrediente ────────────────────────────────────
// IDÉNTICA a la del Edge extract-recipe y a normalize_ingredient_name (SQL):
// minúsculas + sin acentos + sin paréntesis + espacios colapsados. La pantalla de
// revisión la usa para casar cada línea con su mapping_proposal (que la RPC
// materialize busca por source_normalized).

export function normalizeIngredientName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Tipos de la receta extraída ──────────────────────────────────────────────

export interface ParsedRecipeLine {
  rawText: string
  quantity: number | null
  unit: string | null
  cost: number | null
  note: string | null
  /** Nombre normalizado: clave para casar con la mapping_proposal de la sesión. */
  normalized: string
}

export interface ExtractedRecipeSession {
  sessionId: string
  dishName: string
  /** Si la sesión rellena un plato existente, su id (targetRecipeId). */
  targetRecipeId: string | null
  /** Líneas leídas, deduplicadas por nombre normalizado (igual que el Edge). */
  lines: ParsedRecipeLine[]
}

// Forma cruda que devuelve el Edge (parsed_result).
interface RawParsedRecipe {
  dish?: { name?: string | null; brand?: string | null; yield_portions?: number | null }
  lines?: { raw_text: string; quantity: number | null; unit: string | null; cost?: number | null; note?: string | null }[]
}

interface ExtractResponse {
  session_id: string
  status: string
  parsed: RawParsedRecipe
  lines_extracted: number
  lines_mapped: number
  proposal_error: string | null
}

// ── Candidato de casado (run_mapping) ─────────────────────────────────────────

export interface ImportMatchCandidate {
  recipeItemId: string
  name: string
  folvyCode: string | null
  confidence: number
  matchType: string
  semaphore: 'green' | 'yellow'
}

interface RowRunMapping {
  recipe_item_id: string
  name: string
  folvy_code: string | null
  confidence: number
  match_type: string
  semaphore: string
}

// ── Resultado de materializar ─────────────────────────────────────────────────

export interface ImportRecipeResult {
  recipeId: string
  dishName: string
  wasCreated: boolean
  linesCreated: number
  newArticlesCreated: number
  linesSkipped: number
  linesExtracted: number
}

interface MaterializeRow {
  result_recipe_id: string
  dish_name: string
  was_created: boolean
  lines_created: number
  new_articles_created: number
  lines_skipped: number
}

// ── Opciones de importación ───────────────────────────────────────────────────

export interface ImportRecipeOptions {
  /** Marca probable: ayuda a la extracción (opcional). */
  brandHint?: string
  /**
   * Si se indica, la importación RELLENA ese plato (recipe_item) en vez de crear
   * uno nuevo. La sesión nace apuntando a él y la RPC reemplaza sus líneas.
   * Lo usa "Importar ficha" dentro de un escandallo abierto.
   */
  targetRecipeId?: string
}

// Helper: tipado laxo para supabase.rpc (mismo patrón que el resto del módulo).
function rpc(fn: string, args: Record<string, unknown>) {
  return (
    supabase!.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args)
}

// ── Paso 1: subir + extraer (NO materializa) ──────────────────────────────────

/**
 * Sube la ficha y la extrae con la IA. Devuelve la sesión a revisar (con las
 * líneas leídas), SIN materializar. La pantalla de revisión resuelve cada línea
 * y luego llama a materializeRecipeSession().
 */
export async function extractRecipeSession(
  accountId: string,
  file: File,
  opts?: ImportRecipeOptions,
): Promise<ExtractedRecipeSession> {
  if (!supabase) throw new Error('Supabase no disponible')

  const brandHint = opts?.brandHint
  const targetRecipeId = opts?.targetRecipeId ?? null

  const fileKind = detectKind(file)
  if (fileKind === 'unsupported') {
    throw new Error('Formato no admitido. Usa una foto, un PDF, un Excel o un Word.')
  }

  let extractBody: Record<string, unknown>

  if (fileKind === 'image' || fileKind === 'pdf') {
    const ts = Date.now()
    let blob: Blob
    let ext: string
    let contentType: string
    if (fileKind === 'image') {
      blob = await compressImage(file)
      ext = 'jpg'
      contentType = 'image/jpeg'
    } else {
      blob = file
      ext = 'pdf'
      contentType = 'application/pdf'
    }
    const path = `${accountId}/recipe-sources/${ts}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType, upsert: false })
    if (upErr) throw new Error(`Error subiendo la ficha: ${upErr.message}`)

    extractBody = {
      account_id: accountId,
      kind: 'photo',
      file_paths: [path],
      brand_hint: brandHint ?? null,
      target_recipe_id: targetRecipeId,
    }
  } else {
    const text = fileKind === 'excel' ? await excelToText(file) : await wordToText(file)
    extractBody = {
      account_id: accountId,
      kind: 'conversational',
      input_text: text,
      brand_hint: brandHint ?? null,
      target_recipe_id: targetRecipeId,
    }
  }

  const { data: extractData, error: extractErr } = await supabase.functions.invoke(
    'extract-recipe',
    { body: extractBody },
  )
  if (extractErr) {
    throw new Error(`La IA no pudo leer la ficha: ${extractErr.message}`)
  }
  const extract = extractData as ExtractResponse
  if (!extract?.session_id) {
    throw new Error('La IA no devolvió un escandallo legible. Prueba con un archivo más claro.')
  }

  const parsed = extract.parsed ?? {}
  const dishName = parsed.dish?.name?.trim() || 'Escandallo sin nombre'

  // Deduplicar por nombre normalizado, IGUAL que el Edge al crear las propuestas
  // (la mapping_proposal es única por texto normalizado dentro de la cuenta).
  const seen = new Set<string>()
  const lines: ParsedRecipeLine[] = []
  for (const l of parsed.lines ?? []) {
    const rawText = (l.raw_text ?? '').trim()
    if (rawText === '') continue
    const normalized = normalizeIngredientName(rawText)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    lines.push({
      rawText,
      quantity: l.quantity ?? null,
      unit: l.unit ?? null,
      cost: l.cost ?? null,
      note: l.note ?? null,
      normalized,
    })
  }

  // ── Adopción de propuestas (deuda del índice único mapping_proposal_uq) ──
  // El índice único es por (account_id, source_kind, source_normalized,
  // target_kind, context_brand_id) — NO incluye source_ref (la sesión). Si una
  // ficha se reimporta, el Edge no puede recrear las propuestas (chocan con las
  // de una sesión anterior) y quedan huérfanas, atadas a la sesión vieja y en
  // 'pending'. El modal resuelve por source_ref = ESTA sesión y materialize las
  // busca igual → no casan → se crea todo nuevo (duplica).
  //
  // Solución sin tocar el Edge ni el índice: REAPUNTAR a esta sesión las
  // propuestas que existan para esta cuenta + estos textos normalizados, y
  // dejarlas limpias ('pending', sin chosen_target_id). Así el modal y
  // materialize trabajan sobre la sesión actual, gane quien gane el insert.
  const normlist = lines.map((l) => l.normalized)
  if (normlist.length > 0) {
    const { error: adoptErr } = await supabase
      .from('mapping_proposal')
      .update({
        source_ref: extract.session_id,
        status: 'pending',
        chosen_target_id: null,
        // NO tocar `method`: la columna es NOT NULL. Se reescribe luego en
        // resolveImportProposal ('human') al resolver cada línea en el modal.
      } as never)
      .eq('account_id', accountId)
      .eq('source_kind', 'recipe_ingredient')
      .eq('target_kind', 'recipe_item')
      .in('source_normalized', normlistDistinct(normlist))
      .neq('source_ref', extract.session_id)
    if (adoptErr) {
      // No es fatal: si la adopción falla, el modal seguirá; pero lo registramos
      // para no enmascarar un problema de RLS o de datos.
      console.error('[extractRecipeSession] adopción de propuestas:', adoptErr.message)
    }
  }

  return { sessionId: extract.session_id, dishName, targetRecipeId, lines }
}

// Quita normalizados repetidos (defensa; las líneas ya vienen deduplicadas).
function normlistDistinct(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

// ── Paso 2: candidatos por similitud (run_mapping) ────────────────────────────

/**
 * Devuelve los ingredientes existentes más parecidos a un nombre, vía run_mapping
 * (la misma RPC que usan Ventas y Supply). Umbral bajo + límite alto a propósito:
 * queremos ver TODOS los gemelos posibles para no duplicar; si el bueno no sale,
 * la pantalla ofrece búsqueda libre. Solo lee; no escribe nada.
 *
 * No devuelve coste (run_mapping no lo trae): la pantalla cruza el coste contra
 * el mapa de ingredientes que ya tiene cargado.
 */
export async function findIngredientMatches(
  accountId: string,
  text: string,
  limit = 6,
  fuzzyMin = 0.2,
): Promise<ImportMatchCandidate[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await rpc('run_mapping', {
    p_account_id: accountId,
    p_text: text,
    p_code: null,
    p_limit: limit,
    p_fuzzy_min: fuzzyMin,
    p_target_types: ['raw', 'recipe'],
  })
  if (error) throw new Error(`Error buscando similares: ${error.message}`)
  return ((data ?? []) as RowRunMapping[]).map((r) => ({
    recipeItemId: r.recipe_item_id,
    name: r.name,
    folvyCode: r.folvy_code ?? null,
    confidence: Number(r.confidence ?? 0),
    matchType: r.match_type,
    semaphore: (r.semaphore as 'green' | 'yellow') ?? 'yellow',
  }))
}

// ── Paso 2b: registrar la decisión humana en la propuesta ─────────────────────

/**
 * Resuelve UNA línea: escribe la decisión del humano en su mapping_proposal para
 * que materialize la respete. Casa por (source_ref = sesión, source_normalized).
 *   · chosenTargetId NO nulo → usar ese ingrediente existente (no duplica).
 *   · chosenTargetId nulo     → crear nuevo a propósito (materialize lo creará
 *     como raw provisional needs_review).
 * En ambos casos status='human_confirmed' (que está en la lista que materialize
 * acepta). Patrón calcado de approveFamilyProposal (UPDATE con RLS, sin RPC).
 */
export async function resolveImportProposal(
  accountId: string,
  sessionId: string,
  sourceNormalized: string,
  chosenTargetId: string | null,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await supabase
    .from('mapping_proposal')
    .update({
      chosen_target_id: chosenTargetId,
      status: 'human_confirmed',
      method: 'human',
    } as never)
    .eq('account_id', accountId)
    .eq('source_ref', sessionId)
    .eq('source_normalized', sourceNormalized)
  if (error) throw new Error(`Error guardando la decisión: ${error.message}`)
}

// ── Paso 3: materializar la sesión revisada → escandallo ──────────────────────

/**
 * Vuelca la sesión a recipe_item (dish) + recipe_line. Llamar SOLO después de
 * resolver todas las líneas. La RPC respeta chosen_target_id de cada propuesta:
 * enlaza a los existentes elegidos y crea solo los marcados como nuevos.
 */
export async function materializeRecipeSession(
  sessionId: string,
  linesExtracted: number,
): Promise<ImportRecipeResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await rpc('materialize_recipe_session', { p_session_id: sessionId })
  if (error) throw new Error(`No se pudo crear el escandallo: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as MaterializeRow | undefined
  if (!row?.result_recipe_id) {
    throw new Error('La materialización no devolvió el escandallo creado.')
  }
  return {
    recipeId: row.result_recipe_id,
    dishName: row.dish_name,
    wasCreated: row.was_created,
    linesCreated: row.lines_created,
    newArticlesCreated: row.new_articles_created,
    linesSkipped: row.lines_skipped,
    linesExtracted,
  }
}

// ── COMPAT: importación end-to-end sin revisión (extract + materialize) ────────

/**
 * Importa un escandallo en un solo paso (sin pantalla de revisión). Se conserva
 * por compatibilidad; las pantallas usan el flujo de tres pasos (extract →
 * revisión → materialize) para no duplicar ingredientes.
 */
export async function importRecipeFromFile(
  accountId: string,
  file: File,
  opts?: ImportRecipeOptions,
): Promise<ImportRecipeResult> {
  const session = await extractRecipeSession(accountId, file, opts)
  return materializeRecipeSession(session.sessionId, session.lines.length)
}

// Compat: nombre anterior (solo foto) usado por la pantalla. Reexporta al nuevo.
export const importRecipeFromPhoto = importRecipeFromFile
