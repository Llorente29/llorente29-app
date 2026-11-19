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
// R08 (encargo R08, 3.3): el saldo del banco es el cierre del ÚLTIMO extracto de la cadena
// (bank_saldo_extracto: a igual fecha, el que llegó el último) y «Cuadra» cuenta solo lo que
// está en el diario (bank_saldo_diario: lo validado). Y lo que el banco no cobró se aparta
// (bank_apartar_no_cobrados), con su porqué en palabras.

import { supabase } from '@/lib/supabase'
import { tabla, mensaje, rpc } from '@/modules/conta/services/bd'
import { leerDatosBancos, leerMovimientos, type BancoVista, type DatosBancos, type Extracto } from '@/modules/conta/services/bancosPantallas'
import { cuadreDe, puntoDePartida, type Cuadre } from '@/modules/conta/lib/conciliarVista'
import { mesesElegibles, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { mesInicial } from '@/modules/conta/bancos/navegacion'
import { corteDelMes } from './mes'
import { cifra } from '../ficha/textos'
import { fechaVista } from '../ficha/teclas'

export interface LecturaBancos {
  movs: MovimientoBanco[]
  cuadre: Cuadre
  /** La fecha del saldo del banco que se compara: la del último extracto del mes con saldo. */
  extractoHasta: string | null
  /** R08 · Cuándo llegó ese extracto (la hora de «extracto de hoy, 13:17»). */
  extractoLlego: string | null
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
  Promise<{ bancoCent: number | null; libroCent: number | null; extractoHasta: string | null; extractoLlego: string | null }> {
  const corte = corteDelMes(mes, hoy)
  const fechaCorte = datos.corte
  const vispera = fechaCorte ? dia(fechaCorte, -1) : null
  const [extracto, libro, antes] = await Promise.all([
    saldoDelExtracto(banco.id, corte),
    banco.cuenta ? saldoDiario(companyId, corte, banco.cuenta) : Promise.resolve(null),
    banco.cuenta && vispera && corte >= (fechaCorte ?? '') ? saldoDiario(companyId, vispera, banco.cuenta) : Promise.resolve(null),
  ])
  const extractos = datos.extractos.filter((e) => e.cuentaId === banco.id)
  const partida = puntoDePartida(fechaCorte, corte, extractos, antes, libro)
  // Del mes: el último extracto que acaba dentro del mes (antes, ninguno: no se sabe).
  const delMes = extracto && extracto.hasta >= `${mes}-01` ? extracto : null
  return { bancoCent: delMes?.saldoCent ?? null, libroCent: partida.libroCent, extractoHasta: delMes?.hasta ?? null, extractoLlego: delMes?.llego ?? null }
}

/** R08 · El saldo del banco a una fecha: el cierre del último extracto de la cadena (bank_saldo_extracto). */
export async function saldoDelExtracto(bancoId: string, hasta: string): Promise<{ saldoCent: number; hasta: string; llego: string } | null> {
  const filas = await rpc<{ saldo: number | string; hasta: string; llego: string }[]>('bank_saldo_extracto', { p_treasury: bancoId, p_hasta: hasta })
  const f = filas?.[0]
  return f ? { saldoCent: Math.round(Number(f.saldo) * 100), hasta: String(f.hasta), llego: String(f.llego) } : null
}

/** R08 · El saldo de la cuenta a una fecha con lo que está en el diario (bank_saldo_diario: lo validado). */
export async function saldoDiario(companyId: string, hasta: string, cuenta: string): Promise<number> {
  const s = await rpc<number | string>('bank_saldo_diario', { p_company: companyId, p_hasta: hasta, p_cuenta: cuenta })
  return Math.round(Number(s ?? 0) * 100)
}

/** R08 · «extracto de hoy, 13:17» o «extracto del 16/11, 03:02». */
export function cuandoDelExtracto(hasta: string | null, llego: string | null, hoy: string): string {
  if (!hasta) return ''
  const hora = llego ? new Date(llego).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : ''
  return `extracto ${hasta === hoy ? 'de hoy' : `del ${fechaVista(hasta).slice(0, 5)}`}${hora ? `, ${hora}` : ''}`
}

/** R08 · Aparta lo que el banco no cobró (bank_apartar_no_cobrados). Devuelve lo apartado. */
export async function apartarNoCobrados(companyId: string): Promise<{ id: string; fecha: string; importeCent: number; concepto: string }[]> {
  const r = await rpc<{ id: string; fecha: string; importe: number | string; concepto: string }[]>('bank_apartar_no_cobrados', { p_company: companyId })
  return (r ?? []).map((x) => ({ id: String(x.id), fecha: String(x.fecha), importeCent: Math.round(Number(x.importe) * 100), concepto: String(x.concepto ?? '') }))
}

/** R08 · Lo que se dice al apartar solo: «Apartado: el banco no cobró Recibo Telefonía Ejemplo, 31,50, del 12/11.» */
export function textoApartados(xs: readonly { fecha: string; importeCent: number; concepto: string }[]): string | null {
  if (xs.length === 0) return null
  const uno = (x: { fecha: string; importeCent: number; concepto: string }) => `${x.concepto}, ${cifra(Math.abs(x.importeCent) / 100)}, del ${fechaVista(x.fecha).slice(0, 5)}`
  return xs.length === 1 ? `Apartado: el banco no cobró ${uno(xs[0])}. El saldo del extracto lo delata.` : `Apartados ${xs.length} que el banco no cobró: ${xs.map(uno).join(' · ')}. El saldo de los extractos lo delata.`
}

/**
 * R08 · Por qué está apartado, en palabras. Si lo apartó el banco («Anulado por el banco»), con el
 * salto de saldo que lo delata: el cierre del extracto anterior de la cadena y la apertura del suyo.
 */
export async function porQueApartado(m: MovimientoBanco, extractos: readonly Extracto[]): Promise<{ titulo: string; detalle: string | null }> {
  const motivo = (m.motivoIgnorado ?? '').trim()
  if (!/^Anulado por el banco/i.test(motivo)) return { titulo: `Apartado: ${motivo || 'sin motivo'}.`, detalle: null }
  const titulo = 'Apartado: el banco no cobró este recibo.'
  const { data } = await tabla('bank_movement').select('statement_id').eq('id', m.id).maybeSingle()
  const suyo = extractos.find((e) => e.id === (data as { statement_id: string | null } | null)?.statement_id)
  if (!suyo) return { titulo, detalle: 'No hay saldo para pagarlo: si tenía factura, sigue pendiente.' }
  const cadena = extractos.filter((e) => e.cuentaId === suyo.cuentaId && e.saldoFinalCent !== null)
    .sort((a, b) => a.hasta.localeCompare(b.hasta) || a.subido.localeCompare(b.subido) || a.id.localeCompare(b.id))
  const anterior = cadena[cadena.findIndex((e) => e.id === suyo.id) - 1]
  if (!anterior || suyo.saldoInicialCent === null) return { titulo, detalle: 'No hay saldo para pagarlo: si tenía factura, sigue pendiente.' }
  const cuando = anterior.hasta === dia(suyo.desde, -1) ? 'El día antes' : `El ${fechaVista(anterior.hasta).slice(0, 5)}`
  return { titulo, detalle: `${cuando} la cuenta cerró en ${cifra(anterior.saldoFinalCent! / 100)} y este extracto abre en ${cifra(suyo.saldoInicialCent / 100)} sin ninguna línea que lo explique. No hay saldo para pagarlo: si tenía factura, sigue pendiente.` }
}

/** Los movimientos del banco en el mes y su cuadre, con la misma regla que la pantalla de hoy. */
export async function leerBancos(accountId: string, companyId: string, datos: DatosBancos, banco: BancoVista, mes: string, hoy: string): Promise<LecturaBancos> {
  const [movs, saldos] = await Promise.all([leerMovimientos(accountId, banco.id, mes), saldosDelCuadre(companyId, datos, banco, mes, hoy)])
  const cuadre = cuadreDe(movs, saldos.bancoCent, saldos.libroCent, mes)
  const delAsiento = await cuentasDeLosAsientos(companyId, movs.map((m) => m.casado?.asientoId).filter((x): x is string => !!x), banco.cuenta)
  return { movs, cuadre, extractoHasta: saldos.extractoHasta, extractoLlego: saldos.extractoLlego, delAsiento }
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

/** El saldo de la 572 a una fecha (el «Saldo de la cuenta a la fecha» de ERP10), en céntimos: lo del diario (R08). */
export const saldoALaFecha = (companyId: string, cuenta: string, fecha: string): Promise<number> => saldoDiario(companyId, fecha, cuenta)

/** El justificante del movimiento, para verlo: su URL firmada por una hora. null si no tiene. */
export async function urlDelJustificante(ruta: string | null): Promise<string | null> {
  if (!ruta || !supabase) return null
  const { data, error } = await supabase.storage.from('banco-tickets').createSignedUrl(ruta, 3600)
  if (error) throw new Error(`No se ha podido abrir el justificante: ${error.message}`)
  return data?.signedUrl ?? null
}
