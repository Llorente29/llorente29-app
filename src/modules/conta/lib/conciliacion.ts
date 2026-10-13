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
}

export interface CuentaPropia { id: string; nombre: string; cuenta: string | null }
export interface FacturaPendiente {
  id: string; numero: string | null; fecha: string; totalCent: number; pagadoCent: number
  proveedor: string; alias: string[]; terceroId: string | null; cuentaTercero: string
}
export interface SaldoProveedor { terceroId: string | null; proveedor: string; alias: string[]; cuenta: string; pendienteCent: number }
export interface ProveedorConocido { terceroId: string | null; proveedor: string; alias: string[]; cuentaTercero: string; cuentaAnticipo: string }
export interface Cliente { terceroId: string | null; nombre: string; alias: string[]; cuenta: string; pendienteCent: number }
export interface Liquidacion { id: string; plataforma: string; fecha: string; desde: string | null; hasta: string | null; netoCent: number; cuenta430: string; terceroId: string | null }
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
export interface Regla { id: string; palabras: string; contiene: string; signo: 1 | -1 | null; cuenta: string; terceroId: string | null }
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
}

/** El destino tal y como lo recibe bank_casar (20261101T0110). */
export type Destino =
  | { tipo: 'asiento'; entry_id: string; concepto?: string }
  | { tipo: 'factura_recibida'; facturas: { id: string; importe: number }[]; cuenta_tercero: string; tercero_id: string | null; concepto: string; metodo?: string }
  | { tipo: 'liquidacion'; liquidacion_id: string; cuenta_cliente: string; tercero_id: string | null; concepto: string }
  | { tipo: 'traspaso'; otro_movimiento_id: string; concepto: string }
  | { tipo: 'cuenta' | 'anticipo' | 'contrato' | 'factura_emitida'; lineas: { cuenta: string; importe: number; tercero_id?: string | null; concepto?: string }[];
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
}

const euros = (c: number) => c / 100
const abs = Math.abs

