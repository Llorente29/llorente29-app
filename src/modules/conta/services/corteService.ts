// src/modules/conta/services/corteService.ts
//
// C04 R4 · La fecha de corte con el programa anterior, como dato de la
// empresa: hasta ese día manda lo traído; desde el siguiente asienta Folvy.
// Se fija con conta_fijar_corte (solo administrador; cierra como «traídos» los
// meses enteros de antes). Cambiable mientras no haya asientos traídos: lo
// guarda el disparador fiscal_year_corte_cambiable, y aquí se dice antes.
//
// Todo por cuenta y empresa (regla 9).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'

export interface CorteEmpresa {
  /** El ejercicio que contiene el corte, o el más reciente traído/mixto. */
  ejercicio: string | null
  hasta: string | null
  programa: string | null
  /** Asientos traídos del programa anterior: con alguno, el corte ya no cambia. */
  traidos: number
}

export async function leerCorte(accountId: string, companyId: string): Promise<CorteEmpresa> {
  const [ej, tr] = await Promise.all([
    tabla('fiscal_year').select('code, starts_on, ends_on, origin, origin_program, imported_until')
      .eq('account_id', accountId).eq('company_id', companyId).order('starts_on', { ascending: false }),
    tabla('journal_entry').select('id', { count: 'exact', head: true })
      .eq('account_id', accountId).eq('company_id', companyId).eq('source_type', 'migrated'),
  ])
  if (ej.error) throw new Error(mensaje('No se ha podido leer el ejercicio', ej.error))
  if (tr.error) throw new Error(mensaje('No se han podido contar los asientos traídos', tr.error))
  const filas = (ej.data ?? []) as Record<string, unknown>[]
  // El mixto lleva la fecha; si todo un ejercicio es traído, el corte es su último día.
  const mixto = filas.find((f) => f.origin === 'mixed' && f.imported_until)
  const traido = filas.find((f) => f.origin === 'migrated')
  const f = mixto ?? traido ?? null
  return {
    ejercicio: f ? String(f.code) : null,
    hasta: mixto ? String(mixto.imported_until) : traido ? String(traido.ends_on) : null,
    programa: f?.origin_program ? String(f.origin_program) : null,
    traidos: tr.count ?? 0,
  }
}

/** Fija (o quita, con hasta = null) la fecha de corte. Devuelve cuántos meses ha cerrado como traídos. */
export async function fijarCorte(companyId: string, hasta: string | null, programa: string): Promise<number> {
  const r = (await rpc('conta_fijar_corte', { p_company: companyId, p_hasta: hasta, p_programa: programa })) as { meses_cerrados?: number } | null
  return Number(r?.meses_cerrados ?? 0)
}

/** El primer día con ventas en Folvy de la cuenta (fecha de Madrid), o null. */
export async function primeraVenta(accountId: string): Promise<string | null> {
  const { data, error } = await tabla('sale').select('sold_at').eq('account_id', accountId).order('sold_at', { ascending: true }).limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer la primera venta', error))
  const v = (data as { sold_at: string }[] | null)?.[0]?.sold_at
  return v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(v)) : null
}
