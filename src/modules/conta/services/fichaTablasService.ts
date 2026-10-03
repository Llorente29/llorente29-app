// src/modules/conta/services/fichaTablasService.ts
//
// C00, tarea 7: lo que la ficha de proveedor del C01 lee de las tablas
// generales del C00 (IVA, retención, forma y plazo de pago) y los tipos de
// gasto con sus dos formas de ocultarlos unificadas. Las reglas, en
// ../lib/opcionesFicha.ts (puras).
//
// De qué empresa: el proveedor es de la CUENTA y las tablas son de la
// EMPRESA (sus filas propias, lo que ocultó, su territorio). Se toma la
// empresa elegida en contabilidad (la misma que recuerda el menú del módulo)
// o la primera. Si la cuenta aún no tiene empresa, salen las filas de serie
// de la península: lo mismo que ofrecía el C01, ahora con su fuente.
//
// Regla 9: todo lo que no es de serie se filtra por la cuenta, aunque la RLS
// ya lo haga. Regla 40, nombres entre comillas comprobados contra las
// migraciones 20261002T0100 (C01) y 20261003T0110/0120 (C00): company,
// company_tax_profile.tax_territory, tax_rate, withholding_rate,
// payment_method, payment_term, general_row_setting, expense_category,
// expense_category_hidden.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { listarEmpresas } from '@/modules/conta/services/empresaService'
import { claveEmpresaElegida, empresaQueQuedaActiva } from '@/modules/conta/empresa/contexto'
import {
  construirOpciones, tipoGastoOculto,
  type FilasFicha, type OpcionesFicha, type Territorio,
} from '@/modules/conta/lib/opcionesFicha'

type Fila = Record<string, unknown>
const TERRITORIOS: readonly Territorio[] = ['peninsula_baleares', 'canarias', 'ceuta_melilla']

function recordada(accountId: string): string | null {
  try { return window.localStorage.getItem(claveEmpresaElegida(accountId)) } catch { return null }
}

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

/** La empresa de la que la ficha toma las tablas, o null si la cuenta aún no tiene. */
export async function empresaDeLaFicha(accountId: string): Promise<{ id: string; nombre: string } | null> {
  const e = empresaQueQuedaActiva(await listarEmpresas(accountId), recordada(accountId))
  return e ? { id: e.id, nombre: e.nombre } : null
}

/** Filas de serie y, si hay empresa, las propias de la cuenta que sean de toda la cuenta o de esa empresa. */
function deLaCuenta(t: string, columnas: string, accountId: string, companyId: string | null) {
  const q = tabla(t).select(columnas)
  return companyId
    ? q.or(`is_system.eq.true,and(account_id.eq.${accountId},or(company_id.is.null,company_id.eq.${companyId}))`)
    : q.eq('is_system', true)
}

