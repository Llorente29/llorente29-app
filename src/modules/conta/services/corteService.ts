// src/modules/conta/services/corteService.ts
//
// C04 R4 · La fecha de corte con el programa anterior, como dato de la
// empresa: hasta ese día manda lo traído; desde el siguiente asienta Folvy.
// Se fija con conta_fijar_corte (solo administrador; cierra como «traídos» los
// meses enteros de antes). X14 · 2: lo fija una persona, a mano, nunca lo traído;
// con asientos traídos también, si todos quedan antes del día de inicio (lo
// guardan la base y el disparador fiscal_year_corte_cambiable; aquí se dice antes).
//
// Todo por cuenta y empresa (regla 9).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'

export interface CorteEmpresa {
  /** El ejercicio que contiene el corte, o el más reciente traído/mixto. */
  ejercicio: string | null
  hasta: string | null
  programa: string | null
  /** Asientos traídos del programa anterior. */
  traidos: number
  /** X14 · 2 · El día del último asiento traído: el día de inicio, como pronto, el siguiente. Nulo sin traídos. */
  ultimoTraido: string | null
  /** N05c · Lo anterior al corte ya está traído (history_imported_at). Sin corte, true. */
  historicoTraido: boolean
  /** N05c · «Empezar a trabajar ya» sin lo anterior: cuándo y quién. Nulo si no se ha decidido. */
  sinHistorico: { el: string; por: string | null } | null
  /**
   * N06a · El día de inicio, LEÍDO DE LA BASE (conta_dia_de_inicio, la misma que usan la carga y
   * las paradas), no calculado aquí: cuenta también el corte de Bancos (respuesta N05c · 1).
   */
  diaDeInicio: string | null
}

/**
 * N05c · El nombre del programa de antes, como en el N03: «ERP10», «Diez» o, con otro
 * o sin programa, nulo («el programa de antes»). Así ya no se ve «erp10» en minúsculas.
 */
export function nombrePrograma(programa: string | null | undefined): string | null {
  switch ((programa ?? '').trim().toLowerCase()) {
    case 'erp10': return 'ERP10'
    case 'diez': return 'Diez'
    default: return null
  }
}

export async function leerCorte(accountId: string, companyId: string): Promise<CorteEmpresa> {
  const [ej, tr, ult, di] = await Promise.all([
    tabla('fiscal_year').select('code, starts_on, ends_on, origin, origin_program, imported_until, history_imported_at, works_without_history_at, works_without_history_by_name')
      .eq('account_id', accountId).eq('company_id', companyId).order('starts_on', { ascending: false }),
    tabla('journal_entry').select('id', { count: 'exact', head: true })
      .eq('account_id', accountId).eq('company_id', companyId).eq('source_type', 'migrated'),
    tabla('journal_entry').select('entry_date')
      .eq('account_id', accountId).eq('company_id', companyId).eq('source_type', 'migrated').order('entry_date', { ascending: false }).limit(1),
    rpc<string | null>('conta_empresa_dia_de_inicio', { p_company: companyId }),
  ])
  if (ej.error) throw new Error(mensaje('No se ha podido leer el ejercicio', ej.error))
  if (tr.error) throw new Error(mensaje('No se han podido contar los asientos traídos', tr.error))
  if (ult.error) throw new Error(mensaje('No se ha podido leer el último asiento traído', ult.error))
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
    ultimoTraido: ((ult.data ?? []) as { entry_date?: string }[])[0]?.entry_date ?? null,
    historicoTraido: !f || !f.origin_program || f.history_imported_at != null,
    sinHistorico: f?.works_without_history_at
      ? { el: String(f.works_without_history_at), por: f.works_without_history_by_name ? String(f.works_without_history_by_name) : null }
      : null,
    diaDeInicio: typeof di === 'string' && di ? di : null,
  }
}

/** N05c · «Empezar a trabajar ya»: se contabiliza desde el día de inicio sin lo anterior. Devuelve el texto de la base (regla 8). */
export async function empezarSinHistorico(companyId: string, ejercicio: string, quien: string | null): Promise<string> {
  const r = (await rpc('conta_trabajar_sin_historico', { p_company: companyId, p_ejercicio: ejercicio, p_quien_nombre: quien })) as { texto?: string } | null
  return r?.texto ?? 'Hecho.'
}

/** Fija (o quita, con hasta = null) la fecha de corte. Devuelve cuántos meses ha cerrado como traídos. */
export async function fijarCorte(companyId: string, hasta: string | null, programa: string): Promise<number> {
  const r = (await rpc('conta_fijar_corte', { p_company: companyId, p_hasta: hasta, p_programa: programa })) as { meses_cerrados?: number } | null
  return Number(r?.meses_cerrados ?? 0)
}
