// src/modules/conta/nucleo/emitida/asiento.ts
//
// K05 · Lo que decide la ficha de la factura emitida del núcleo, sin React ni
// red: el asiento que sale, lo que se le manda a la base, qué hace el cobro,
// las comprobaciones y la franja. Es la recibida dada la vuelta: lo que se
// repite (los totales, la cuota, la retención, el trimestre, la etiqueta del
// asiento, la duda de la cuenta) se usa de la recibida, no se copia.
//
// El asiento es EL MISMO que hace hoy la emisión al contabilizar
// (conta_venta_emitir, 20261109T1007): la 430 del cliente por el total, con su
// tercero; la 70x por la base; la 477 de cada tipo con su IVA (tipo, base y
// libro «issued»); la 473 por la retención, al debe. Todo con el número de la
// factura en el documento y el concepto «Factura <número>».
//
// El cobro, como hoy (sin tanda): a un banco, conta_banco_a_mano (E05, serie 3,
// que el motor de Bancos enlaza con el extracto); a la caja o a otra cuenta, el
// asiento del cobro en efectivo de conta_venta_cobrar (serie 4). Vacía, o con
// fecha posterior a hoy, no se apunta: queda pendiente de cobrar.

import { totalesDe, type Adicional, type LineaIva } from '@/modules/conta/documentos/fichaRecibida'
import { leerImporteEs } from '@/modules/conta/lib/recibidaAMano'
import { cent, cuotaIva, deCent } from '@/modules/conta/lib/libro'
import { nifValido } from '@/modules/conta/documentos/paraValidar'
import type { LineaAsiento, TonoEstado, UnaComprobacion } from '../ficha/piezas'
import { cifra } from '../ficha/textos'
import { periodoAbierto, type Calendario } from '../recibida/estado'

export interface LineaVenta { cuenta: string; local: string; importe: string }

export type BorradorEmitida = {
  clienteId: string
  numero: string
  fecha: string
  iva: LineaIva[]
  retencion: Adicional | null
  ventas: LineaVenta[]
  /**
   * «Cómo se cobra»: la subcuenta (57x u otra) y la fecha del cobro. null: la
   * que se propone (de su ficha o de la última, y la fecha de la factura más sus
   * días); '' (vacía): pendiente de cobrar.
   */
  cobroCuenta: string | null
  cobroFecha: string | null
}

export const borradorVacio = (hoy: string): BorradorEmitida => ({
  clienteId: '', numero: '', fecha: hoy, iva: [{ base: '', tipo: '21', cuota: '' }, { base: '', tipo: '10', cuota: '' }],
  retencion: null, ventas: [{ cuenta: '', local: '', importe: '' }], cobroCuenta: null, cobroFecha: null,
})

/** Los nombres de los cambios sin guardar (la ventana de la pestaña), con los rótulos de la ficha. */
export const ETIQUETAS_EMITIDA: Record<keyof BorradorEmitida, string> = {
  clienteId: 'Cliente', numero: 'N.º de factura', fecha: 'Fecha factura', iva: 'IVA', retencion: 'Retención',
  ventas: 'A qué cuenta de venta va', cobroCuenta: 'Cómo se cobra', cobroFecha: 'La fecha del cobro',
}

/** Lo que la ficha sabe de las cuentas de la empresa para hacer el asiento. */
export interface CuentasEmitida {
  /** La 430 del cliente (su subcuenta), o null si aún no tiene (se le crea al guardar, como hoy). */
  cliente: { codigo: string; nombre: string } | null
  /** La 477 de cada tipo (por su %), con el id del tipo para el libro. */
  tipos: ReadonlyMap<number, { tipoId: string; codigo: string | null; nombre: string }>
  /** La 473 (la primera del plan), o null: se crea al guardar, como hoy. */
  retencion: { codigo: string; nombre: string } | null
  /** El nombre de una cuenta del plan por su código. */
  nombre: (codigo: string) => string | null
}

/** Una línea como la espera journal_entry_proponer (la misma forma que arma conta_venta_emitir). */
export interface LineaParaLaBase {
  cuenta: string
  debe: number
  haber: number
  concepto: string
  documento: string
  tercero_id?: string
  iva?: { tipo_id: string; base: number; libro: 'issued'; facturas: 1 }
  local_id?: string
  comun?: boolean
}

