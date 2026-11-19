// src/modules/conta/nucleo/bancos/servicio.ts
//
// E05 · Lo que lee la pantalla de Bancos del núcleo. Todo es lo de hoy, por
// dentro (services/bancosPantallas, lib/conciliarVista), con la MISMA regla que
// bancos/Movimientos.tsx para el cuadre: el saldo del último extracto del mes
// contra el de la 572 a la fecha de corte (puntoDePartida, cuadreDe). Lo único
// nuevo que se lee es lo que la pantalla de hoy no pinta:
//   · la cuenta de «A qué va» de lo ya casado: las líneas de su asiento
//     (journal_line, de esa empresa y esa cuenta, regla 9);
//   · el justificante del movimiento: su URL firmada (bucket banco-tickets, el
//     mismo donde lo sube subirTicket).

import { supabase } from '@/lib/supabase'
import { tabla, mensaje } from '@/modules/conta/services/bd'
import { leerDatosBancos, leerMovimientos, saldosContables, type BancoVista, type DatosBancos } from '@/modules/conta/services/bancosPantallas'
import { cuadreDe, puntoDePartida, type Cuadre } from '@/modules/conta/lib/conciliarVista'
import { mesesElegibles, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { mesInicial } from '@/modules/conta/bancos/navegacion'
import { corteDelMes, extractoDelMes } from './mes'

export interface LecturaBancos {
  movs: MovimientoBanco[]
  cuadre: Cuadre
  /** La fecha del saldo del banco que se compara: la del último extracto del mes con saldo. */
  extractoHasta: string | null
  /** «A qué va» de lo casado: la cuenta de su asiento que no es la del banco, por id de asiento. */
  delAsiento: Record<string, string>
}

const dia = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/**
 * El libro y el banco que se comparan, con la regla de la pantalla de hoy: la
 * 572 a la fecha de corte (el fin del mes o hoy), desde el saldo del extracto a
 * la víspera de la fecha de corte de los bancos si la hay (puntoDePartida); y el
 * saldo del último extracto del mes que lo trae.
 */
export async function saldosDelCuadre(companyId: string, datos: DatosBancos, banco: BancoVista, mes: string, hoy: string):
  Promise<{ bancoCent: number | null; libroCent: number | null; extractoHasta: string | null }> {
  const corte = corteDelMes(mes, hoy)
  const fechaCorte = datos.corte
  const vispera = fechaCorte ? dia(fechaCorte, -1) : null
  const cuentas = banco.cuenta ? [banco.cuenta] : []
  const [saldos, antes] = await Promise.all([
    saldosContables(companyId, corte, cuentas),
    vispera && corte >= (fechaCorte ?? '') ? saldosContables(companyId, vispera, cuentas) : Promise.resolve(null),
  ])
  const libroCent = banco.cuenta ? saldos[banco.cuenta] ?? 0 : null
  const libroAntesCent = banco.cuenta && antes ? antes[banco.cuenta] ?? 0 : null
  const extractos = datos.extractos.filter((e) => e.cuentaId === banco.id)
  const extracto = extractoDelMes(extractos, banco.id, mes)
  const partida = puntoDePartida(fechaCorte, corte, extractos, libroAntesCent, libroCent)
  return { bancoCent: extracto?.saldoFinalCent ?? null, libroCent: partida.libroCent, extractoHasta: extracto?.hasta ?? null }
}

/** Los movimientos del banco en el mes y su cuadre, con la misma regla que la pantalla de hoy. */
export async function leerBancos(accountId: string, companyId: string, datos: DatosBancos, banco: BancoVista, mes: string, hoy: string): Promise<LecturaBancos> {
  const [movs, saldos] = await Promise.all([leerMovimientos(accountId, banco.id, mes), saldosDelCuadre(companyId, datos, banco, mes, hoy)])
  const cuadre = cuadreDe(movs, saldos.bancoCent, saldos.libroCent, mes)
  const delAsiento = await cuentasDeLosAsientos(companyId, movs.map((m) => m.casado?.asientoId).filter((x): x is string => !!x), banco.cuenta)
  return { movs, cuadre, extractoHasta: saldos.extractoHasta, delAsiento }
}

/**
 * «Bancos cuadrados» (la línea de estado): cada banco con su 572 y un extracto
 * con saldo, en el mes con el que se abre (mesInicial, el de su último
 * extracto), con la MISMA regla que la cabecera de la pantalla (saldosDelCuadre).
 * Los que no tienen extracto con saldo no se cuentan: no se sabe.
 */
export async function bancosCuadrados(accountId: string, companyId: string, hoy: string): Promise<{ cuadran: number; de: number }> {
  const datos = await leerDatosBancos(accountId, companyId)
  const meses = mesesElegibles(datos.primerMovimiento, hoy)
  const r = await Promise.all(datos.bancos.filter((b) => b.cuenta && b.ultimoExtracto).map((b) => saldosDelCuadre(companyId, datos, b, mesInicial(meses, b, hoy), hoy)))
  const sabidos = r.filter((x) => x.bancoCent !== null && x.libroCent !== null)
  return { cuadran: sabidos.filter((x) => x.bancoCent === x.libroCent).length, de: sabidos.length }
}

/** De cada asiento, la cuenta que no es la del banco (la primera, por posición). */
export async function cuentasDeLosAsientos(companyId: string, ids: readonly string[], cuenta572: string | null): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const { data, error } = await tabla('journal_line')
    .select('entry_id, position, company_account:company_account_id(code)')
    .eq('company_id', companyId)
    .in('entry_id', [...new Set(ids)])
    .order('position')
  if (error) throw new Error(mensaje('No se han podido leer los asientos de lo casado', error as Parameters<typeof mensaje>[1]))
  const fuera: Record<string, string> = {}
  for (const l of (data ?? []) as unknown as { entry_id: string; company_account: { code: string } | null }[]) {
    const c = l.company_account?.code
    if (c && c !== cuenta572 && !fuera[l.entry_id]) fuera[l.entry_id] = c
  }
  return fuera
}

/** El saldo de la 572 a una fecha (el «Saldo de la cuenta a la fecha» de ERP10), en céntimos. */
export async function saldoALaFecha(companyId: string, cuenta: string, fecha: string): Promise<number> {
  const s = await saldosContables(companyId, fecha, [cuenta])
  return s[cuenta] ?? 0
}

/** El justificante del movimiento, para verlo: su URL firmada por una hora. null si no tiene. */
export async function urlDelJustificante(ruta: string | null): Promise<string | null> {
  if (!ruta || !supabase) return null
  const { data, error } = await supabase.storage.from('banco-tickets').createSignedUrl(ruta, 3600)
  if (error) throw new Error(`No se ha podido abrir el justificante: ${error.message}`)
  return data?.signedUrl ?? null
}
