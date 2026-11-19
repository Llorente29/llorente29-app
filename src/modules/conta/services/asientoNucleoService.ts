// src/modules/conta/services/asientoNucleoService.ts
//
// N08 · Lo que lee la ficha del asiento del núcleo y la de hoy no tenía a mano. Guardar,
// validar y anular son los de hoy (diarioService: guardarAMano, validar, anular): aquí no.
//   · el mayor de una cuenta en el ejercicio (la pestaña «El mayor de la cuenta» de la maqueta);
//   · el asiento de antes y el de después (‹ ›), por fecha, serie y número.
// Todo por cuenta y empresa (regla 9). Nombres de la base entre comillas (regla 40), los de
// diarioService: journal_entry, journal_line.

import { tabla, mensaje } from '@/modules/conta/services/bd'

type Fila = Record<string, unknown>

export interface MovimientoMayor { entryId: string; fecha: string; serie: number; numero: number | null; concepto: string; debe: number; haber: number; saldo: number }

/** El mayor de una cuenta entre dos días, con su saldo arrastrado (sin los anulados ni los propuestos). */
export async function leerMayorDeCuenta(accountId: string, companyId: string, cuentaId: string, desde: string, hasta: string): Promise<MovimientoMayor[]> {
  const { data, error } = await tabla('journal_line')
    .select('debit, credit, concept, journal_entry!inner(id, entry_date, series, number, concept, status)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('company_account_id', cuentaId)
    .in('journal_entry.status', ['borrador', 'validado'])
    .gte('journal_entry.entry_date', desde).lte('journal_entry.entry_date', hasta)
  if (error) throw new Error(mensaje('No se ha podido leer el mayor de la cuenta', error))
  const filas = ((data ?? []) as Fila[]).map((l) => {
    const e = l.journal_entry as Fila
    return {
      entryId: String(e.id), fecha: String(e.entry_date), serie: Number(e.series), numero: e.number == null ? null : Number(e.number),
      concepto: String(l.concept ?? e.concept ?? ''), debe: Number(l.debit ?? 0), haber: Number(l.credit ?? 0),
    }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.serie - b.serie || (a.numero ?? 1e9) - (b.numero ?? 1e9))
  let saldo = 0
  return filas.map((f) => { saldo = Math.round((saldo + f.debe - f.haber) * 100) / 100; return { ...f, saldo } })
}

/** El asiento de antes y el de después de uno (o, sin ninguno, el último), por fecha, serie y número. */
export async function asientosDeAlLado(accountId: string, companyId: string, actual: { id: string; fecha: string } | null): Promise<{ antes: string | null; despues: string | null }> {
  const base = () => tabla('journal_entry').select('id, entry_date, series, number').eq('account_id', accountId).eq('company_id', companyId).neq('status', 'anulado')
  if (!actual) {
    const { data, error } = await base().order('entry_date', { ascending: false }).order('series', { ascending: false }).order('number', { ascending: false }).limit(1)
    if (error) throw new Error(mensaje('No se ha podido leer el último asiento', error))
    return { antes: ((data ?? []) as Fila[])[0] ? String(((data ?? []) as Fila[])[0].id) : null, despues: null }
  }
  // Los del mismo día y los de al lado; se ordenan aquí (el mismo día, por serie y número).
  const [a, d] = await Promise.all([
    base().lte('entry_date', actual.fecha).order('entry_date', { ascending: false }).limit(50),
    base().gte('entry_date', actual.fecha).order('entry_date', { ascending: true }).limit(50),
  ])
  if (a.error || d.error) throw new Error(mensaje('No se han podido leer los asientos de al lado', (a.error ?? d.error)!))
  const todos = [...new Map([...(a.data ?? []), ...(d.data ?? [])].map((f) => [String((f as Fila).id), f as Fila])).values()]
    .sort((x, y) => String(x.entry_date).localeCompare(String(y.entry_date)) || Number(x.series) - Number(y.series) || Number(x.number ?? 1e9) - Number(y.number ?? 1e9))
  const i = todos.findIndex((f) => String(f.id) === actual.id)
  return { antes: i > 0 ? String(todos[i - 1].id) : null, despues: i >= 0 && i < todos.length - 1 ? String(todos[i + 1].id) : null }
}