export interface AsientoEmitida {
  /** Para pintarlo (la 430 sin subcuenta aún sale como «430 · se crea al guardar»). */
  vista: LineaAsiento[]
  /** Lo que le falta para poder guardarse, en palabras («la 477 del 21 %»). */
  faltan: string[]
  debe: number
  haber: number
  cuadra: boolean
  total: number
  base: number
  iva: number
  retencion: number
}

const num = (x: string): number | null => leerImporteEs(x)

/** Las líneas de IVA escritas: la que se deja con la base y la cuota vacías no cuenta (la a mano empieza con 21 y 10; e2e 44477335179). */
export const ivaEscrito = (iva: readonly LineaIva[]): LineaIva[] => iva.filter((l) => l.base.trim() !== '' || l.cuota.trim() !== '')

/** Las cuentas de venta con su importe: con una sola, la base entera; con varias, lo escrito (la última, lo que falte). */
export function ventasConImporte(ventas: readonly LineaVenta[], base: number): { cuenta: string; local: string; importe: number }[] {
  if (ventas.length <= 1) return ventas.map((v) => ({ cuenta: v.cuenta.trim(), local: v.local, importe: base }))
  const escritas = ventas.slice(0, -1).map((v) => num(v.importe) ?? 0)
  const resto = deCent(cent(base) - escritas.reduce((t, x) => t + cent(x), 0))
  return ventas.map((v, i) => ({ cuenta: v.cuenta.trim(), local: v.local, importe: i < ventas.length - 1 ? escritas[i] : resto }))
}

/**
 * El asiento que sale de la ficha, como lo haría conta_venta_emitir: la vista
 * para pintarlo y lo que falta. Las cuentas que aún no existen (la 430 de un
 * cliente nuevo, la 473) salen con su grupo y «se crea al guardar».
 */
export function asientoDeLaEmitida(b: BorradorEmitida, c: CuentasEmitida, nombreCliente: string | null): AsientoEmitida {
  const t = totalesDe({ iva: ivaEscrito(b.iva), retencion: b.retencion, recargo: null })
  const vista: LineaAsiento[] = []
  const faltan: string[] = [...t.malEscrito]
  if (!b.clienteId) faltan.push('el cliente')
  if (t.total !== 0) {
    vista.push({ codigo: c.cliente?.codigo ?? '430', nombre: c.cliente?.nombre ?? `${nombreCliente ?? 'El cliente'} · se crea al guardar`, debe: t.total, haber: null })
  }
  if (t.retencion) vista.push({ codigo: c.retencion?.codigo ?? '473', nombre: c.retencion?.nombre ?? 'Retenciones · se crea al guardar', debe: t.retencion, haber: null })
  for (const v of ventasConImporte(b.ventas, t.base)) {
    if (!v.importe) continue
    if (!v.cuenta) faltan.push('la cuenta de venta')
    vista.push({ codigo: v.cuenta, nombre: v.cuenta ? c.nombre(v.cuenta) ?? 'Cuenta' : '', debe: null, haber: v.importe })
  }
  for (const l of b.iva) {
    const cuota = num(l.cuota)
    if (!cuota) continue
    const tipo = Number(l.tipo)
    const x = c.tipos.get(tipo)
    if (!x?.codigo) faltan.push(`la 477 del ${l.tipo} %`)
    vista.push({ codigo: x?.codigo ?? '', nombre: x?.nombre ?? `IVA repercutido ${l.tipo} %`, debe: null, haber: cuota })
  }
  const debe = vista.reduce((s, l) => s + cent(l.debe ?? 0), 0)
  const haber = vista.reduce((s, l) => s + cent(l.haber ?? 0), 0)
  return { vista, faltan: [...new Set(faltan)], debe: deCent(debe), haber: deCent(haber), cuadra: debe === haber && debe > 0, total: t.total, base: t.base, iva: t.iva, retencion: t.retencion }
}

/**
 * Las líneas para journal_entry_proponer, las de conta_venta_emitir: 430 por el
 * total, 473 por la retención, 70x por cuenta, 477 por tipo con su IVA. Cada
 * apunte con su local o «común» (como la emisión: el local de la factura).
 * `cuenta430` y `cuenta473` ya existen cuando se llama (se crean antes).
 */
