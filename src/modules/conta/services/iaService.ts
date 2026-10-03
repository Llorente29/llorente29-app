// src/modules/conta/services/iaService.ts
//
// La base de la IA del módulo (C00 §6.1–6.3), sobre la migración 0160: de
// dónde sale cada dato, el registro con su deshacer y las sugerencias. Todo
// lo que la IA escribe pasa por las funciones conta_ia_* (nadie escribe el
// registro a mano); aquí solo se llaman y se lee.
//
// Nombres de la base entre comillas (regla 40), comprobados contra la
// migración 20261003T0160 en tests/unit/modules/conta/iaC00.test.ts.

import { tabla, mensaje, rpc } from '@/modules/conta/services/bd'
import type { Origen, Registro, Sugerencia } from '@/modules/conta/ia/tipos'

type Fila = Record<string, unknown>
const sinPrefijo = (e: unknown): Error => new Error((e instanceof Error ? e.message : String(e)).replace(/^conta_[a-z_]+: /, ''))
const txt = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

async function leer(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await p
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

/** Recalcula las sugerencias (las que se fundamentan con datos de la cuenta) y lee lo de la IA. */
export async function cargarIa(companyId: string): Promise<{ origenes: Origen[]; sugerencias: Sugerencia[]; registro: Registro[] }> {
  try { await rpc('conta_sugerencias_calcular', { p_company: companyId }) } catch (e) { throw sinPrefijo(e) }
  const [o, s, r] = await Promise.all([
    leer(tabla('ai_data_origin').select('table_key, row_id, field, source, value_set, reason, set_at').eq('company_id', companyId), 'de dónde sale cada dato'),
    leer(tabla('ai_suggestion').select('id, kind, reason_key, title, why, payload, status, created_at').eq('company_id', companyId).eq('status', 'open').order('created_at'), 'las sugerencias'),
    leer(tabla('ai_action_log').select('*').eq('company_id', companyId).order('done_at', { ascending: false }).limit(50), 'lo que ha hecho Folvy'),
  ])
  return {
    origenes: o.map((x): Origen => ({
      tableKey: String(x.table_key), rowId: String(x.row_id), field: String(x.field),
      source: x.source === 'import' ? 'import' : 'ai', valueSet: x.value_set ?? null, reason: String(x.reason), setAt: String(x.set_at),
    })),
    sugerencias: s.map((x): Sugerencia => ({
      id: String(x.id), kind: String(x.kind), reasonKey: String(x.reason_key), title: String(x.title), why: String(x.why),
      payload: x.payload && typeof x.payload === 'object' ? x.payload as Record<string, unknown> : {},
    })),
    registro: r.map((x): Registro => ({
      id: String(x.id), action: x.action === 'anadir_actividad' ? 'anadir_actividad' : 'poner',
      source: x.source === 'import' ? 'import' : 'ai', tableKey: String(x.table_key), field: txt(x.field),
      before: x.before_value ?? null, after: x.after_value ?? null, reason: String(x.reason),
      doneAt: String(x.done_at), doneForName: txt(x.done_for_name), undoneAt: txt(x.undone_at), undoneByName: txt(x.undone_by_name),
      suggestionId: txt(x.suggestion_id),
    })),
  }
}

export async function responderSugerencia(id: string, acepta: boolean): Promise<void> {
  try { await rpc('conta_sugerencia_responder', { p_sugerencia: id, p_acepta: acepta }) } catch (e) { throw sinPrefijo(e) }
}

export async function deshacer(registroId: string): Promise<void> {
  try { await rpc('conta_ia_deshacer', { p_registro: registroId }) } catch (e) { throw sinPrefijo(e) }
}

/** La IA (o una importación) pone un campo de la empresa o de su perfil fiscal, con su porqué. */
export async function ponerConIa(companyId: string, tablaBd: 'company' | 'company_tax_profile', campo: string, valor: unknown,
  motivo: string, origen: 'ai' | 'import' = 'ai'): Promise<string> {
  try {
    return await rpc<string>('conta_ia_poner', { p_company: companyId, p_tabla: tablaBd, p_campo: campo, p_valor: valor, p_motivo: motivo, p_origen: origen })
  } catch (e) { throw sinPrefijo(e) }
}

export async function anadirActividadConIa(companyId: string, a: {
  descripcion: string; clase: 'business' | 'professional' | 'other'; iae: string | null; cnae: string | null; principal: boolean; motivo: string
}): Promise<string> {
  try {
    return await rpc<string>('conta_ia_anadir_actividad', {
      p_company: companyId, p_descripcion: a.descripcion, p_clase: a.clase, p_iae: a.iae, p_cnae: a.cnae, p_principal: a.principal, p_motivo: a.motivo,
    })
  } catch (e) { throw sinPrefijo(e) }
}
