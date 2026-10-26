// src/modules/conta/lib/pagos.ts
//
// PC01 · Entrega 2 · Compras › Pagos (tableros 15 y 16), sin React: las filas
// de conta_pagos_lista, sus pestañas, las cifras de arriba, qué se puede meter
// en una remesa y por qué no, y los pasos de una remesa.
//
// Las pestañas (tablero 15): Por pagar · Vencidas · Esta semana · Sin
// vencimiento · En remesa · Pagadas. «Por pagar» es lo que queda por pagar,
// todo (regla 7: ninguna fila se esconde); las demás son trozos de ella, y
// «Pagadas» va aparte. El estado viene de la base (conta_recibida_pago, PC01 ·
// E1), con una capa más: «En remesa» cuando lo pendiente ya está en una remesa
// que espera el cargo.

export type FormaPago = 'transfer' | 'direct_debit' | 'card' | 'cash' | 'prepaid' | null
export type EstadoPago = 'por_pagar' | 'vence_semana' | 'vencida' | 'sin_vencimiento' | 'pagada_parte' | 'pagada' | 'en_remesa'

export interface FilaPago {
  id: string
  proveedorId: string | null
  proveedor: string
  numero: string | null
  fecha: string | null
  vence: string | null
  total: number
  pagado: number
  pendiente: number
  /** El de la base (conta_recibida_pago). */
  estadoBase: string
  diasVencida: number | null
  forma: FormaPago
  localId: string | null
  local: string | null
  iban4: string | null
  conIban: boolean
  conCuenta: boolean
  remesa: { id: string; codigo: string; importe: number } | null
}

const num = (x: unknown) => (x === null || x === undefined || x === '' ? 0 : Number(x))
const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
const FORMAS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'prepaid'])

export function filaPago(f: Record<string, unknown>): FilaPago {
  const r = f.remesa as Record<string, unknown> | null
  return {
    id: String(f.id), proveedorId: str(f.supplier_id), proveedor: str(f.proveedor) ?? 'Sin proveedor', numero: str(f.numero), fecha: str(f.fecha),
    vence: str(f.vence), total: num(f.total), pagado: num(f.pagado), pendiente: num(f.pendiente), estadoBase: String(f.estado ?? ''),
    diasVencida: f.dias_vencida === null || f.dias_vencida === undefined ? null : Number(f.dias_vencida),
    forma: FORMAS.has(String(f.forma)) ? (String(f.forma) as FormaPago) : null, localId: str(f.location_id), local: str(f.local),
    iban4: str(f.iban4), conIban: f.con_iban === true, conCuenta: f.con_cuenta === true,
    remesa: r ? { id: String(r.id), codigo: String(r.codigo), importe: num(r.importe) } : null,
  }
}

/** Lo que le queda sin remesa (lo que se puede pagar hoy). */
export const libre = (f: FilaPago) => Math.round((f.pendiente - (f.remesa?.importe ?? 0)) * 100) / 100

/** El estado de la fila: el de la base, salvo que todo lo pendiente ya esté en una remesa. */
export function estadoPago(f: FilaPago): EstadoPago {
  if (f.estadoBase === 'pagada' || f.pendiente < 0.005) return 'pagada'
  if (f.remesa && libre(f) < 0.005) return 'en_remesa'
  if (f.estadoBase === 'vencida' || f.estadoBase === 'vence_semana' || f.estadoBase === 'sin_vencimiento' || f.estadoBase === 'pagada_parte') return f.estadoBase
  return 'por_pagar'
}

export const NOMBRE_ESTADO: Record<EstadoPago, string> = {
  por_pagar: 'Por pagar', vence_semana: 'Vence esta semana', vencida: 'Vencida', sin_vencimiento: 'Sin vencimiento',
  pagada_parte: 'Pagada en parte', pagada: 'Pagada', en_remesa: 'En la remesa',
}

/** El chip del estado (tablero 15): rojo vencida, ámbar lo que pide algo, verde pagada o en remesa. */
export function chipEstado(f: FilaPago): { texto: string; tono: 'falta' | 'duda' | 'seguro' | 'neutro' } {
  const e = estadoPago(f)
  if (e === 'vencida') return { texto: `Vencida · ${f.diasVencida ?? 0} ${f.diasVencida === 1 ? 'día' : 'días'}`, tono: 'falta' }
  if (e === 'en_remesa') return { texto: `En la remesa ${f.remesa!.codigo}`, tono: 'seguro' }
  if (e === 'pagada') return { texto: 'Pagada', tono: 'seguro' }
  if (seCargaSola(f)) return { texto: 'La paga el banco solo', tono: 'neutro' }
  if (e === 'vence_semana' || e === 'sin_vencimiento' || e === 'pagada_parte') return { texto: NOMBRE_ESTADO[e], tono: 'duda' }
  return { texto: 'Por pagar', tono: 'neutro' }
}

