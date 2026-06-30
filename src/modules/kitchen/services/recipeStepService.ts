// src/modules/kitchen/services/recipeStepService.ts
//
// Service de recipe_item_step: los PASOS de elaboración de una receta/plato,
// y su puente recipe_item_step_line (qué líneas/ingredientes usa cada paso, N:N).
//
// Tramo E8 (pasos inteligentes enlazados a ingredientes). Este fichero es la
// capa CRUD pura (E8.2): listar pasos con sus líneas vinculadas, crear, editar,
// borrar, reordenar, y sincronizar el puente paso↔línea. La inteligencia
// (resaltado en vivo, aviso de faltantes, orden-por-elaboración, borrador IA)
// se construye encima en tramos posteriores; aquí solo están los cimientos.
//
// Patrón calcado de recipeLineService.ts: cliente por ruta relativa +
// requireSupabase(), mapeo Row(snake) ↔ dominio(camel) con rowToX / xInsertToRow
// / xUpdateToRow (update parcial con `if (patch.campo !== undefined)`).
//
// OJO tenancy: recipe_item_step NO tiene account_id (cuelga de recipe_item_id);
// su RLS se resuelve por el recipe_item padre. El puente recipe_item_step_line
// SÍ tiene account_id (mismo patrón que recipe_line) y hay que aportarlo al
// insertar el vínculo.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  RecipeItemStep,
  RecipeItemStepInsert,
  RecipeItemStepUpdate,
  RowRecipeItemStep,
  RowRecipeItemStepInsert,
  RowRecipeItemStepUpdate,
} from '../../../types/kitchen'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mapeo Row(snake) ↔ dominio(camel)
// ─────────────────────────────────────────────────────────────────────

// El paso de dominio incluye lineIds (las líneas vinculadas vía el puente).
// rowToRecipeItemStep solo mapea las columnas propias; lineIds se inyecta
// aparte (lo resuelve listStepsByRecipe con un join al puente). Por defecto [].
export function rowToRecipeItemStep(
  row: RowRecipeItemStep,
  lineIds: string[] = [],
): RecipeItemStep {
  return {
    id: row.id,
    recipeItemId: row.recipe_item_id,
    position: row.position,
    kind: row.kind,
    text: row.text,
    durationMin: row.duration_min,
    temperatureC: row.temperature_c,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lineIds,
  }
}

function stepInsertToRow(input: RecipeItemStepInsert): RowRecipeItemStepInsert {
  return {
    recipe_item_id: input.recipeItemId,
    text: input.text,
    position: input.position ?? 0,
    // kind tiene default en BBDD; solo lo mandamos si viene informado.
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    duration_min: input.durationMin ?? null,
    temperature_c: input.temperatureC ?? null,
    photo_url: input.photoUrl ?? null,
  }
}

function stepUpdateToRow(patch: RecipeItemStepUpdate): RowRecipeItemStepUpdate {
  const row: RowRecipeItemStepUpdate = {}
  if (patch.text !== undefined) row.text = patch.text
  if (patch.position !== undefined) row.position = patch.position
  if (patch.kind !== undefined) row.kind = patch.kind
  if (patch.durationMin !== undefined) row.duration_min = patch.durationMin
  if (patch.temperatureC !== undefined) row.temperature_c = patch.temperatureC
  if (patch.photoUrl !== undefined) row.photo_url = patch.photoUrl
  return row
}

// ─────────────────────────────────────────────────────────────────────
// Lectura: pasos de una receta, ordenados, con sus líneas vinculadas.
// ─────────────────────────────────────────────────────────────────────

/**
 * Lista los pasos de una receta/plato ordenados por `position` (y created_at
 * como desempate), cada uno con `lineIds` = las líneas del escandallo que usa
 * (resueltas del puente recipe_item_step_line en una sola query agregada).
 *
 * Devuelve [] si la receta no tiene pasos.
 */
