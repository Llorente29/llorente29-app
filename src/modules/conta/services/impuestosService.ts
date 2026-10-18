// src/modules/conta/services/impuestosService.ts
//
// I01a · Impuestos por dentro. Lo que el front escribe de Impuestos va por
// funciones de la base (security definer): las respuestas del alta, que
// hasta el I01a se usaban para proponer los modelos y se tiraban, y los
// modelos que salen de las reglas de la base.

import { supabase } from '@/lib/supabase'
import { hayBase, rpc } from '@/modules/conta/services/bd'
import type { Calendario } from '@/modules/conta/impuestos/calendario'
import type { DeclaracionVer, Puerta } from '@/modules/conta/impuestos/declaracion'

/** Las preguntas del paso «impuestos» del alta que deciden modelos. */
const CLAVES_DEL_ALTA = ['retiene', 'alquiler', 'retenido70'] as const

/**
 * Guarda, como datos de la empresa con quién y cuándo, las respuestas del
 * paso «impuestos»: «sí», «no» o «No lo sé» (__nolose). Las que no se
 * preguntaron no se envían. Devuelve cuántas se guardaron.
 */
export async function guardarRespuestasDelAlta(companyId: string, respuestas: Partial<Record<string, string>>): Promise<number> {
  const p: Record<string, string> = {}
  for (const k of CLAVES_DEL_ALTA) {
    const v = respuestas[k]
    if (v === 'si' || v === 'no' || v === '__nolose') p[k] = v
  }
  if (Object.keys(p).length === 0) return 0
  return rpc<number>('conta_impuesto_datos_del_alta', { p_company: companyId, p_respuestas: p })
}

/** Lo que devuelve conta_impuesto_obligaciones_calcular por cada modelo. */
interface ObligacionCalculada {
  modelo: string
  presenta: boolean
  regla: string
  por_que: string
  hecho: 'igual' | 'nuevo' | 'cambiado' | 'no_toca' | 'lo_decidio_una_persona'
}

/**
 * Escribe los modelos que dicen las reglas de la base (cada uno con su regla,
 * sus datos y su porqué; lo que decidió una persona no se toca) y devuelve los
 * que presenta, ordenados, con el porqué de cada uno en una frase.
 */
export async function calcularObligaciones(companyId: string): Promise<{ modelos: string[]; porque: string }> {
  const filas = await rpc<ObligacionCalculada[]>('conta_impuesto_obligaciones_calcular', { p_company: companyId })
  const presenta = filas.filter((f) => f.presenta).sort((a, b) => a.modelo.localeCompare(b.modelo))
  return {
    modelos: presenta.map((f) => f.modelo),
    porque: presenta.length
      ? presenta.map((f) => `${f.modelo}: ${f.por_que}`).join(' ')
      : 'Con lo que me has dicho, no presentas ningún modelo de los que conozco.',
  }
}

// ── I01b · Las pantallas de Impuestos ──────────────────────────────────────


/** Lo que pinta Impuestos › Calendario (conta_impuesto_calendario). */
export function leerCalendario(companyId: string, hoy?: string): Promise<Calendario> {
  return rpc<Calendario>('conta_impuesto_calendario', { p_company: companyId, ...(hoy ? { p_hoy: hoy } : {}) })
}

/** «+ Añadir otro impuesto»: con su motivo, queda quién y cuándo (conta_impuesto_obligacion_decidir). */
export function anadirImpuesto(companyId: string, modelo: string, motivo: string): Promise<string> {
  return rpc<string>('conta_impuesto_obligacion_decidir', { p_company: companyId, p_form: modelo, p_presenta: true, p_motivo: motivo })
}

/** Lo que devuelve conta_impuesto_303_calcular. */
export interface Calculo303 { declaracion: string; desde: string; hasta: string; apuntes: number; resultado: string; importe: number }

