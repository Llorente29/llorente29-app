// src/modules/conta/services/avisosService.ts
//
// G01d · «Al instante» de cada conexión: leer su estado, pegar el código o el
// secreto, encender o apagar y probar.
//
// Nombres dentro de cadenas (regla 40): conta_crm.aviso_* y
// conta_cobro_gocardless.aviso_*, la tabla conta_aviso, la función
// conta_aviso_configurar y las funciones conta-crm-aviso y
// conta-gocardless-aviso los crea la 20261108T1620_g01d_avisos (esta rama); el
// resto (conta_crm, conta_cobro_gocardless, sus columnas account_id, crm,
// company_id) existe en producción (esquema de staging del 08/11).

import { supabase } from '@/lib/supabase'
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import type { DatosAlInstante, OrigenAviso } from '@/modules/conta/avisos/alInstante'

export type Conexion = { origen: 'crm'; cuenta: string; crm: string } | { origen: 'gocardless'; cuenta: string; empresa: string }

type Fila = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** El estado de «Al instante» de una conexión. Sin las columnas (antes de la tanda), apagado. */
export async function leerAlInstante(c: Conexion): Promise<DatosAlInstante> {
  const q = c.origen === 'crm'
    ? tabla('conta_crm').select('*').eq('account_id', c.cuenta).eq('crm', c.crm).maybeSingle()
    : tabla('conta_cobro_gocardless').select('*').eq('company_id', c.empresa).maybeSingle()
  const { data, error } = await q
  if (error) throw new Error(mensaje('No se ha podido leer «Al instante»', error))
  const f = (data ?? {}) as Fila
  return { encendido: f.aviso_encendido === true, tieneCodigo: !!f.aviso_ref, ultimoAviso: str(f.aviso_ultimo_at), encendidoAt: str(f.aviso_encendido_at) }
}

/** Pegar el código (o el secreto) y, si se dice, encender o apagar. Devuelve la frase de lo hecho (regla 8). */
export async function configurarAlInstante(c: Conexion, cambio: { codigo?: string; encender?: boolean }): Promise<string> {
  const r = await rpc<{ frase?: string }>('conta_aviso_configurar', {
    p_account: c.cuenta, p_origen: c.origen, p_crm: c.origen === 'crm' ? c.crm : null, p_company: c.origen === 'gocardless' ? c.empresa : null,
    p_codigo: cambio.codigo?.trim() || null, p_encender: cambio.encender ?? null,
  })
  return r?.frase ?? 'Hecho.'
}

/** «Probar»: Sumied se manda un aviso de prueba y dice si ha llegado. */
export async function probarAlInstante(c: Conexion): Promise<{ ok: boolean; frase: string }> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const nombre = c.origen === 'crm' ? 'conta-crm-aviso' : 'conta-gocardless-aviso'
  const body = c.origen === 'crm' ? { accion: 'probar', cuenta: c.cuenta, crm: c.crm } : { accion: 'probar', empresa: c.empresa }
  const { data, error } = await supabase.functions.invoke(nombre, { body })
  if (!error) return { ok: (data as Fila | null)?.ok === true, frase: String((data as Fila | null)?.frase ?? 'Probado.') }
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  return { ok: false, frase: str(cuerpo?.error) ?? (ctx?.status === 404 ? 'La prueba aún no está publicada en este entorno.' : `No se ha podido probar: ${error.message}`) }
}

export const origenDe = (c: Conexion): OrigenAviso => c.origen
