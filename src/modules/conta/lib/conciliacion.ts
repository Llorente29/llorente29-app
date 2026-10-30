// src/modules/conta/lib/conciliacion.ts
//
// B01 · El motor de conciliación. Para cada movimiento del banco dice qué cree
// que es, con qué confianza y por qué, en una frase:
//
//   · SEGURO: se casa solo y queda en «Lo que ha hecho Folvy» con «Deshacer».
//     Solo los cuatro casos del encargo, y solo si el candidato es ÚNICO:
//       1. mismo importe y misma referencia que una factura o un pago ya apuntado;
//       2. traspaso entre dos cuentas propias (sale de una y entra en la otra
//          el mismo día por el mismo importe);
//       3. cobro de plataforma que cuadra con su liquidación;
//       4. cuota repetida de un contrato conocido confirmada 3 veces.
//   · PROBABLE: «Para confirmar», una línea con el porqué y «Sí» / «Otra cosa».
//   · DUDA: «Por aclarar», diciendo qué falta.
//   · Antes del corte: solo se busca su pareja en el libro traído (P4).
//
// Cruces: facturas recibidas (entera, en partes, varias en un pago), saldo
// traído del proveedor (P5 de la respuesta 2), anticipo 407 (P6), facturas
// emitidas y cobros de clientes, liquidaciones de plataformas (y, sin ellas,
// lo pendiente en su 430: nunca seguro, P7), tarjeta (pide el ticket),
// nóminas y seguros sociales (465/476; sin nómina del mes, «Por aclarar» con
// la 476, respuesta 2.4), préstamos (capital + intereses del cuadro),
// impuestos (303/111/115), comisiones del banco (626), reglas y lo aprendido
// por contraparte.
//
// S01 · El ABONO DE STRIPE O DEL TPV (Redsys): el neto de uno o varios cobros
// por el enlace de pago, menos su comisión. Se casa con esos cobros
// (abonoDePasarela): «seguro» solo si el banco nombra a Stripe y el neto
// cuadra al céntimo con lo que Stripe dijo de cada cobro; el del TPV, como el
// banco no dice la comisión, siempre para confirmar. El asiento: el banco por
// el neto y la 626 por la comisión, contra la cuenta de la pasarela («Stripe ·
// por abonar»), donde quedó cada cobro el día que el cliente pagó.
//
// NADA SE CASA DOS VECES: `conciliar` recorre los movimientos en orden y cada
// candidato (lo que queda de una factura, una liquidación, el otro lado de un
// traspaso, un asiento traído) se gasta al usarse.
//
// Puro: no lee la base. Lo que sabe le llega en `Contexto` (lo monta
// services/bancosService.ts). Pruebas: tests/unit/modules/conta/conciliacionB01.test.ts.
// Importes en CÉNTIMOS.

import { eurosCent, limpiarConcepto } from '@/modules/conta/lib/extractoBanco'

export type Confianza = 'seguro' | 'probable' | 'duda'

export interface Movimiento {
  id: string
  cuentaId: string
  fecha: string
  importeCent: number
  concepto: string
  conceptoComun: string | null
  referencias: string[]
  antesDelCorte: boolean
  /** A quién pagas o quién te paga, limpio (B02: `bank_movement.counterparty`). */
  contraparte?: string | null
  /** El tipo de movimiento del banco, aparte (B02: `bank_movement.movement_type`). */
  tipo?: string | null
}

/** Una cuenta del banco de la empresa: su 572 y sus 4 últimos («···0133»). */
export interface CuentaPropia { id: string; nombre: string; cuenta: string | null; ultimos4?: string | null }
export interface FacturaPendiente {
  id: string; numero: string | null; fecha: string; totalCent: number; pagadoCent: number
  proveedor: string; alias: string[]; terceroId: string | null; cuentaTercero: string
  /** B02: false si está «en revisión»: se propone en ámbar, «factura sin aprobar», nunca preseleccionada. */
  aprobada?: boolean
}
export interface SaldoProveedor { terceroId: string | null; proveedor: string; alias: string[]; cuenta: string; pendienteCent: number }
export interface ProveedorConocido { terceroId: string | null; proveedor: string; alias: string[]; cuentaTercero: string; cuentaAnticipo: string }
export interface Cliente {
  terceroId: string | null; nombre: string; alias: string[]; cuenta: string; pendienteCent: number
  /** PC01 · Sus facturas emitidas con algo por cobrar (la más antigua primero): el cobro las nombra y la base escribe su cobro. */
  facturas?: { id: string; numero: string | null; fecha: string; pendienteCent: number }[]
}

/**
 * PC01 · Qué facturas cobra un ingreso de `imp` céntimos de un cliente: la
 * que queda justo por ese importe, o todas si suman justo eso. Si no cuadra,
 * ninguna (el cobro va a la 430, como antes, y se casa a mano).
 */
export function facturasQueCobra(c: Pick<Cliente, 'facturas'>, imp: number): { id: string; importe: number; numero: string | null }[] {
  const fs = c.facturas ?? []
  const justa = fs.filter((f) => f.pendienteCent === imp)
  if (justa.length === 1) return [{ id: justa[0].id, importe: justa[0].pendienteCent / 100, numero: justa[0].numero }]
  if (fs.length > 1 && fs.reduce((t, f) => t + f.pendienteCent, 0) === imp) return fs.map((f) => ({ id: f.id, importe: f.pendienteCent / 100, numero: f.numero }))
  return []
}
/**
 * S01 · Un cobro por el enlace de pago que espera su abono en el banco
 * (conta_abonos_pasarela_pendientes). Stripe da su neto y su comisión con el
 * cobro; el TPV (Redsys), no: la comisión sale al casar el abono. `cuenta` es
 * la de la pasarela («Stripe · por abonar»); `conAsiento`, si el cobro ya hizo
 * su asiento (sin él, en la pasarela no hay nada que saldar).
 */
export interface CobroPasarela {
  id: string; proveedor: 'stripe' | 'redsys'; fecha: string; brutoCent: number; netoCent: number | null; comisionCent: number | null
  factura: string | null; cliente: string; cuenta: string | null; conAsiento: boolean
}

export interface Liquidacion {
  id: string; plataforma: string; fecha: string; desde: string | null; hasta: string | null; netoCent: number; cuenta430: string; terceroId: string | null
  /**
   * D01 · Liquidación por tienda (las del correo de Uber: una transferencia por
   * marca × local). Con esto se casa por SU regla: la cuenta del banco de la
   * tienda (si está dada), el neto exacto y la fecha dentro de la ventana.
   */
  porTienda?: { tienda: string; cuentaId: string | null; ventana: { desde: string; hasta: string } } | null
}
export interface Plataforma {
  nombre: string; alias: string[]; cuenta430: string; terceroId: string | null
  /** Comisión habitual (0–1) sacada de sus liquidaciones; null si no hay. */
  comisionHabitual: number | null
  /** Lo pendiente de cobro en su 430 por periodos (ventas del día ya asentadas). */
  pendiente: { desde: string; hasta: string; ventasCent: number }[]
}
export interface Nomina { mes: string; ssPendienteCent: number; netoPendienteCent: number; cuenta476: string; cuenta465: string }
export interface Impuesto { modelo: '303' | '111' | '115'; periodo: string; importeCent: number; cuenta: string }
export interface Contrato {
  id: string; tipo: 'prestamo' | 'alquiler' | 'otro'; nombre: string; contiene: string; importeCent: number; confirmaciones: number
  terceroId: string | null
  cuadro: { fecha: string; cuotaCent: number; capitalCent: number; interesesCent: number }[] | null
  cuentaCapital: string | null; cuentaIntereses: string | null; cuentaGasto: string | null
}
/** Una tarjeta de débito de la empresa (respuesta 3): de qué cuenta, sus 4 últimos, quién la lleva y su local. */
export interface Tarjeta { id: string; cuentaId: string; ultimos4: string; titular: string; localId: string | null }
export interface Regla {
  id: string; palabras: string; contiene: string; signo: 1 | -1 | null; cuenta: string; terceroId: string | null
  /** Veces que la persona la ha confirmado sin corregir: a la 3.ª casa sola (B01). */
  confirmaciones?: number
}
/** Lo confirmado antes (por la persona, o traído del libro de Diez) por contraparte. */
export interface Aprendido { contraparte: string; cuenta: string; terceroId: string | null; veces: number }
/** Un asiento del libro con la 572 de esta cuenta (traído de Diez o apuntado a mano) sin movimiento. */
export interface AsientoLibre { id: string; cuentaId: string; fecha: string; importeCent: number; concepto: string; origen: 'traido' | 'pago_factura' | 'liquidacion' | 'otro' }

