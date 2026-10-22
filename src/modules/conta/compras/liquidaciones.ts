// src/modules/conta/compras/liquidaciones.ts
//
// S02 · PR 3 · Compras y gastos › Liquidaciones: lo que decide la lista sin
// React (regla react-refresh: el componente solo exporta componentes).
//
// Una sola lista con TODAS las liquidaciones de la empresa (regla 7: un estado
// ordena y etiqueta, nunca decide qué existe):
//   · las mensuales (licensed_settlement): las que se suben con sus cinco PDF
//     (formula 'documentos', con su status borrador · confirmada · saldada) y
//     las que llegaron del sistema anterior (status nulo, sin documentos ni
//     ficha: se enseñan y se dice qué son);
//   · las que se esperan y aún no han llegado (compras_liquidaciones, del mes
//     pasado y de este): un proveedor que liquida cada mes y no la ha mandado;
//   · las quincenas de Catcher (supplier_batch), con lo abierto y lo reclamado
//     de UNA cuenta (catcherCuenta), la misma que su ficha.
// El estado en palabras sale de lo que de verdad guardan; cada estado cae en
// una pestaña, y las pestañas suman «Todas».

import { mesLargo, fraseSaldo, mesSiguiente, type FilaLiquidacion } from '@/modules/conta/lib/compras'
import { contar, type Cuenta } from '@/modules/conta/lib/catcherCuenta'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { leerOrden, ordenar, pestanasConTodas, type PestanaEstado, type Sentido } from '@/modules/conta/diseno/plantillas/lista'
import type { TonoChip } from '@/modules/conta/diseno/valores'

export type TipoLiquidacion = 'mensual' | 'catcher'

/** Lo que pide cada estado: te toca hacer algo · ya está · esperar (a que llegue, a Catcher, o nada que hacer aquí). */
export type GrupoLiquidacion = 'te-toca' | 'hecha' | 'espera'

export interface EstadoLiquidacionLista { texto: string; tono: TonoChip; grupo: GrupoLiquidacion; detalle?: string }

/** Una fila de la lista. `abrir` es su ficha; null, que no la tiene (y la página dice por qué). */
export interface FilaLiquidaciones {
  id: string
  tipo: TipoLiquidacion
  proveedor: string
  local: string | null
  desde: string
  hasta: string
  /** El periodo en palabras: «septiembre de 2026», «1.ª quincena de octubre de 2026». */
  periodo: string
  referencia: string | null
  /** Lo que mueve: la diferencia de la mensual (te paga / le pagas) o el total de la quincena. Null si aún no ha llegado. */
  importe: number | null
  /** Debajo del importe: «Te paga 5.545,84 €», «lo que baja la 40700001», «7 albaranes por 812,40 €». */
  apoyoImporte: string
  estado: EstadoLiquidacionLista
  abrir:
    | { a: 'liquidacion'; id: string }
    | { a: 'nueva'; proveedor: string; local: string | null; mes: string }
    | { a: 'quincena'; id: string }
    | { a: 'sin-ficha'; porque: string }
}

// ── Las mensuales ─────────────────────────────────────────────────────────

/** licensed_settlement, como la lee la página (status: null · borrador · confirmada · saldada; CHECK licensed_settlement_status_check). */
export interface LiquidacionGuardada {
  id: string
  status: string | null
  formula: string
  settlement_ref: string | null
  period_from: string
  period_to: string
  net_settlement: number | string | null
  supplier_id: string | null
  location_id: string | null
  company_id: string | null
  /** detail->bloqueos: lo que impide contabilizarla (como compras_liquidaciones). */
  bloqueos: unknown[] | null
}

/** El estado de una mensual guardada, de su status y sus bloqueos. */
export function estadoMensual(status: string | null, bloqueos: number): EstadoLiquidacionLista {
  if (status === 'saldada') return { texto: 'Saldada', tono: 'seguro', grupo: 'hecha', detalle: 'Contabilizada y cerrada con el banco.' }
  if (status === 'confirmada') return { texto: 'Contabilizada', tono: 'seguro', grupo: 'hecha', detalle: 'En el libro; se cerrará cuando llegue al banco.' }
  if (status === 'borrador') {
    return bloqueos > 0
      ? { texto: `No cuadra (${bloqueos})`, tono: 'falta', grupo: 'te-toca', detalle: `${bloqueos === 1 ? 'Una cosa no cuadra' : `${bloqueos} cosas no cuadran`}: ábrela.` }
      : { texto: 'Por confirmar', tono: 'duda', grupo: 'te-toca', detalle: 'Ha llegado: falta mirarla y contabilizarla.' }
  }
  // status nulo: la trajo el sistema anterior (formula 'anterior'), sin sus documentos ni asiento.
  return { texto: 'Del sistema anterior', tono: 'neutro', grupo: 'espera', detalle: 'Llegó importada, sin sus documentos: no tiene ficha ni asiento.' }
}

/** El importe de una mensual: la diferencia, y debajo quién paga a quién. */
function importeMensual(neto: number | null): { importe: number | null; apoyo: string } {
  if (neto == null) return { importe: null, apoyo: 'sin la diferencia todavía' }
  return { importe: Math.abs(neto), apoyo: fraseSaldo(neto) ?? '' }
}