/** «Luz y agua · 62800000»: nunca un código a secas, nunca «subcuenta». */
export function nombreCuenta(ctx: Pick<Contexto, 'nombres'>, codigo: string): string {
  const n = ctx.nombres[codigo]?.trim().replace(/[.\s]+$/, '')
  return n ? `${n} · ${codigo}` : codigo
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

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
interface Gastado { facturas: Map<string, number>; liquidaciones: Set<string>; movimientos: Set<string>; asientos: Set<string>; saldos: Map<string, number>; pendiente430: Map<string, number> }
const nuevoGastado = (): Gastado => ({ facturas: new Map(), liquidaciones: new Set(), movimientos: new Set(), asientos: new Set(), saldos: new Map(), pendiente430: new Map() })

function base(m: Movimiento): Omit<Decision, 'confianza' | 'que' | 'porque' | 'destino'> {
  return { movimientoId: m.id, falta: null, antesDelCorteSinPareja: false, pideTicket: false, reglaId: null, contraparte: contraparte(m.concepto), otroLadoDe: null }
}

/** Una decisión para un movimiento, sin gastar nada (para el que se mira suelto). */
export function decidir(m: Movimiento, ctx: Contexto): Decision {
  return decidirCon(m, ctx, nuevoGastado())
}

/** Un lote entero, en orden de fecha: cada candidato se usa una sola vez. */
export function conciliar(movs: readonly Movimiento[], ctx: Contexto): Decision[] {
  const g = nuevoGastado()
  const orden = [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
  const porId = new Map<string, Decision>()
  for (const m of orden) {
    if (g.movimientos.has(m.id)) continue // ya casado como el otro lado de un traspaso
    porId.set(m.id, decidirCon(m, ctx, g))
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

function decidirCon(m: Movimiento, ctx: Contexto, g: Gastado): Decision {
  const b = base(m)
  const imp = m.importeCent
  const entra = imp > 0
  const txt = `${m.concepto} ${m.referencias.join(' ')}`

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
  const otros = ctx.sinCasar.filter((o) => o.cuentaId !== m.cuentaId && o.importeCent === -imp && !g.movimientos.has(o.id) && o.id !== m.id && abs(dias(o.fecha, m.fecha)) <= 3)
  if (otros.length >= 1) {
    const mismoDia = otros.filter((o) => o.fecha === m.fecha)
    const o = mismoDia.length === 1 ? mismoDia[0] : otros.length === 1 ? otros[0] : null
    if (o) {
      const dest = ctx.cuentas.find((c) => c.id === o.cuentaId)
      const orig = ctx.cuentas.find((c) => c.id === m.cuentaId)
      g.movimientos.add(o.id); g.movimientos.add(m.id)
      const desde = entra ? dest : orig, hacia = entra ? orig : dest
      return { ...b, confianza: o.fecha === m.fecha ? 'seguro' : 'probable', que: 'Traspaso entre tus cuentas', contraparte: null,
        porque: o.fecha === m.fecha
          ? `Sale de ${desde?.nombre ?? 'una cuenta'} y entra en ${hacia?.nombre ?? 'la otra'} el mismo día, mismo importe.`
          : `Sale de ${desde?.nombre ?? 'una cuenta'} el ${ddmm(entra ? o.fecha : m.fecha)} y entra en ${hacia?.nombre ?? 'la otra'} el ${ddmm(entra ? m.fecha : o.fecha)}, mismo importe.`,
        destino: { tipo: 'traspaso', otro_movimiento_id: o.id, concepto: `Traspaso de ${desde?.nombre ?? ''} a ${hacia?.nombre ?? ''}`.trim() } }
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
    const liqs = ctx.liquidaciones.filter((l) => !g.liquidaciones.has(l.id) && l.netoCent === imp && dias(l.fecha, m.fecha) >= -3 && dias(l.fecha, m.fecha) <= 30
      && (plats.length === 0 || plats.some((p) => p.nombre === l.plataforma)))
    if (liqs.length === 1 && (plats.length > 0 || ctx.liquidaciones.filter((l) => l.netoCent === imp).length === 1)) {
      const l = liqs[0]
      g.liquidaciones.add(l.id)
      const periodo = l.desde && l.hasta ? ` ${ddmm(l.desde)}–${ddmm(l.hasta)}` : ''
      return { ...b, confianza: plats.length > 0 ? 'seguro' : 'probable', que: `Cobro de ${l.plataforma} · liquidación${periodo}`,
        porque: `${plats.length > 0 ? 'Casado solo: cuadra' : 'Cuadra'} con su liquidación${periodo} (neto ${eurosCent(l.netoCent)}).`,
        destino: { tipo: 'liquidacion', liquidacion_id: l.id, cuenta_cliente: l.cuenta430, tercero_id: l.terceroId, concepto: `Cobro de ${l.plataforma}${periodo}` } }
    }
    if (plats.length === 1) {
      // P7: sin liquidación, contra lo pendiente en su 430 del periodo. Nunca seguro.
      const p = plats[0]
      const per = p.pendiente.filter((x) => dias(x.hasta, m.fecha) >= 0 && dias(x.hasta, m.fecha) <= 15).at(-1)
      const ventas = per ? per.ventasCent - (g.pendiente430.get(`${p.nombre}:${per.desde}`) ?? 0) : 0
      const pct = ventas > 0 ? 1 - imp / ventas : null
      if (per && pct !== null && pct >= 0 && pct <= 0.45) {
        g.pendiente430.set(`${p.nombre}:${per.desde}`, (g.pendiente430.get(`${p.nombre}:${per.desde}`) ?? 0) + imp)
        const habitual = p.comisionHabitual !== null ? ` (su comisión habitual es ${Math.round(p.comisionHabitual * 100)} %)` : ''
        return { ...b, confianza: 'probable', que: `Cobro de ${p.nombre} · ${ddmm(per.desde)}–${ddmm(per.hasta)}`,
          porque: `Sin liquidación: cuadra con las ventas de ${ddmm(per.desde)}–${ddmm(per.hasta)} menos un ${Math.round(pct * 100)} % de comisión${habitual}. La diferencia queda pendiente en su 430 hasta que llegue la liquidación.`,
          destino: { tipo: 'cuenta', tercero_id: p.terceroId, concepto: `Cobro de ${p.nombre} ${ddmm(per.desde)}–${ddmm(per.hasta)}`, lineas: [{ cuenta: p.cuenta430, importe: euros(imp) }] } }
      }
      return { ...b, confianza: 'duda', que: `Cobro de ${p.nombre}`, falta: 'su liquidación',
        porque: `Es de ${p.nombre}, pero no hay liquidación de ${eurosCent(imp)} ni ventas pendientes del periodo con las que cuadre: ¿subes su liquidación?`, destino: null }
    }
  }

  // ── 5 · Facturas recibidas (pagos) ───────────────────────────────────────
  if (!entra) {
    const pagar = -imp
    const queda = (f: FacturaPendiente) => f.totalCent - f.pagadoCent - (g.facturas.get(f.id) ?? 0)
    const vivas = ctx.facturas.filter((f) => queda(f) > 0)
    const conRef = vivas.filter((f) => queda(f) === pagar && f.numero && refEn(txt, f.numero))
    if (conRef.length === 1) {
      const f = conRef[0]
      g.facturas.set(f.id, (g.facturas.get(f.id) ?? 0) + pagar)
      return { ...b, confianza: 'seguro', que: `Pago de la factura ${f.numero} de ${f.proveedor}`,
        porque: `Casado solo: mismo importe y misma referencia (${f.numero}) que la factura pendiente del ${ddmm(f.fecha)}.`,
        destino: factura(f, pagar, m) }
    }
    const delProv = vivas.filter((f) => nombra(txt, [f.proveedor, ...f.alias]))
    const exactas = delProv.filter((f) => queda(f) === pagar)
    if (exactas.length === 1) {
      const f = exactas[0]
      g.facturas.set(f.id, (g.facturas.get(f.id) ?? 0) + pagar)
      return { ...b, confianza: 'probable', que: `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}`.replace('  ', ' '),
        porque: `Mismo importe y proveedor que la factura pendiente del ${ddmm(f.fecha)}; la referencia ${m.referencias.length ? 'no coincide' : 'del recibo no viene'}.`,
        destino: factura(f, pagar, m) }
    }
    if (exactas.length > 1) {
      // Varias iguales del mismo proveedor: la más antigua, diciéndolo.
      const f = [...exactas].sort((a, c) => a.fecha.localeCompare(c.fecha))[0]
      g.facturas.set(f.id, (g.facturas.get(f.id) ?? 0) + pagar)
      return { ...b, confianza: 'probable', que: `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}`.replace('  ', ' '),
        porque: `Hay ${exactas.length} facturas pendientes de ${f.proveedor} por este importe: propongo la más antigua, del ${ddmm(f.fecha)}.`,
        destino: factura(f, pagar, m) }
    }
    // Varias facturas del mismo proveedor en un pago.
    const prov = [...new Set(delProv.map((f) => f.proveedor))]
    if (prov.length === 1) {
      const suyas = delProv.filter((f) => f.proveedor === prov[0]).sort((a, c) => a.fecha.localeCompare(c.fecha))
      const grupo = subconjunto(suyas.map(queda), pagar)
      if (grupo && grupo.length > 1) {
        const fs = grupo.map((i) => ({ f: suyas[i], importe: queda(suyas[i]) }))
        for (const x of fs) g.facturas.set(x.f.id, (g.facturas.get(x.f.id) ?? 0) + x.importe)
        return { ...b, confianza: 'probable', que: `Pago de ${fs.length} facturas de ${prov[0]}`,
          porque: `Suman justo ${eurosCent(pagar)}: ${fs.map((x) => x.f.numero ?? ddmm(x.f.fecha)).join(', ')}.`,
          destino: { tipo: 'factura_recibida', facturas: fs.map((x) => ({ id: x.f.id, importe: euros(x.importe) })),
            cuenta_tercero: fs[0].f.cuentaTercero, tercero_id: fs[0].f.terceroId, concepto: `Pago a ${prov[0]}`, metodo: metodo(m) } }
      }
      // Un pago en partes.
      const mayor = suyas.filter((f) => queda(f) > pagar)
      if (mayor.length === 1) {
        const f = mayor[0]
        const resto = queda(f) - pagar
        g.facturas.set(f.id, (g.facturas.get(f.id) ?? 0) + pagar)
        return { ...b, confianza: 'probable', que: `Pago en parte de la factura ${f.numero ?? ''} de ${f.proveedor}`.replace('  ', ' '),
          porque: `Paga ${eurosCent(pagar)} de los ${eurosCent(f.totalCent - f.pagadoCent)} que quedan; seguirán pendientes ${eurosCent(resto)}.`,
          destino: factura(f, pagar, m) }
      }
    }
    // P5 de la respuesta 2: proveedor del libro traído, sin factura de Folvy.
    const saldo = ctx.saldosTraidos.filter((s) => nombra(txt, [s.proveedor, ...s.alias]) && s.pendienteCent - (g.saldos.get(s.cuenta) ?? 0) >= pagar)
    if (saldo.length === 1) {
      const s = saldo[0]
      const antes = s.pendienteCent - (g.saldos.get(s.cuenta) ?? 0)
      g.saldos.set(s.cuenta, (g.saldos.get(s.cuenta) ?? 0) + pagar)
      return { ...b, confianza: 'probable', que: `Pago a ${s.proveedor}`,
        porque: `Pago a ${s.proveedor} · su saldo pendiente en el libro era ${eurosCent(antes).replace(' €', '')}.`,
        destino: { tipo: 'cuenta', tercero_id: s.terceroId, concepto: `Pago a ${s.proveedor}`, lineas: [{ cuenta: s.cuenta, importe: euros(pagar) }] } }
    }
    // P6: proveedor conocido sin nada pendiente → anticipo (407), que se compensa cuando llegue su factura.
    const conocidos = ctx.proveedores.filter((p) => nombra(txt, [p.proveedor, ...p.alias]))
    if (conocidos.length === 1 && delProv.length === 0) {
      const p = conocidos[0]
      return { ...b, confianza: 'probable', que: `Anticipo a ${p.proveedor}`,
        porque: `${p.proveedor} no tiene ninguna factura pendiente: lo dejo como anticipo (${nombreCuenta(ctx, p.cuentaAnticipo)}) y se compensa cuando llegue su factura.`,
        destino: { tipo: 'anticipo', tercero_id: p.terceroId, concepto: `Anticipo a ${p.proveedor}`, lineas: [{ cuenta: p.cuentaAnticipo, importe: euros(pagar) }] } }
    }
  }

  // ── 6 · Cobros de clientes (facturas emitidas: hoy, su saldo en la 430) ──
  if (entra) {
    const cls = ctx.clientes.filter((c) => nombra(txt, [c.nombre, ...c.alias]) && c.pendienteCent >= imp)
    if (cls.length === 1) {
      const c = cls[0]
      return { ...b, confianza: 'probable', que: `Cobro de ${c.nombre}`,
        porque: `${c.nombre} te debe ${eurosCent(c.pendienteCent)} en el libro; este cobro lo reduce.`,
        destino: { tipo: 'factura_emitida', tercero_id: c.terceroId, concepto: `Cobro de ${c.nombre}`, lineas: [{ cuenta: c.cuenta, importe: euros(imp) }] } }
    }
  }

  // ── 7 · Nóminas y seguros sociales ───────────────────────────────────────
  if (!entra && (/\bTGSS\b|SEGURIDAD SOCIAL|SEG\.? ?SOCIAL/i.test(txt) || (m.conceptoComun === '15' && !/NOMINA|NÓMINA/i.test(txt)))) {
    const n = ctx.nominas.filter((x) => x.ssPendienteCent === -imp)
    if (n.length === 1) {
      const x = n[0]
      return { ...b, confianza: 'probable', que: `Seguros sociales de ${mesNombre(x.mes)}`,
        porque: `Cuadra con las nóminas de ${mesNombre(x.mes)} (476 a pagar ${eurosCent(x.ssPendienteCent).replace(' €', '')}).`,
        destino: { tipo: 'cuenta', concepto: `Seguros sociales de ${mesNombre(x.mes)}`, lineas: [{ cuenta: x.cuenta476, importe: euros(-imp) }] } }
    }
    return { ...b, confianza: 'duda', que: 'Seguros sociales', falta: 'el asiento de nóminas del mes',
      porque: `Es un recibo de la Seguridad Social, pero no hay nómina asentada con ${eurosCent(-imp)} a pagar: propongo ${nombreCuenta(ctx, ctx.cuentas476)}. Al confirmarlo, lo aprendo.`,
      destino: { tipo: 'cuenta', concepto: 'Seguros sociales', lineas: [{ cuenta: ctx.cuentas476, importe: euros(-imp) }] } }
  }
  if (!entra && /NOMINA|NÓMINA/i.test(txt)) {
    const n = ctx.nominas.filter((x) => x.netoPendienteCent === -imp)
    if (n.length === 1) {
      return { ...b, confianza: 'probable', que: `Nóminas de ${mesNombre(n[0].mes)}`, porque: `Cuadra con lo pendiente de pagar de las nóminas de ${mesNombre(n[0].mes)} (465).`,
        destino: { tipo: 'cuenta', concepto: `Nóminas de ${mesNombre(n[0].mes)}`, lineas: [{ cuenta: n[0].cuenta465, importe: euros(-imp) }] } }
    }
  }

  // ── 8 · Impuestos ────────────────────────────────────────────────────────
  if (!entra && /AEAT|AGENCIA TRIBUTARIA|HACIENDA|IMPUESTO|MODELO|\b(303|111|115)\b/i.test(txt)) {
    const modelo = (txt.match(/\b(303|111|115)\b/) ?? [])[1]
    const xs = ctx.impuestos.filter((x) => x.importeCent === -imp && (!modelo || x.modelo === modelo))
    if (xs.length === 1) {
      const x = xs[0]
      return { ...b, confianza: 'probable', que: `Modelo ${x.modelo} · ${x.periodo}`, porque: `Mismo importe que el ${x.modelo} de ${x.periodo} pendiente en ${nombreCuenta(ctx, x.cuenta)}.`,
        destino: { tipo: 'cuenta', concepto: `Pago del modelo ${x.modelo} · ${x.periodo}`, lineas: [{ cuenta: x.cuenta, importe: euros(-imp) }] } }
    }
    return { ...b, confianza: 'duda', que: 'Pago a Hacienda', falta: 'el modelo y el periodo',
      porque: `Es un pago a Hacienda de ${eurosCent(-imp)}, pero no hay ningún modelo pendiente por ese importe: ¿de qué modelo y periodo es?`, destino: null }
  }

  // ── 9 · Reglas activas ───────────────────────────────────────────────────
  const reglas = ctx.reglas.filter((r) => nombra(txt, [r.contiene]) && (r.signo === null || r.signo === Math.sign(imp)))
  if (reglas.length === 1) {
    const r = reglas[0]
    return { ...b, confianza: 'probable', reglaId: r.id, que: nombreCuenta(ctx, r.cuenta),
      porque: `Regla: ${r.palabras}.`, destino: { tipo: 'cuenta', tercero_id: r.terceroId, concepto: limpiarConcepto(m.concepto) || ctx.nombres[r.cuenta] || r.cuenta,
        lineas: [{ cuenta: r.cuenta, importe: euros(abs(imp)) }] } }
  }

  // ── 10 · Lo aprendido por contraparte (y la tarjeta) ─────────────────────
  const tarjeta = m.conceptoComun === '12' || /TARJETA/i.test(m.concepto)
  const cp = b.contraparte
  const visto = cp ? ctx.aprendido.filter((a) => a.contraparte === cp).sort((x, y) => y.veces - x.veces) : []
  if (visto.length && visto[0].veces >= 2 && (visto.length === 1 || visto[0].veces > visto[1].veces)) {
    const a = visto[0]
    return { ...b, confianza: 'probable', pideTicket: tarjeta && !entra, que: `${nombreCuenta(ctx, a.cuenta)}${tarjeta && !entra ? ' · ¿ticket?' : ''}`,
      porque: `Las ${a.veces} anteriores de este ${tarjeta ? 'comercio' : 'concepto'} fueron ${nombreCuenta(ctx, a.cuenta)}.${tarjeta && !entra ? ' Falta el ticket.' : ''}`,
      destino: { tipo: 'cuenta', tercero_id: a.terceroId, concepto: limpiarConcepto(m.concepto), lineas: [{ cuenta: a.cuenta, importe: euros(abs(imp)) }] } }
  }

  // ── 11 · Comisiones del banco ────────────────────────────────────────────
  if (!entra && (m.conceptoComun === '17' || /COMISI[OÓ]N|COMIS\.|MANTENIMIENTO/i.test(m.concepto))) {
    return { ...b, confianza: 'probable', que: `Comisión del banco`,
      porque: `El banco lo da como ${m.conceptoComun === '17' ? '«intereses, comisiones, gastos» (concepto 17)' : 'comisión'}: ${nombreCuenta(ctx, ctx.cuentas626)}.`,
      destino: { tipo: 'cuenta', concepto: limpiarConcepto(m.concepto) || 'Comisión del banco', lineas: [{ cuenta: ctx.cuentas626, importe: euros(-imp) }] } }
  }

  // ── 12 · Por aclarar: lo que falta ───────────────────────────────────────
  if (visto.length === 1 && visto[0].veces === 1) {
    const a = visto[0]
    return { ...b, confianza: 'duda', pideTicket: tarjeta && !entra, que: 'No sé qué es', falta: 'confirmarlo una vez más',
      porque: `Solo una vez antes fue ${nombreCuenta(ctx, a.cuenta)}: ¿es lo mismo?`,
      destino: { tipo: 'cuenta', tercero_id: a.terceroId, concepto: limpiarConcepto(m.concepto), lineas: [{ cuenta: a.cuenta, importe: euros(abs(imp)) }] } }
  }
  if (tarjeta && !entra) {
    return { ...b, confianza: 'duda', pideTicket: true, que: 'Pago con tarjeta · ¿ticket?', falta: 'el ticket',
      porque: `Pago con tarjeta${cp ? ` en ${cp}` : ''} que aún no conozco: sube la foto del ticket y lo aprendo.`, destino: null }
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
 * «Regla nueva, ¿la guardo?»: cuando lo confirmado por contraparte llega a 2
 * con la misma cuenta y no hay regla que lo diga, Folvy la propone en palabras.
 */
export function reglasNuevas(ctx: Pick<Contexto, 'aprendido' | 'reglas' | 'nombres'>): { palabras: string; contiene: string; cuenta: string; terceroId: string | null }[] {
  const out: { palabras: string; contiene: string; cuenta: string; terceroId: string | null }[] = []
  for (const a of ctx.aprendido) {
    if (a.veces < 2) continue
    if (ctx.reglas.some((r) => normal(r.contiene) === a.contraparte)) continue
    if (ctx.aprendido.some((x) => x.contraparte === a.contraparte && x.cuenta !== a.cuenta && x.veces >= a.veces)) continue
    out.push({ palabras: `Cuando el concepto tenga «${a.contraparte}» → ${nombreCuenta(ctx, a.cuenta)}`, contiene: a.contraparte, cuenta: a.cuenta, terceroId: a.terceroId })
  }
  return out
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