export interface Contexto {
  cuentas: CuentaPropia[]
  /** Movimientos sin casar de TODAS las cuentas propias (para los traspasos). */
  sinCasar: Movimiento[]
  facturas: FacturaPendiente[]
  saldosTraidos: SaldoProveedor[]
  proveedores: ProveedorConocido[]
  clientes: Cliente[]
  liquidaciones: Liquidacion[]
  plataformas: Plataforma[]
  nominas: Nomina[]
  impuestos: Impuesto[]
  contratos: Contrato[]
  reglas: Regla[]
  aprendido: Aprendido[]
  asientos: AsientoLibre[]
  /** Nombre de uso de cada cuenta («Luz y agua»): se enseña «Luz y agua · 62800000». */
  nombres: Record<string, string>
  cuentas626: string
  cuentas476: string
  /** La caja (570), para los ingresos de efectivo. */
  cuentaCaja?: string | null
  /** Las tarjetas de débito dadas de alta (respuesta 3). */
  tarjetas?: Tarjeta[]
  /** B02 · El nombre de la empresa y sus variantes: en el concepto, delata un traspaso entre sus cuentas. */
  nombresPropios?: string[]
  /**
   * B02 · Adónde va una diferencia pequeña al pagar una factura (Julio, 15/10):
   * de más, 669 «Otros gastos financieros»; de menos, 769 «Otros ingresos
   * financieros»; si el banco dice que es una comisión, 626. Siempre propuesta.
   */
  cuentaDiferenciaGasto?: string
  cuentaDiferenciaIngreso?: string
  /** S01 · Los cobros por el enlace de pago (Stripe y TPV) que esperan su abono. */
  cobrosPasarela?: CobroPasarela[]
  /** S01c · Los albaranes que esperan factura: dicen qué albarán espera una factura que falta. */
  albaranesEsperando?: AlbaranQueEspera[]
}

/** S01c · Un albarán que espera su factura, para decir cuál espera la que falta. */
export interface AlbaranQueEspera { proveedor: string; numero: string | null; fecha: string; totalCent: number | null }

/**
 * S01c · Los números de factura que nombra un concepto del banco: «FACT:
 * 26A/10965», «FRA 2026/0477», «FACTURA Nº 123». Solo lo que va detrás de esas
 * palabras: un número suelto no es una factura.
 */
export function facturasEnConcepto(texto: string): string[] {
  const out: string[] = []
  const re = /\b(?:FACTURAS?|FACT|FRAS?)\b\.?\s*(?:N[º°O]?\.?\s*)?:?\s*([A-Z0-9][A-Z0-9/.-]*\d[A-Z0-9/.-]*)/gi
  for (const m of texto.matchAll(re)) {
    const ref = m[1].replace(/[.-]+$/, '').toUpperCase()
    if (ref.replace(/[^A-Z0-9]/g, '').length >= 3 && !out.includes(ref)) out.push(ref)
  }
  return out
}

/** De dónde sale la propuesta: la píldora de la fila (N17b). */
export type Origen = 'factura' | 'traspaso' | 'regla' | 'liquidacion' | 'historial' | 'libro' | 'contrato' | 'nomina' | 'impuesto' | 'banco' | 'cliente' | 'anticipo' | 'pasarela'

/** El destino tal y como lo recibe bank_casar (20261101T0110). */
export type Destino =
  | { tipo: 'asiento'; entry_id: string; concepto?: string }
  | { tipo: 'factura_recibida'; facturas: { id: string; importe: number }[]; cuenta_tercero: string; tercero_id: string | null; concepto: string; metodo?: string
      /** B02 · La diferencia pequeña (comisión, redondeo), con su cuenta: + de más (gasto), − de menos (ingreso). Nunca se crea sola. */
      diferencia?: { cuenta: string; importe: number; concepto: string } }
  | { tipo: 'liquidacion'; liquidacion_id: string; cuenta_cliente: string; tercero_id: string | null; concepto: string }
  | { tipo: 'traspaso'; otro_movimiento_id: string; concepto: string }
  /**
   * S01 · El abono de Stripe o del TPV: no va a bank_casar directamente, sino a
   * conta_abono_pasarela_casar (bancosNucleo), que hace el asiento (572 por el
   * neto, 626 por la comisión, contra la cuenta de la pasarela) y lo casa.
   */
  | { tipo: 'abono_pasarela'; proveedor: 'stripe' | 'redsys'; cobros: string[]; comision: number; cuenta_comision: string
      /** La cuenta de la pasarela y lo cobrado (bruto) que se salda en ella. */
      cuenta_pasarela: string; cobrado: number; concepto: string }
  | { tipo: 'cuenta' | 'anticipo' | 'contrato' | 'factura_emitida'; lineas: { cuenta: string; importe: number; tercero_id?: string | null; concepto?: string }[];
      /** PC01 · Solo «factura_emitida»: las facturas que cobra (bank_casar escribe su cobro). */
      facturas?: { id: string; importe: number }[];
      tercero_id?: string | null; contrato_id?: string; concepto: string }

export interface Decision {
  movimientoId: string
  confianza: Confianza
  /** «Lo que Folvy cree que es», el título de la línea. */
  que: string
  /** El porqué, en una línea. */
  porque: string
  destino: Destino | null
  /** Lo que falta (en «Por aclarar»). */
  falta: string | null
  /** Antes del corte y sin pareja en el libro (solo informativo). */
  antesDelCorteSinPareja: boolean
  /** Pago con tarjeta: se pide el ticket. */
  pideTicket: boolean
  reglaId: string | null
  /** La contraparte que se aprende al confirmar. */
  contraparte: string | null
  /** El otro lado de un traspaso: lo casa la decisión de este movimiento; no se hace nada aparte. */
  otroLadoDe: string | null
  /** La tarjeta que pagó, si es un pago con tarjeta dada de alta. */
  tarjetaId: string | null
  /** B02 · La píldora: de dónde sale la propuesta. */
  origen: Origen | null
  /** B02 · Punto verde: «lo casaría solo, pero aún no puedo». Viene marcado para confirmar en bloque. */
  preseleccionar: boolean
  /** B02 · Los 4 últimos de una tarjeta que no está dada de alta: se pregunta UNA vez por tarjeta, no aquí. */
  tarjetaDesconocida: string | null
  /** B02 · Cuando hay que elegir (un traspaso con dos cuentas posibles): cada opción con su destino. */
  alternativas: { etiqueta: string; destino: Destino }[]
  /** B02 · Lo que queda por casar de la factura después de este pago (pagos en parte). */
  quedaPorCasarCent: number | null
  /** B02 · La factura propuesta está «en revisión»: confirmar el pago no la aprueba. */
  facturaSinAprobar: boolean
}

const euros = (c: number) => c / 100
const abs = Math.abs

/** «Luz y agua · 62800000»: nunca un código a secas, nunca «subcuenta». */
export function nombreCuenta(ctx: Pick<Contexto, 'nombres'>, codigo: string): string {
  const n = ctx.nombres[codigo]?.trim().replace(/[.\s]+$/, '')
  return n ? `${n} · ${codigo}` : codigo
}

export const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** ¿El concepto nombra a este tercero? (por cualquiera de sus nombres, sin acentos ni signos). */
export function nombra(concepto: string, alias: readonly string[]): boolean {
  const c = ` ${normal(concepto)} `
  return alias.some((a) => {
    const n = normal(a).replace(/\b(S ?L|S ?A|S ?L ?U|SLU|SL|SA|SC|CB)\b/g, '').trim()
    return n.length >= 3 && c.includes(` ${n} `)
  })
}

/** La contraparte de un concepto: lo que queda quitando la operación, números y siglas sociales. */
export function contraparte(concepto: string): string | null {
  const limpio = limpiarConcepto(concepto)
  const resto = limpio.split(' ').filter((p) => p === p.toUpperCase() && /[A-ZÑ]{2,}/.test(p) && !/^\d/.test(p)).join(' ')
  const n = normal(resto).replace(/\b(SL|SA|SLU|SC|CB|REF)\b/g, '').replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim()
  return n.length >= 3 ? n : null
}

const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Lo que va quedando de cada candidato mientras se recorre un lote: nada se casa dos veces. */
interface Gastado { facturas: Map<string, number>; liquidaciones: Set<string>; movimientos: Set<string>; asientos: Set<string>; saldos: Map<string, number>; pendiente430: Map<string, number>; pasarela: Set<string> }
const nuevoGastado = (): Gastado => ({ facturas: new Map(), liquidaciones: new Set(), movimientos: new Set(), asientos: new Set(), saldos: new Map(), pendiente430: new Map(), pasarela: new Set() })

function base(m: Movimiento): Omit<Decision, 'confianza' | 'que' | 'porque' | 'destino'> {
  return { movimientoId: m.id, falta: null, antesDelCorteSinPareja: false, pideTicket: false, reglaId: null, contraparte: contraparteDe(m), otroLadoDe: null, tarjetaId: null,
    origen: null, preseleccionar: false, tarjetaDesconocida: null, alternativas: [], quedaPorCasarCent: null, facturaSinAprobar: false }
}