export function filaMensual(l: LiquidacionGuardada, nombres: { proveedor: Map<string, string>; local: Map<string, string> }): FilaLiquidaciones {
  const neto = l.net_settlement == null ? null : Number(l.net_settlement)
  const estado = estadoMensual(l.status, Array.isArray(l.bloqueos) ? l.bloqueos.length : 0)
  const { importe, apoyo } = importeMensual(neto)
  const anterior = l.status == null
  const proveedor = (l.supplier_id && nombres.proveedor.get(l.supplier_id)) || (anterior ? 'Liquidación mensual' : 'Proveedor sin nombre')
  return {
    id: `mensual:${l.id}`, tipo: 'mensual', proveedor, local: l.location_id ? nombres.local.get(l.location_id) ?? null : null,
    desde: l.period_from, hasta: l.period_to, periodo: mesLargo(l.period_from), referencia: l.settlement_ref,
    importe, apoyoImporte: apoyo, estado,
    abrir: anterior
      ? { a: 'sin-ficha', porque: `La liquidación ${l.settlement_ref ? `${l.settlement_ref} ` : ''}de ${mesLargo(l.period_from)} llegó del sistema anterior, sin sus documentos: no tiene ficha que abrir.` }
      : { a: 'liquidacion', id: l.id },
  }
}

/**
 * Las que se esperan y no han llegado (compras_liquidaciones de un mes): solo
 * los pares sin liquidación, porque las que ya están salen de la tabla.
 */
export function filasPorLlegar(mes: string, filas: readonly FilaLiquidacion[], hoy: string): FilaLiquidaciones[] {
  return filas.filter((f) => !f.liquidacion).map((f) => {
    const noToca = hoy < mesSiguiente(mes)
    const albaranes = `${contar(f.recepciones, 'albarán', 'albaranes')} por ${eurosExactos(f.base)}`
    return {
      id: `por-llegar:${mes}:${f.proveedor}:${f.local ?? ''}`, tipo: 'mensual', proveedor: f.proveedor_nombre, local: f.local_nombre,
      desde: mes, hasta: mes, periodo: mesLargo(mes), referencia: null, importe: null, apoyoImporte: albaranes,
      estado: noToca
        ? { texto: 'Aún no toca', tono: 'neutro', grupo: 'espera', detalle: `Llega a primeros de ${mesLargo(mesSiguiente(mes))}.` }
        : { texto: 'Por llegar', tono: 'duda', grupo: 'te-toca', detalle: 'Todavía no ha llegado: sube sus documentos cuando te los mande.' },
      abrir: { a: 'nueva', proveedor: f.proveedor, local: f.local, mes },
    }
  })
}

// ── Las quincenas de Catcher ──────────────────────────────────────────────

/** Lo que la lista necesita de una quincena (LoteFila de catcherService). */
export interface QuincenaParaLista {
  id: string; etiqueta: string; desde: string; hasta: string; facturas: number; total: number
  cruzado: boolean; pago: string | null; cuenta: Cuenta
}

/**
 * El estado de una quincena: lo abierto manda; luego lo reclamado (espera a
 * Catcher); luego el pago. Las mismas palabras que su ficha (catcherCuenta).
 */
export function estadoQuincena(q: Pick<QuincenaParaLista, 'cruzado' | 'pago' | 'cuenta'>): EstadoLiquidacionLista {
  if (!q.cruzado) return { texto: 'Sin cruzar', tono: 'duda', grupo: 'te-toca', detalle: 'Sin cruzar con los pedidos todavía: ábrela y «Volver a comprobar».' }
  const pago = q.pago ? 'Pago propuesto.' : 'Sin proponer el pago.'
  if (q.cuenta.abiertas > 0) return { texto: `${q.cuenta.abiertas} por aclarar`, tono: 'duda', grupo: 'te-toca', detalle: pago }
  if (q.cuenta.reclamadas > 0) {
    return { texto: q.cuenta.reclamadas === 1 ? '1 reclamada' : `${q.cuenta.reclamadas} reclamadas`, tono: 'neutro', grupo: 'espera', detalle: `Esperando a Catcher. ${pago}` }
  }
  if (!q.pago) return { texto: 'Falta el pago', tono: 'duda', grupo: 'te-toca', detalle: 'Cuadra con los pedidos: falta proponer el pago desde la 40700001.' }
  return { texto: 'Cuadra · pago propuesto', tono: 'seguro', grupo: 'hecha', detalle: 'Cuadra con los pedidos y tiene su pago.' }
}

export function filaQuincena(q: QuincenaParaLista): FilaLiquidaciones {
  return {
    id: `catcher:${q.id}`, tipo: 'catcher', proveedor: 'Catcher', local: null, desde: q.desde, hasta: q.hasta,
    periodo: q.etiqueta, referencia: null, importe: q.total,
    apoyoImporte: `${contar(q.facturas, 'factura', 'facturas')} · lo que baja la 40700001`,
    estado: estadoQuincena(q), abrir: { a: 'quincena', id: q.id },
  }
}