export function lineasParaLaBase(b: BorradorEmitida, c: CuentasEmitida & { cuenta430: string; cuenta473: string | null }, partyId: string, local: string | null): LineaParaLaBase[] {
  const t = totalesDe({ iva: ivaEscrito(b.iva), retencion: b.retencion, recargo: null })
  const doc = b.numero.trim()
  const base = { documento: doc, tercero_id: partyId, ...(local ? { local_id: local } : { comun: true }) }
  const l: LineaParaLaBase[] = []
  if (t.total !== 0) l.push({ cuenta: c.cuenta430, debe: t.total, haber: 0, concepto: `Factura ${doc}`, ...base })
  for (const v of ventasConImporte(b.ventas, t.base)) {
    if (v.importe) l.push({ cuenta: v.cuenta, debe: 0, haber: v.importe, concepto: `Factura ${doc}`, ...base, ...(v.local ? { local_id: v.local, comun: undefined } : {}) })
  }
  for (const x of b.iva) {
    const cuota = num(x.cuota); const bi = num(x.base)
    const tipo = c.tipos.get(Number(x.tipo))
    if (!cuota || !tipo?.codigo) continue
    l.push({ cuenta: tipo.codigo, debe: 0, haber: cuota, concepto: `IVA factura ${doc}`, ...base, iva: { tipo_id: tipo.tipoId, base: Math.abs(bi ?? 0), libro: 'issued', facturas: 1 } })
  }
  if (t.retencion && c.cuenta473) l.push({ cuenta: c.cuenta473, debe: t.retencion, haber: 0, concepto: `Retención factura ${doc}`, ...base })
  return l
}

// ── El cobro ────────────────────────────────────────────────────────────────

export type QueHaceElCobro =
  | { que: 'banco'; bancoId: string; cuenta: string; fecha: string; importe: number }
  | { que: 'otra'; cuenta: string; fecha: string; importe: number }
  | { que: 'pendiente'; porque: string }

/**
 * Qué se hace con «Cómo se cobra» al guardar. A un banco de Cuentas y extractos
 * (su 572), el asiento de tesorería de conta_banco_a_mano; a otra cuenta (desde el
 * X23, cualquier subcuenta del plan), el del cobro en la serie 4 (apuntarCobro:
 * la elegida al debe y la 430 del cliente al haber). Vacía, sin fecha o con fecha
 * posterior a hoy: nada, pendiente de cobrar (un cobro de mañana no ha pasado).
 */
export function queHaceElCobro(o: { cuenta: string; fecha: string; hoy: string; importe: number; bancos: ReadonlyMap<string, string>; cuentaCliente?: string | null }): QueHaceElCobro {
  const cuenta = o.cuenta.trim()
  if (!cuenta) return { que: 'pendiente', porque: 'sin cuenta de cobro' }
  // X23 · Cualquier subcuenta vale para cobrar, menos la del propio cliente (el asiento iría de la 430 a la misma 430).
  if (o.cuentaCliente && cuenta === o.cuentaCliente) return { que: 'pendiente', porque: `la ${cuenta} es la del cliente, no una cuenta de cobro` }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.fecha)) return { que: 'pendiente', porque: 'sin la fecha del cobro' }
  if (o.fecha > o.hoy) return { que: 'pendiente', porque: `se cobra el ${o.fecha.slice(8, 10)}/${o.fecha.slice(5, 7)}/${o.fecha.slice(0, 4)}, después de hoy` }
  if (!(o.importe > 0)) return { que: 'pendiente', porque: 'sin importe que cobrar' }
  const banco = o.bancos.get(cuenta)
  return banco ? { que: 'banco', bancoId: banco, cuenta, fecha: o.fecha, importe: o.importe } : { que: 'otra', cuenta, fecha: o.fecha, importe: o.importe }
}

/**
 * X23 (Julio, 19/11) · «Cómo se cobra» admite cualquier subcuenta del plan, como el pago (X21b). Si la elegida no es un
 * banco ni la caja (ni ninguna 57), una línea dice qué asiento hará al guardar, sin bloquear: el del cobro, con la
 * elegida al debe y la 430 del cliente al haber (serie 4, apuntarCobro). Null si no toca decirlo.
 */
