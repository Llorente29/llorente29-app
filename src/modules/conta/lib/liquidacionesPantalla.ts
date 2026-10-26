// src/modules/conta/lib/liquidacionesPantalla.ts
//
// V02 · Pantallas · Ventas › Liquidaciones (tableros 28 y 29): lo que la
// pantalla decide sin React, a partir de las filas del motor (FilaMotor, de
// conta_liquidaciones). El estado lo decide la base; aquí solo se dice cómo se
// enseña:
//
//   · las cuatro piezas de cada tarjeta como píldoras: verde si está, ámbar si
//     falta, rojo si no cuadra;
//   · su estado en tres palabras (Cuadrada · Le falta una pieza · No cuadra) y
//     UN botón: Ver · Subirla · Ver por qué · Pedírsela;
//   · la banda del mes: cuántas cuadran de cuántas, lo que te han pagado, lo
//     vendido y las comisiones con su porcentaje;
//   · «Cuándo te pagan», con el ritmo de la ficha de cada uno.
//
// Regla 7: «Este mes» ordena (primero lo que necesita algo de ti) y enseña las
// primeras; las demás están a un clic, contadas («Y N cuadradas más»).

import type { EstadoLiquidacion, FilaMotor } from '@/modules/conta/lib/liquidacionesMotor'
import { pagoYVencimiento, type Periodo } from '@/modules/conta/lib/plazoPlataforma'

export type TonoPieza = 'ok' | 'falta' | 'mal'
export interface Pieza { id: 'vendido' | 'liquidacion' | 'factura' | 'cobro'; texto: string; tono: TonoPieza }
export type Situacion = 'cuadrada' | 'falta' | 'no_cuadra'
export type Accion = 'ver' | 'subirla' | 'ver_por_que' | 'pedirsela'

const SITUACION: Record<EstadoLiquidacion, Situacion> = {
  cuadra: 'cuadrada', diferencia: 'no_cuadra',
  esperando_liquidacion: 'falta', falta_liquidacion: 'falta', falta_factura: 'falta', esperando_cobro: 'falta',
}
export const situacion = (f: Pick<FilaMotor, 'estado'>): Situacion => SITUACION[f.estado]
export const NOMBRE_SITUACION: Record<Situacion, string> = { cuadrada: 'Cuadrada', falta: 'Le falta una pieza', no_cuadra: 'No cuadra' }

const cent = (x: number | null | undefined) => Math.round((x ?? 0) * 100)

/**
 * Las cuatro piezas. Sin liquidación no se sabe de su factura ni de su cobro:
 * salen en ámbar, nunca en verde (una pieza en verde dice que está).
 */
export function piezas(f: FilaMotor): Pieza[] {
  const hayLiq = f.liquidacion.n > 0
  const ref = f.liquidacion.referencia
  // ¿Qué no cuadra? Lo vendido contra la liquidación, o lo que dice que paga contra el banco.
  const difVentas = f.estado === 'diferencia' && f.vendido.total !== null && cent(f.vendido.total) !== cent(f.liquidacion.pedidosTotal)
  const difCobro = f.estado === 'diferencia' && !difVentas
  return [
    { id: 'vendido', texto: 'Lo vendido', tono: 'ok' },
    { id: 'liquidacion', texto: 'La liquidación', tono: !hayLiq ? 'falta' : difVentas ? 'mal' : 'ok' },
    { id: 'factura', texto: 'Su factura', tono: !hayLiq ? 'falta' : f.faltanFacturas > 0 ? 'falta' : 'ok' },
    { id: 'cobro', texto: 'El cobro', tono: !hayLiq ? 'falta' : difCobro ? 'mal' : ref || f.cobro.porCobrar === 0 ? 'ok' : 'falta' },
  ]
}

/** El único botón de la tarjeta. */
export function accion(f: Pick<FilaMotor, 'estado'>): Accion {
  switch (f.estado) {
    case 'esperando_liquidacion': case 'falta_liquidacion': return 'subirla'
    case 'falta_factura': return 'pedirsela'
    case 'diferencia': return 'ver_por_que'
    default: return 'ver'
  }
}
export const NOMBRE_ACCION: Record<Accion, string> = { ver: 'Ver', subirla: 'Subirla', ver_por_que: 'Ver por qué', pedirsela: 'Pedírsela' }
/** El botón azul es el que pide algo; «Ver» y «Pedírsela», en blanco (tablero 28). */
export const accionPrincipal = (a: Accion): boolean => a === 'subirla' || a === 'ver_por_que'

/** El importe de la tarjeta: lo que te pagan si hay liquidación; si no, lo vendido. */
export const importe = (f: FilaMotor): number | null => (f.liquidacion.n > 0 && f.liquidacion.pagan !== null ? f.liquidacion.pagan : f.vendido.total)

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const d = (iso: string) => Number(iso.slice(8, 10))
const m = (iso: string) => Number(iso.slice(5, 7)) - 1

/** «semana 12–18 oct» · «1–15 oct» · «septiembre» · «24 oct» · «28 sep–4 oct». */
export function periodoCorto(desde: string, hasta: string): string {
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7)
  const finDeMes = d(hasta) === new Date(Date.UTC(Number(hasta.slice(0, 4)), m(hasta) + 1, 0)).getUTCDate()
  if (desde === hasta) return `${d(desde)} ${MESES[m(desde)]}`
  if (mismoMes && d(desde) === 1 && finDeMes) return MESES_LARGOS[m(desde)]
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000)
  const tramo = mismoMes ? `${d(desde)}–${d(hasta)} ${MESES[m(hasta)]}` : `${d(desde)} ${MESES[m(desde)]}–${d(hasta)} ${MESES[m(hasta)]}`
  return dias === 6 ? `semana ${tramo}` : tramo
}