export async function listStepsByRecipe(recipeItemId: string): Promise<RecipeItemStep[]> {
  requireSupabase()

  const { data: stepRows, error: stepErr } = await supabase!
    .from('recipe_item_step')
    .select('*')
    .eq('recipe_item_id', recipeItemId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (stepErr) {
    throw new Error(`Error listando pasos de la receta ${recipeItemId}: ${stepErr.message}`)
  }

  const steps = stepRows ?? []
  if (steps.length === 0) return []

  // Puente: traer todos los vínculos de estos pasos de una vez y agruparlos.
  const stepIds = steps.map((s) => s.id)
  const { data: linkRows, error: linkErr } = await supabase!
    .from('recipe_item_step_line')
    .select('step_id, line_id')
    .in('step_id', stepIds)

  if (linkErr) {
    throw new Error(`Error obteniendo vínculos paso↔línea: ${linkErr.message}`)
  }

  const linesByStep = new Map<string, string[]>()
  for (const link of linkRows ?? []) {
    const arr = linesByStep.get(link.step_id) ?? []
    arr.push(link.line_id)
    linesByStep.set(link.step_id, arr)
  }

  return steps.map((row) => rowToRecipeItemStep(row, linesByStep.get(row.id) ?? []))
}

// ─────────────────────────────────────────────────────────────────────
// Escritura de pasos: crear / editar / borrar.
// ─────────────────────────────────────────────────────────────────────

export async function createStep(input: RecipeItemStepInsert): Promise<RecipeItemStep> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item_step')
    .insert(stepInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando paso: ${error.message}`)
  }
  return rowToRecipeItemStep(data)
}

export async function updateStep(
  id: string,
  patch: RecipeItemStepUpdate,
): Promise<RecipeItemStep> {
  requireSupabase()
  const rowPatch = stepUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const { data, error } = await supabase!
      .from('recipe_item_step').select('*').eq('id', id).single()
    if (error) throw new Error(`Error obteniendo paso ${id}: ${error.message}`)
    return rowToRecipeItemStep(data)
  }

  const { data, error } = await supabase!
    .from('recipe_item_step')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando paso ${id}: ${error.message}`)
  }
  return rowToRecipeItemStep(data)
}

export async function deleteStep(id: string): Promise<void> {
  requireSupabase()
  // Los vínculos del puente caen solos por ON DELETE CASCADE en step_id.
  const { error } = await supabase!
    .from('recipe_item_step')
    .delete()
    .eq('id', id)
  if (error) {
    throw new Error(`Error eliminando paso ${id}: ${error.message}`)
  }
}

/**
 * Reordena los pasos: reescribe `position` según el orden recibido (0..n-1).
 * No hay RPC de reorder en bloque; lo hacemos con updates individuales en
 * paralelo. Si alguno falla, se lanza el primer error (el orden puede quedar
 * a medias; la UI debe recargar para reflejar el estado real).
 */