// ── Pestañas, filtros y orden ─────────────────────────────────────────────

export type IdPestanaLiquidaciones = 'todas' | GrupoLiquidacion
const PESTANAS: { id: GrupoLiquidacion; etiqueta: string; siempre: boolean }[] = [
  { id: 'te-toca', etiqueta: 'Te tocan', siempre: true },
  { id: 'espera', etiqueta: 'En espera', siempre: false },
  { id: 'hecha', etiqueta: 'Hechas', siempre: false },
]

/** Las pestañas con su número: cada estado cae en una, y suman «Todas». */
export function pestanasLiquidaciones(fs: readonly FilaLiquidaciones[]): PestanaEstado[] {
  return pestanasConTodas(PESTANAS.map((p) => ({ ...p, n: fs.filter((f) => f.estado.grupo === p.id).length })))
}

const ORDEN_DE_SERIE = { columna: 'periodo', sentido: 'desc' as Sentido }
export const COLUMNAS_ORDENABLES = ['periodo', 'proveedor', 'importe'] as const

export interface FiltrosLiquidaciones { pestana: IdPestanaLiquidaciones; tipo: '' | TipoLiquidacion; orden: { columna: string; sentido: Sentido } }

/** Los filtros, de la dirección (?ver=&tipo=&orden=): se recarga y la lista queda igual. */
export function filtrosLiquidaciones(query: URLSearchParams): FiltrosLiquidaciones {
  const ver = query.get('ver')
  const tipo = query.get('tipo')
  const orden = leerOrden(query.get('orden') ?? undefined, ORDEN_DE_SERIE)
  return {
    pestana: ver === 'te-toca' || ver === 'espera' || ver === 'hecha' ? ver : 'todas',
    tipo: tipo === 'mensual' || tipo === 'catcher' ? tipo : '',
    orden: (COLUMNAS_ORDENABLES as readonly string[]).includes(orden.columna) ? orden : ORDEN_DE_SERIE,
  }
}

/** Lo que deja el filtro de tipo (las pestañas cuentan sobre esto). */
export function filtrarPorTipo(fs: readonly FilaLiquidaciones[], tipo: FiltrosLiquidaciones['tipo']): FilaLiquidaciones[] {
  return tipo ? fs.filter((f) => f.tipo === tipo) : [...fs]
}

/**
 * Las filas: tipo, pestaña y orden. De serie, la más reciente arriba; en el
 * mismo periodo, la que te toca primero y luego por proveedor y local, para
 * que el orden no dependa de cómo llegaron.
 */
export function filasLiquidaciones(fs: readonly FilaLiquidaciones[], f: FiltrosLiquidaciones): FilaLiquidaciones[] {
  const sin = filtrarPorTipo(fs, f.tipo)
  const con = f.pestana === 'todas' ? sin : sin.filter((x) => x.estado.grupo === f.pestana)
  const peso: Record<GrupoLiquidacion, number> = { 'te-toca': 0, espera: 1, hecha: 2 }
  const base = [...con].sort((a, b) =>
    peso[a.estado.grupo] - peso[b.estado.grupo] || a.proveedor.localeCompare(b.proveedor, 'es') || (a.local ?? '').localeCompare(b.local ?? '', 'es'))
  const valor = (x: FilaLiquidaciones): string | number | null =>
    f.orden.columna === 'importe' ? x.importe : f.orden.columna === 'proveedor' ? x.proveedor : x.desde
  return ordenar(base, valor, f.orden.sentido)
}

/** El pie: cuántas, y cuántas te tocan. */
export function pieLiquidaciones(fs: readonly FilaLiquidaciones[]): string {
  const tocan = fs.filter((f) => f.estado.grupo === 'te-toca').length
  return `${contar(fs.length, 'liquidación', 'liquidaciones')}${tocan ? ` · ${tocan} te ${tocan === 1 ? 'toca' : 'tocan'}` : ''}`
}

// ── El saldo prepago, en una línea ────────────────────────────────────────

/**
 * El saldo de la 40700001 en palabras, con las mismas cifras que el bloque de
 * la quincena (SaldoPrepago): la lectura es la misma (catcherService.saldoPrepago).
 */
export function fraseSaldoPrepago(s: { existe: boolean; texto?: string; recargas?: number; pagos?: number; saldo?: number; pagosSinValidar?: number }): { frase: string; sinValidar: string | null } {
  if (!s.existe) return { frase: s.texto ?? 'Falta la 40700001 «Saldo prepago Catcher» en el plan de la empresa.', sinValidar: null }
  const sinValidar = Math.round((s.pagosSinValidar ?? 0) * 100) !== 0 ? `De esos pagos, ${eurosExactos(s.pagosSinValidar ?? 0)} aún sin validar.` : null
  return {
    frase: `Te quedan ${eurosExactos(s.saldo ?? 0)}: has recargado ${eurosExactos(s.recargas ?? 0)} y se han pagado ${eurosExactos(s.pagos ?? 0)}.`,
    sinValidar,
  }
}