/** El primer y el último día del mes de `iso`. */
export function mesDe(iso: string): { desde: string; hasta: string; nombre: string } {
  const y = Number(iso.slice(0, 4)); const mm = m(iso)
  const fin = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate()
  return { desde: `${iso.slice(0, 7)}-01`, hasta: `${iso.slice(0, 7)}-${String(fin).padStart(2, '0')}`, nombre: MESES_LARGOS[mm] }
}

/** Las filas del mes: las de un periodo que toca el mes. */
export const delMes = (fs: readonly FilaMotor[], mes: { desde: string; hasta: string }): FilaMotor[] =>
  fs.filter((f) => f.desde <= mes.hasta && f.hasta >= mes.desde)

/** Primero lo que necesita algo de ti: no cuadra, le falta una pieza (lo más antiguo antes), y al final las cuadradas. */
export function ordenar(fs: readonly FilaMotor[]): FilaMotor[] {
  const peso: Record<Situacion, number> = { no_cuadra: 0, falta: 1, cuadrada: 2 }
  return [...fs].sort((a, b) => peso[situacion(a)] - peso[situacion(b)] || a.hasta.localeCompare(b.hasta) || a.intermediario.localeCompare(b.intermediario, 'es') || (a.local ?? '').localeCompare(b.local ?? '', 'es') || (a.marca ?? '').localeCompare(b.marca ?? '', 'es'))
}

/** «Este mes»: todas las que necesitan algo y, si sobra sitio, unas cuantas cuadradas. Las demás, contadas. */
export function esteMes(fs: readonly FilaMotor[], max = 5): { vistas: FilaMotor[]; cuadradasMas: number } {
  const o = ordenar(fs)
  const necesitan = o.filter((f) => situacion(f) !== 'cuadrada')
  const cuadradas = o.filter((f) => situacion(f) === 'cuadrada')
  const sitio = Math.max(0, max - necesitan.length)
  // Las que necesitan algo salen todas (un aviso que se esconde no es un aviso).
  return { vistas: [...necesitan, ...cuadradas.slice(0, sitio)], cuadradasMas: cuadradas.length - Math.min(sitio, cuadradas.length) }
}

export interface Banda {
  total: number; cuadradas: number; falta: number; noCuadran: number
  pagado: number; vendido: number; comision: number; pct: number | null
  /** Las que se pueden pedir: falta la liquidación o su factura. */
  porPedir: number
}

/** La banda del mes (suman todas: regla 7). */
export function banda(fs: readonly FilaMotor[]): Banda {
  const c = (s: Situacion) => fs.filter((f) => situacion(f) === s).length
  const conLiq = fs.filter((f) => f.liquidacion.n > 0)
  const suma = (xs: readonly FilaMotor[], k: (f: FilaMotor) => number | null) => Math.round(xs.reduce((t, f) => t + (k(f) ?? 0), 0) * 100) / 100
  const comision = suma(conLiq, (f) => f.liquidacion.comision)
  const bruto = suma(conLiq, (f) => f.liquidacion.ventas)
  return {
    total: fs.length, cuadradas: c('cuadrada'), falta: c('falta'), noCuadran: c('no_cuadra'),
    pagado: suma(conLiq, (f) => f.liquidacion.pagan), vendido: suma(fs, (f) => f.vendido.total), comision,
    pct: bruto > 0 ? Math.round((1000 * comision) / bruto) / 10 : null,
    porPedir: fs.filter((f) => f.estado === 'falta_liquidacion' || f.estado === 'falta_factura').length,
  }
}

/** La inicial del círculo: «UE» de Uber Eats, «GL» de Glovo, «JE» de Just Eat. */
export function inicial(nombre: string): string {
  const p = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase()
  return (p[0] ?? '?').slice(0, 2).toUpperCase()
}

/** El color del círculo: siempre el mismo para el mismo nombre (los de la puerta). */
export const colorDe = (n: string): string => String([...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6)

const DIAS_SEMANA = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado']

/** Un intermediario con su ritmo, como lo dice su ficha de Contactos. */
export interface Ritmo { cada: Periodo | null; dias: number | null }

/** «cada semana» · «cada quincena, con una de retraso» · «cada mes» · «sin ritmo todavía». */
export function cadaCuanto(r: Ritmo): string {
  if (r.cada === 'weekly') return 'cada semana'
  if (r.cada === 'fortnightly') return (r.dias ?? 0) > 15 ? 'cada quincena, con una de retraso' : 'cada quincena'
  if (r.cada === 'monthly') return 'cada mes'
  return 'sin ritmo todavía'
}

/** El día que paga: «el lunes» · «hacia el 4 y el 19» · «hacia el día 10» · «—». Con la misma cuenta que la base. */
export function cuandoPaga(r: Ritmo): string {
  if (!r.cada || r.dias === null) return '—'
  if (r.cada === 'weekly') return DIAS_SEMANA[new Date(`${pagoYVencimiento('weekly', r.dias, null, '2026-01-07').pago}T12:00:00Z`).getUTCDay()]
  if (r.cada === 'monthly') return `hacia el día ${d(pagoYVencimiento('monthly', r.dias, null, '2026-01-10').pago)}`
  // Una quincena de 15 días y otra de 16: se miran las dos de un mes de 31.
  const a = d(pagoYVencimiento('fortnightly', r.dias, null, '2026-01-10').pago)
  const b = d(pagoYVencimiento('fortnightly', r.dias, null, '2026-01-20').pago)
  const [x, y] = [a, b].sort((p, q) => p - q)
  return x === y ? `hacia el día ${x}` : `hacia el ${x} y el ${y}`
}
