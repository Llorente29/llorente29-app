// src/modules/conta/gestoria/g05/datos.ts
//
// G05 · Tarea 4 · Lo que lee y hace «Revisar el cobro».
//   · Leer: UNA llamada, ya agregada en la base (conta_pantalla_cobro, 1006):
//     el mes, los ajustes, la conexión y los recibos (regla de Julio: toda
//     pantalla abre en menos de 1 s, con una sola lectura).
//   · Preparar y enviar: la función conta-cobro (el servidor calcula los
//     recibos con los núcleos y manda a GoCardless, solo con una conexión de
//     pruebas). Lo que se cobra nunca sale del navegador.
//   · Decidir: «Aprobar» / «Este mes no» (conta_cobro_decidir) y «Aprobar los
//     N» iguales (conta_cobro_aprobar_iguales). Cada una devuelve su frase.

import { rpc } from '@/modules/conta/services/bd'
import { supabase } from '@/lib/supabase'
import type { DatosCobro } from './modeloCobro'
import type { DatosFichaRecibo } from './modeloFicha'
import type { AsientoPago, DatosStripe, Envio, EstadoCuenta, MotivoCuenta, PagoApuntado, PagoTarjeta } from './modeloStripe'

type Fila = Record<string, unknown>

export async function leerCobro(cuenta: string, empresa: string, mes: string): Promise<DatosCobro> {
  const d = (await rpc<Fila | null>('conta_pantalla_cobro', { p_cuenta: cuenta, p_company: empresa, p_mes: mes })) ?? {}
  return {
    mes: (d.mes as DatosCobro['mes']) ?? null,
    ajustes: (d.ajustes as DatosCobro['ajustes']) ?? null,
    conexion: (d.conexion as DatosCobro['conexion']) ?? null,
    recibos: Array.isArray(d.recibos) ? (d.recibos as DatosCobro['recibos']) : [],
  }
}

/** Llama a conta-cobro y devuelve su frase; si falla, el porqué que da (regla 8). */
async function cobro(body: Record<string, unknown>, que: string): Promise<string> {
  if (!supabase) throw new Error(`${que}: no hay conexión con la base.`)
  const { data, error } = await supabase.functions.invoke('conta-cobro', { body })
  if (!error) return String((data as Fila | null)?.frase ?? `${que}: hecho.`)
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? ((await ctx.clone().json().catch(() => null)) as Fila | null) : null
  const porque = typeof cuerpo?.error === 'string' ? cuerpo.error : null
  throw new Error(porque ?? `${que}: ${ctx?.status === 404 ? 'el cobro aún no está publicado en este entorno' : error.message}`)
}

export const prepararCobro = (empresa: string, mes: string) => cobro({ accion: 'preparar', empresa, mes }, 'No se ha preparado el cobro')
export const enviarCobro = (empresa: string, mes: string) => cobro({ accion: 'enviar', empresa, mes }, 'No se ha enviado el cobro')

export async function decidir(recibo: string, decision: 'pendiente' | 'aprobado' | 'este_mes_no'): Promise<string> {
  const r = await rpc<Fila>('conta_cobro_decidir', { p_recibo: recibo, p_decision: decision })
  return String(r?.frase ?? 'Hecho.')
}

/** nº 46 · «Volver a cobrar»: la gestoría deshace lo que paró el cliente desde el portal (conta_recibo_reanudar). */
export async function reanudar(recibo: string): Promise<string> {
  const r = await rpc<Fila>('conta_recibo_reanudar', { p_recibo: recibo })
  return String(r?.frase ?? 'Hecho.')
}

export async function aprobarIguales(empresa: string, mes: string): Promise<string> {
  const r = await rpc<Fila>('conta_cobro_aprobar_iguales', { p_company: empresa, p_mes: mes })
  return String(r?.frase ?? 'Hecho.')
}

/**
 * La ficha de una factura que sale de un recibo, en UNA lectura
 * (conta_pantalla_factura_recibo, 1403): su recibo, lo que le ha pasado, su
 * Verifactu y sus asientos con los apuntes. Null si no sale de un recibo.
 */
export async function leerFichaRecibo(cuenta: string, factura: string): Promise<DatosFichaRecibo | null> {
  const d = await rpc<DatosFichaRecibo | null>('conta_pantalla_factura_recibo', { p_cuenta: cuenta, p_factura: factura })
  return d && d.recibo ? { ...d, eventos: d.eventos ?? [], asientos: d.asientos ?? [] } : null
}

