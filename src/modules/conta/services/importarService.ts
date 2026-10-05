// src/modules/conta/services/importarService.ts
//
// C02c · Traer el plan de otro programa: leer y guardar la importación, traer
// y deshacer. Lo que cambia algo va SIEMPRE por las funciones de la base
// (20261008T0100), que lo comprueban todo otra vez.
//
// Nombres de la base entre comillas (regla 40), comprobados en staging-conta
// el 06/10 tras aplicar la 0100: company_chart_import (id, program, file_names,
// file_sha256, digits, plan, status, review, result, applied_at,
// applied_by_name), supplier (id, name, tax_id), treasury_account (id, name,
// iban, kind, is_active, company_id); funciones company_chart_import_save,
// company_chart_import_discard, company_chart_import_apply,
// company_chart_import_undo.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { Programa } from '@/modules/conta/lib/importarPlan'
import type { FichaBanco, FichaProveedor, PlanTraer } from '@/modules/conta/lib/propuestaImportacion'

type Fila = Record<string, unknown>

export type EstadoImportacion = 'revision' | 'traida' | 'deshecha'

export interface Importacion {
  id: string
  programa: Programa
  ficheros: string[]
  huella: string
  estado: EstadoImportacion
  /** Lo guardado para seguir luego: la lectura y lo decidido. */
  revision: Record<string, unknown>
  resultado: { cuentas: number; fichas: number; enlaces: number; avisos: string[] } | null
  traidaEl: string | null
  traidaPor: string | null
}

const aImportacion = (f: Fila): Importacion => ({
  id: String(f.id), programa: f.program as Programa, ficheros: Array.isArray(f.file_names) ? (f.file_names as unknown[]).map(String) : [],
  huella: String(f.file_sha256), estado: f.status as EstadoImportacion, revision: (f.review as Record<string, unknown>) ?? {},
  resultado: f.result ? {
    cuentas: Number((f.result as Fila).cuentas ?? 0), fichas: Number((f.result as Fila).fichas ?? 0), enlaces: Number((f.result as Fila).enlaces ?? 0),
    avisos: Array.isArray((f.result as Fila).avisos) ? ((f.result as Fila).avisos as unknown[]).map(String) : [],
  } : null,
  traidaEl: (f.applied_at as string) ?? null, traidaPor: (f.applied_by_name as string) ?? null,
})

/** La importación abierta de la empresa (en revisión o traída), o null. */
export async function importacionAbierta(accountId: string, companyId: string): Promise<Importacion | null> {
  const { data, error } = await tabla('company_chart_import')
    .select('id, program, file_names, file_sha256, status, review, result, applied_at, applied_by_name')
    .eq('account_id', accountId).eq('company_id', companyId).in('status', ['revision', 'traida']).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer la importación', error))
  return data ? aImportacion(data as Fila) : null
}

/** Lo que hay en Folvy para casar: proveedores con su NIF y bancos con su IBAN. */
export async function fichasParaCasar(accountId: string, companyId: string): Promise<{ proveedores: FichaProveedor[]; bancos: FichaBanco[] }> {
  const [p, b] = await Promise.all([
    tabla('supplier').select('id, name, tax_id').eq('account_id', accountId).is('archived_at', null).order('name'),
    tabla('treasury_account').select('id, name, iban').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true).order('name'),
  ])
  if (p.error) throw new Error(mensaje('No se han podido leer los proveedores', p.error))
  if (b.error) throw new Error(mensaje('No se han podido leer los bancos', b.error))
  const nif = (v: unknown) => (typeof v === 'string' && v.trim() ? v.toUpperCase().replace(/[\s.\-_/]/g, '') : null)
  const iban = (v: unknown) => (typeof v === 'string' && v.trim() ? v.toUpperCase().replace(/[\s\-.]/g, '') : null)
  return {
    proveedores: ((p.data ?? []) as Fila[]).map((x) => ({ id: String(x.id), name: String(x.name), nif: nif(x.tax_id) })),
    bancos: ((b.data ?? []) as Fila[]).map((x) => ({ id: String(x.id), name: String(x.name), iban: iban(x.iban) })),
  }
}

/** «Guardar y seguir luego»: guarda la lectura y lo decidido. Devuelve el id de la importación. */
export const guardarImportacion = (companyId: string, programa: Programa, ficheros: string[], huella: string, revision: Record<string, unknown>, quien: string | null) =>
  rpc<string>('company_chart_import_save', { p_company: companyId, p_program: programa, p_file_names: ficheros, p_sha: huella, p_review: revision, p_quien_nombre: quien })

export const tirarImportacion = (id: string) => rpc<void>('company_chart_import_discard', { p_import: id })

export interface ResultadoTraer { importacion: string; serie: number; cuentas: number; fichas: number; enlaces: number; subcuentas: number; avisos: string[] }

/** Traer el plan: importar y activar en un paso, en la base, todo o nada. */
export const traerPlan = (id: string, plan: PlanTraer, quien: string | null) =>
  rpc<ResultadoTraer>('company_chart_import_apply', { p_import: id, p_plan: plan, p_quien_nombre: quien })

/** Deshacer entero: el plan vuelve a «sin activar» y se van las fichas nuevas (si nadie las ha usado). */
export const deshacerImportacion = (id: string, quien: string | null) =>
  rpc<{ cuentas: number; fichas: number }>('company_chart_import_undo', { p_import: id, p_quien_nombre: quien })

/** La huella (sha-256) de los ficheros, en el orden en que se dieron: el mismo fichero da la misma. */
export async function huellaDe(ficheros: readonly ArrayBuffer[]): Promise<string> {
  const total = ficheros.reduce((s, f) => s + f.byteLength, 0)
  const junto = new Uint8Array(total)
  let at = 0
  for (const f of ficheros) { junto.set(new Uint8Array(f), at); at += f.byteLength }
  const h = await crypto.subtle.digest('SHA-256', junto)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