export function textoAsientoDelCobro(q: QueHaceElCobro, o: { nombre: (c: string) => string; cuentaCliente: string | null; importe: string }): string | null {
  if (q.que !== 'otra' || /^57/.test(q.cuenta)) return null
  const nombre = o.nombre(q.cuenta)
  const elegida = `la ${q.cuenta}${nombre ? ` · ${nombre}` : ''}`
  const cliente = o.cuentaCliente ? `la ${o.cuentaCliente} del cliente` : 'la del cliente'
  return `No es un banco ni la caja: al guardar, un asiento del cobro con ${elegida} al debe y ${cliente} al haber, por ${o.importe}, y la factura queda cobrada.`
}

/** La fecha del cobro que se propone: la de la factura más los días de su ficha (sin días, la de la factura). */
export function fechaDelCobro(fecha: string, dias: number | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return ''
  if (!dias) return fecha
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// ── Las comprobaciones y la franja ──────────────────────────────────────────

export interface DatosComprobarEmitida {
  numero: string
  fecha: string
  calendario: Calendario | null
  /** Otra emitida con el mismo número y el mismo NIF (el libro de expedidas), o null. */
  repetida: string | null
  /** El NIF de la ficha del cliente; hayCliente: si hay cliente elegido. */
  hayCliente: boolean
  nif: string | null
  iva: readonly LineaIva[]
  total: number
}

/** Las comprobaciones de la línea: repetida, el periodo, el NIF y que las cuotas son las de sus bases. Ninguna dice «bien» de lo que no hay. */
export function comprobacionesEmitida(d: DatosComprobarEmitida): UnaComprobacion[] {
  const l: UnaComprobacion[] = []
  if (d.repetida) l.push({ id: 'repetida', tono: 'ambar', texto: d.repetida })
  else if (d.numero.trim() && d.hayCliente) l.push({ id: 'repetida', tono: 'bien', texto: 'No está repetida' })
  const p = periodoAbierto(d.fecha, d.calendario)
  if (p) l.push({ id: 'periodo', tono: p.abierto ? 'bien' : 'ambar', texto: p.texto })
  if (d.hayCliente) {
    if (!d.nif) l.push({ id: 'nif', tono: 'ambar', texto: 'Su ficha no tiene NIF' })
    else if (nifValido(d.nif)) l.push({ id: 'nif', tono: 'bien', texto: 'NIF correcto' })
    else l.push({ id: 'nif', tono: 'rojo', texto: `El NIF de su ficha (${d.nif}) no es válido` })
  }
  const mal = d.iva.find((x) => {
    const base = num(x.base); const cuota = num(x.cuota); const tipo = Number(x.tipo)
    return base !== null && cuota !== null && Number.isFinite(tipo) && Math.abs(cent(cuotaIva(base, tipo)) - cent(cuota)) > 1
  })
  if (mal) l.push({ id: 'suma', tono: 'ambar', texto: `La cuota del ${mal.tipo} % no es la base × ${mal.tipo} % (${cifra(cuotaIva(num(mal.base) ?? 0, Number(mal.tipo)))})` })
  else if (d.total > 0) l.push({ id: 'suma', tono: 'bien', texto: 'Bases y cuotas suman el total' })
  return l
}

/** Lo que tiene que estar para que la franja diga «Rellenada» o «bien» (K04b: con casillas vacías, lo que falta). */
export function vaciasEmitida(b: Pick<BorradorEmitida, 'clienteId' | 'numero' | 'fecha' | 'ventas'>, total: number): string[] {
  const l: string[] = []
  if (!b.clienteId) l.push('el cliente')
  if (!b.numero.trim()) l.push('el número de factura')
  if (!b.fecha.trim()) l.push('la fecha')
  if (!(total > 0)) l.push('el importe')
  if (!b.ventas.some((v) => v.cuenta.trim())) l.push('la cuenta de venta')
  return l
}

const enFrase = (l: readonly string[]) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`)

export type ModoEmitida = 'a_mano' | 'rellenada' | 'hecha_sola'

/**
 * La franja de la cabecera. A mano: «La escribes tú.» Hecha sola: «Hecha por
 * Sumied.» y su asiento. Rellenada: con lo que falta, «Mira esto · Falta …»; si
 * no, con sus dudas (las comprobaciones que no están bien y la duda de la cuenta).
 */
export function estadoDeLaEmitida(o: { modo: ModoEmitida; comprobaciones: readonly UnaComprobacion[]; hayDuda: boolean; vacias: readonly string[]; asiento?: number | null }): { tono: TonoEstado; fuerte: string; resto: string } {
  if (o.modo === 'a_mano') return { tono: 'gris', fuerte: 'La escribes tú.', resto: 'Se comprueba mientras escribes.' }
  if (o.modo === 'hecha_sola') return { tono: 'verde', fuerte: 'Hecha por Sumied.', resto: o.asiento ? `Su asiento, el 1 / ${o.asiento}, está validado.` : 'Su asiento está validado.' }
  if (o.vacias.length) return { tono: 'ambar', fuerte: 'Mira esto ·', resto: `Falta ${enFrase(o.vacias)}` }
  const bien = o.comprobaciones.filter((c) => c.tono === 'bien').length
  const dudas = o.comprobaciones.filter((c) => c.tono !== 'bien').length + (o.hayDuda ? 1 : 0)
  return {
    tono: dudas ? 'ambar' : 'verde',
    fuerte: dudas ? `Rellenada por Sumied, con ${dudas} duda${dudas === 1 ? '' : 's'}.` : 'Rellenada por Sumied.',
    resto: `${bien} comprobaci${bien === 1 ? 'ón' : 'ones'} bien · ${dudas ? 'mira lo ámbar y pulsa Intro.' : 'pulsa Intro.'}`,
  }
}

/** «Operaciones interiores», «Entregas intracomunitarias», «Exportaciones» (customer_fiscal.operation_scope); con recargo, «Recargo de equivalencia». */
export function textoOperacionCliente(scope: string | null, recargo: boolean): string | null {
  if (recargo) return 'Recargo de equivalencia'
  return scope === 'eu' ? 'Entregas intracomunitarias' : scope === 'export' ? 'Exportaciones' : scope === 'domestic' ? 'Operaciones interiores' : null
}

/** El nombre de la pestaña: «Factura emitida · <cliente>»; la nueva sin cliente, «· nueva»; una que existe sin cliente, «· sin cliente». */
export const nombreDePestanaEmitida = (cliente: string | null | undefined, existe: boolean): string =>
  `Factura emitida · ${cliente?.trim() || (existe ? 'sin cliente' : 'nueva')}`

// ── Una emitida que ya tiene asiento (rellenada o hecha sola) ───────────────

/** Lo que se lee de un apunte (lib/diario, ApunteDiario): lo justo. */
export interface ApunteLeido { cuenta: string; debe: number; haber: number; localId: string | null; iva: { base: number; libro: string; tipo: number | null } | null }

const importe = (n: number) => importeEsCorto(n)
const importeEsCorto = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * El borrador de la ficha desde su asiento: el cliente, el número y la fecha de
 * la factura; el IVA de las líneas con libro «issued» (base, tipo y cuota);
 * las 70x con su importe; la retención de la 473 (su tipo, el que da sobre la base).
 */
export function borradorDesdeAsiento(a: { terceroId: string | null; documento: string | null; fechaDocumento?: string | null; fecha: string; apuntes: readonly ApunteLeido[] }): BorradorEmitida {
  const iva: LineaIva[] = a.apuntes.filter((l) => l.iva && l.iva.libro === 'issued' && /^477/.test(l.cuenta))
    .map((l) => ({ base: importe(l.iva!.base), tipo: String(l.iva!.tipo ?? ''), cuota: importe(deCent(cent(l.haber) - cent(l.debe))) }))
  const ventas: LineaVenta[] = a.apuntes.filter((l) => /^70/.test(l.cuenta)).map((l) => ({ cuenta: l.cuenta, local: l.localId ?? '', importe: importe(deCent(cent(l.haber) - cent(l.debe))) }))
  const base = iva.reduce((t, l) => t + cent(num(l.base) ?? 0), 0)
  const ret = a.apuntes.filter((l) => /^473/.test(l.cuenta)).reduce((t, l) => t + cent(l.debe) - cent(l.haber), 0)
  const tipoRet = base && ret ? Math.round((ret / base) * 100) : null
  return {
    clienteId: a.terceroId ?? '', numero: a.documento ?? '', fecha: (a.fechaDocumento ?? a.fecha).slice(0, 10), iva: iva.length ? iva : [{ base: '', tipo: '21', cuota: '' }],
    retencion: ret ? { tipo: tipoRet !== null ? String(tipoRet) : '', importe: importe(deCent(ret)) } : null,
    ventas: ventas.length ? ventas : [{ cuenta: '', local: '', importe: '' }], cobroCuenta: null, cobroFecha: null,
  }
}