/** La contraparte con la que se aprende: la limpia del banco si la hay (B02); si no, la sacada del concepto. */
export function contraparteDe(m: Pick<Movimiento, 'concepto' | 'contraparte'>): string | null {
  if (m.contraparte) { const n = normal(m.contraparte); return n.length >= 3 ? n : null }
  return contraparte(m.concepto)
}

/** El texto en el que se buscan nombres y referencias: el del banco, la contraparte limpia y las referencias. */
const textoDe = (m: Movimiento) => [m.concepto, m.contraparte ?? '', ...m.referencias].join(' ')

/** La píldora que corresponde a una decisión, si la rama no la dijo. */
function conOrigen(d: Decision): Decision {
  if (d.origen) return d
  const t = d.destino?.tipo ?? d.alternativas[0]?.destino.tipo
  const origen: Origen | null = d.reglaId ? 'regla' : t === 'factura_recibida' ? 'factura' : t === 'traspaso' ? 'traspaso' : t === 'liquidacion' ? 'liquidacion'
    : t === 'asiento' ? 'libro' : t === 'contrato' ? 'contrato' : t === 'anticipo' ? 'anticipo' : t === 'factura_emitida' ? 'cliente'
    : t === 'abono_pasarela' ? 'pasarela' : null
  return { ...d, origen }
}

/** Una decisión para un movimiento, sin gastar nada (para el que se mira suelto). */
export function decidir(m: Movimiento, ctx: Contexto): Decision {
  return conOrigen(decidirCon(m, ctx, nuevoGastado()))
}

