// src/services/documentsService.ts
import { supabase } from '../lib/supabase'
import type { DocumentFile } from '../types/personal'

const BUCKET = 'employee-documents'

interface DocRow {
  id: string
  employee_id: string
  type: string
  name: string
  file_path: string
  file_size_kb: number
  uploaded_by: string | null
  uploaded_role: 'gestor' | 'trabajador'
  notes: string | null
  created_at: string
}

function rowToDocument(r: DocRow): DocumentFile {
  return {
    id: r.id,
    employeeId: r.employee_id,
    type: r.type,
    name: r.name,
    filePath: r.file_path,
    fileSizeKb: r.file_size_kb,
    uploadedBy: r.uploaded_by || undefined,
    uploadedRole: r.uploaded_role,
    notes: r.notes || undefined,
    createdAt: r.created_at,
  }
}

export async function fetchDocuments(employeeId?: string): Promise<DocumentFile[] | null> {
  if (!supabase) return null
  let query = supabase.from('documents').select('*').order('created_at', { ascending: false })
  if (employeeId) query = query.eq('employee_id', employeeId)
  const { data, error } = await query
  if (error) { console.error('fetchDocuments:', error); return null }
  return (data as DocRow[]).map(rowToDocument)
}

export async function uploadDocument(
  employeeId: string,
  file: File,
  type: string,
  uploadedBy: string | null,
  uploadedRole: 'gestor' | 'trabajador',
  notes?: string,
): Promise<DocumentFile | null> {
  if (!supabase) return null
  const sb = supabase

  // Validaciones
  const MAX_KB = 5 * 1024
  if (file.size > MAX_KB * 1024) {
    throw new Error(`Archivo demasiado grande (${Math.round(file.size / 1024)} KB). Máximo ${MAX_KB} KB.`)
  }
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    throw new Error('Formato no permitido. Solo PDF, JPG, PNG o WEBP.')
  }

  // Subir al bucket. Estructura: employee-documents/{employeeId}/{timestamp}-{filename}
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${employeeId}/${Date.now()}-${safeName}`
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (upErr) { console.error('Upload error:', upErr); throw new Error('Error subiendo archivo: ' + upErr.message) }

  // Insertar en la tabla
  const { data, error } = await sb.from('documents').insert({
    employee_id: employeeId,
    type,
    name: file.name,
    file_path: path,
    file_size_kb: Math.round(file.size / 1024),
    uploaded_by: uploadedBy,
    uploaded_role: uploadedRole,
    notes: notes || null,
  }).select().single()

  if (error) {
    console.error('Insert document error:', error)
    // Si falla la inserción, intentar borrar el archivo subido
    await sb.storage.from(BUCKET).remove([path])
    throw new Error('Error guardando metadatos: ' + error.message)
  }

  return rowToDocument(data as DocRow)
}

export function getDocumentUrl(filePath: string): string | null {
  if (!supabase) return null
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

export async function deleteDocument(doc: DocumentFile): Promise<boolean> {
  if (!supabase) return false
  // Borrar archivo del bucket
  await supabase.storage.from(BUCKET).remove([doc.filePath])
  // Borrar registro
  const { error } = await supabase.from('documents').delete().eq('id', doc.id)
  if (error) { console.error('deleteDocument:', error); return false }
  return true
}
