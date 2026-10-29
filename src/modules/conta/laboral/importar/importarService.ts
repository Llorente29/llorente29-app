// src/modules/conta/laboral/importar/importarService.ts
//
// LAB1 · Lo que habla con la base en la tanda 1: guardar las cabeceras de un
// fichero (lab_import_leer_cabeceras) y listar los lotes de la cuenta. La
// función y la tabla son de la 0850 y aún no están en database.ts.

import { supabase } from '@/lib/supabase'
import type { Comparacion, HojaLeida } from './cegidCabeceras'

export interface LoteGuardado { id: string; repetido: boolean; subidoAt: string; estado: string }

export interface LoteImportacion {
  id: string
  ficheroNombre: string
  estado: string
  subidoAt: string
  hojas: HojaLeida[]
  completa: boolean | null
}

const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'Solo el administrador de la cuenta puede importar el historial de personal.',
  SIN_HOJAS: 'El fichero no trae ninguna hoja.',
  HOJA_MAL_FORMADA: 'El fichero no se ha podido leer bien: alguna hoja no tiene cabeceras.',
  CABECERAS_DEMASIADO_GRANDES: 'Las cabeceras del fichero son demasiado grandes para guardarlas. ¿Es el paquete de Cegid?',
  FICHERO_SIN_NOMBRE_O_HUELLA: 'El fichero no tiene nombre o no se ha podido calcular su huella.',
}

/** El error de la base, en palabras de oficina. */
export function mensajeDeError(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? ''
  const clave = Object.keys(MENSAJES).find((k) => m.includes(k))
  return clave ? MENSAJES[clave] : `No se ha podido guardar: ${m || 'error sin mensaje'}.`
}

export async function guardarCabeceras(
  accountId: string, ficheroNombre: string, huella: string, hojas: HojaLeida[], comparacion: Comparacion,
): Promise<LoteGuardado> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  // lab_import_leer_cabeceras es de la 0850 y aún no está en database.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('lab_import_leer_cabeceras', {
    p_account_id: accountId, p_fichero_nombre: ficheroNombre, p_fichero_huella: huella, p_hojas: hojas, p_comparacion: comparacion,
  })
  if (error) throw new Error(mensajeDeError(error))
  const r = data as { id: string; repetido: boolean; subido_at: string; estado: string }
  return { id: r.id, repetido: r.repetido, subidoAt: r.subido_at, estado: r.estado }
}

export async function leerLotes(accountId: string): Promise<LoteImportacion[]> {
  if (!supabase) return []
  // lab_import_lote es de la 0850 y aún no está en database.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from as any)('lab_import_lote')
    .select('id, fichero_nombre, estado, subido_at, resumen')
    .eq('account_id', accountId)
    .order('subido_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(mensajeDeError(error))
  type Fila = { id: string; fichero_nombre: string; estado: string; subido_at: string; resumen: { hojas?: HojaLeida[]; comparacion?: { completa?: boolean } } | null }
  return ((data ?? []) as Fila[]).map((f) => ({
    id: f.id, ficheroNombre: f.fichero_nombre, estado: f.estado, subidoAt: f.subido_at,
    hojas: f.resumen?.hojas ?? [], completa: f.resumen?.comparacion?.completa ?? null,
  }))
}
