// src/modules/personal/laboral/registroJornadaServicio.ts
//
// L1a · PR 2 (28/10/2026). Lo que el registro de jornada pide a la base: el
// informe (con sesión o por el enlace de la Inspección), el enlace, las
// jornadas para revisar, las correcciones que esperan la respuesta de la
// persona y la firma del mes. Las funciones son de la 0705 y aún no están en
// database.ts: van por un cliente sin tipos, y cada error sale en palabras.

import { supabase } from '@/lib/supabase'
import type { DatosInforme } from './informeJornada'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase
}

/** El mensaje de un error de la base, con su pista si la trae. */
function enPalabras(e: { message?: string; hint?: string | null } | null, porDefecto: string): Error {
  return new Error(e?.hint || e?.message || porDefecto)
}

export async function leerInforme(employeeId: string, desde: string, hasta: string): Promise<DatosInforme> {
  const { data, error } = await db().rpc('informe_registro_jornada', { p_employee_id: employeeId, p_desde: desde, p_hasta: hasta })
  if (error) throw enPalabras(error, 'No se ha podido sacar el registro de jornada.')
  return data as DatosInforme
}

export async function leerInformePorEnlace(token: string): Promise<DatosInforme> {
  const { data, error } = await db().rpc('informe_por_enlace', { p_token: token })
  if (error) throw enPalabras(error, 'Este enlace ya no es válido.')
  return data as DatosInforme
}

export interface EnlaceInspeccion {
  token: string
  caducaAt: string
  url: string
}

export function urlDelEnlace(token: string): string {
  return `${window.location.origin}/inspeccion?t=${encodeURIComponent(token)}`
}

export async function crearEnlace(employeeId: string, desde: string, hasta: string, dias = 30): Promise<EnlaceInspeccion> {
  const { data, error } = await db().rpc('crear_enlace_inspeccion', { p_employee_id: employeeId, p_desde: desde, p_hasta: hasta, p_dias: dias })
  if (error) throw enPalabras(error, 'No se ha podido crear el enlace.')
  const r = data as { token: string; caduca_at: string }
  return { token: r.token, caducaAt: r.caduca_at, url: urlDelEnlace(r.token) }
}

export async function retirarEnlace(token: string): Promise<void> {
  const { error } = await db().rpc('revocar_enlace_inspeccion', { p_token: token })
  if (error) throw enPalabras(error, 'No se ha podido retirar el enlace.')
}

export interface JornadaParaRevisar {
  clockEntryId: string
  employeeId: string
  nombre: string
  tipo: 'larga' | 'sin_salida'
  entrada: string
  salida: string | null
  horas: number | null
}

export async function jornadasParaRevisar(accountId: string): Promise<JornadaParaRevisar[]> {
  const { data, error } = await db().rpc('jornadas_para_revisar', { p_account_id: accountId })
  if (error) throw enPalabras(error, 'No se han podido leer las jornadas para revisar.')
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    clockEntryId: String(r.clock_entry_id), employeeId: String(r.employee_id), nombre: String(r.nombre ?? ''),
    tipo: r.tipo as 'larga' | 'sin_salida', entrada: String(r.entrada),
    salida: (r.salida as string | null) ?? null, horas: r.horas == null ? null : Number(r.horas),
  }))
}

/** Una corrección que hizo otra persona y espera la respuesta de la persona del fichaje. */
export interface CorreccionPendiente {
  id: string
  accion: 'create_manual' | 'edit' | 'void' | 'restore'
  cuando: string
  quien: string | null
  motivo: string | null
  tipo: string | null
  horaAntes: string | null
  horaDespues: string | null
  conformidad: 'pendiente' | 'conforme' | 'desacuerdo'
  employeeId: string
  conformidadAt: string | null
  conformidadNota: string | null
}

type Instantanea = { type?: string; real_datetime?: string; datetime?: string } | null
const horaDe = (s: Instantanea) => s?.real_datetime ?? s?.datetime ?? null

function aCorreccion(r: Record<string, unknown>): CorreccionPendiente {
  const antes = r.before as Instantanea
  const despues = r.after as Instantanea
  return {
    id: String(r.id), accion: r.action as CorreccionPendiente['accion'], cuando: String(r.created_at),
    quien: (r.actor_label as string | null) || null, motivo: (r.reason as string | null) ?? null,
    tipo: despues?.type ?? antes?.type ?? null, horaAntes: horaDe(antes), horaDespues: horaDe(despues),
    conformidad: r.conformidad as CorreccionPendiente['conformidad'], employeeId: String(r.employee_id),
    conformidadAt: (r.conformidad_at as string | null) ?? null, conformidadNota: (r.conformidad_nota as string | null) ?? null,
  }
}

