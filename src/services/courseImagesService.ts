// src/services/courseImagesService.ts
// Formación C3-A — imágenes de course_section: lectura (URL firmada, bucket
// privado) y escritura ("Usar foto propia" / "Volver a la imagen de Folvy").
//
// Convención de path (course-section-images, privado, mismo patrón que
// course-signatures de C1): `{accountId}/{sectionId}-{timestamp}.jpg` para
// las fotos propias de cada cuenta; `_global/...` para las genéricas de
// Folvy (las sube Julio fuera de esta app — este servicio nunca escribe ahí,
// solo lee).
//
// Escribir sobre una sección exige que su curso padre tenga account_id NOT
// NULL (RLS course_section_write, C1) — por eso "Usar foto propia" sobre un
// curso TODAVÍA global pasa primero por courseAdoptionService.

import { supabase } from '../lib/supabase'
import { compressImage } from '@/modules/appcc/services/photosService'

const SECTION_IMAGES_BUCKET = 'course-section-images'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_UPLOAD_MB = 8

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase
}

/** Resuelve URLs firmadas en lote para varios paths de una vez (1h de validez). */
// media_url puede ser un path de Storage (fotos propias de cuenta, bucket
// privado course-section-images) O una ruta pública de assets estáticos del
// propio despliegue (esquemas genéricos de Folvy, /formacion/*.svg servidos
// por Vercel desde public/) — estas últimas se devuelven TAL CUAL, sin pasar
// por Storage: createSignedUrls fallaría porque el objeto no vive ahí.
function isPublicUrl(path: string): boolean {
  return path.startsWith('/') || path.startsWith('http://') || path.startsWith('https://')
}

export async function getSignedSectionImageUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (unique.length === 0) return {}

  const map: Record<string, string> = {}
  const storagePaths: string[] = []
  for (const p of unique) {
    if (isPublicUrl(p)) map[p] = p
    else storagePaths.push(p)
  }
  if (storagePaths.length === 0) return map
  if (!supabase) return map

  const { data, error } = await supabase.storage.from(SECTION_IMAGES_BUCKET).createSignedUrls(storagePaths, 3600)
  if (error) { console.error('[courseImagesService] getSignedSectionImageUrls', error); return map }
  ;(data ?? []).forEach((d, i) => { if (d.signedUrl) map[storagePaths[i]] = d.signedUrl })
  return map
}

/** Versión de una sola imagen (previsualización puntual en el editor de oficina). */
export async function getSignedSectionImageUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const map = await getSignedSectionImageUrls([path])
  return map[path] ?? null
}

/**
 * Sube una foto propia de la cuenta para una sección y actualiza su
 * media_url. La sección DEBE pertenecer a un curso con account_id NOT NULL
 * (si es una plantilla global sin adoptar, adoptar primero — ver
 * courseAdoptionService.adoptCourseForAccount). Comprime antes de subir
 * (fotos de móvil de varios MB, se ven en cocina con datos móviles).
 */
export async function uploadOwnSectionImage(
  accountId: string,
  sectionId: string,
  file: File,
  previousMediaUrl?: string | null,
): Promise<string> {
  const sb = requireSupabase()

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Sube una foto en JPG, PNG o WEBP.')
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`Foto demasiado grande (máx ${MAX_UPLOAD_MB} MB antes de comprimir).`)
  }

  const compressed = await compressImage(file, 1600, 0.75)
  const path = `${accountId}/${sectionId}-${Date.now()}.jpg`

  const { error: upErr } = await sb.storage.from(SECTION_IMAGES_BUCKET).upload(path, compressed, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (upErr) { console.error('[courseImagesService] upload', upErr); throw upErr }

  const { error: updErr } = await sb.from('course_section').update({ media_url: path }).eq('id', sectionId)
  if (updErr) {
    // Si no se pudo escribir media_url (p.ej. RLS: la sección es de un curso
    // global sin adoptar), no dejar el archivo huérfano en storage.
    await sb.storage.from(SECTION_IMAGES_BUCKET).remove([path])
    console.error('[courseImagesService] actualizar media_url', updErr)
    throw updErr
  }

  // Best-effort: retira la foto propia ANTERIOR de esta misma sección para
  // no acumular huérfanos. Nunca toca `_global/...` (no es suya).
  if (previousMediaUrl && previousMediaUrl.startsWith(`${accountId}/`) && previousMediaUrl !== path) {
    try {
      await sb.storage.from(SECTION_IMAGES_BUCKET).remove([previousMediaUrl])
    } catch {
      // no bloquea la subida ya confirmada
    }
  }

  return path
}

/**
 * "Volver a la imagen de Folvy": revierte la sección de una copia ADOPTADA a
 * la imagen que tenga hoy la sección correspondiente en la plantilla global
 * (nunca a NULL a secas — si Folvy aún no tiene imagen para esa sección,
 * queda como Folvy la tenga, no como un borrado unilateral de la cuenta).
 * Exige que el curso sea una copia adoptada (adopted_from_course_id no nulo)
 * — un curso creado desde cero por la cuenta no tiene "imagen de Folvy" a la
 * que volver.
 */
export async function revertSectionImageToFolvy(sectionId: string, accountId: string): Promise<string | null> {
  const sb = requireSupabase()

  const { data: section, error: sErr } = await sb
    .from('course_section')
    .select('id, ord, course_id, media_url')
    .eq('id', sectionId)
    .single()
  if (sErr) throw sErr

  const { data: course, error: cErr } = await sb
    .from('course')
    .select('adopted_from_course_id')
    .eq('id', section.course_id)
    .single()
  if (cErr) throw cErr
  if (!course.adopted_from_course_id) {
    throw new Error('Este curso no es una copia adoptada de una plantilla de Folvy: no hay imagen a la que volver.')
  }

  const { data: originSection, error: oErr } = await sb
    .from('course_section')
    .select('media_url')
    .eq('course_id', course.adopted_from_course_id)
    .eq('ord', section.ord)
    .maybeSingle()
  if (oErr) throw oErr
  const originMediaUrl = originSection?.media_url ?? null

  const { error: updErr } = await sb.from('course_section').update({ media_url: originMediaUrl }).eq('id', sectionId)
  if (updErr) throw updErr

  // Best-effort: retira la foto propia que se está sustituyendo.
  if (section.media_url && section.media_url.startsWith(`${accountId}/`)) {
    try {
      await sb.storage.from(SECTION_IMAGES_BUCKET).remove([section.media_url])
    } catch {
      // no bloquea la reversión ya confirmada
    }
  }

  return originMediaUrl
}