export async function leerOpcionesFicha(accountId: string, hoy: string): Promise<OpcionesFicha> {
  const empresa = await empresaDeLaFicha(accountId)
  const cid = empresa?.id ?? null
  const [imp, ret, pm, pt, ajustes, perfil] = await Promise.all([
    leer(deLaCuenta('tax_rate', 'id, name, tax_system, territory, treatment, rate, valid_from, valid_to, sort_order', accountId, cid), 'los impuestos'),
    leer(deLaCuenta('withholding_rate', 'id, name, rate, valid_from, valid_to, sort_order', accountId, cid), 'las retenciones'),
    leer(deLaCuenta('payment_method', 'id, name, kind, sort_order', accountId, cid), 'las formas de pago'),
    leer(deLaCuenta('payment_term', 'id, name, days, fixed_days, sort_order', accountId, cid), 'los plazos de pago'),
    cid
      ? leer(tabla('general_row_setting').select('row_id').eq('account_id', accountId).eq('company_id', cid).eq('hidden', true)
        .in('table_key', ['tax_rate', 'withholding_rate', 'payment_method', 'payment_term']), 'lo que has ocultado')
      : Promise.resolve([] as Fila[]),
    cid
      ? leer(tabla('company_tax_profile').select('tax_territory').eq('account_id', accountId).eq('company_id', cid), 'dónde está tu empresa')
      : Promise.resolve([] as Fila[]),
  ])
  const t = perfil[0]?.tax_territory
  const territorio: Territorio = TERRITORIOS.includes(t as Territorio) ? t as Territorio : 'peninsula_baleares'
  const n = (v: unknown) => Number(v)
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
  const filas: FilasFicha = {
    impuestos: imp.map((r) => ({
      id: String(r.id), name: String(r.name), taxSystem: String(r.tax_system), territory: String(r.territory), treatment: String(r.treatment),
      rate: n(r.rate), validFrom: String(r.valid_from), validTo: s(r.valid_to), sortOrder: n(r.sort_order),
    })),
    retenciones: ret.map((r) => ({ id: String(r.id), name: String(r.name), rate: n(r.rate), validFrom: String(r.valid_from), validTo: s(r.valid_to), sortOrder: n(r.sort_order) })),
    formasPago: pm.map((r) => ({ id: String(r.id), name: String(r.name), kind: String(r.kind), sortOrder: n(r.sort_order) })),
    plazos: pt.map((r) => ({
      id: String(r.id), name: String(r.name), sortOrder: n(r.sort_order),
      days: Array.isArray(r.days) ? r.days.map(Number) : [], fixedDays: Array.isArray(r.fixed_days) ? r.fixed_days.map(Number) : [],
    })),
  }
  return construirOpciones(filas, new Set(ajustes.map((a) => String(a.row_id))), territorio, hoy, empresa)
}

// ── Tipos de gasto: una sola forma de saber si están ocultos ────────────────

/** Qué tipos de gasto están ocultos para esta cuenta y su empresa (ver tipoGastoOculto). */
export async function tiposGastoOcultos(accountId: string, companyId: string | null, ids: readonly string[]): Promise<Set<string>> {
  const [cuenta, empresa] = await Promise.all([
    leer(tabla('expense_category_hidden').select('expense_category_id').eq('account_id', accountId), 'los tipos de gasto ocultos'),
    companyId
      ? leer(tabla('general_row_setting').select('row_id, hidden').eq('account_id', accountId).eq('company_id', companyId).eq('table_key', 'expense_category'), 'los tipos de gasto ocultos')
      : Promise.resolve([] as Fila[]),
  ])
  const deCuenta = new Set(cuenta.map((c) => String(c.expense_category_id)))
  const deEmpresa = new Map(empresa.map((a) => [String(a.row_id), a.hidden === true]))
  return new Set(ids.filter((id) => tipoGastoOculto(id, deEmpresa, deCuenta)))
}

/**
 * Oculta o vuelve a enseñar un tipo de gasto. Con empresa, en sus ajustes
 * (lo mismo que hace «Tablas generales», y manda sobre lo de la cuenta); sin
 * empresa, en la lista de la cuenta del C01. Solo toca `hidden`: las cuentas
 * que la empresa hubiera cambiado se quedan como estaban.
 */
export async function ocultarTipoGastoUnificado(accountId: string, companyId: string | null, expenseCategoryId: string,
  ocultar: boolean, actorId: string | null): Promise<void> {
  if (companyId) {
    const { error } = await tabla('general_row_setting').upsert({
      account_id: accountId, company_id: companyId, table_key: 'expense_category', row_id: expenseCategoryId,
      hidden: ocultar, updated_at: new Date().toISOString(), updated_by: actorId,
    }, { onConflict: 'company_id,table_key,row_id' })
    if (error) throw new Error(mensaje('No se pudo cambiar la lista de tipos de gasto', error))
    return
  }
  const { error } = ocultar
    ? await tabla('expense_category_hidden').insert({ account_id: accountId, expense_category_id: expenseCategoryId, created_by: actorId })
    : await tabla('expense_category_hidden').delete().eq('account_id', accountId).eq('expense_category_id', expenseCategoryId)
  if (error && (error as { code?: string }).code !== '23505') throw new Error(mensaje('No se pudo cambiar la lista de tipos de gasto', error))
}