const COLUMNAS_CORRECCION = 'id, employee_id, action, created_at, actor_label, reason, before, after, conformidad, conformidad_at, conformidad_nota'

/** Las correcciones de esta persona que esperan su respuesta (su portal). */
export async function correccionesPorResponder(employeeId: string): Promise<CorreccionPendiente[]> {
  const { data, error } = await db().from('clock_entry_audit').select(COLUMNAS_CORRECCION)
    .eq('employee_id', employeeId).eq('conformidad', 'pendiente').order('created_at', { ascending: true })
  if (error) {
    // Con la base de antes de la 0705 la columna no existe: no hay nada que responder.
    if (error.code === '42703') return []
    throw enPalabras(error, 'No se han podido leer las correcciones.')
  }
  return ((data ?? []) as Record<string, unknown>[]).map(aCorreccion)
}

/** Las correcciones con las que alguien no está de acuerdo (para revisar). */
export async function correccionesEnDesacuerdo(accountId: string): Promise<CorreccionPendiente[]> {
  const { data, error } = await db().from('clock_entry_audit').select(COLUMNAS_CORRECCION)
    .eq('account_id', accountId).eq('conformidad', 'desacuerdo').order('conformidad_at', { ascending: false })
  if (error) {
    if (error.code === '42703') return []
    throw enPalabras(error, 'No se han podido leer las correcciones en desacuerdo.')
  }
  return ((data ?? []) as Record<string, unknown>[]).map(aCorreccion)
}

export async function responderCorreccion(id: string, conforme: boolean, nota?: string): Promise<void> {
  const { error } = await db().rpc('responder_correccion', { p_audit_id: id, p_conforme: conforme, p_nota: nota ?? null })
  if (error) throw enPalabras(error, 'No se ha podido guardar tu respuesta.')
}

export interface FirmaDelMes {
  mes: string
  firmadoAt: string
  invalidadaAt: string | null
}

export async function firmasDe(employeeId: string): Promise<FirmaDelMes[]> {
  const { data, error } = await db().from('registro_jornada_firma').select('mes, firmado_at, invalidada_at')
    .eq('employee_id', employeeId).order('mes', { ascending: false })
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return []
    throw enPalabras(error, 'No se han podido leer tus firmas.')
  }
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    mes: String(r.mes), firmadoAt: String(r.firmado_at), invalidadaAt: (r.invalidada_at as string | null) ?? null,
  }))
}

export async function firmarMes(employeeId: string, mes: string, resumen: Record<string, unknown>): Promise<{ firmadoAt: string }> {
  const { data, error } = await db().rpc('firmar_registro_mes', { p_employee_id: employeeId, p_mes: mes, p_resumen: resumen })
  if (error) throw enPalabras(error, 'No se ha podido firmar.')
  return { firmadoAt: String((data as { firmado_at: string }).firmado_at) }
}

// ── L1a-H (29/10) · La firma del mes, solo si la empresa la pide ─────────────
// accounts.firma_registro_mes y firma_registro_mes_pedir son de la 1135.

/**
 * Si la empresa pide a cada persona que firme su registro del mes. NULL o
 * false es apagado. Lanza si no se puede leer (sin la 1135, sin red): quien
 * llama decide; el portal lo toma como apagado.
 */
export async function pideFirmaDelMes(accountId: string): Promise<boolean> {
  const { data, error } = await db().from('accounts').select('firma_registro_mes').eq('id', accountId).maybeSingle()
  if (error) throw enPalabras(error, 'No se ha podido leer si la empresa pide la firma del registro.')
  return (data as { firma_registro_mes?: boolean | null } | null)?.firma_registro_mes === true
}

/** Enciende o apaga la firma del mes de la empresa (solo su administrador). */
export async function pedirFirmaDelMes(accountId: string, pedir: boolean): Promise<{ pedir: boolean; personas: number }> {
  const { data, error } = await db().rpc('firma_registro_mes_pedir', { p_account_id: accountId, p_pedir: pedir })
  if (error) throw enPalabras(error, pedir ? 'No se ha podido encender la firma del registro.' : 'No se ha podido apagar la firma del registro.')
  const r = data as { pedir: boolean; personas: number }
  return { pedir: r.pedir === true, personas: Number(r.personas ?? 0) }
}