/** Un lote entero, en orden de fecha: cada candidato se usa una sola vez. */
export function conciliar(movs: readonly Movimiento[], ctx: Contexto): Decision[] {
  const g = nuevoGastado()
  const orden = [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
  const porId = new Map<string, Decision>()
  for (const m of orden) {
    if (g.movimientos.has(m.id)) continue // ya casado como el otro lado de un traspaso
    porId.set(m.id, conOrigen(decidirCon(m, ctx, g)))
  }
  // El otro lado de un traspaso queda casado por el mismo asiento.
  for (const d of porId.values()) {
    if (d.destino?.tipo === 'traspaso') {
      const otro = d.destino.otro_movimiento_id
      if (!porId.has(otro) && movs.some((x) => x.id === otro)) {
        porId.set(otro, { ...d, movimientoId: otro, destino: null, otroLadoDe: d.movimientoId })
      }
    }
  }
  return movs.map((m) => porId.get(m.id)!).filter(Boolean)
}

/** La referencia del pago que pone el banco a una transferencia de Uber («LIQ. OP. N 123456789012345»): se guarda en el concepto del cobro. */
export function referenciaDeLiquidacion(texto: string): string | null {
  const m = texto.match(/LIQ\.?\s*OP\.?\s*N\.?\s*(\d{10,20})/i)
  return m ? `LIQ. OP. N ${m[1]}` : null
}

/**
 * D01 · La ventana de cobro de una liquidación por tienda: del día siguiente al
 * fin del periodo a cuatro días después (Uber paga el lunes, o el martes con
 * fecha valor del lunes). Medido el 15/10 sobre los dos ingresos del extracto.
 */
export function ventanaDeCobro(hasta: string): { desde: string; hasta: string } {
  const d = (n: number) => new Date(Date.parse(`${hasta}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
  return { desde: d(1), hasta: d(5) }
}

/**
 * D01 · La cuenta del banco donde cobra una tienda (Julio, 16/10): cada local cobra en
 * la suya y una marca puede cobrar en otra. La de la tienda (marca × local) manda; si no
 * la tiene, la del local, si el local tiene UNA sola; si no, ninguna (se casa por importe y fecha).
 */
export function cuentaDeTienda(t: { cuentaId: string | null; localId: string | null }, bancos: readonly { id: string; localId: string | null }[]): string | null {
  if (t.cuentaId) return t.cuentaId
  const xs = t.localId ? bancos.filter((b) => b.localId === t.localId) : []
  return xs.length === 1 ? xs[0].id : null
}

/** ¿El banco nombra a Stripe? ¿Y al TPV del banco (Redsys)? */
export const nombraStripe = (texto: string) => /\bSTRIPE\b/.test(normal(texto))
export const nombraTpv = (texto: string) => /\b(REDSYS|TPV|TPVV|DATAFONO|COMERCIO ELECTRONICO)\b/.test(normal(texto))

/** La comisión más alta que se acepta en un abono del TPV, sobre lo cobrado (el banco no la dice). */
export const COMISION_TPV_MAXIMA = 0.03

export interface AbonoPasarela {
  proveedor: 'stripe' | 'redsys'
  cobros: CobroPasarela[]
  brutoCent: number
  comisionCent: number
  confianza: Confianza
  /** «Abono de Stripe del 03/11 al 05/11 · 3 cobros». */
  que: string
  /** «Abono de Stripe del 3 al 5/11: 3 cobros, 120,00 € menos 1,80 € de comisión.» y por qué cuadra. */
  porque: string
}

/** «del 05/11» o «del 03/11 al 05/11». */
function periodoDe(cobros: readonly CobroPasarela[]): string {
  const desde = cobros[0].fecha, hasta = cobros[cobros.length - 1].fecha
  return desde === hasta ? `del ${ddmm(desde)}` : `del ${ddmm(desde)} al ${ddmm(hasta)}`
}

/**
 * S01 · ¿Es este ingreso el abono de Stripe o del TPV? Busca, entre los cobros
 * por el enlace que esperan su abono (cobrados ese día o en los 31 anteriores,
 * sin gastar), un tramo SEGUIDO en el tiempo que cuadre:
 *   · Stripe: la suma de sus netos es exactamente el ingreso. Si el banco nombra
 *     a Stripe y el tramo es único, «seguro»; si no, para confirmar.
 *   · TPV (Redsys): el banco tiene que nombrar al TPV, y lo cobrado menos el
 *     ingreso (la comisión) va de 0 al 3 %. Siempre para confirmar: el banco no
 *     dice la comisión. Si hay varios tramos, el de menos comisión.
 * Puro: no gasta nada (lo hace quien lo llama). Null si nada cuadra.
 */
export function abonoDePasarela(m: Movimiento, cobros: readonly CobroPasarela[], usados: ReadonlySet<string> = new Set()): AbonoPasarela | null {
  const imp = m.importeCent
  if (imp <= 0 || m.antesDelCorte) return null
  const txt = textoDe(m)
  const tramos = (prov: 'stripe' | 'redsys') => {
    const xs = cobros.filter((c) => c.proveedor === prov && !usados.has(c.id) && c.fecha <= m.fecha && dias(c.fecha, m.fecha) <= 31)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
    const out: CobroPasarela[][] = []
    for (let i = 0; i < xs.length; i++) {
      for (let j = i; j < xs.length; j++) out.push(xs.slice(i, j + 1))
    }
    return out
  }
  const suma = (xs: readonly CobroPasarela[], f: (c: CobroPasarela) => number) => xs.reduce((t, c) => t + f(c), 0)
  const frase = (prov: 'stripe' | 'redsys', xs: CobroPasarela[], comision: number) =>
    `Abono ${prov === 'stripe' ? 'de Stripe' : 'del TPV'} ${periodoDe(xs)}: ${xs.length} ${xs.length === 1 ? 'cobro' : 'cobros'}, ${eurosCent(suma(xs, (c) => c.brutoCent))} menos ${eurosCent(comision)} de comisión.`

  // Stripe: el neto exacto de cada cobro.
  const deStripe = tramos('stripe').filter((xs) => xs.every((c) => c.netoCent !== null) && suma(xs, (c) => c.netoCent!) === imp)
  if (deStripe.length) {
    const xs = deStripe.sort((a, b) => b[b.length - 1].fecha.localeCompare(a[a.length - 1].fecha) || a.length - b.length)[0]
    const bruto = suma(xs, (c) => c.brutoCent), comision = bruto - imp
    const nombra = nombraStripe(txt)
    const seguro = nombra && deStripe.length === 1
    return { proveedor: 'stripe', cobros: xs, brutoCent: bruto, comisionCent: comision, confianza: seguro ? 'seguro' : 'probable',
      que: `Abono de Stripe ${periodoDe(xs)} · ${xs.length} ${xs.length === 1 ? 'cobro' : 'cobros'}`,
      porque: `${frase('stripe', xs, comision)} ` + (seguro ? 'Cuadra al céntimo con lo que Stripe dijo de cada cobro.'
        : !nombra ? 'Cuadra al céntimo con lo que Stripe dijo de cada cobro, pero el banco no nombra a Stripe: confírmalo.'
        : `Cuadra al céntimo, pero hay ${deStripe.length} formas de juntar los cobros que dan lo mismo: confirma que son estos.`) }
  }

  // TPV: el banco lo nombra y la comisión es pequeña.
  if (!nombraTpv(txt)) return null
  const delTpv = tramos('redsys').map((xs) => ({ xs, bruto: suma(xs, (c) => c.brutoCent) }))
    .filter(({ bruto }) => bruto >= imp && bruto - imp <= Math.round(bruto * COMISION_TPV_MAXIMA))
    .sort((a, b) => (a.bruto - imp) - (b.bruto - imp) || b.xs[b.xs.length - 1].fecha.localeCompare(a.xs[a.xs.length - 1].fecha))
  if (!delTpv.length) return null
  const { xs, bruto } = delTpv[0]
  const comision = bruto - imp
  return { proveedor: 'redsys', cobros: xs, brutoCent: bruto, comisionCent: comision, confianza: 'probable',
    que: `Abono del TPV ${periodoDe(xs)} · ${xs.length} ${xs.length === 1 ? 'cobro' : 'cobros'}`,
    porque: `${frase('redsys', xs, comision)} El banco no dice la comisión: sale de lo cobrado menos lo abonado. Confírmalo.` }
}

/** ¿Es un pago con tarjeta? (concepto común 12 de la AEB, o lo dice el concepto) */
export const esTarjeta = (m: Pick<Movimiento, 'conceptoComun' | 'concepto'>) => m.conceptoComun === '12' || /\bTARJ(ETA)?\b|COMPRA TARJ/i.test(m.concepto)

/**
 * Los últimos 4 dígitos de la tarjeta que trae el concepto: primero los que van
 * detrás de una máscara («****1234», «XXXX 1234»); si no, cada grupo suelto de
 * cuatro cifras, en orden. El motor se queda con el que sea de una tarjeta
 * dada de alta en esa cuenta.
 */
export function digitosTarjeta(texto: string): string[] {
  const enmascarados = [...texto.matchAll(/[*xX•·]{2,}\s*(\d{4})\b/g)].map((x) => x[1])
  const sueltos = [...texto.matchAll(/(?:^|[^\d])(\d{4})(?=$|[^\d])/g)].map((x) => x[1])
  return [...new Set([...enmascarados, ...sueltos])]
}

function decidirCon(m: Movimiento, ctx: Contexto, g: Gastado): Decision {
  // Respuesta 3: el pago con una tarjeta de débito dada de alta sabe quién la lleva y de qué local es.
  if (!esTarjeta(m) || m.importeCent > 0 || m.antesDelCorte) return decidirSin(m, ctx, g)
  const delBanco = (ctx.tarjetas ?? []).filter((t) => t.cuentaId === m.cuentaId)
  const digitos = digitosTarjeta(`${m.concepto} ${m.referencias.join(' ')}`)
  const t = delBanco.find((x) => digitos.includes(x.ultimos4))
  if (!t) {
    // Una tarjeta que no está dada de alta: «¿de quién es la tarjeta ···3085?» se
    // pregunta UNA vez por tarjeta (B02, preguntasDeTarjeta), no en cada
    // movimiento. El movimiento sigue su camino: si una regla o lo aprendido sabe
    // a qué va (las recargas de saldo prepago), lo propone sin pedir nada más.
    // Un año suelto no es una tarjeta.
    const ultimos = digitos.find((x) => !/^(19|20)\d\d$/.test(x))
    const d = decidirSin(m, ctx, g)
    return ultimos ? { ...d, tarjetaDesconocida: ultimos } : d
  }
  const d = decidirSin(m, ctx, g, t)
  const destino = d.destino && d.destino.tipo !== 'asiento' && d.destino.tipo !== 'traspaso' && t.localId ? { ...d.destino, local_id: t.localId } : d.destino
  return { ...d, tarjetaId: t.id, destino }
}

function decidirSin(m: Movimiento, ctx: Contexto, g: Gastado, tj?: Tarjeta): Decision {
  const b = base(m)
  const imp = m.importeCent
  const entra = imp > 0
  const txt = textoDe(m)

  // ── P4 · Antes del corte: solo su pareja en el libro ─────────────────────
  if (m.antesDelCorte) {
    const parejas = ctx.asientos.filter((a) => a.cuentaId === m.cuentaId && a.importeCent === imp && !g.asientos.has(a.id) && abs(dias(a.fecha, m.fecha)) <= 5)
    const exacta = parejas.filter((a) => a.fecha === m.fecha)
    const elegida = exacta.length === 1 ? exacta[0] : parejas.length === 1 ? parejas[0] : null
    if (elegida) {
      g.asientos.add(elegida.id)
      return { ...b, confianza: exacta.length === 1 ? 'seguro' : 'probable', que: `Ya está en el libro · ${elegida.concepto}`,
        porque: `Antes del corte: el libro traído tiene este ${entra ? 'cobro' : 'pago'} el ${ddmm(elegida.fecha)} por el mismo importe; solo se enlaza.`,
        destino: { tipo: 'asiento', entry_id: elegida.id } }
    }
    return { ...b, confianza: 'duda', que: 'Antes del corte · sin pareja en el libro', antesDelCorteSinPareja: true,
      porque: parejas.length > 1 ? `Hay ${parejas.length} apuntes del libro con este importe esos días: no sé cuál es.` : 'No hay ningún apunte del banco en el libro con este importe esos días. Solo informativo.',
      destino: null }
  }

  // ── 1 · Un pago o cobro ya apuntado (asiento con la 572 de esta cuenta) ───
  const apuntados = ctx.asientos.filter((a) => a.origen !== 'traido' && a.cuentaId === m.cuentaId && a.importeCent === imp && !g.asientos.has(a.id) && abs(dias(a.fecha, m.fecha)) <= 10)
  if (apuntados.length === 1) {
    const a = apuntados[0]
    g.asientos.add(a.id)
    return { ...b, confianza: a.fecha === m.fecha ? 'seguro' : 'probable', que: a.concepto,
      porque: `Ya estaba apuntado el ${ddmm(a.fecha)} por el mismo importe: se enlaza, no se crea otro asiento.`, destino: { tipo: 'asiento', entry_id: a.id } }
  }

  // ── 2 · Traspaso entre dos cuentas propias ───────────────────────────────
  // Mismo importe con signo contrario, el mismo día o ±2 días, en otra cuenta de
  // la empresa. El nombre de la empresa en el concepto lo confirma (B02).
  const nombraEmpresa = (ctx.nombresPropios ?? []).some((n) => nombra(txt, [n]))
  const otros = ctx.sinCasar.filter((o) => o.cuentaId !== m.cuentaId && o.importeCent === -imp && !g.movimientos.has(o.id) && o.id !== m.id && abs(dias(o.fecha, m.fecha)) <= 2)
  if (otros.length >= 1) {
    const mismoDia = otros.filter((o) => o.fecha === m.fecha)
    const o = mismoDia.length === 1 ? mismoDia[0] : otros.length === 1 ? otros[0] : null
    if (o) {
      const dest = ctx.cuentas.find((c) => c.id === o.cuentaId)
      const orig = ctx.cuentas.find((c) => c.id === m.cuentaId)
      g.movimientos.add(o.id); g.movimientos.add(m.id)
      const desde = entra ? dest : orig, hacia = entra ? orig : dest
      return { ...b, confianza: o.fecha === m.fecha || nombraEmpresa ? 'seguro' : 'probable', que: 'Traspaso entre tus cuentas', contraparte: null, origen: 'traspaso',
        porque: o.fecha === m.fecha
          ? `Sale de ${desde?.nombre ?? 'una cuenta'} y entra en ${hacia?.nombre ?? 'la otra'} el mismo día, mismo importe.`
          : `Sale de ${desde?.nombre ?? 'una cuenta'} el ${ddmm(entra ? o.fecha : m.fecha)} y entra en ${hacia?.nombre ?? 'la otra'} el ${ddmm(entra ? m.fecha : o.fecha)}, mismo importe${nombraEmpresa ? ' y a nombre de la empresa' : ''}.`,
        destino: { tipo: 'traspaso', otro_movimiento_id: o.id, concepto: `Traspaso de ${desde?.nombre ?? ''} a ${hacia?.nombre ?? ''}`.trim() } }
    }
  }
  // Un solo lado subido (B02): el banco lo llama traspaso o lo manda la propia
  // empresa. Se propone contra la 572 de la otra cuenta; si hay varias, se elige.
  if (otros.length === 0 && (nombraEmpresa || /\bTRASPASO/i.test(txt))) {
    const otras = ctx.cuentas.filter((c) => c.id !== m.cuentaId && c.cuenta)
    const etiqueta = (c: CuentaPropia) => (c.ultimos4 ? `···${c.ultimos4}` : c.nombre)
    const destinoDe = (c: CuentaPropia): Destino => ({ tipo: 'cuenta', concepto: entra ? `Traspaso desde ${c.nombre}` : `Traspaso a ${c.nombre}`,
      lineas: [{ cuenta: c.cuenta!, importe: euros(abs(imp)) }] })
    const sentido = entra ? 'desde' : 'a'
    if (otras.length === 1) {
      return { ...b, confianza: 'probable', origen: 'traspaso', contraparte: null, que: `Traspaso ${sentido} tu cuenta ${etiqueta(otras[0])}`,
        porque: `${nombraEmpresa ? 'Lo manda tu propia empresa' : 'El banco lo llama traspaso'} y la otra cuenta aún no tiene este movimiento subido: cuando lo subas, se enlaza solo.`,
        destino: destinoDe(otras[0]) }
    }
    if (otras.length > 1) {
      return { ...b, confianza: 'probable', origen: 'traspaso', contraparte: null, que: `Traspaso ${sentido} otra cuenta tuya`,
        porque: `${nombraEmpresa ? 'Lo manda tu propia empresa' : 'El banco lo llama traspaso'}, pero no dice de qué cuenta: elige ${otras.map(etiqueta).join(' o ')}.`,
        destino: null, alternativas: otras.map((c) => ({ etiqueta: `${entra ? 'Desde' : 'A'} ${etiqueta(c)}`, destino: destinoDe(c) })) }
    }
  }

  // ── 2b · S01 · Abono de Stripe o del TPV ─────────────────────────────────
  if (entra && ctx.cobrosPasarela?.length) {
    const a = abonoDePasarela(m, ctx.cobrosPasarela, g.pasarela)
    if (a) {
      const sinAsiento = a.cobros.find((c) => !c.conAsiento || !c.cuenta)
      if (sinAsiento) {
        return { ...b, confianza: 'duda', origen: 'pasarela', contraparte: null, que: a.que, falta: `el asiento del cobro de la ${sinAsiento.factura ?? 'factura'} (${sinAsiento.cliente})`,
          porque: `${a.porque} Pero el cobro de la ${sinAsiento.factura ?? 'factura'} aún no tiene su asiento, y sin él no hay nada por abonar que saldar: mira el historial de la factura.`, destino: null }
      }
      for (const c of a.cobros) g.pasarela.add(c.id)
      return { ...b, confianza: a.confianza, origen: 'pasarela', contraparte: null, que: a.que, porque: a.porque,
        destino: { tipo: 'abono_pasarela', proveedor: a.proveedor, cobros: a.cobros.map((c) => c.id), comision: euros(a.comisionCent),
          cuenta_comision: ctx.cuentas626, cuenta_pasarela: a.cobros[0].cuenta!, cobrado: euros(a.brutoCent), concepto: a.que } }
    }
  }

  // ── 3 · Contrato con cuota (préstamo, alquiler) ──────────────────────────
  if (!entra) {
    const cs = ctx.contratos.filter((c) => nombra(txt, [c.contiene]) && c.importeCent === -imp)
    if (cs.length === 1) {
      const c = cs[0]
      const seguro = c.confirmaciones >= 3
      if (c.tipo === 'prestamo') {
        const fila = c.cuadro?.find((f) => f.cuotaCent === -imp && f.fecha.slice(0, 7) === m.fecha.slice(0, 7))
        if (!fila || !c.cuentaCapital || !c.cuentaIntereses) {
          return { ...b, confianza: 'duda', que: `Cuota de ${c.nombre}`, falta: 'el cuadro de amortización de este mes',
            porque: `Es la cuota de ${c.nombre}, pero sin el cuadro de amortización no sé cuánto es capital y cuánto intereses.`, destino: null }
        }
        return { ...b, confianza: seguro ? 'seguro' : 'probable', que: `Cuota de ${c.nombre}`,
          porque: `Cuota ${seguro ? `confirmada ${c.confirmaciones} veces` : 'de un contrato conocido'}: ${eurosCent(fila.capitalCent)} de capital (${nombreCuenta(ctx, c.cuentaCapital)}) y ${eurosCent(fila.interesesCent)} de intereses (${nombreCuenta(ctx, c.cuentaIntereses)}), según su cuadro.`,
          destino: { tipo: 'contrato', contrato_id: c.id, tercero_id: c.terceroId, concepto: `Cuota de ${c.nombre}`,
            lineas: [{ cuenta: c.cuentaCapital, importe: euros(fila.capitalCent), concepto: 'Capital' }, { cuenta: c.cuentaIntereses, importe: euros(fila.interesesCent), concepto: 'Intereses' }] } }
      }
      const gasto = c.cuentaGasto ?? ''
      return { ...b, confianza: seguro ? 'seguro' : 'probable', que: `Cuota de ${c.nombre}`,
        porque: seguro ? `Cuota repetida de ${c.nombre}, confirmada ${c.confirmaciones} veces.` : `Mismo importe que la cuota de ${c.nombre} (confirmada ${c.confirmaciones} ${c.confirmaciones === 1 ? 'vez' : 'veces'}; a la 3.ª se casa sola).`,
        destino: { tipo: 'contrato', contrato_id: c.id, tercero_id: c.terceroId, concepto: `Cuota de ${c.nombre}`, lineas: [{ cuenta: gasto, importe: euros(-imp) }] } }
    }
  }

  // ── 4 · Cobro de plataforma ──────────────────────────────────────────────
  if (entra) {
    const plats = ctx.plataformas.filter((p) => nombra(txt, [p.nombre, ...p.alias]))
    // D01 · Por tienda (plan de Uber aprobado el 15/10): misma cuenta del banco
    // que su marca × local, neto exacto y fecha en la ventana. Una → propuesta;
    // varias → por aclarar, enseñando cuáles; ninguna → sigue la regla de siempre.
    const enVentana = ctx.liquidaciones.filter((l) => l.porTienda && !g.liquidaciones.has(l.id) && l.netoCent === imp
      && m.fecha >= l.porTienda.ventana.desde && m.fecha <= l.porTienda.ventana.hasta && (!l.porTienda.cuentaId || l.porTienda.cuentaId === m.cuentaId)
      && (plats.length === 0 || plats.some((p) => p.nombre === l.plataforma)))
    const ref = referenciaDeLiquidacion(txt)
    if (enVentana.length === 1) {
      const l = enVentana[0], t = l.porTienda!
      g.liquidaciones.add(l.id)
      const periodo = l.desde && l.hasta ? ` ${ddmm(l.desde)}–${ddmm(l.hasta)}` : ''
      return { ...b, confianza: 'probable', que: `Cobro de ${l.plataforma} · ${t.tienda}${periodo}`,
        porque: `Cuadra con su liquidación${periodo} de ${t.tienda}: neto ${eurosCent(l.netoCent)} exacto${t.cuentaId ? ', en la cuenta de esa tienda' : ''} y llegado ${ddmm(m.fecha)}.` +
          (t.cuentaId ? '' : ' La tienda no tiene su cuenta del banco: casa por importe y fecha.'),
        destino: { tipo: 'liquidacion', liquidacion_id: l.id, cuenta_cliente: l.cuenta430, tercero_id: l.terceroId,
          concepto: `Cobro de ${l.plataforma} · ${t.tienda}${periodo}${ref ? ` · ${ref}` : ''}` } }
    }
    if (enVentana.length > 1) {
      return { ...b, confianza: 'duda', que: `Cobro de ${enVentana[0].plataforma}`, falta: `cuál de las ${enVentana.length} liquidaciones es`,
        porque: `Por aclarar: ${enVentana.length} liquidaciones con el mismo neto (${eurosCent(imp)}) esos días: ${enVentana.map((l) => `${l.porTienda!.tienda}${l.desde && l.hasta ? ` ${ddmm(l.desde)}–${ddmm(l.hasta)}` : ''}`).join('; ')}. Elige la suya.`,
        destino: null }
    }
    const liqs = ctx.liquidaciones.filter((l) => !l.porTienda && !g.liquidaciones.has(l.id) && l.netoCent === imp && dias(l.fecha, m.fecha) >= -3 && dias(l.fecha, m.fecha) <= 30
      && (plats.length === 0 || plats.some((p) => p.nombre === l.plataforma)))
    if (liqs.length === 1 && (plats.length > 0 || ctx.liquidaciones.filter((l) => !l.porTienda && l.netoCent === imp).length === 1)) {
      const l = liqs[0]
      g.liquidaciones.add(l.id)
      const periodo = l.desde && l.hasta ? ` ${ddmm(l.desde)}–${ddmm(l.hasta)}` : ''
      return { ...b, confianza: plats.length > 0 ? 'seguro' : 'probable', que: `Cobro de ${l.plataforma} · liquidación${periodo}`,
        porque: `${plats.length > 0 ? 'Casado solo: cuadra' : 'Cuadra'} con su liquidación${periodo} (neto ${eurosCent(l.netoCent)}).`,
        destino: { tipo: 'liquidacion', liquidacion_id: l.id, cuenta_cliente: l.cuenta430, tercero_id: l.terceroId, concepto: `Cobro de ${l.plataforma}${periodo}` } }
    }
    if (plats.length === 1) {
      // Sin su liquidación no se casa: se dice que falta, sin inventar nada (B02).
      // En cuanto la liquidación exista, la rama de arriba la casa sin tocar nada.
      const p = plats[0]
      return { ...b, confianza: 'duda', origen: 'liquidacion', que: `Cobro de ${p.nombre} · falta su liquidación`, falta: 'su liquidación',
        porque: `Es un cobro de ${p.nombre}, pero no hay ninguna liquidación de ${eurosCent(imp)} con la que cuadre: cuando llegue, lo caso con ella.`, destino: null }
    }
  }

  // ── 5 · Facturas recibidas (pagos) ───────────────────────────────────────
  // Las aprobadas y, en ámbar, las «en revisión» (B02: «factura sin aprobar»,
  // nunca preseleccionada; confirmar el pago no la aprueba).
  if (!entra) {
    const pagar = -imp
    const queda = (f: FacturaPendiente) => f.totalCent - f.pagadoCent - (g.facturas.get(f.id) ?? 0)
    const sinAprobar = (f: FacturaPendiente) => f.aprobada === false
    const marca = (fs: FacturaPendiente[]) => (fs.some(sinAprobar) ? ' · factura sin aprobar' : '')
    const nota = (fs: FacturaPendiente[]) => (fs.some(sinAprobar) ? ' Está en revisión: confirmar el pago no la aprueba.' : '')
    const gastar = (f: FacturaPendiente, c: number) => g.facturas.set(f.id, (g.facturas.get(f.id) ?? 0) + c)
    const vivas = ctx.facturas.filter((f) => queda(f) > 0)
    const conRef = vivas.filter((f) => queda(f) === pagar && f.numero && refEn(txt, f.numero))
    if (conRef.length === 1) {
      const f = conRef[0]
      gastar(f, pagar)
      return { ...b, confianza: sinAprobar(f) ? 'probable' : 'seguro', facturaSinAprobar: sinAprobar(f), origen: 'factura',
        que: `Pago de la factura ${f.numero} de ${f.proveedor}${marca([f])}`,
        porque: `${sinAprobar(f) ? '' : 'Casado solo: '}mismo importe y misma referencia (${f.numero}) que la factura pendiente del ${ddmm(f.fecha)}.${nota([f])}`,
        destino: factura(f, pagar, m) }
    }
    const delProv = vivas.filter((f) => nombra(txt, [f.proveedor, ...f.alias]))
    // S01c · El banco nombra una factura («FACT: 26A/10965») que no está pendiente en Sumied:
    // se dice que falta, con el albarán que la espera. Nunca se casa con otra de distinto número.
    const refs = facturasEnConcepto(m.concepto)
    if (refs.length > 0 && !vivas.some((f) => f.numero && refs.some((r) => refEn(r, f.numero!)))) {
      const quien = delProv[0]?.proveedor ?? ctx.proveedores.find((x) => nombra(txt, [x.proveedor, ...x.alias]))?.proveedor ?? null
      if (quien) {
        const ref = refs[0]
        const alb = (ctx.albaranesEsperando ?? []).filter((a) => normal(a.proveedor) === normal(quien) && a.totalCent === pagar)
        const espera = alb.length === 1 ? ` La espera el albarán ${alb[0].numero ?? ''} del ${ddmm(alb[0].fecha)}.`.replace('  ', ' ') : ''
        return { ...b, confianza: 'duda', origen: 'factura', falta: `la factura ${ref}`,
          que: `Falta la factura ${ref} de ${quien} · ${eurosCent(pagar)}`,
          porque: `El banco dice que pagas la factura ${ref} de ${quien}, y no la tengo entre las pendientes: no la caso con otra.${espera} Súbela (o reenvíala a tu correo de facturas) y la caso con este pago.`,
          destino: null }
      }
    }
    const exactas = delProv.filter((f) => queda(f) === pagar)
    if (exactas.length >= 1) {
      // La aprobada antes que la que está en revisión; entre iguales, la más antigua (diciéndolo).
      const orden = [...exactas].sort((a, c) => Number(sinAprobar(a)) - Number(sinAprobar(c)) || a.fecha.localeCompare(c.fecha))
      const f = orden[0]
      gastar(f, pagar)
      const varias = exactas.length > 1
      return { ...b, confianza: 'probable', preseleccionar: !varias && !sinAprobar(f), facturaSinAprobar: sinAprobar(f), origen: 'factura',
        que: `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}${marca([f])}`.replace('  ', ' '),
        porque: (varias ? `Hay ${exactas.length} facturas pendientes de ${f.proveedor} por este importe: propongo la más antigua, del ${ddmm(f.fecha)}.`
          : `Mismo importe y proveedor que la factura pendiente del ${ddmm(f.fecha)}; la referencia ${m.referencias.length ? 'no coincide' : 'del recibo no viene'}.`) + nota([f]),
        destino: factura(f, pagar, m) }
    }
    const prov = [...new Set(delProv.map((f) => f.proveedor))]
    if (prov.length === 1) {
      const suyas = delProv.filter((f) => f.proveedor === prov[0]).sort((a, c) => a.fecha.localeCompare(c.fecha))
      // Un pago con varias facturas.
      const grupo = subconjunto(suyas.map(queda), pagar)
      if (grupo && grupo.length > 1) {
        const fs = grupo.map((i) => ({ f: suyas[i], importe: queda(suyas[i]) }))
        for (const x of fs) gastar(x.f, x.importe)
        return { ...b, confianza: 'probable', facturaSinAprobar: fs.some((x) => sinAprobar(x.f)), origen: 'factura',
          que: `Pago de ${fs.length} facturas de ${prov[0]}${marca(fs.map((x) => x.f))}`,
          porque: `Suman justo ${eurosCent(pagar)}: ${fs.map((x) => x.f.numero ?? ddmm(x.f.fecha)).join(', ')}.${nota(fs.map((x) => x.f))}`,
          destino: { tipo: 'factura_recibida', facturas: fs.map((x) => ({ id: x.f.id, importe: euros(x.importe) })),
            cuenta_tercero: fs[0].f.cuentaTercero, tercero_id: fs[0].f.terceroId, concepto: `Pago a ${prov[0]}`, metodo: metodo(m) } }
      }
      // Una sola factura y una diferencia pequeña (comisión o redondeo): se propone con su cuenta, nunca sola.
      if (suyas.length === 1) {
        const f = suyas[0]
        const pendiente = queda(f)
        const dif = pagar - pendiente
        if (dif !== 0 && abs(dif) <= Math.min(300, Math.round(pagar * 0.03))) {
          const deMas = dif > 0
          const comision = deMas && /COMISI[OÓ]N|\bCOMIS\b|\bCOMIS\./i.test(txt)
          const cuenta = comision ? ctx.cuentas626 : deMas ? (ctx.cuentaDiferenciaGasto ?? '66900000') : (ctx.cuentaDiferenciaIngreso ?? '76900000')
          gastar(f, pendiente)
          return { ...b, confianza: 'probable', facturaSinAprobar: sinAprobar(f), origen: 'factura', quedaPorCasarCent: 0,
            que: `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}, con ${eurosCent(abs(dif))} de diferencia${marca([f])}`.replace('  ', ' '),
            porque: `De la factura del ${ddmm(f.fecha)} quedan ${eurosCent(pendiente)} y ${deMas ? 'pagas' : 'te cobran'} ${eurosCent(pagar)}: la diferencia de ${eurosCent(abs(dif))} ${comision ? 'es la comisión que dice el banco' : deMas ? 'parece un gasto del pago' : 'parece un redondeo'} y va a ${nombreCuenta(ctx, cuenta)}. No la apunto hasta que digas que sí.${nota([f])}`,
            destino: { ...(factura(f, pendiente, m) as Extract<Destino, { tipo: 'factura_recibida' }>),
              diferencia: { cuenta, importe: euros(dif), concepto: comision ? `Comisión del pago a ${f.proveedor}` : deMas ? `Diferencia del pago a ${f.proveedor}` : `Redondeo del pago a ${f.proveedor}` } } }
        }
      }
      // Un pago en parte: lo que queda por casar se dice.
      const mayor = suyas.filter((f) => queda(f) > pagar)
      if (mayor.length === 1) {
        const f = mayor[0]
        const resto = queda(f) - pagar
        gastar(f, pagar)
        return { ...b, confianza: 'probable', facturaSinAprobar: sinAprobar(f), origen: 'factura', quedaPorCasarCent: resto,
          que: `Pago en parte de la factura ${f.numero ?? ''} de ${f.proveedor}${marca([f])}`.replace('  ', ' '),
          porque: `Paga ${eurosCent(pagar)} de los ${eurosCent(resto + pagar)} que quedan; seguirán pendientes ${eurosCent(resto)}.${nota([f])}`,
          destino: factura(f, pagar, m) }
      }
    }
    // P5 de la respuesta 2: proveedor del libro traído, sin factura.
    const saldo = ctx.saldosTraidos.filter((x) => nombra(txt, [x.proveedor, ...x.alias]) && x.pendienteCent - (g.saldos.get(x.cuenta) ?? 0) >= pagar)
    if (saldo.length === 1) {
      const x = saldo[0]
      const antes = x.pendienteCent - (g.saldos.get(x.cuenta) ?? 0)
      g.saldos.set(x.cuenta, (g.saldos.get(x.cuenta) ?? 0) + pagar)
      return { ...b, confianza: 'probable', que: `Pago a ${x.proveedor}`, origen: 'libro',
        porque: `Pago a ${x.proveedor} · su saldo pendiente en el libro era ${eurosCent(antes).replace(' €', '')}.`,
        destino: { tipo: 'cuenta', tercero_id: x.terceroId, concepto: `Pago a ${x.proveedor}`, lineas: [{ cuenta: x.cuenta, importe: euros(pagar) }] } }
    }
    // B02 · Mismo importe que una factura, aunque el banco no nombre al proveedor
    // (antes de dejarlo como anticipo, se busca más): por aclarar, con la propuesta.
    const porImporte = vivas.filter((f) => queda(f) === pagar && !delProv.includes(f) && dias(f.fecha, m.fecha) >= -3 && dias(f.fecha, m.fecha) <= 120)
    if (porImporte.length === 1) {
      const f = porImporte[0]
      gastar(f, pagar)
      return { ...b, confianza: 'duda', facturaSinAprobar: sinAprobar(f), origen: 'factura', falta: 'que me digas si es esta factura',
        que: `¿Pago de la factura ${f.numero ?? ''} de ${f.proveedor}?${marca([f])}`.replace('  ', ' '),
        porque: `Mismo importe que la factura de ${f.proveedor} del ${ddmm(f.fecha)}, pero el banco no la nombra: ¿es esta?${nota([f])}`,
        destino: factura(f, pagar, m) }
    }
    // P6: proveedor conocido sin nada pendiente → anticipo (407), que se compensa cuando llegue su factura.
    const conocidos = ctx.proveedores.filter((p) => nombra(txt, [p.proveedor, ...p.alias]))
    if (conocidos.length === 1 && delProv.length === 0) {
      const p = conocidos[0]
      return { ...b, confianza: 'probable', que: `Anticipo a ${p.proveedor}`, origen: 'anticipo',
        porque: `${p.proveedor} no tiene ninguna factura pendiente, ni aprobada ni en revisión, por este importe: lo dejo como anticipo (${nombreCuenta(ctx, p.cuentaAnticipo)}) y se compensa cuando llegue su factura.`,
        destino: { tipo: 'anticipo', tercero_id: p.terceroId, concepto: `Anticipo a ${p.proveedor}`, lineas: [{ cuenta: p.cuentaAnticipo, importe: euros(pagar) }] } }
    }
  }

  // ── 6 · Cobros de clientes (facturas emitidas: hoy, su saldo en la 430) ──
  if (entra) {
    const cls = ctx.clientes.filter((c) => nombra(txt, [c.nombre, ...c.alias]) && c.pendienteCent >= imp)
    if (cls.length === 1) {
      const c = cls[0]
      const fs = facturasQueCobra(c, imp)
      const nombra = fs.length ? ` Cobra ${fs.length === 1 ? `la factura ${fs[0].numero ?? ''}` : `sus ${fs.length} facturas pendientes`}, que quedan cobradas.`.replace('  ', ' ') : ''
      return { ...b, confianza: 'probable', que: fs.length === 1 ? `Cobro de la factura ${fs[0].numero ?? ''} de ${c.nombre}`.replace('  ', ' ') : `Cobro de ${c.nombre}`,
        porque: `${c.nombre} te debe ${eurosCent(c.pendienteCent)} en el libro; este cobro lo reduce.${nombra}`,
        destino: { tipo: 'factura_emitida', tercero_id: c.terceroId, concepto: `Cobro de ${c.nombre}`, lineas: [{ cuenta: c.cuenta, importe: euros(imp) }],
          ...(fs.length ? { facturas: fs.map((f) => ({ id: f.id, importe: f.importe })) } : {}) } }
    }
  }

  // ── 7 · Nóminas y seguros sociales ───────────────────────────────────────
  if (!entra && (/\bTGSS\b|SEGURIDAD SOCIAL|SEG\.? ?SOCIAL/i.test(txt) || (m.conceptoComun === '15' && !/NOMINA|NÓMINA/i.test(txt)))) {
    const n = ctx.nominas.filter((x) => x.ssPendienteCent === -imp)
    if (n.length === 1) {
      const x = n[0]
      return { ...b, confianza: 'probable', origen: 'nomina', que: `Seguros sociales de ${mesNombre(x.mes)}`,
        porque: `Cuadra con las nóminas de ${mesNombre(x.mes)} (476 a pagar ${eurosCent(x.ssPendienteCent).replace(' €', '')}).`,
        destino: { tipo: 'cuenta', concepto: `Seguros sociales de ${mesNombre(x.mes)}`, lineas: [{ cuenta: x.cuenta476, importe: euros(-imp) }] } }
    }
    return { ...b, confianza: 'duda', origen: 'nomina', que: 'Seguros sociales', falta: 'el asiento de nóminas del mes',
      porque: `Es un recibo de la Seguridad Social, pero no hay nómina asentada con ${eurosCent(-imp)} a pagar: propongo ${nombreCuenta(ctx, ctx.cuentas476)}. Al confirmarlo, lo aprendo.`,
      destino: { tipo: 'cuenta', concepto: 'Seguros sociales', lineas: [{ cuenta: ctx.cuentas476, importe: euros(-imp) }] } }
  }
  if (!entra && /NOMINA|NÓMINA/i.test(txt)) {
    const n = ctx.nominas.filter((x) => x.netoPendienteCent === -imp)
    if (n.length === 1) {
      return { ...b, confianza: 'probable', origen: 'nomina', que: `Nóminas de ${mesNombre(n[0].mes)}`, porque: `Cuadra con lo pendiente de pagar de las nóminas de ${mesNombre(n[0].mes)} (465).`,
        destino: { tipo: 'cuenta', concepto: `Nóminas de ${mesNombre(n[0].mes)}`, lineas: [{ cuenta: n[0].cuenta465, importe: euros(-imp) }] } }
    }
  }

  // ── 8 · Impuestos ────────────────────────────────────────────────────────
  if (!entra && /AEAT|AGENCIA TRIBUTARIA|HACIENDA|IMPUESTO|MODELO|\b(303|111|115)\b/i.test(txt)) {
    const modelo = (txt.match(/\b(303|111|115)\b/) ?? [])[1]
    const xs = ctx.impuestos.filter((x) => x.importeCent === -imp && (!modelo || x.modelo === modelo))
    if (xs.length === 1) {
      const x = xs[0]
      return { ...b, confianza: 'probable', origen: 'impuesto', que: `Modelo ${x.modelo} · ${x.periodo}`, porque: `Mismo importe que el ${x.modelo} de ${x.periodo} pendiente en ${nombreCuenta(ctx, x.cuenta)}.`,
        destino: { tipo: 'cuenta', concepto: `Pago del modelo ${x.modelo} · ${x.periodo}`, lineas: [{ cuenta: x.cuenta, importe: euros(-imp) }] } }
    }
    return { ...b, confianza: 'duda', origen: 'impuesto', que: 'Pago a Hacienda', falta: 'el modelo y el periodo',
      porque: `Es un pago a Hacienda de ${eurosCent(-imp)}, pero no hay ningún modelo pendiente por ese importe: ¿de qué modelo y periodo es?`, destino: null }
  }

  // ── 9 · Reglas activas ───────────────────────────────────────────────────
  const reglas = ctx.reglas.filter((r) => nombra(txt, [r.contiene]) && (r.signo === null || r.signo === Math.sign(imp)))
  if (reglas.length === 1) {
    const r = reglas[0]
    // Una regla propone; casa sola cuando la persona la ha confirmado 3 veces sin corregir (B01).
    // Antes, punto verde: «lo casaría sola, pero aún no puedo».
    const conf = r.confirmaciones ?? 0
    const sola = conf >= 3
    return { ...b, confianza: sola ? 'seguro' : 'probable', preseleccionar: !sola, reglaId: r.id, origen: 'regla', que: nombreCuenta(ctx, r.cuenta),
      porque: sola ? `Regla confirmada ${conf} veces: ${r.palabras}.` : `Regla: ${r.palabras} (confirmada ${conf} ${conf === 1 ? 'vez' : 'veces'}; a la 3.ª caso sola).`, destino: { tipo: 'cuenta', tercero_id: r.terceroId, concepto: limpiarConcepto(m.concepto) || ctx.nombres[r.cuenta] || r.cuenta,
        lineas: [{ cuenta: r.cuenta, importe: euros(abs(imp)) }] } }
  }

  // ── 10 · Lo aprendido por contraparte (y la tarjeta) ─────────────────────
  const tarjeta = esTarjeta(m)
  const cp = b.contraparte
  const visto = cp ? ctx.aprendido.filter((a) => a.contraparte === cp).sort((x, y) => y.veces - x.veces) : []
  if (visto.length && visto[0].veces >= 2 && (visto.length === 1 || visto[0].veces > visto[1].veces)) {
    const a = visto[0]
    return { ...b, confianza: 'probable', origen: 'historial', pideTicket: tarjeta && !entra, que: `${nombreCuenta(ctx, a.cuenta)}${tarjeta && !entra ? ' · ¿ticket?' : ''}`,
      porque: `Las ${a.veces} anteriores de este ${tarjeta ? 'comercio' : 'concepto'} fueron ${nombreCuenta(ctx, a.cuenta)}.${tarjeta && !entra ? (tj ? ` Tarjeta de ${tj.titular} (···${tj.ultimos4}): pídele el ticket.` : ' Falta el ticket.') : ''}`,
      destino: { tipo: 'cuenta', tercero_id: a.terceroId, concepto: limpiarConcepto(m.concepto), lineas: [{ cuenta: a.cuenta, importe: euros(abs(imp)) }] } }
  }

  // ── 11 · Comisiones del banco ────────────────────────────────────────────
  if (!entra && (m.conceptoComun === '17' || /COMISI[OÓ]N|COMIS\.|MANTENIMIENTO/i.test(m.concepto))) {
    return { ...b, confianza: 'probable', origen: 'banco', que: `Comisión del banco`,
      porque: `El banco lo da como ${m.conceptoComun === '17' ? '«intereses, comisiones, gastos»' : 'comisión'}: ${nombreCuenta(ctx, ctx.cuentas626)}.`,
      destino: { tipo: 'cuenta', concepto: limpiarConcepto(m.concepto) || 'Comisión del banco', lineas: [{ cuenta: ctx.cuentas626, importe: euros(-imp) }] } }
  }

  // ── 12 · Por aclarar: lo que falta ───────────────────────────────────────
  if (visto.length === 1 && visto[0].veces === 1) {
    const a = visto[0]
    return { ...b, confianza: 'duda', origen: 'historial', pideTicket: tarjeta && !entra, que: 'No sé qué es', falta: 'confirmarlo una vez más',
      porque: `Solo una vez antes fue ${nombreCuenta(ctx, a.cuenta)}: ¿es lo mismo?`,
      destino: { tipo: 'cuenta', tercero_id: a.terceroId, concepto: limpiarConcepto(m.concepto), lineas: [{ cuenta: a.cuenta, importe: euros(abs(imp)) }] } }
  }
  if (tarjeta && !entra) {
    return { ...b, confianza: 'duda', pideTicket: true, que: 'Pago con tarjeta · ¿ticket?', falta: 'el ticket',
      porque: tj
        ? `Pago con la tarjeta de ${tj.titular} (···${tj.ultimos4})${cp ? ` en ${cp}` : ''} que aún no conozco: pídele el ticket a ${tj.titular} y lo aprendo.`
        : `Pago con tarjeta${cp ? ` en ${cp}` : ''} que aún no conozco: sube la foto del ticket y lo aprendo.`, destino: null }
  }
  if (entra && /\bEFECTIVO\b|INGRESO EN CAJERO|\bCAJA\b/i.test(m.concepto) && ctx.cuentaCaja) {
    return { ...b, confianza: 'probable', que: `Ingreso de efectivo · ${nombreCuenta(ctx, ctx.cuentaCaja)}`,
      porque: 'Un ingreso de efectivo en el banco suele venir de la caja: sale de la caja y entra en el banco.',
      destino: { tipo: 'cuenta', concepto: 'Ingreso de efectivo de la caja', lineas: [{ cuenta: ctx.cuentaCaja, importe: euros(imp) }] } }
  }
  return { ...b, confianza: 'duda', pideTicket: tarjeta && !entra, que: 'No sé qué es',
    falta: entra ? 'de quién es' : 'la factura',
    porque: entra
      ? `Sin factura ni liquidación de ese importe. ¿De quién es?`
      : `No hay factura de ${eurosCent(-imp)}: ¿la subes o es un pago sin factura?`,
    destino: null }
}

function factura(f: FacturaPendiente, pagar: number, m: Movimiento): Destino {
  return { tipo: 'factura_recibida', facturas: [{ id: f.id, importe: euros(pagar) }], cuenta_tercero: f.cuentaTercero, tercero_id: f.terceroId,
    concepto: `Pago a ${f.proveedor}${f.numero ? ` · ${f.numero}` : ''}`, metodo: metodo(m) }
}

/** La forma de pago como la guarda la factura (mark_supplier_invoice_paid). */
const metodo = (m: Movimiento) => (m.conceptoComun === '03' || /RECIBO|ADEUDO|DOMICILIA/i.test(m.concepto) ? 'direct_debit' : 'transfer')

/** ¿Lleva el texto la referencia (el número de factura), sin ceros ni separadores de más? */
export function refEn(texto: string, numero: string): boolean {
  const n = numero.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (n.length < 3) return false
  const t = texto.toUpperCase().replace(/[^A-Z0-9 ]/g, '')
  if (t.replace(/ /g, '').includes(n)) return true
  // «2026/0477» y «477»: la parte numérica final, sin ceros a la izquierda, como palabra.
  const cola = (numero.match(/(\d+)\D*$/) ?? [])[1]?.replace(/^0+/, '')
  return !!cola && cola.length >= 3 && new RegExp(`(^|\\D)0*${cola}(\\D|$)`).test(t)
}

/** Índices de un subconjunto (de hasta 8 facturas) que suma exactamente `objetivo`; el de menos facturas. */
export function subconjunto(importes: number[], objetivo: number): number[] | null {
  const n = Math.min(importes.length, 8)
  let mejor: number[] | null = null
  for (let mask = 1; mask < (1 << n); mask++) {
    let s = 0
    const idx: number[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { s += importes[i]; idx.push(i) }
    if (s === objetivo && (!mejor || idx.length < mejor.length)) mejor = idx
  }
  return mejor
}

function mesNombre(mes: string): string {
  return MESES[Number(mes.slice(5, 7)) - 1] ?? mes
}

/**
 * B02 · «¿De quién es la tarjeta ···3085?», UNA vez por tarjeta: las tarjetas
 * que no están dadas de alta, con los movimientos que las usan.
 */
export function preguntasDeTarjeta(ds: readonly Pick<Decision, 'movimientoId' | 'tarjetaDesconocida'>[]): { ultimos4: string; movimientos: string[] }[] {
  const por = new Map<string, string[]>()
  for (const d of ds) if (d.tarjetaDesconocida) por.set(d.tarjetaDesconocida, [...(por.get(d.tarjetaDesconocida) ?? []), d.movimientoId])
  return [...por.entries()].map(([ultimos4, movimientos]) => ({ ultimos4, movimientos })).sort((a, b) => b.movimientos.length - a.movimientos.length)
}

/** Las cinco cifras de arriba y la frase de la banda («He casado yo 142 de 158…»). */
export function resumenMes(ds: readonly Pick<Decision, 'confianza' | 'antesDelCorteSinPareja'>[], mes: string): { casadoSolo: number; paraConfirmar: number; porAclarar: number; frase: string } {
  const casadoSolo = ds.filter((d) => d.confianza === 'seguro').length
  const paraConfirmar = ds.filter((d) => d.confianza === 'probable').length
  const porAclarar = ds.filter((d) => d.confianza === 'duda' && !d.antesDelCorteSinPareja).length
  const total = ds.length
  const nombre = mesNombre(`${mes}-01`)
  const frase = total === 0 ? `No hay movimientos de ${nombre}.`
    : `He casado yo ${casadoSolo} de ${total} movimientos de ${nombre}. Te quedan ${paraConfirmar} por confirmar y ${porAclarar} por aclarar.`
  return { casadoSolo, paraConfirmar, porAclarar, frase }
}