/** Domiciliada, tarjeta o prepago: no se pagan desde aquí, el banco las cobra solo. */
export const seCargaSola = (f: FilaPago) => f.forma === 'direct_debit' || f.forma === 'card' || f.forma === 'prepaid'

export const NOMBRE_FORMA: Record<Exclude<FormaPago, null>, string> = {
  transfer: 'Transferencia', direct_debit: 'Domiciliada', card: 'Tarjeta', cash: 'Efectivo', prepaid: 'Saldo prepago',
}
export const nombreForma = (f: FormaPago) => (f ? NOMBRE_FORMA[f] : 'Sin decir')

/** Por qué no se puede meter en una remesa (null = sí se puede). */
export function porQueNoEnRemesa(f: FilaPago): string | null {
  if (estadoPago(f) === 'pagada') return 'ya está pagada'
  if (libre(f) < 0.005) return `ya está en la remesa ${f.remesa!.codigo}`
  if (seCargaSola(f)) return f.forma === 'direct_debit' ? 'la paga el banco solo (domiciliada)' : f.forma === 'card' ? 'se paga con tarjeta' : 'se paga del saldo prepago'
  if (f.forma === 'cash') return 'se paga en efectivo'
  if (!f.conIban) return `${f.proveedor} no tiene IBAN en su ficha`
  if (!f.conCuenta) return `${f.proveedor} no tiene su cuenta de proveedor (400)`
  return null
}

// ── Pestañas ────────────────────────────────────────────────────────────────

export type PestanaPagos = 'por_pagar' | 'vencidas' | 'semana' | 'sin_vencimiento' | 'en_remesa' | 'pagadas'
export const PESTANAS_PAGOS: readonly { id: PestanaPagos; etiqueta: string }[] = [
  { id: 'por_pagar', etiqueta: 'Por pagar' }, { id: 'vencidas', etiqueta: 'Vencidas' }, { id: 'semana', etiqueta: 'Esta semana' },
  { id: 'sin_vencimiento', etiqueta: 'Sin vencimiento' }, { id: 'en_remesa', etiqueta: 'En remesa' }, { id: 'pagadas', etiqueta: 'Pagadas' },
]

export function enPestana(f: FilaPago, p: PestanaPagos): boolean {
  const e = estadoPago(f)
  switch (p) {
    case 'por_pagar': return e !== 'pagada'
    case 'vencidas': return e === 'vencida'
    case 'semana': return e === 'vence_semana'
    case 'sin_vencimiento': return e === 'sin_vencimiento'
    case 'en_remesa': return e !== 'pagada' && f.remesa !== null
    case 'pagadas': return e === 'pagada'
  }
}

export const leerPestana = (s: string | null): PestanaPagos => (PESTANAS_PAGOS.some((p) => p.id === s) ? (s as PestanaPagos) : 'por_pagar')

// ── Cifras de arriba ───────────────────────────────────────────────────────

