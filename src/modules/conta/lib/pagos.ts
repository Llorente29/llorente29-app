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
  /** PC01 · E2b · El IBAN de la ficha se leyó de una factura y nadie lo ha confirmado (la remesa lo para hasta confirmarlo). */
  ibanSinConfirmar: boolean
  /** PC01 · E2b · La factura trae otro IBAN que el de la ficha y nadie ha decidido (antifraude de la C01b). */
  ibanDistinto: boolean
  ibanLeido4: string | null
  conCuenta: boolean
  remesa: { id: string; codigo: string; importe: number } | null
  /** B01 · Cola 1e · Está por revisar: se ve en Pagos con su vencimiento, pero no se puede marcar hasta aprobarla. */
  porRevisar?: boolean
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
    ibanSinConfirmar: f.iban_sin_confirmar === true, ibanDistinto: f.iban_distinto === true, ibanLeido4: str(f.iban_leido4),
    remesa: r ? { id: String(r.id), codigo: String(r.codigo), importe: num(r.importe) } : null,
    porRevisar: f.por_revisar === true,
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
  if (f.porRevisar) return { texto: 'Por revisar · apruébala para pagarla', tono: 'duda' }
  const e = estadoPago(f)
  if (e !== 'en_remesa' && e !== 'pagada' && !seCargaSola(f)) {
    // B01·12 (03/11): la que no se puede pagar lo dice en su fila, como «Por revisar», y no se deja marcar.
    if (libre(f) >= 0.005) {
      if (f.forma === 'cash') return { texto: 'En efectivo · no se paga desde aquí', tono: 'neutro' }
      if (!f.conIban) return { texto: 'Sin IBAN · ponlo para pagarla', tono: 'duda' }
      if (f.ibanDistinto) return { texto: 'Otro IBAN · decide en su ficha', tono: 'duda' }
      if (!f.conCuenta) return { texto: 'Sin cuenta 400 · no se puede pagar', tono: 'duda' }
    }
  }
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
  if (f.porRevisar) return 'está por revisar: apruébala para pagarla'
  if (estadoPago(f) === 'pagada') return 'ya está pagada'
  if (libre(f) < 0.005) return `ya está en la remesa ${f.remesa!.codigo}`
  if (seCargaSola(f)) return f.forma === 'direct_debit' ? 'la paga el banco solo (domiciliada)' : f.forma === 'card' ? 'se paga con tarjeta' : 'se paga del saldo prepago'
  if (f.forma === 'cash') return 'se paga en efectivo'
  if (!f.conIban) return `${f.proveedor} no tiene IBAN en su ficha`
  if (f.ibanDistinto) return `la factura trae otro IBAN (···· ${f.ibanLeido4 ?? '—'}) que el de la ficha de ${f.proveedor}: decide en su ficha si es el nuevo`
  if (!f.conCuenta) return `${f.proveedor} no tiene su cuenta de proveedor (400)`
  return null
}

/**
 * PC01 · E2b · Los proveedores de las marcadas a los que solo les falta el IBAN
 * para entrar en la remesa: «Poner IBAN» en la barra. Las domiciliadas, las de
 * tarjeta, prepago o efectivo NO cuentan como «sin IBAN» (no se pagan por
 * transferencia), ni las ya pagadas o ya en una remesa. Uno por proveedor.
 */
