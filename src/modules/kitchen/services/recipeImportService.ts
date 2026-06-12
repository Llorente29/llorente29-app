// src/modules/kitchen/services/recipeImportService.ts
//
// FUNCIÓN ESTRELLA: importar un escandallo desde la ficha del cocinero, en
// CUALQUIER formato habitual:
//   · Imagen (jpg/png/webp) → visión IA.
//   · PDF                   → visión IA (Claude lo lee nativo como documento).
//   · Excel (.xlsx/.xls/.csv) → se lee a texto en el cliente (SheetJS) → IA texto.
//   · Word (.docx)          → se lee a texto en el cliente (mammoth) → IA texto.
//
// Orquesta tres piezas de backend que ya existen:
//   1. Subida al bucket recipe-uploads/{cuenta}/recipe-sources/  (solo imagen/PDF).
//   2. Edge `extract-recipe` (kind 'photo' para visión; 'conversational' para texto).
//   3. RPC `materialize_recipe_session` → recipe_item (dish) + recipe_line, casando
//      ingredientes existentes y creando los nuevos como raw provisional (needs_review).
//
// Anti-invención: los ingredientes no casados se crean needs_review; el coste no
// se da por bueno hasta que el humano lo complete.

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

// ── Resultado ──────────────────────────────────────────────────────────────

export interface ImportRecipeResult {
  recipeId: string
  dishName: string
  wasCreated: boolean
  linesCreated: number
  newArticlesCreated: number
  linesSkipped: number
  linesExtracted: number
}

interface ExtractResponse {
  session_id: string
  status: string
  parsed: unknown
  lines_extracted: number
  lines_mapped: number
  proposal_error: string | null
}

interface MaterializeRow {
  result_recipe_id: string
  dish_name: string
  was_created: boolean
  lines_created: number
  new_articles_created: number
  lines_skipped: number
}

// ── Importación end-to-end ────────────────────────────────────────────────────

/**
 * Importa un escandallo desde un fichero (imagen, PDF, Excel o Word).
 */
export async function importRecipeFromFile(
  accountId: string,
  file: File,
  brandHint?: string,
): Promise<ImportRecipeResult> {
  if (!supabase) throw new Error('Supabase no disponible')

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
    }
  } else {
    const text = fileKind === 'excel' ? await excelToText(file) : await wordToText(file)
    extractBody = {
      account_id: accountId,
      kind: 'conversational',
      input_text: text,
      brand_hint: brandHint ?? null,
    }
  }

  // ── Extraer con la IA (Edge extract-recipe) ──
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

  // ── Materializar la sesión → escandallo real ──
  const { data: matData, error: matErr } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )('materialize_recipe_session', { p_session_id: extract.session_id })

  if (matErr) {
    throw new Error(`No se pudo crear el escandallo: ${matErr.message}`)
  }
  const row = (Array.isArray(matData) ? matData[0] : matData) as MaterializeRow | undefined
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
    linesExtracted: extract.lines_extracted,
  }
}

// Compat: nombre anterior (solo foto) usado por la pantalla. Reexporta al nuevo.
export const importRecipeFromPhoto = importRecipeFromFile