/** Calcula (o recalcula) el borrador del 303 de un periodo desde el libro de IVA. */
export function calcular303(companyId: string, ejercicio: number, periodo: string): Promise<Calculo303> {
  return rpc<Calculo303>('conta_impuesto_303_calcular', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}


/** Lo que pinta el IVA de un periodo (conta_impuesto_declaracion_ver). */
export function leerDeclaracion(companyId: string, ejercicio: number, periodo: string): Promise<DeclaracionVer> {
  return rpc<DeclaracionVer>('conta_impuesto_declaracion_ver', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/** «Revisado»: sin nada que Sumied no sepa resolver. */
export function revisarDeclaracion(declaracion: string): Promise<unknown> {
  return rpc('conta_impuesto_revisar', { p_return: declaracion })
}

/** Dar por bueno un aviso, con su motivo. */
export function aceptarAviso(comprobacion: string, motivo: string): Promise<unknown> {
  return rpc('conta_impuesto_aviso_aceptar', { p_check: comprobacion, p_motivo: motivo })
}

/** Cómo se paga: domiciliado, pagar yo o a devolver en un banco. */
export function ponerPago(declaracion: string, modo: 'direct_debit' | 'self' | 'refund', cuenta: string | null): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_impuesto_pago_poner', { p_return: declaracion, p_modo: modo, p_cuenta: cuenta })
}

/** El asiento de liquidación (0180). */
export function contabilizar303(declaracion: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_303_contabilizar', { p_return: declaracion })
}

export interface CargoPosible { movimiento: string; fecha: string; importe: number; concepto: string | null; cuenta: string }

/** Los movimientos del banco sin casar por el importe de la declaración (0180). */
export function cargosPosibles(declaracion: string): Promise<CargoPosible[]> {
  return rpc<CargoPosible[]>('conta_impuesto_cargos_posibles', { p_return: declaracion })
}

/** Casar el cargo con la declaración: «Pagado» (0180). */
export function casarCargo(declaracion: string, movimiento: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_casar_cargo', { p_return: declaracion, p_movement: movimiento })
}

/** El token de un solo uso para usar el certificado en ESA acción (dura 5 minutos). */
export function confirmarCertificado(certificado: string, accion: 'test' | 'file' | 'query', declaracion?: string, empresa?: string): Promise<string> {
  return rpc<string>('conta_cert_confirmar', { p_certificate: certificado, p_action: accion, p_tax_return: declaracion ?? null, p_company: empresa ?? null })
}

/** Lo que contesta conta-hacienda: siempre con un mensaje para la pantalla (regla 8). */
export type SalidaHacienda = { ok: boolean; mensaje: string; motivo?: string; [k: string]: unknown }

/** Llama a conta-hacienda. Nunca lanza: si la función contesta con un error, su cuerpo dice por qué. */
export async function hacienda(accion: 'puerta' | 'fichero_303' | 'presentar_303' | 'ya_presentado_fuera' | 'probar', cuerpo: Record<string, unknown> = {}): Promise<SalidaHacienda> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-hacienda', { body: { accion, ...cuerpo } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as SalidaHacienda
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as SalidaHacienda | null
    if (c && typeof c.mensaje === 'string') return { ...c, ok: false }
    if (ctx.status === 404) return { ok: false, motivo: 'sin_funcion', mensaje: 'La conexión con Hacienda aún no está publicada en este entorno. No se ha enviado nada.' }
    return { ok: false, motivo: 'fallo', mensaje: `La conexión con Hacienda ha contestado ${ctx.status}. No se ha enviado nada nuevo.` }
  }
  return { ok: false, motivo: 'fallo', mensaje: `No se ha podido hablar con la conexión con Hacienda${error ? ` (${error.message})` : ''}. No se ha enviado nada.` }
}

/** ¿Está abierta la puerta de Hacienda? Sin respuesta, cerrada (y se dice). */
export async function leerPuerta(): Promise<Puerta> {
  const r = await hacienda('puerta')
  if (r.ok) return { abierta: r.abierta === true, entorno: (r.entorno as Puerta['entorno']) ?? 'desconocido', mensaje: r.mensaje }
  return { abierta: false, entorno: 'cerrada', mensaje: r.mensaje }
}
