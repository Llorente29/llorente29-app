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

export type TipoLiquidacion = 'mensual' | 'catcher' | 'plataforma'

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

// ── Las de plataforma (D07, Julio 23/10, camino B) ────────────────────────

/**
 * Una liquidación de plataforma (channel_settlement): lo que la plataforma te
 * liquida de una semana —ventas, su comisión y lo que te transfiere—. No es una
 * factura ni tiene PDF: su factura de comisión llega aparte, cada semana, como
 * su propia factura recibida, y se enlaza con las liquidaciones de su semana.
 */
export interface LiquidacionPlataforma {
  id: string
  canal: string
  tienda: string | null
  desde: string
  hasta: string
  ventas: number | null
  /** Comisión y cargos (la comisión, la publicidad): en positivo. */
  comision: number
  neto: number | null
  cobrado: { fecha: string; importe: number | null } | null
  /** Lo que factura la plataforma por esta liquidación (su parte de la factura de la semana). 0 si nada. */
  aFacturar: number
  /** S01i · Sus facturas de comisión (channel_settlement_invoice): puede haber varias. */
  facturas: { id: string; numero: string | null; total: number }[]
  deReferencia: boolean
  porAclarar: string | null
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function estadoPlataforma(l: LiquidacionPlataforma): EstadoLiquidacionLista {
  if (l.deReferencia) return { texto: 'De referencia', tono: 'neutro', grupo: 'espera', detalle: 'De antes del cierre: sin factura ni asiento; su cobro se casa en Bancos.' }
  if (l.porAclarar) return { texto: 'Por aclarar', tono: 'duda', grupo: 'te-toca', detalle: l.porAclarar }
  if (l.aFacturar > 0 && !l.facturas.length) {
    return { texto: 'Falta la factura de comisión', tono: 'duda', grupo: 'espera', detalle: `Su factura de comisión (${eurosExactos(l.aFacturar)} de esta liquidación) aún no ha llegado.` }
  }
  if (l.facturas.length) {
    const nums = l.facturas.map((f) => f.numero).filter(Boolean).join(', ')
    const suma = Math.round(l.facturas.reduce((t, f) => t + f.total, 0) * 100) / 100
    const dif = Math.round((suma - l.aFacturar) * 100) / 100
    const cuanto = l.facturas.length === 1 ? `Su factura de comisión${nums ? ` ${nums}` : ''}: ${eurosExactos(suma)}` : `Sus ${l.facturas.length} facturas de comisión (${nums}): ${eurosExactos(suma)}`
    // Regla 7: la diferencia con lo que factura la liquidación se ve, no se esconde.
    return dif === 0 || l.aFacturar <= 0
      ? { texto: 'Factura de comisión · recibida', tono: 'seguro', grupo: 'hecha', detalle: `${cuanto}. Se paga por compensación con esta liquidación.` }
      : { texto: 'Factura de comisión · recibida', tono: 'duda', grupo: 'hecha', detalle: `${cuanto}; la liquidación factura ${eurosExactos(l.aFacturar)}: diferencia de ${eurosExactos(dif)}.` }
  }
  return l.comision > 0
    ? { texto: 'Sin factura aparte', tono: 'neutro', grupo: 'hecha', detalle: 'Su comisión va en la propia liquidación (la de Glovo, por ejemplo): no espera otra factura.' }
    : { texto: 'Sin comisión', tono: 'neutro', grupo: 'hecha', detalle: 'No trae comisión ni cargos que facturar.' }
}

export function filaPlataforma(l: LiquidacionPlataforma): FilaLiquidaciones {
  const partes = [
    l.ventas !== null ? `ventas ${eurosExactos(l.ventas)}` : null,
    `comisión ${eurosExactos(l.comision)}`,
    l.cobrado ? `cobrado ${eurosExactos(l.cobrado.importe ?? l.neto ?? 0)} el ${ddmm(l.cobrado.fecha)}` : l.neto !== null ? 'neto sin cobrar aún' : null,
  ].filter(Boolean) as string[]
  return {
    id: `plataforma:${l.id}`, tipo: 'plataforma', proveedor: l.canal, local: l.tienda, desde: l.desde, hasta: l.hasta,
    periodo: `del ${ddmm(l.desde)} al ${ddmm(l.hasta)}/${l.hasta.slice(0, 4)}`, referencia: l.facturas.map((f) => f.numero).filter(Boolean).join(', ') || null,
    importe: l.neto, apoyoImporte: partes.join(' · ').replace(/^./, (x) => x.toUpperCase()),
    estado: estadoPlataforma(l),
    abrir: { a: 'sin-ficha', porque: `Es una liquidación de ${l.canal}: lo que te liquida de una semana. No es una factura ni tiene PDF; su factura de comisión llega aparte, en Facturas recibidas, se liga con su liquidación y se paga por compensación con ella.` },
  }
}

/**
 * D07 · Las semanas cuya factura de comisión no ha llegado (para Inicio): las
 * liquidaciones que la esperan, agrupadas por la semana que acaba, contando
 * solo las que acabaron hace más de `diasDeMargen` días (la factura llega el
 * martes siguiente).
 */
export function semanasSinFactura(ls: readonly LiquidacionPlataforma[], hoy: string, diasDeMargen = 7): { canal: string; hasta: string; desde: string; n: number; importe: number }[] {
  const limite = new Date(`${hoy}T12:00:00Z`); limite.setUTCDate(limite.getUTCDate() - diasDeMargen)
  const corte = limite.toISOString().slice(0, 10)
  const porSemana = new Map<string, { canal: string; hasta: string; desde: string; n: number; importe: number }>()
  for (const l of ls) {
    if (l.deReferencia || l.facturas.length || l.aFacturar <= 0 || l.hasta > corte) continue
    const k = `${l.canal}|${l.hasta}`
    const x = porSemana.get(k) ?? { canal: l.canal, hasta: l.hasta, desde: l.desde, n: 0, importe: 0 }
    x.n += 1; x.importe = Math.round((x.importe + l.aFacturar) * 100) / 100
    if (l.desde > x.desde) x.desde = l.desde
    porSemana.set(k, x)
  }
  return [...porSemana.values()].sort((a, b) => b.hasta.localeCompare(a.hasta) || a.canal.localeCompare(b.canal, 'es'))
}

/** El aviso de una semana sin su factura, en una frase. */
export function fraseSemanaSinFactura(x: { canal: string; desde: string; hasta: string; n: number; importe: number }): string {
  return `Falta la factura de comisión de ${x.canal} de la semana del ${ddmm(x.desde)} al ${ddmm(x.hasta)}/${x.hasta.slice(0, 4)}: ${x.n === 1 ? 'una liquidación la espera' : `${x.n} liquidaciones la esperan`} (${eurosExactos(x.importe)}).`
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
    tipo: tipo === 'mensual' || tipo === 'catcher' || tipo === 'plataforma' ? tipo : '',
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