export interface CifrasPagos {
  porPagar: { importe: number; n: number }
  semana: { importe: number; n: number }
  vencido: { importe: number; n: number; dias: number | null }
  pagadoMes: { importe: number; n: number }
  sinVencimiento: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function cifrasPagos(filas: readonly FilaPago[], pagadoMes: number, pagadasMes: number): CifrasPagos {
  const vivas = filas.filter((f) => estadoPago(f) !== 'pagada')
  const venc = vivas.filter((f) => f.estadoBase === 'vencida')
  const sem = vivas.filter((f) => f.estadoBase === 'vence_semana')
  return {
    porPagar: { importe: r2(vivas.reduce((t, f) => t + f.pendiente, 0)), n: vivas.length },
    semana: { importe: r2(sem.reduce((t, f) => t + f.pendiente, 0)), n: sem.length },
    vencido: { importe: r2(venc.reduce((t, f) => t + f.pendiente, 0)), n: venc.length, dias: venc.length ? Math.max(...venc.map((f) => f.diasVencida ?? 0)) : null },
    pagadoMes: { importe: r2(pagadoMes), n: pagadasMes },
    sinVencimiento: vivas.filter((f) => f.estadoBase === 'sin_vencimiento').length,
  }
}

// ── Filtros ─────────────────────────────────────────────────────────────────

export interface FiltrosPagos { buscar: string; hasta: string | null; forma: FormaPago | 'todas'; local: string | null }

/** Buscar por proveedor, número o importe («1105,30», «1.105,30» o «1105.30»). */
export function cumpleBuscar(f: FilaPago, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  // Con coma, el punto es de los miles («1.105,30»); sin coma, el punto es el de los decimales («1105.30»).
  const comoNumero = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  if (Number.isFinite(comoNumero) && /\d/.test(t) && (Math.abs(f.total - comoNumero) < 0.005 || Math.abs(f.pendiente - comoNumero) < 0.005)) return true
  return f.proveedor.toLowerCase().includes(t) || (f.numero ?? '').toLowerCase().includes(t)
}

export function filtrar(filas: readonly FilaPago[], p: PestanaPagos, fl: FiltrosPagos): FilaPago[] {
  return filas.filter((f) => enPestana(f, p) && cumpleBuscar(f, fl.buscar)
    && (!fl.hasta || p === 'pagadas' || !f.vence || f.vence <= fl.hasta)
    && (fl.forma === 'todas' || f.forma === fl.forma)
    && (!fl.local || f.localId === fl.local))
}

/** Primero lo que vence antes; sin vencimiento al final; a igualdad, la factura más antigua. */
export function ordenarPagos(filas: readonly FilaPago[]): FilaPago[] {
  return [...filas].sort((a, b) => (a.vence ?? '9999') .localeCompare(b.vence ?? '9999') || (a.fecha ?? '').localeCompare(b.fecha ?? ''))
}

// ── La remesa ───────────────────────────────────────────────────────────────

export type EstadoRemesa = 'preparada' | 'fichero' | 'en_banco' | 'pagada' | 'vacia'

/** Los pasos de la ficha (tablero 16): Preparada → Fichero para el banco → En el banco → Pagada. A mano, sin fichero. */
/** Respuesta 7 · Lo que dice el paso «Pagada» cuando el asiento del cargo se validó solo. */
export const VALIDADO_SOLO = 'Asiento validado solo: el cargo cuadra con la remesa'

export function pasosRemesa(estado: EstadoRemesa, aMano: boolean, validadoSolo = false): { etiqueta: string; hecho: boolean; actual: boolean; detalle?: string }[] {
  const pasos = aMano ? ['Preparada', 'En el banco: esperando el cargo', 'Pagada'] : ['Preparada', 'Fichero para el banco', 'En el banco: esperando el cargo', 'Pagada']
  const actual = estado === 'pagada' || estado === 'vacia' ? pasos.length : estado === 'en_banco' ? pasos.length - 1 : aMano ? 1 : 2
  return pasos.map((etiqueta, i) => ({
    etiqueta, hecho: i + 1 < actual || (i + 1 === actual && (estado === 'pagada' || estado === 'vacia')), actual: i + 1 === actual && estado !== 'pagada' && estado !== 'vacia',
    ...(etiqueta === 'Pagada' && estado === 'pagada' && validadoSolo ? { detalle: VALIDADO_SOLO } : {}),
  }))
}

export const NOMBRE_ESTADO_REMESA: Record<EstadoRemesa, string> = {
  preparada: 'Preparada: un IBAN por confirmar', fichero: 'Fichero para el banco', en_banco: 'En el banco: esperando el cargo', pagada: 'Pagada', vacia: 'Sin pagos',
}

/** IBAN para enseñar: «ES21 ···· 0418». */
export const ibanCorto = (pais: string | null, ultimos: string | null) => (ultimos ? `${pais ?? ''} ···· ${ultimos}`.trim() : '—')

/** El día siguiente laborable (lunes a viernes) a partir de hoy, para la fecha de pago por defecto. */
export function proximoLaborable(hoy: string): string {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Respuesta 7 · Bancos, «Esperando este cargo»: si el cargo es justo lo que
 * espera UNA sola remesa entera, se propone sola (y lo demás que cuadre, un pago
 * suelto de otra, queda debajo para elegir); si cuadran dos o más remesas
 * enteras, no se propone ninguna: se elige.
 */
export function remesaQueSePropone<T extends { lineas: readonly string[] | null }>(esperan: readonly T[]): { propuesta: T | null; resto: T[] } {
  const enteras = esperan.filter((x) => x.lineas === null)
  if (enteras.length !== 1) return { propuesta: null, resto: [...esperan] }
  return { propuesta: enteras[0], resto: esperan.filter((x) => x !== enteras[0]) }
}