// ── nº 61 · «Pagos con tarjeta»: la cuenta de Stripe y los pagos que esperan ────────

const num = (v: unknown) => Number(v ?? 0)
const txt = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const pago = (p: Fila): PagoTarjeta => ({
  id: txt(p.id) ?? undefined, recibo: String(p.recibo ?? ''), cliente: txt(p.cliente), partyId: txt(p.party_id), mes: String(p.mes ?? ''),
  importe: num(p.importe), referencia: String(p.referencia ?? ''), pagadoEl: txt(p.pagado_el), numero: txt(p.numero),
})
const estado = (d: Fila): EstadoCuenta => ({ cuenta: txt(d.cuenta), nombre: txt(d.nombre), motivo: (txt(d.motivo) as MotivoCuenta), banco: txt(d.banco) })

/** La cuenta de Stripe de una empresa, cómo está, y los pagos con tarjeta que esperan y los apuntados hoy (conta_cobro_cuenta_stripe_leer). */
export async function leerStripe(empresa: string): Promise<DatosStripe> {
  const d = (await rpc<Fila>('conta_cobro_cuenta_stripe_leer', { p_company: empresa })) ?? {}
  return { ...estado(d), pendientes: Array.isArray(d.pendientes) ? (d.pendientes as Fila[]).map(pago) : [],
    apuntadosHoy: Array.isArray(d.apuntados_hoy) ? (d.apuntados_hoy as Fila[]).map(pago) : [] }
}

/** «Guardar» la cuenta de Stripe: guardada o no (de un banco, con otro nombre), con su estado y su frase. */
export async function ponerStripe(empresa: string, codigo: string | null): Promise<{ guardada: boolean; estado: EstadoCuenta; frase: string }> {
  const d = (await rpc<Fila>('conta_cobro_cuenta_stripe_poner', { p_company: empresa, p_code: codigo })) ?? {}
  return { guardada: d.guardada === true, estado: estado(d), frase: String(d.frase ?? '') }
}

const apuntado = (r: Fila): PagoApuntado => ({
  recibo: String(r.recibo ?? ''), mes: String(r.mes ?? ''), importe: num(r.importe), factura: txt(r.factura), numero: txt(r.numero),
  facturaNueva: r.factura_nueva === true, quien: txt(r.quien), cuando: txt(r.cuando), cuenta: String(r.cuenta ?? ''), frase: String(r.frase ?? ''),
  asientos: Array.isArray(r.asientos) ? (r.asientos as Fila[]).map((a) => ({ tipo: a.tipo as AsientoPago['tipo'], id: String(a.id),
    apuntes: ((a.apuntes as Fila[]) ?? []).map((x) => ({ codigo: String(x.codigo), nombre: String(x.nombre ?? ''), debe: num(x.debe), haber: num(x.haber) })) })) : [],
})

/** El PDF y el correo de la factura que acaba de salir (conta-cobro, «rematar»). Si falla, se dice, pero lo apuntado ya está. */
export async function rematarFacturas(empresa: string): Promise<Envio> {
  if (!supabase) throw new Error('No hay conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-cobro', { body: { accion: 'rematar', empresa } })
  if (error) throw new Error(`no se ha podido preparar el PDF ni enviar la factura (${error.message}); se hará en la próxima lectura`)
  const f = ((data as Fila | null)?.facturas ?? {}) as Fila
  return { enviadas: num(f.enviadas), sinEnviar: ((f.sinEnviar as string[]) ?? []).map(String), fallos: ((f.fallos as string[]) ?? []).map(String) }
}

/** «Apuntar el pago» de una incidencia: apuntado (con su factura y sus asientos) o no, con su frase. */
export async function apuntarPago(diferencia: string): Promise<{ apuntado: PagoApuntado | null; frase: string }> {
  const r = (await rpc<Fila>('conta_recibo_apuntar_pendiente', { p_diferencia: diferencia })) ?? {}
  return { apuntado: r.apuntado === true && r.ya !== true ? apuntado(r) : null, frase: String(r.frase ?? '') }
}

/** «Apuntar los N pagos» de una empresa: los apuntados y la frase de todo (conta_cobro_apuntar_pendientes). */
export async function apuntarTodos(empresa: string): Promise<{ apuntados: PagoApuntado[]; frase: string }> {
  const r = (await rpc<Fila>('conta_cobro_apuntar_pendientes', { p_company: empresa })) ?? {}
  return { apuntados: Array.isArray(r.apuntados) ? (r.apuntados as Fila[]).map(apuntado) : [], frase: String(r.frase ?? '') }
}