export function sinIbanParaPoner(marcadas: readonly FilaPago[]): { id: string; nombre: string }[] {
  const vistos = new Map<string, string>()
  for (const f of marcadas) {
    if (!f.proveedorId || f.conIban || vistos.has(f.proveedorId)) continue
    if (porQueNoEnRemesa(f) !== `${f.proveedor} no tiene IBAN en su ficha`) continue
    vistos.set(f.proveedorId, f.proveedor)
  }
  return [...vistos].map(([id, nombre]) => ({ id, nombre }))
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
    // Las que están por revisar solo salen en «Por pagar» (con su vencimiento), nunca como vencidas o de la semana: no se pueden pagar todavía.
    case 'vencidas': return !f.porRevisar && e === 'vencida'
    case 'semana': return !f.porRevisar && e === 'vence_semana'
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
  /** B01 · Cola 1e · Las que están por revisar (no se pueden pagar hasta aprobarlas). */
  porRevisar: { importe: number; n: number }
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function cifrasPagos(filas: readonly FilaPago[], pagadoMes: number, pagadasMes: number): CifrasPagos {
  const rev = filas.filter((f) => f.porRevisar && estadoPago(f) !== 'pagada')
  const vivas = filas.filter((f) => !f.porRevisar && estadoPago(f) !== 'pagada')
  const venc = vivas.filter((f) => f.estadoBase === 'vencida')
  const sem = vivas.filter((f) => f.estadoBase === 'vence_semana')
  return {
    porPagar: { importe: r2(vivas.reduce((t, f) => t + f.pendiente, 0)), n: vivas.length },
    semana: { importe: r2(sem.reduce((t, f) => t + f.pendiente, 0)), n: sem.length },
    vencido: { importe: r2(venc.reduce((t, f) => t + f.pendiente, 0)), n: venc.length, dias: venc.length ? Math.max(...venc.map((f) => f.diasVencida ?? 0)) : null },
    pagadoMes: { importe: r2(pagadoMes), n: pagadasMes },
    sinVencimiento: vivas.filter((f) => f.estadoBase === 'sin_vencimiento').length,
    porRevisar: { importe: r2(rev.reduce((t, f) => t + f.pendiente, 0)), n: rev.length },
  }
}

/**
 * B01 · Cola 1e · «Pagar lo de esta semana»: lo vencido y lo que vence esta
 * semana que se puede pagar ya (aprobado, por transferencia, con IBAN, sin
 * remesa). Lo que no se puede, no entra (se dice al lado del botón).
 */
export function loDeEstaSemana(filas: readonly FilaPago[]): { entran: FilaPago[]; fuera: FilaPago[]; total: number } {
  const toca = filas.filter((f) => { const e = estadoPago(f); return e === 'vencida' || e === 'vence_semana' || (f.porRevisar && (f.estadoBase === 'vencida' || f.estadoBase === 'vence_semana')) })
  const entran = toca.filter((f) => porQueNoEnRemesa(f) === null)
  return { entran, fuera: toca.filter((f) => !entran.includes(f)), total: r2(entran.reduce((t, f) => t + libre(f), 0)) }
}

/** B01 · Cola 1e · Si el saldo del banco llega para lo marcado (null: no se sabe el saldo). */
export function llega(saldo: number | null, total: number): boolean | null {
  if (saldo === null) return null
  return saldo + 0.005 >= total
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

export type ColumnaOrdenPagos = 'vence' | 'proveedor' | 'pendiente' | 'estado'
export interface OrdenPagos { columna: ColumnaOrdenPagos; sentido: 'asc' | 'desc' }
export const ORDEN_PAGOS_DEFECTO: OrdenPagos = { columna: 'vence', sentido: 'asc' }
const PESO_ESTADO: Record<EstadoPago, number> = { vencida: 0, vence_semana: 1, por_pagar: 2, pagada_parte: 3, sin_vencimiento: 4, en_remesa: 5, pagada: 6 }

/**
 * Cola 1d · Ordenar por una columna, en los dos sentidos. Por defecto, por
 * vencimiento, lo más cercano primero. Las «sin fecha» van siempre al final,
 * en los dos sentidos. A igualdad, por vencimiento y la factura más antigua.
 */
export function ordenarPagos(filas: readonly FilaPago[], o: OrdenPagos = ORDEN_PAGOS_DEFECTO): FilaPago[] {
  const s = o.sentido === 'asc' ? 1 : -1
  const base = (a: FilaPago, b: FilaPago) => (a.vence ?? '9999').localeCompare(b.vence ?? '9999') || (a.fecha ?? '').localeCompare(b.fecha ?? '')
  return [...filas].sort((a, b) => {
    if (o.columna === 'vence') {
      if (!a.vence !== !b.vence) return a.vence ? -1 : 1
      return s * (a.vence ?? '').localeCompare(b.vence ?? '') || (a.fecha ?? '').localeCompare(b.fecha ?? '')
    }
    const c = o.columna === 'proveedor' ? a.proveedor.localeCompare(b.proveedor, 'es')
      : o.columna === 'pendiente' ? a.pendiente - b.pendiente
      : (a.porRevisar ? 2.5 : PESO_ESTADO[estadoPago(a)]) - (b.porRevisar ? 2.5 : PESO_ESTADO[estadoPago(b)])
    return s * c || base(a, b)
  })
}

/** El orden guardado («vence:asc»), o el de por defecto si no vale. */
export function leerOrdenPagos(t: string | null): OrdenPagos {
  const [c, d] = (t ?? '').split(':')
  return ['vence', 'proveedor', 'pendiente', 'estado'].includes(c) && (d === 'asc' || d === 'desc') ? { columna: c as ColumnaOrdenPagos, sentido: d } : ORDEN_PAGOS_DEFECTO
}
/** Pulsar una columna: la misma, cambia de sentido; otra, ascendente. */
export const cambiarOrden = (o: OrdenPagos, c: ColumnaOrdenPagos): OrdenPagos => (o.columna === c ? { columna: c, sentido: o.sentido === 'asc' ? 'desc' : 'asc' } : { columna: c, sentido: 'asc' })

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
