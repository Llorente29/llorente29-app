// src/modules/conta/services/despachoService.ts
//
// P01 · «Impuestos de tus clientes» por dentro. Todo va por funciones de la
// base (security definer) de 20261123T0100_p01_despacho.sql, que miran quién
// pregunta y si cada empresa ha dado permiso:
//   conta_despacho_soy, conta_despacho_marcar, conta_despacho_correo_poner,
//   conta_despacho_equipo, conta_despacho_responsable_poner,
//   conta_despacho_trimestre.
// Nombres dentro de cadenas (regla 40): los ocho los crea esa migración;
// comprobado en staging el 19/10 (run 356).
// Presentar y descargar el fichero van por lo que ya existe (impuestosService).
// El resumen a los clientes va por la edge function conta-asesoria (acción
// «resumen»): manda los correos con el «responder a» de la asesoría, cerrados
// hasta que Julio los abra.

import { supabase } from '@/lib/supabase'
import { hayBase, rpc } from '@/modules/conta/services/bd'
import type { PersonaEquipo, TrimestreDespacho } from '@/modules/conta/impuestos/despacho/despacho'

export interface SoyAsesoria {
  asesoria: boolean
  desde: string | null
  nombre: string
  correo_respuesta: string | null
  clientes: number
  puede_gestionar: boolean
  puede_marcar: boolean
}

export function leerSoyAsesoria(accountId: string): Promise<SoyAsesoria> {
  return rpc<SoyAsesoria>('conta_despacho_soy', { p_account: accountId })
}

export function marcarAsesoria(accountId: string, es: boolean): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_despacho_marcar', { p_account: accountId, p_es: es })
}

export function ponerCorreoRespuesta(accountId: string, correo: string): Promise<{ ok: boolean; mensaje: string; correo: string }> {
  return rpc('conta_despacho_correo_poner', { p_account: accountId, p_correo: correo })
}

export function leerTrimestre(accountId: string, ejercicio: number, periodo: string, hoy?: string): Promise<TrimestreDespacho> {
  return rpc<TrimestreDespacho>('conta_despacho_trimestre', { p_account: accountId, p_year: ejercicio, p_period: periodo, p_hoy: hoy ?? null })
}

export function leerEquipo(accountId: string): Promise<PersonaEquipo[]> {
  return rpc<PersonaEquipo[]>('conta_despacho_equipo', { p_account: accountId })
}

export function ponerResponsable(accountId: string, companyId: string, userId: string | null): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_despacho_responsable_poner', { p_account: accountId, p_company: companyId, p_user: userId })
}

export interface EnvioResumen {
  ok: boolean
  mensaje: string
  /** El freno de send-email lo ha parado: no ha salido nada. */
  cerrado?: boolean
  /** Falta el correo al que responden los clientes (se pone en Ajustes › Tus impuestos). */
  falta_correo?: boolean
  enviados?: number
}

/** Manda el resumen del trimestre a los clientes elegidos. Nunca lanza: si algo falla, el mensaje dice qué (regla 8). */
export async function enviarResumen(accountId: string, ejercicio: number, periodo: string, empresas: string[], hoy?: string): Promise<EnvioResumen> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-asesoria', {
    body: { accion: 'resumen', cuenta: accountId, ejercicio, periodo, empresas, hoy: hoy ?? null },
  })
  if (!error && data && typeof data === 'object') return data as EnvioResumen
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as EnvioResumen | null
    if (c?.mensaje) return { ...c, ok: false }
    if (ctx.status === 404) return { ok: false, mensaje: 'El envío del resumen aún no está publicado en este entorno. No se ha mandado nada.' }
    return { ok: false, mensaje: `El envío ha contestado ${ctx.status}. No se ha mandado nada.` }
  }
  return { ok: false, mensaje: 'No se ha podido hablar con el envío. No se ha mandado nada.' }
}
