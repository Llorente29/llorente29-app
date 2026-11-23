// src/modules/conta/nucleo/conciliar/servicio.ts
//
// X29 · Lo que lee y escribe «Conciliar» (Gestión de extractos bancarios). Lo del banco y conciliar es lo de siempre
// (bancosPantallas, nucleo/bancos, nucleo/tesoreria); lo nuevo:
//   · las líneas del banco con lo de antes del inicio y lo validado (before_cutover, validated_at, 1712);
//   · de cada banco: cuántas desde el inicio, cuántas contabilizadas y cuántas pendientes (para su tarjeta);
//   · lo que Sumied ha conciliado solo hoy (bank_match de Folvy de hoy, Madrid), por qué y de cuántos bancos;
//   · validar, quitar la validación y borrar líneas (1712);
//   · el panel «Casar con facturas», plegado o no, de cada persona (conta_user_pref.casar_plegado, 1712).
// Todo con su empresa y su cuenta (regla 9).

import { tabla, mensaje, rpc } from '@/modules/conta/services/bd'
import { leerMovimientosEntre, type BancoVista } from '@/modules/conta/services/bancosPantallas'
import { asientosDeTesoreria, type AsientoDeTesoreria } from '../tesoreria/servicio'
import { subcuentaDeFila } from '../tesoreria/tesoreria'
import { saldoDelExtracto } from '../bancos/servicio'
import type { HechoHoy, Linea } from './conciliar'

type Fila = Record<string, unknown>

export interface LecturaBanco { lineas: Linea[]; asientos: Record<string, AsientoDeTesoreria>; base: { cent: number; fecha: string } | null; antesFuera: number }

/**
 * Las líneas de un banco entre dos fechas, del más antigua a la más nueva, con su asiento y el saldo del banco a la última
 * fecha que lo trae. `antesFuera`: cuántas de antes del inicio quedan fuera del rango (para el pie).
 */
export async function leerBanco(accountId: string, companyId: string, banco: BancoVista, desde: string, hasta: string, inicio: string | null): Promise<LecturaBanco> {
  const [movs, saldo, antes] = await Promise.all([
    leerMovimientosEntre(accountId, banco.id, desde, hasta, true, true),
    saldoDelExtracto(banco.id, hasta),
    contar(tabla('bank_movement').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('treasury_account_id', banco.id)
      .or(`before_cutover.eq.true${inicio ? `,op_date.lt.${inicio}` : ''}`).lt('op_date', desde)),
  ])
  const asientos = await asientosDeTesoreria(companyId, movs.map((m) => m.casado?.asientoId).filter((x): x is string => !!x), banco.cuenta)
  const lineas: Linea[] = movs.map((m) => {
    const a = m.casado?.asientoId ? asientos[m.casado.asientoId] ?? null : null
    return { m, antes: !!m.antesDelInicio || (!!inicio && m.fecha < inicio), validado: !!m.validado, subcuenta: subcuentaDeFila(m, banco.cuenta, a?.cuenta ?? null).codigo }
  })
  return { lineas, asientos, base: saldo ? { cent: saldo.saldoCent, fecha: saldo.hasta } : null, antesFuera: antes }
}

async function contar(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await q
  if (error) throw new Error(mensaje('No se ha podido contar', error as Parameters<typeof mensaje>[1]))
  return count ?? 0
}

/** De cada banco: desde el inicio, cuántas hay, cuántas están contabilizadas y cuántas pendientes (la tarjeta de la izquierda). */
export interface CuentaBanco { total: number; contabilizadas: number; pendientes: number }

export async function cuentasDeLosBancos(accountId: string, bancos: readonly BancoVista[], inicio: string | null): Promise<Record<string, CuentaBanco>> {
  const out: Record<string, CuentaBanco> = {}
  await Promise.all(bancos.map(async (b) => {
    const base = () => {
      let q = tabla('bank_movement').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('treasury_account_id', b.id).eq('before_cutover', false)
      if (inicio) q = q.gte('op_date', inicio)
      return q
    }
    const [total, casadas, apartadas] = await Promise.all([contar(base()), contar(base().eq('status', 'casado')), contar(base().eq('status', 'ignorado'))])
    out[b.id] = { total, contabilizadas: casadas, pendientes: total - casadas - apartadas }
  }))
  return out
}

/** Lo que Sumied ha conciliado solo hoy (Madrid) en la empresa: los casados de Folvy vivos de hoy, por qué. */
export async function hechoHoy(companyId: string, hoy: string): Promise<HechoHoy & { movimientos: string[] }> {
  const { data, error } = await tabla('bank_match').select('movement_id, kind, rule_id, reason, bank_movement:movement_id(treasury_account_id)')
    .eq('company_id', companyId).eq('by_who', 'folvy').eq('status', 'vivo').gte('created_at', `${hoy}T00:00:00+01:00`)
  if (error) throw new Error(mensaje('No se ha podido leer lo conciliado hoy', error))
  const filas = (data ?? []) as unknown as (Fila & { bank_movement: { treasury_account_id: string } | null })[]
  const h = { n: filas.length, bancos: new Set(filas.map((f) => f.bank_movement?.treasury_account_id)).size, regla: 0, factura: 0, memoria: 0, otros: 0, movimientos: filas.map((f) => String(f.movement_id)) }
  for (const f of filas) {
    const k = String(f.kind ?? '')
    if (f.rule_id) h.regla++
    else if (k === 'factura_recibida' || k === 'factura_emitida' || k === 'liquidacion') h.factura++
    else if (/anterior|veces/i.test(String(f.reason ?? ''))) h.memoria++
    else h.otros++
  }
  return h
}

/** Validar (revisado) las marcadas. Devuelve la frase de la base. */
export async function validar(ids: readonly string[], quien: string | null): Promise<string> {
  const r = await rpc<Fila>('bank_validar', { p_movimientos: ids, p_quien_nombre: quien })
  return String(r.texto ?? 'Validados.')
}

export async function quitarValidacion(ids: readonly string[]): Promise<string> {
  const r = await rpc<Fila>('bank_quitar_validacion', { p_movimientos: ids })
  return String(r.texto ?? 'Quitada la validación.')
}

/** Borrar líneas sin contabilizar: no vuelven al leer el banco ni al subir el extracto. Devuelve la frase de la base. */
export async function borrarLineas(ids: readonly string[], quien: string | null): Promise<string> {
  const r = await rpc<Fila>('bank_movimientos_borrar', { p_movimientos: ids, p_quien_nombre: quien })
  return String(r.texto ?? 'Borradas.')
}

/** El panel «Casar con facturas», plegado o no, de esta persona (sin valor, desplegado). */
export async function leerPlegado(accountId: string, userId: string): Promise<boolean> {
  const { data, error } = await tabla('conta_user_pref').select('casar_plegado').eq('account_id', accountId).eq('user_id', userId).maybeSingle()
  if (error) return false
  return (data as { casar_plegado: boolean | null } | null)?.casar_plegado === true
}

export async function guardarPlegado(accountId: string, userId: string, plegado: boolean): Promise<void> {
  const { error } = await tabla('conta_user_pref').upsert({ account_id: accountId, user_id: userId, casar_plegado: plegado }, { onConflict: 'account_id,user_id' })
  if (error) throw new Error(mensaje('No se ha podido guardar el panel', error))
}