export async function reorderSteps(orderedIds: string[]): Promise<void> {
  requireSupabase()
  if (orderedIds.length === 0) return

  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase!
        .from('recipe_item_step')
        .update({ position: index })
        .eq('id', id),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    throw new Error(`Error reordenando pasos: ${failed.error.message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Puente paso↔línea: sincronizar qué líneas usa un paso.
// ─────────────────────────────────────────────────────────────────────

/**
 * Sincroniza el puente recipe_item_step_line para UN paso: deja vinculadas
 * EXACTAMENTE las líneas de `lineIds` (borra las que sobran, inserta las que
 * faltan). Idempotente gracias al UNIQUE(step_id, line_id).
 *
 * Necesita `accountId` porque el puente SÍ tiene account_id (RLS) — el paso no
 * lo tiene, así que el llamador (que conoce la cuenta activa) lo aporta.
 *
 * @param stepId    paso a sincronizar
 * @param lineIds   líneas que deben quedar vinculadas (puede ser [])
 * @param accountId cuenta dueña (va en cada fila del puente, RLS)
 */
export async function setStepLines(
  stepId: string,
  lineIds: string[],
  accountId: string,
): Promise<void> {
  requireSupabase()

  // Estado actual del puente para este paso.
  const { data: current, error: readErr } = await supabase!
    .from('recipe_item_step_line')
    .select('id, line_id')
    .eq('step_id', stepId)
  if (readErr) {
    throw new Error(`Error leyendo vínculos del paso ${stepId}: ${readErr.message}`)
  }

  const want = new Set(lineIds)
  const have = new Set((current ?? []).map((r) => r.line_id))

  // Borrar los que sobran (están en BBDD pero ya no se quieren).
  const toDeleteIds = (current ?? [])
    .filter((r) => !want.has(r.line_id))
    .map((r) => r.id)
  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase!
      .from('recipe_item_step_line')
      .delete()
      .in('id', toDeleteIds)
    if (delErr) {
      throw new Error(`Error quitando vínculos del paso ${stepId}: ${delErr.message}`)
    }
  }

  // Insertar los que faltan (se quieren pero no están).
  const toInsert = lineIds
    .filter((lineId) => !have.has(lineId))
    .map((lineId) => ({ step_id: stepId, line_id: lineId, account_id: accountId }))
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase!
      .from('recipe_item_step_line')
      .insert(toInsert)
    if (insErr) {
      throw new Error(`Error añadiendo vínculos al paso ${stepId}: ${insErr.message}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// MEDIA POR PASO (foto + vídeo). recipe_item_step ya tiene photo_url y video_url.
// El valor es una RUTA de storage (archivo subido a recipe-uploads, se reproduce
// con signed URL) o una URL externa (enlace; solo se ofrece para vídeo). El front
// distingue por el prefijo http(s). database.ts puede no incluir aún video_url
// (columna recién creada) → cliente sin tipar acotado, patrón del proyecto.
// ─────────────────────────────────────────────────────────────────────

export type StepMediaKind = 'photo' | 'video'

const STEP_MEDIA_BUCKET = 'recipe-uploads'
const MEDIA_COLUMN: Record<StepMediaKind, string> = { photo: 'photo_url', video: 'video_url' }
const MEDIA_FOLDER: Record<StepMediaKind, string> = { photo: 'step-photo', video: 'step-video' }

export interface StepMedia {
  photo: string | null
  video: string | null
}

// Cliente sin tipar para tocar photo_url/video_url + storage sin depender del
// regen de database.ts.
function sb(): {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
    }
  }
  storage: {
    from: (b: string) => {
      upload: (path: string, file: File, opts?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
      createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>
    }
  }
} {
  requireSupabase()
  return supabase as never
}

/** account_id del plato (lo necesita la ruta de storage por carpeta-de-cuenta). */
export async function getRecipeAccountId(recipeItemId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .select('account_id')
    .eq('id', recipeItemId)
    .single()
  if (error) throw new Error(`Error obteniendo la cuenta de la receta: ${error.message}`)
  return (data as { account_id: string }).account_id
}

/** Mapa stepId → { photo, video } (ruta o URL externa) de todos los pasos. */
export async function getStepMediaMap(recipeItemId: string): Promise<Record<string, StepMedia>> {
  const { data, error } = await sb()
    .from('recipe_item_step')
    .select('id, photo_url, video_url')
    .eq('recipe_item_id', recipeItemId)
  if (error) throw new Error(`Error leyendo media de los pasos: ${error.message}`)
  const map: Record<string, StepMedia> = {}
  for (const r of data ?? []) {
    map[r.id as string] = {
      photo: (r.photo_url as string) ?? null,
      video: (r.video_url as string) ?? null,
    }
  }
  return map
}

/** Fija (o limpia con null) la foto o el vídeo de un paso. */
export async function setStepMedia(stepId: string, kind: StepMediaKind, value: string | null): Promise<void> {
  const { error } = await sb()
    .from('recipe_item_step')
    .update({ [MEDIA_COLUMN[kind]]: value })
    .eq('id', stepId)
  if (error) throw new Error(`No se pudo guardar ${kind === 'photo' ? 'la foto' : 'el vídeo'} del paso: ${error.message}`)
}

/**
 * Sube un archivo (foto o vídeo) a recipe-uploads/{accountId}/{carpeta}/{stepId}/…
 * y guarda su RUTA en la columna correspondiente. Devuelve la ruta guardada.
 */
export async function uploadStepMedia(
  accountId: string, stepId: string, kind: StepMediaKind, file: File,
): Promise<string> {
  const ext = (file.name.split('.').pop() || (kind === 'photo' ? 'jpg' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${accountId}/${MEDIA_FOLDER[kind]}/${stepId}/${Date.now()}.${ext}`
  const { error: upErr } = await sb().storage.from(STEP_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || (kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
    upsert: true,
  })
  if (upErr) throw new Error(`No se pudo subir ${kind === 'photo' ? 'la foto' : 'el vídeo'}: ${upErr.message}`)
  await setStepMedia(stepId, kind, path)
  return path
}

/** Signed URL para mostrar/reproducir un archivo subido (ruta de storage). 1 h. */
export async function getStepMediaSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await sb().storage.from(STEP_MEDIA_BUCKET).createSignedUrl(path, 3600)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * Quita la foto/vídeo de un paso: si era un archivo subido (ruta de storage) lo
 * borra del bucket; si era enlace externo solo limpia el campo. Deja la columna null.
 */
export async function removeStepMedia(stepId: string, kind: StepMediaKind, currentValue: string | null): Promise<void> {
  if (currentValue && !/^https?:\/\//i.test(currentValue)) {
    try { await sb().storage.from(STEP_MEDIA_BUCKET).remove([currentValue]) } catch { /* no bloqueante */ }
  }
  await setStepMedia(stepId, kind, null)
}
