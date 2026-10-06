// src/modules/conta/lib/liquidaciones.ts
//
// C03 · Las liquidaciones de una plataforma de reparto (channel_settlement).
//
// Regla 3 · ventas − comisiones − otros cargos = neto. Si lo que llegó al
//   banco no es el neto, la liquidación está «con diferencia» y se dice la
//   cifra («faltan 212,30 € en el banco»). Nunca se cuadra sola.
// Regla 2 · Te debe = liquidaciones pendientes (y lo que falta de las cobradas
//   con diferencia); vencido = pasada la fecha de la liquidación sin cobro.
//
// Los importes de los ficheros vienen con signos distintos según la
// plataforma (medido en producción el 06/10: la comisión de Glovo viene en
// positivo aunque es un coste). Aquí los costes se toman en valor absoluto.
// Y no todos traen el neto: Just Eat y Uber Eats solo traen ventas; entonces
// no se inventa, se dice «el fichero no trae el neto».

import { diaMes, eurosExactos } from './formato'

export interface LiquidacionPlataforma {
  id: string
  ref: string | null
  desde: string | null
  hasta: string | null
  /** Periodo PROPUESTO desde sus pedidos, por confirmar. */
  propuestoDesde: string | null
  propuestoHasta: string | null
  /** Fecha de la liquidación (la del pago que anuncia la plataforma). */
  fecha: string | null
  pedidos: number | null
  ventas: number | null
  comision: number | null
  /** Todos los demás cargos (transporte, promociones, cuotas, incidencias…), con su signo de origen. */
  otros: number[]
  neto: number | null
  cobradoEn: string | null
  cobrado: number | null
  paraRevisar: boolean
  motivoRevisar: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const abs = (n: number | null | undefined) => Math.abs(n ?? 0)

export interface Cuadre {
  ventas: number | null
  comisiones: number
  otrosCargos: number
  /** ventas − comisiones − otros, o null si no hay ventas. */
  calculado: number | null
  neto: number | null
  /** neto − calculado: 0 si cuadra; null si falta uno de los dos. */
  descuadre: number | null
  /** La línea de la maqueta: «11.004 € − 2.311 € = 8.693 €». */
  frase: string
}

/** Regla 3: la cuenta de la liquidación, tal como viene. */
export function cuadre(l: Pick<LiquidacionPlataforma, 'ventas' | 'comision' | 'otros' | 'neto'>): Cuadre {
  const comisiones = r2(abs(l.comision))
  const otrosCargos = r2(l.otros.reduce((s, x) => s + abs(x), 0))
  const calculado = l.ventas == null ? null : r2(l.ventas - comisiones - otrosCargos)
  const descuadre = calculado == null || l.neto == null ? null : r2(l.neto - calculado)
  const partes = [l.ventas == null ? '¿ventas?' : eurosExactos(l.ventas), eurosExactos(comisiones)]
  if (otrosCargos) partes.push(eurosExactos(otrosCargos))
  const frase = `${partes.join(' − ')} = ${l.neto == null ? 'sin neto en el fichero' : eurosExactos(l.neto)}`
  return { ventas: l.ventas, comisiones, otrosCargos, calculado, neto: l.neto, descuadre, frase }
}

export type EstadoLiquidacion = 'cobrada' | 'con_diferencia' | 'vencida' | 'pendiente' | 'sin_neto'

export interface Estado {
  estado: EstadoLiquidacion
  /** La etiqueta de la píldora. */
  etiqueta: string
  tono: 'verde' | 'azul' | 'ambar' | 'gris'
  /** La explicación de debajo: «faltan 212,30 € en el banco», «llega el 20»… */
  explica: string
  /** Lo que te debe todavía por esta liquidación (0 si nada; null si no se sabe). */
  pendiente: number | null
}

/**
 * Regla 2 y 3: el estado de una liquidación hoy. El cobro se compara con el
 * neto al céntimo; si no es igual, «con diferencia» con la cifra y el sentido.
 */
export function estadoLiquidacion(l: LiquidacionPlataforma, hoy: string): Estado {
  if (l.cobradoEn != null && l.cobrado != null) {
    if (l.neto == null) {
      return { estado: 'cobrada', etiqueta: 'Cobrada', tono: 'verde', explica: `llegaron ${eurosExactos(l.cobrado)}; el fichero no trae el neto para comprobarlo`, pendiente: 0 }
    }
    const dif = r2(l.cobrado - l.neto)
    if (dif === 0) return { estado: 'cobrada', etiqueta: 'Cobrada', tono: 'verde', explica: 'cuadra con el banco', pendiente: 0 }
    return dif < 0
      ? { estado: 'con_diferencia', etiqueta: 'Con diferencia', tono: 'ambar', explica: `faltan ${eurosExactos(-dif)} en el banco`, pendiente: -dif }
      : { estado: 'con_diferencia', etiqueta: 'Con diferencia', tono: 'ambar', explica: `llegaron ${eurosExactos(dif)} de más`, pendiente: 0 }
  }
  if (l.neto == null) {
    return { estado: 'sin_neto', etiqueta: 'Para revisar', tono: 'gris', explica: 'el fichero no trae el neto: no se sabe cuánto tiene que llegar', pendiente: null }
  }
  if (l.fecha && l.fecha < hoy) {
    return { estado: 'vencida', etiqueta: 'Vencida', tono: 'ambar', explica: `tenía que llegar el ${diaMes(l.fecha)} y no ha llegado`, pendiente: l.neto }
  }
  return { estado: 'pendiente', etiqueta: 'Pendiente', tono: 'azul', explica: l.fecha ? `llega el ${diaMes(l.fecha).split(' ')[0]}` : 'sin fecha de pago', pendiente: l.neto }
}

/** El periodo como en la maqueta: «1–15 oct», «16–31 ago», «28 sep – 4 oct». Con el propuesto, «por confirmar». */
export function periodo(l: Pick<LiquidacionPlataforma, 'desde' | 'hasta' | 'propuestoDesde' | 'propuestoHasta'>): { texto: string; porConfirmar: boolean } {
  const d = l.desde ?? l.propuestoDesde
  const h = l.hasta ?? l.propuestoHasta
  const porConfirmar = !l.desde && !!l.propuestoDesde
  if (!d || !h) return { texto: 'sin periodo', porConfirmar: false }
  const [dd, dm] = [Number(d.slice(8, 10)), d.slice(5, 7)]
  const texto = dm === h.slice(5, 7) && d.slice(0, 4) === h.slice(0, 4)
    ? `${dd}–${diaMes(h)}`
    : `${diaMes(d)} – ${diaMes(h)}`
  return { texto, porConfirmar }
}

export interface TeDebe {
  total: number
  vencido: number
  /** Las que suman, ordenadas por cuándo tenían o tienen que llegar (la primera, la que antes vence). */
  partes: { id: string; importe: number; fecha: string | null; estado: EstadoLiquidacion; texto: string }[]
  /** «liquidación del 1–15 oct · llega el 20»; null si no te debe nada. */
  frase: string | null
  /** Liquidaciones sin neto: no suman, pero se dicen. */
  sinNeto: number
}

/**
 * Regla 2. Lo que te debe una plataforma: lo pendiente de cada liquidación
 * (el neto sin cobrar, o lo que falta de una cobrada con diferencia). Vencido:
 * pasada su fecha sin llegar.
 */
export function teDebe(liqs: readonly LiquidacionPlataforma[], hoy: string): TeDebe {
  const partes: TeDebe['partes'] = []
  let sinNeto = 0
  for (const l of liqs) {
    const e = estadoLiquidacion(l, hoy)
    if (e.pendiente == null) { sinNeto++; continue }
    if (e.pendiente <= 0) continue
    partes.push({ id: l.id, importe: e.pendiente, fecha: l.fecha, estado: e.estado, texto: `liquidación del ${periodo(l).texto} · ${e.explica}` })
  }
  partes.sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999'))
  const total = r2(partes.reduce((s, p) => s + p.importe, 0))
  const vencido = r2(partes.filter((p) => p.estado !== 'pendiente').reduce((s, p) => s + p.importe, 0))
  const frase = partes.length === 0 ? null
    : partes.length === 1 ? partes[0].texto
    : `${partes.length} liquidaciones · la primera, ${partes[0].texto.replace(/^liquidación del /, 'del ')}`
  return { total, vencido, partes, frase, sinNeto }
}

/**
 * El pie corto de «Te debe» (móvil). Lo vencido o con diferencia va primero:
 * una fecha de llegada solo se dice de lo que aún está pendiente (capturas del
 * 06/10: decía «llega el 5 sept» de una que llegó con 212,30 € de menos).
 */
export function pieTeDebe(t: TeDebe, hayLiquidaciones: boolean): string {
  if (t.vencido > 0) return `${eurosExactos(t.vencido)} con retraso o diferencia`
  const proxima = t.partes.find((p) => p.estado === 'pendiente' && p.fecha)
  if (proxima?.fecha) return `llega el ${diaMes(proxima.fecha)}`
  return hayLiquidaciones ? 'nada pendiente' : 'aún sin liquidaciones'
}

export interface CifrasPlataforma {
  teDebe: TeDebe
  vendidoEsteAnio: number
  pedidosEsteAnio: number
  comisionesEsteAnio: number
  /** Comisión / ventas del año, en %, redondeada a una cifra decimal. */
  pctMedio: number | null
  ultima: { liq: LiquidacionPlataforma; periodo: string; estado: Estado } | null
  hayLiquidaciones: boolean
}

/** Las cuatro cifras de la ficha de una plataforma (maqueta N9), con el año de hoy (Madrid). */
export function cifrasPlataforma(liqs: readonly LiquidacionPlataforma[], hoy: string): CifrasPlataforma {
  const anio = hoy.slice(0, 4)
  const delAnio = liqs.filter((l) => (l.hasta ?? l.propuestoHasta ?? l.fecha ?? '').startsWith(anio))
  const vendido = r2(delAnio.reduce((s, l) => s + (l.ventas ?? 0), 0))
  const comis = r2(delAnio.reduce((s, l) => s + abs(l.comision), 0))
  const ordenadas = [...liqs].sort((a, b) => (b.hasta ?? b.propuestoHasta ?? b.fecha ?? '').localeCompare(a.hasta ?? a.propuestoHasta ?? a.fecha ?? ''))
  const u = ordenadas.find((l) => l.cobradoEn) ?? ordenadas[0] ?? null
  return {
    teDebe: teDebe(liqs, hoy),
    vendidoEsteAnio: vendido,
    pedidosEsteAnio: delAnio.reduce((s, l) => s + (l.pedidos ?? 0), 0),
    comisionesEsteAnio: comis,
    pctMedio: vendido > 0 ? Math.round((comis / vendido) * 1000) / 10 : null,
    ultima: u ? { liq: u, periodo: periodo(u).texto, estado: estadoLiquidacion(u, hoy) } : null,
    hayLiquidaciones: liqs.length > 0,
  }
}
