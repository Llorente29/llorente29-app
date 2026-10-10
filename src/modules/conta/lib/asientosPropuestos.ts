// src/modules/conta/lib/asientosPropuestos.ts
//
// C04 · Los asientos que se hacen solos: de lo que Folvy ya sabe a una
// propuesta con su confianza y su porqué (regla 10). Puro: recibe los datos
// leídos y las cuentas de la empresa, devuelve la propuesta o dice por qué no
// propone nada. Nada valida solo.
//
//   · ventasDelDia — regla 6 y 13. Un asiento por día y local con las ventas
//     de marcas PROPIAS (factura simplificada de Folvy, todas al tipo de la
//     empresa): cobro por plataforma a su 430, venta por marca a 700 y el IVA
//     repercutido por tipo con base, cuota y número de facturas (RIVA 63.4).
//     Las cedidas no entran: van solo por la liquidación mensual del socio
//     (D9). Una cancelación antes de entregar no es venta. Una devolución
//     posterior entra el día en que se produce, con su línea propia y el
//     pedido (Ley 37/1992 art. 80.Dos). Sin base en el pedido, se calcula al
//     tipo de la empresa y se dice; si el pedido trae otro tipo, duda.
//   · liquidacionPlataforma — regla 7. La factura de comisión y cargos de la
//     plataforma (gasto con IVA al 21 %), la compensación con su 430 y el
//     cobro al banco. NUNCA vuelve a asentar ventas que ya están en un resumen
//     del día; las de una marca cedida son del socio (NRV 16.ª).
//   · facturaProveedor / pagoFactura — regla 8. Lo comprado a nombre del socio
//     no es gasto: no se propone.
//   · liquidacionSocio — su resumen mensual hace de factura de compra; la
//     comisión, ingreso por servicios (705) con IVA; se compensan las cuentas.
//   · nomina — 640, 642, 476, 4751 (modelo 111) y 465.
//   · aprendizaje (regla 11) y cuentaDeBoe (regla 12).

import { NORMAS } from './normas'
import { eurosExactos } from './formato'
import {
  baseDeTotal, cent, cuotaIva, deCent, peor, red2,
  type Confianza, type LineaAsiento, type Propuesta, type Razon,
} from './libro'

const cita = (k: keyof typeof NORMAS) => NORMAS[k].cita

// ── Ventas del día (reglas 6 y 13) ──────────────────────────────────────────

export interface PedidoDia {
  id: string
  /** Código del pedido en la plataforma (el que enlaza la devolución). */
  codigo: string | null
  canalId: string | null
  marcaId: string | null
  /** La marca es de la empresa (no cedida). */
  marcaPropia: boolean
  /** «unconfirmed»: cerrado por el cierre del día como no confirmado por la plataforma (no es venta). */
  estado: 'closed' | 'cancelled' | 'open' | 'unconfirmed'
  total: number
  /** Lo que trae el pedido; null si no lo trae (HubRise de Glovo y Just Eat). */
  base: number | null
  cuota: number | null
  /** Los tipos que traen sus líneas (Uber vía HubRise: [10]). Vacío si no traen. */
  tiposEnLineas: number[]
}

export interface DevolucionDia {
  pedidoId: string | null
  codigo: string | null
  canalId: string | null
  marcaId: string | null
  marcaPropia: boolean
  /** Lo devuelto al cliente, con el impuesto dentro. */
  importe: number
  /** Si la venta devuelta tenía factura o factura simplificada emitida por nosotros. */
  conFactura: boolean
}

export interface CuentasVentas {
  /** La 430 de la plataforma de cada canal (o la caja/banco de la sala). */
  cobroPorCanal: Record<string, string>
  ventas: string
  devoluciones: string
  /** La 477 del tipo de ventas. */
  ivaRepercutido: string
}

export interface EntradaVentasDia {
  fecha: string
  localId: string
  tipo: { id: string; porcentaje: number }
  pedidos: readonly PedidoDia[]
  devoluciones: readonly DevolucionDia[]
  cuentas: CuentasVentas
  /** Una línea de venta por marca (resultado por marca). */
  porMarca: boolean
  /** Nombres para el porqué. */
  nombreCanal: (id: string | null) => string
  nombreLocal: string
}

export interface ResultadoVentasDia {
  propuesta: Propuesta | null
  /** Por qué no se propone, si no se propone. */
  sinPropuesta: string | null
  /** Los pedidos de los que habla ese porqué, para «Ver los N pedidos». */
  pedidosDelPorque?: PedidoDia[]
  resumen: {
    tickets: number
    total: number
    base: number
    cuota: number
    baseCalculada: boolean
    cedidasFuera: { pedidos: number; total: number }
    canceladosFuera: number
    /** Cerrados al cierre del día sin confirmar: no están en estas ventas, pero se enseñan. */
    noConfirmados: { pedidos: number; total: number; ids: string[] }
    devoluciones: { pedidos: number; total: number }
    porCanal: { canalId: string | null; total: number }[]
    porMarca: { marcaId: string | null; base: number }[]
    pedidoIds: string[]
  }
}

export function ventasDelDia(e: EntradaVentasDia): ResultadoVentasDia {
  const tipo = e.tipo.porcentaje
  const cedidas = e.pedidos.filter((p) => !p.marcaPropia && p.estado === 'closed')
  const cancelados = e.pedidos.filter((p) => p.estado === 'cancelled')
  const abiertos = e.pedidos.filter((p) => p.estado === 'open' && p.marcaPropia)
  const noConfirmados = e.pedidos.filter((p) => p.estado === 'unconfirmed')
  const propios = e.pedidos.filter((p) => p.marcaPropia && p.estado === 'closed')
  const razones: Razon[] = []
  const avisos: string[] = []
  const confs: Confianza[] = []

  // Base y cuota de cada ticket: la del pedido si la trae; si no, al tipo de la empresa.
  let calculada = false
  let otroTipo = 0
  const filas = propios.map((p) => {
    if (p.tiposEnLineas.some((t) => t !== tipo)) otroTipo += 1
    if (p.base !== null && p.cuota !== null && cent(p.base) + cent(p.cuota) === cent(p.total)) return { p, base: p.base, cuota: p.cuota }
    calculada = true
    return { p, ...baseDeTotal(p.total, tipo) }
  })
  const devs = e.devoluciones.filter((d) => d.marcaPropia).map((d) => ({ d, ...baseDeTotal(d.importe, tipo) }))
  const sum = (xs: number[]) => deCent(xs.reduce((t, x) => t + cent(x), 0))
  const total = sum(filas.map((f) => f.p.total))
  const base = sum(filas.map((f) => f.base))
  const cuota = sum(filas.map((f) => f.cuota))

  const porCanalMap = new Map<string | null, number>()
  for (const f of filas) porCanalMap.set(f.p.canalId, (porCanalMap.get(f.p.canalId) ?? 0) + cent(f.p.total))
  const porMarcaMap = new Map<string | null, number>()
  for (const f of filas) porMarcaMap.set(f.p.marcaId, (porMarcaMap.get(f.p.marcaId) ?? 0) + cent(f.base))
  const resumen: ResultadoVentasDia['resumen'] = {
    tickets: filas.length, total, base, cuota, baseCalculada: calculada,
    cedidasFuera: { pedidos: cedidas.length, total: sum(cedidas.map((c) => c.total)) },
    canceladosFuera: cancelados.length,
    noConfirmados: { pedidos: noConfirmados.length, total: sum(noConfirmados.map((p) => p.total)), ids: noConfirmados.map((p) => p.id).sort() },
    devoluciones: { pedidos: devs.length, total: sum(devs.map((d) => d.d.importe)) },
    porCanal: [...porCanalMap].map(([canalId, c]) => ({ canalId, total: deCent(c) })),
    porMarca: [...porMarcaMap].map(([marcaId, c]) => ({ marcaId, base: deCent(c) })),
    pedidoIds: filas.map((f) => f.p.id).sort(),
  }

  if (filas.length === 0 && devs.length === 0) {
    return { propuesta: null, sinPropuesta: cedidas.length ? 'Ese día solo hubo ventas de marcas cedidas: van en la liquidación del socio.' : 'Ese día no hubo ventas de tus marcas.', resumen }
  }
  if (abiertos.length) {
    // Solo se proponen días cerrados, y el cierre del día pasa cada hora a los
    // 7 minutos: esto solo puede verse en ese rato, o si el cierre ha fallado
    // (y entonces el agente del Libro diario está en rojo).
    return { propuesta: null, sinPropuesta: `El cierre del día aún no ha pasado por este día: ${abiertos.length} pedido${abiertos.length === 1 ? '' : 's'} de tus marcas ${abiertos.length === 1 ? 'sigue abierto' : 'siguen abiertos'}. Pasa cada hora a los 7 minutos; vuelve a proponer después.`, resumen, pedidosDelPorque: abiertos }
  }
  const sinCuenta = [...porCanalMap.keys(), ...devs.map((d) => d.d.canalId)].filter((c) => !c || !e.cuentas.cobroPorCanal[c])
  if (sinCuenta.length) {
    return { propuesta: null, sinPropuesta: `No sé a qué cuenta va lo que cobra ${[...new Set(sinCuenta.map(e.nombreCanal))].join(', ')}: enlaza su 430 en su ficha (Clientes y proveedores › Plataformas).`, resumen,
      pedidosDelPorque: filas.map((f) => f.p).filter((p) => !p.canalId || !e.cuentas.cobroPorCanal[p.canalId]) }
  }

  const lineas: LineaAsiento[] = []
  for (const [canalId, c] of porCanalMap) {
    lineas.push({ cuenta: e.cuentas.cobroPorCanal[canalId!], debe: deCent(c), haber: 0, localId: e.localId, concepto: `Cobra ${e.nombreCanal(canalId)}` })
  }
  if (e.porMarca) {
    for (const [marcaId, c] of porMarcaMap) lineas.push({ cuenta: e.cuentas.ventas, debe: 0, haber: deCent(c), localId: e.localId, marcaId, concepto: 'Ventas de tus marcas' })
  } else if (filas.length) {
    lineas.push({ cuenta: e.cuentas.ventas, debe: 0, haber: base, localId: e.localId, concepto: 'Ventas de tus marcas' })
  }
  if (filas.length) {
    lineas.push({ cuenta: e.cuentas.ivaRepercutido, debe: 0, haber: cuota, localId: e.localId, concepto: `IVA repercutido ${tipo} %`,
      iva: { tipoId: e.tipo.id, tipo, base, libro: 'issued', facturas: filas.length } })
  }
  // Devoluciones: su línea propia y el pedido (art. 80.Dos).
  for (const d of devs) {
    const ref = d.d.codigo ?? d.d.pedidoId
    lineas.push({ cuenta: e.cuentas.devoluciones, debe: d.base, haber: 0, localId: e.localId, marcaId: d.d.marcaId, documento: ref, concepto: `Devolución del pedido ${ref ?? 'sin código'}` })
    lineas.push({ cuenta: e.cuentas.ivaRepercutido, debe: d.cuota, haber: 0, localId: e.localId, documento: ref, concepto: `IVA de la devolución ${ref ?? ''}`.trim(),
      iva: { tipoId: e.tipo.id, tipo, base: d.base, libro: 'issued', facturas: 1 } })
    lineas.push({ cuenta: e.cuentas.cobroPorCanal[d.d.canalId!], debe: 0, haber: d.d.importe, localId: e.localId, documento: ref, concepto: `Devuelve ${e.nombreCanal(d.d.canalId)}` })
  }
  if (devs.length) {
    razones.push({ decision: `${devs.length} devolución${devs.length === 1 ? '' : 'es'} de ${eurosExactos(resumen.devoluciones.total)}`, porque: 'la plataforma devolvió al cliente después de la venta: menos venta y menos IVA, contra lo que cobra la plataforma, el día en que se produce', cita: cita('ivaModificacionBase') })
    if (devs.some((d) => d.d.conFactura)) {
      avisos.push(`Alguna devolución es de una venta con factura emitida por ti: hace falta su factura rectificativa (${cita('facturaRectificativa')}).`)
      confs.push('probable')
    }
  }

  // Comprobaciones: el total del asiento es el de los tickets (regla 6) y la cuota por tipo (regla 5).
  const cobrado = sum([...porCanalMap.values()].map(deCent))
  if (cent(cobrado) !== cent(total)) {
    return { propuesta: null, sinPropuesta: `El cobro (${eurosExactos(cobrado)}) no es el total de los tickets (${eurosExactos(total)}): no se propone.`, resumen }
  }
  // Tolerancia del redondeo: con la base calculada, cada ticket se aparta de
  // base × tipo hasta 1,1 × medio céntimo (0,55), y el redondeo del total otro
  // medio. Con floor(n/2), un día de UN ticket de 20,40 € (base 18,55, cuota
  // 1,85; 18,55 × 10 % = 1,855 → 1,86) no se proponía (cierre del día, T4).
  // Un pedido al 21 % se aparta euros, no céntimos: sigue sin pasar.
  if (filas.length && Math.abs(cent(cuota) - cent(cuotaIva(base, tipo))) > Math.floor(0.55 * filas.length + 0.5)) {
    return { propuesta: null, sinPropuesta: `La cuota de los tickets (${eurosExactos(cuota)}) se aleja de la base × ${tipo} % más de medio céntimo por ticket: hay pedidos con otro tipo.`, resumen,
      pedidosDelPorque: filas.filter((f) => f.p.tiposEnLineas.some((t) => t !== tipo) || Math.abs(cent(f.cuota) - cent(cuotaIva(f.base, tipo))) > 1).map((f) => f.p) }
  }

  razones.unshift(
    { decision: `${filas.length} ticket${filas.length === 1 ? '' : 's'} de tus marcas, ${eurosExactos(total)}`, porque: `una factura simplificada por pedido, anotadas juntas en un asiento resumen del día con base y cuota por tipo`, cita: `${cita('libroAnotacionConjunta')}; ${cita('ivaAsientoResumenExpedidas')}` },
    { decision: `IVA al ${tipo} %`, porque: 'reparto de comida = servicio de restauración: criterio de tu empresa', cita: cita('ivaHosteleria') },
  )
  if (calculada) {
    razones.push({ decision: 'Base calculada', porque: `algún pedido no trae la base imponible: la calculo del total al ${tipo} % (el tipo de tus ventas); no la invento, la deduzco y lo digo` })
    confs.push('probable')
  }
  if (otroTipo) {
    avisos.push(`${otroTipo} pedido${otroTipo === 1 ? ' trae' : 's traen'} en sus líneas un tipo distinto del ${tipo} %: mira cuáles antes de validar.`)
    confs.push('duda')
  }
  if (cedidas.length) {
    razones.push({ decision: `Fuera: ${cedidas.length} pedidos de marcas cedidas (${eurosExactos(resumen.cedidasFuera.total)})`, porque: 'son ventas del socio y su IVA es del socio: entran solo en su liquidación mensual, que comparas con estos tickets', cita: cita('ivaMediacionNombreAjeno') })
  }
  if (cancelados.length) razones.push({ decision: `Fuera: ${cancelados.length} cancelado${cancelados.length === 1 ? '' : 's'}`, porque: 'cancelado antes de entregar no es venta' })

  return {
    propuesta: {
      serie: 1, fecha: e.fecha, concepto: `Ventas del día · ${e.nombreLocal}`, origen: { tipo: 'sales_day', id: null }, lineas,
      confianza: peor('seguro', ...confs),
      porque: `${filas.length} tickets de tus marcas cuadran con lo que cobran las plataformas, al céntimo${calculada ? '; base calculada al ' + tipo + ' %' : ''}.`,
      razones, avisos,
    },
    sinPropuesta: null,
    resumen,
  }
}

// ── Liquidación de plataforma (regla 7) ─────────────────────────────────────

export interface CargoPlataforma { concepto: string; importe: number }

export interface EntradaLiquidacion {
  id: string
  fecha: string
  ref: string | null
  plataforma: string
  /** own: marcas propias; licensed: una marca cedida (el dinero es del socio). */
  flujo: 'own' | 'licensed'
  ventas: number
  /** Comisión sin IVA (la plataforma la factura con IVA al 21 %). */
  comision: number
  /** Cargos que la plataforma te factura (espera del repartidor, promociones a tu cargo, cuotas…), sin IVA. */
  cargos: CargoPlataforma[]
  /** Lo que devolvió a clientes en el periodo: va a los resúmenes del día, no aquí. */
  devoluciones: number
  neto: number | null
  cobrado: { fecha: string; importe: number } | null
  /** De los pedidos del periodo, cuántos están ya en un resumen del día validado o propuesto. */
  pedidos: { total: number; asentados: number }
  localId: string | null
}
export interface CuentasLiquidacion {
  cliente430: string
  proveedor410: string
  comision: string
  otrosCargos: string
  iva21: { cuenta: string; tipoId: string }
  banco: string | null
  /** «Liquidación pendiente con <socio>» (bajo la 410, papel «liquidacion»): lo cobrado por cuenta de él. */
  pendienteSocio: string | null
}

export function liquidacionPlataforma(l: EntradaLiquidacion, c: CuentasLiquidacion): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  const avisos: string[] = []
  const razones: Razon[] = []
  const confs: Confianza[] = []
  const loc = l.localId
  const comun = !loc
  const cabeza = `Liquidación ${l.plataforma}${l.ref ? ` · ${l.ref}` : ''}`

  if (l.flujo === 'licensed') {
    // El dinero de las ventas de una marca cedida es del socio: entra al banco y se le debe.
    if (!l.cobrado || !c.banco || !c.pendienteSocio) {
      return { propuesta: null, sinPropuesta: !l.cobrado ? 'Liquidación de una marca cedida aún sin cobrar: se asienta cuando llegue al banco.' : 'Falta la cuenta pendiente con el socio o el banco del local.' }
    }
    return {
      sinPropuesta: null,
      propuesta: {
        serie: 3, fecha: l.cobrado.fecha, concepto: `${cabeza} (marca cedida)`, origen: { tipo: 'channel_settlement', id: l.id },
        lineas: [
          { cuenta: c.banco, debe: l.cobrado.importe, haber: 0, localId: loc, comun },
          { cuenta: c.pendienteSocio, debe: 0, haber: l.cobrado.importe, localId: loc, comun, concepto: 'Ventas del socio cobradas por ti' },
        ],
        confianza: 'probable',
        porque: 'Lo cobrado por las ventas de una marca cedida es del socio: queda pendiente hasta su liquidación mensual.',
        razones: [{ decision: 'No es ingreso tuyo', porque: 'son ventas del socio cobradas por cuenta de él', cita: cita('ingresosPorCuentaDeTerceros') }],
        avisos,
      },
    }
  }

  const cargos = l.cargos.filter((x) => cent(x.importe) !== 0)
  const baseFactura = red2(l.comision + cargos.reduce((t, x) => t + x.importe, 0))
  const iva = cuotaIva(baseFactura, 21)
  const totalFactura = red2(baseFactura + iva)
  const lineas: LineaAsiento[] = []
  if (cent(l.comision)) lineas.push({ cuenta: c.comision, debe: l.comision, haber: 0, localId: loc, comun, concepto: `Comisión ${l.plataforma}` })
  for (const x of cargos) lineas.push({ cuenta: c.otrosCargos, debe: x.importe, haber: 0, localId: loc, comun, concepto: x.concepto })
  if (cent(baseFactura)) {
    lineas.push({ cuenta: c.iva21.cuenta, debe: iva, haber: 0, localId: loc, comun, concepto: 'IVA soportado 21 %', iva: { tipoId: c.iva21.tipoId, tipo: 21, base: baseFactura, libro: 'received', deducible: 'yes' } })
    lineas.push({ cuenta: c.proveedor410, debe: 0, haber: totalFactura, localId: loc, comun, concepto: `Factura de ${l.plataforma}` })
    // Compensa: lo que te cobra se descuenta de lo que te debe por ventas.
    lineas.push({ cuenta: c.proveedor410, debe: totalFactura, haber: 0, localId: loc, comun, concepto: 'Compensada con tus ventas' })
    lineas.push({ cuenta: c.cliente430, debe: 0, haber: totalFactura, localId: loc, comun, concepto: 'Compensada con su factura' })
    razones.push({ decision: `Comisión y cargos: ${eurosExactos(baseFactura)} + IVA 21 %`, porque: 'la plataforma te factura su servicio; los cargos (espera del repartidor y demás) son gasto con IVA dentro de su factura y nunca tocan la venta' })
    if (cargos.length) razones.push({ decision: `${cargos.length} cargo${cargos.length === 1 ? '' : 's'} aparte de la comisión`, porque: cargos.map((x) => `${x.concepto} ${eurosExactos(x.importe)}`).join(' · ') })
  }
  if (l.cobrado && c.banco) {
    lineas.push({ cuenta: c.banco, debe: l.cobrado.importe, haber: 0, localId: loc, comun, concepto: 'Cobro al banco' })
    lineas.push({ cuenta: c.cliente430, debe: 0, haber: l.cobrado.importe, localId: loc, comun, concepto: 'Cobro de la liquidación' })
  } else {
    razones.push({ decision: 'Cobro aún no', porque: 'cuando llegue al banco se casa con esta liquidación (Bancos)' })
  }

  // Regla 7: las ventas ya van por los resúmenes del día; aquí nunca.
  if (l.pedidos.asentados < l.pedidos.total) {
    avisos.push(`${l.pedidos.total - l.pedidos.asentados} de ${l.pedidos.total} pedidos del periodo aún no están en un resumen del día: esta liquidación no los asienta (irían dos veces); revisa los días que faltan.`)
    confs.push('duda')
  } else {
    razones.push({ decision: 'Sin ventas', porque: `${l.pedidos.total ? `los ${l.pedidos.total} pedidos del periodo ya están` : 'las ventas del periodo van'} en sus resúmenes del día: aquí solo la comisión, los cargos y el cobro` })
  }
  if (cent(l.devoluciones)) razones.push({ decision: `Devoluciones (${eurosExactos(l.devoluciones)}) fuera`, porque: 'van al resumen del día en que se producen, con su pedido', cita: cita('ivaModificacionBase') })
  // 1 céntimo es el redondeo del IVA (Glovo lo calcula pedido a pedido: 36 de sus 96 liquidaciones).
  if (l.neto !== null && Math.abs(cent(l.ventas - l.devoluciones - totalFactura) - cent(l.neto)) > 1) {
    avisos.push(`Ventas − devoluciones − factura = ${eurosExactos(red2(l.ventas - l.devoluciones - totalFactura))}, y la plataforma dice neto ${eurosExactos(l.neto)}: la comisión puede venir con el IVA dentro o falta un cargo.`)
    confs.push('duda')
  }
  if (l.cobrado && l.neto !== null && cent(l.cobrado.importe) !== cent(l.neto)) {
    avisos.push(`Al banco llegaron ${eurosExactos(l.cobrado.importe)} y el neto es ${eurosExactos(l.neto)}.`)
    confs.push('duda')
  }
  if (!c.banco && l.cobrado) { avisos.push('El local no tiene su cuenta del banco: ponla en Tablas › Bancos.'); confs.push('duda') }
  if (lineas.length < 2) return { propuesta: null, sinPropuesta: 'La liquidación no trae comisión, cargos ni cobro: no hay nada que asentar.' }

  return {
    sinPropuesta: null,
    propuesta: {
      serie: 3, fecha: l.cobrado?.fecha ?? l.fecha, concepto: cabeza, origen: { tipo: 'channel_settlement', id: l.id }, lineas,
      confianza: peor('seguro', ...confs),
      porque: `Comisión y cargos con su IVA, compensados con lo que te debe${l.cobrado ? ', y el cobro al banco' : ''}; las ventas ya están en sus días.`,
      razones, avisos,
    },
  }
}

// ── Factura de proveedor y su pago (regla 8) ────────────────────────────────

export interface LineaFactura { base: number; tipo: { id: string; porcentaje: number } | null; cuentaGasto: string | null }
export interface EntradaFactura {
  id: string
  numero: string | null
  fecha: string
  proveedor: string
  terceroId: string | null
  /** El proveedor es el socio de marca: lo suyo va por su liquidación. */
  esSocio: boolean
  /** Compras (10/10), §2.6: sin NIF en la ficha no se propone (el IVA no se deduce). */
  tieneNif: boolean
  localId: string | null
  lineas: readonly LineaFactura[]
  total: number
  retencion: { tipoId: string; porcentaje: number; base: number; importe: number; modelo: '111' | '115' | '123' } | null
}
export interface CuentasFactura {
  proveedor: string
  ivaSoportado: (porcentaje: number) => { cuenta: string; tipoId: string } | null
  retencion: string
}

export function facturaProveedor(f: EntradaFactura, c: CuentasFactura): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  if (f.esSocio) return { propuesta: null, sinPropuesta: `${f.proveedor} es tu socio de marca: lo que te vende a su nombre no es gasto tuyo, va en su liquidación mensual.` }
  // Compras (10/10), §2.6: lo que falta en la ficha se dice, no se tapa. Una
  // factura sin NIF o sin tipo de gasto NO cae a una cuenta genérica.
  if (!f.tieneNif) return { propuesta: null, sinPropuesta: `A ${f.proveedor} le falta el NIF: ponlo en su ficha. Sin él no se puede deducir el IVA.` }
  if (f.lineas.some((l) => !l.cuentaGasto)) return { propuesta: null, sinPropuesta: `A ${f.proveedor} le falta el tipo de gasto: ponlo en su ficha y la factura se propone.` }
  const razones: Razon[] = []
  const avisos: string[] = []
  const confs: Confianza[] = []
  const loc = f.localId
  const lineas: LineaAsiento[] = []
  const gastos = new Map<string, number>()
  for (const l of f.lineas) gastos.set(l.cuentaGasto!, (gastos.get(l.cuentaGasto!) ?? 0) + cent(l.base))
  for (const [cuenta, cc] of gastos) lineas.push({ cuenta, debe: deCent(cc), haber: 0, localId: loc, comun: !loc, documento: f.numero })
  const porTipo = new Map<number, { id: string; base: number }>()
  for (const l of f.lineas) {
    if (!l.tipo) continue
    const x = porTipo.get(l.tipo.porcentaje) ?? { id: l.tipo.id, base: 0 }
    x.base += cent(l.base)
    porTipo.set(l.tipo.porcentaje, x)
  }
  let ivaTotal = 0
  for (const [pct, x] of porTipo) {
    if (pct === 0) continue
    const cta = c.ivaSoportado(pct)
    if (!cta) { avisos.push(`No hay 472 del ${pct} % en tu plan.`); confs.push('duda'); continue }
    const base = deCent(x.base)
    const cuota = cuotaIva(base, pct)
    ivaTotal += cent(cuota)
    lineas.push({ cuenta: cta.cuenta, debe: cuota, haber: 0, localId: loc, comun: !loc, documento: f.numero, iva: { tipoId: cta.tipoId, tipo: pct, base, libro: 'received', deducible: 'yes' } })
  }
  if (f.retencion) {
    lineas.push({ cuenta: c.retencion, debe: 0, haber: f.retencion.importe, localId: loc, comun: !loc, documento: f.numero,
      retencion: { tipoId: f.retencion.tipoId, tipo: f.retencion.porcentaje, base: f.retencion.base, modelo: f.retencion.modelo } })
    razones.push({ decision: `Retención ${f.retencion.porcentaje} % (${eurosExactos(f.retencion.importe)})`, porque: `se la ingresas tú a Hacienda en el ${f.retencion.modelo}` })
  }
  const baseTotal = f.lineas.reduce((t, l) => t + cent(l.base), 0)
  const aPagar = deCent(baseTotal + ivaTotal - cent(f.retencion?.importe ?? 0))
  lineas.push({ cuenta: c.proveedor, debe: 0, haber: aPagar, localId: loc, comun: !loc, documento: f.numero, terceroId: f.terceroId })
  if (cent(deCent(baseTotal + ivaTotal)) !== cent(f.total)) {
    avisos.push(`Base + IVA = ${eurosExactos(deCent(baseTotal + ivaTotal))}, y la factura dice ${eurosExactos(f.total)}.`)
    confs.push('duda')
  }
  if (!loc) { razones.push({ decision: 'Común', porque: 'la factura no dice de qué local es: queda común y el informe la reparte' }); confs.push('probable') }
  razones.unshift({ decision: 'IVA soportado por tipo', porque: 'una 472 por tipo, con su base, al libro de recibidas' })
  return {
    sinPropuesta: null,
    propuesta: {
      serie: 2, fecha: f.fecha, concepto: `Factura ${f.proveedor}${f.numero ? ` · ${f.numero}` : ''}`, origen: { tipo: 'supplier_invoice', id: f.id },
      lineas, confianza: peor('seguro', ...confs),
      porque: `Gasto por su tipo, IVA por tipo${f.retencion ? ', retención' : ''} y el total a su cuenta.`,
      razones, avisos, terceroId: f.terceroId, documento: f.numero,
    },
  }
}

// ── Compras (10/10), §2.4: lo recibido sin factura al cierre del mes ──────
// UN asiento por proveedor y local el último día del mes (gasto contra
// «proveedores, facturas pendientes de recibir», 4009) y su contrario el día
// 1 del siguiente. Dice de qué recepciones sale. Sin tipo de gasto no cae a
// una cuenta genérica (§2.6): no se propone.

export interface EntradaFinDeMes {
  /** purchase_accrual.id: el origen de los dos asientos. */
  id: string
  /** Primer día del mes, AAAA-MM-01. */
  mes: string
  proveedor: string
  terceroId: string | null
  localId: string | null
  nombreLocal: string | null
  base: number
  recepciones: readonly { codigo: string | null; fecha: string; base: number | null }[]
  /** Recepciones sin importe: no están en la base, y se dice. */
  sinBase: number
}

const MESES_FIN = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

export function finDeMesCompras(e: EntradaFinDeMes, c: { gasto: string | null; pendiente: string | null }):
  { propuestas: Propuesta[]; sinPropuesta: string | null } {
  const nombreMes = MESES_FIN[Number(e.mes.slice(5, 7)) - 1]
  if (!c.gasto) return { propuestas: [], sinPropuesta: `A ${e.proveedor} le falta el tipo de gasto: ponlo en su ficha y lo recibido sin factura de ${nombreMes} se propone.` }
  if (!c.pendiente) return { propuestas: [], sinPropuesta: 'Falta en tu plan la cuenta de facturas pendientes de recibir (4009).' }
  if (cent(e.base) <= 0) return { propuestas: [], sinPropuesta: `Lo recibido sin factura de ${e.proveedor} en ${nombreMes} no trae importe: no hay nada que apuntar.` }
  const [a, m] = [Number(e.mes.slice(0, 4)), Number(e.mes.slice(5, 7))]
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
  const uno = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10)
  const base = deCent(cent(e.base))
  const loc = e.localId
  const deDonde = e.recepciones.map((r) => `${r.codigo ?? 'sin código'} (${ddmm(r.fecha)}${r.base === null ? ', sin importe' : `, ${eurosExactos(r.base)}`})`).join(', ')
  const razones: Razon[] = [
    { decision: `${e.recepciones.length} recepción(es) sin factura a ${ddmm(fin)}`, porque: deDonde },
    { decision: 'Gasto contra facturas pendientes de recibir', porque: 'el género ya es tuyo aunque la factura llegue después; el día 1 se da la vuelta y el gasto lo pone la factura' },
  ]
  const avisos = e.sinBase > 0 ? [`${e.sinBase} recepción(es) sin importe no están en la cifra.`] : []
  const confianza: Confianza = e.sinBase > 0 ? 'duda' : 'seguro'
  const donde = e.nombreLocal ? ` · ${e.nombreLocal}` : ''
  const mk = (fecha: string, tipo: 'purchase_accrual' | 'purchase_accrual_reversal', concepto: string, alReves: boolean): Propuesta => ({
    serie: 2, fecha, concepto, origen: { tipo, id: e.id },
    lineas: [
      { cuenta: c.gasto!, debe: alReves ? 0 : base, haber: alReves ? base : 0, localId: loc, comun: !loc },
      { cuenta: c.pendiente!, debe: alReves ? base : 0, haber: alReves ? 0 : base, localId: loc, comun: !loc, terceroId: e.terceroId },
    ],
    confianza, porque: alReves ? `Da la vuelta al del ${ddmm(fin)}: el gasto lo pone su factura.` : `Lo recibido de ${e.proveedor} en ${nombreMes} sin factura todavía.`,
    razones, avisos, terceroId: e.terceroId,
  })
  return {
    sinPropuesta: null,
    propuestas: [
      mk(fin, 'purchase_accrual', `Recibido sin factura · ${e.proveedor}${donde} · ${nombreMes}`, false),
      mk(uno, 'purchase_accrual_reversal', `Contrario del recibido sin factura · ${e.proveedor}${donde} · ${nombreMes}`, true),
    ],
  }
}

export function pagoFactura(p: { facturaId: string; fecha: string; proveedor: string; numero: string | null; importe: number; localId: string | null; terceroId: string | null },
  c: { proveedor: string; banco: string | null }): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  if (!c.banco) return { propuesta: null, sinPropuesta: 'Falta la cuenta del banco del local: ponla en Tablas › Bancos.' }
  return {
    sinPropuesta: null,
    propuesta: {
      serie: 3, fecha: p.fecha, concepto: `Pago a ${p.proveedor}${p.numero ? ` · ${p.numero}` : ''}`, origen: { tipo: 'supplier_payment', id: p.facturaId },
      lineas: [
        { cuenta: c.proveedor, debe: p.importe, haber: 0, localId: p.localId, comun: !p.localId, terceroId: p.terceroId, documento: p.numero },
        { cuenta: c.banco, debe: 0, haber: p.importe, localId: p.localId, comun: !p.localId, documento: p.numero },
      ],
      confianza: p.localId ? 'seguro' : 'probable',
      porque: 'La factura está marcada como pagada: sale del banco del local.',
      razones: [{ decision: 'Del banco del local', porque: 'cada local paga por su cuenta' }], avisos: [], terceroId: p.terceroId, documento: p.numero,
    },
  }
}

// ── Liquidación del socio ───────────────────────────────────────────────────

export interface EntradaSocio {
  id: string
  fecha: string
  socio: string
  terceroId: string | null
  localId: string | null
  /** Su resumen mensual: compras a su nombre (base e IVA por tipo). */
  compras: { base: number; tipo: { id: string; porcentaje: number } }[]
  /** La comisión que le facturas (base, al 21 %). */
  comision: number
  /** Lo que de sus ventas cobraste tú: está en su cuenta de liquidación (410), no en su 400. */
  ventasCobradas: number
}
export interface CuentasSocio {
  proveedor: string
  cliente: string
  compras: string
  ingresosServicios: string
  iva21: { cuenta: string; tipoId: string }
  ivaSoportado: (porcentaje: number) => { cuenta: string; tipoId: string } | null
  pendienteSocio: string
}

export function liquidacionSocio(s: EntradaSocio, c: CuentasSocio): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  const loc = s.localId
  const lineas: LineaAsiento[] = []
  const avisos: string[] = []
  let compras = 0
  for (const x of s.compras) {
    const cta = c.ivaSoportado(x.tipo.porcentaje)
    const cuota = cuotaIva(x.base, x.tipo.porcentaje)
    lineas.push({ cuenta: c.compras, debe: x.base, haber: 0, localId: loc, comun: !loc })
    if (cuota && cta) lineas.push({ cuenta: cta.cuenta, debe: cuota, haber: 0, localId: loc, comun: !loc, iva: { tipoId: cta.tipoId, tipo: x.tipo.porcentaje, base: x.base, libro: 'received', deducible: 'yes' } })
    else if (cuota) avisos.push(`No hay 472 del ${x.tipo.porcentaje} %.`)
    compras += cent(x.base) + cent(cuota)
  }
  if (compras) lineas.push({ cuenta: c.proveedor, debe: 0, haber: deCent(compras), localId: loc, comun: !loc, terceroId: s.terceroId, concepto: 'Su resumen mensual (compras)' })
  const ivaCom = cuotaIva(s.comision, 21)
  const factura = cent(s.comision) + cent(ivaCom)
  if (factura) {
    lineas.push({ cuenta: c.cliente, debe: deCent(factura), haber: 0, localId: loc, comun: !loc, terceroId: s.terceroId, concepto: 'Tu factura de comisión' })
    lineas.push({ cuenta: c.ingresosServicios, debe: 0, haber: s.comision, localId: loc, comun: !loc, concepto: 'Comisión sobre sus ventas' })
    lineas.push({ cuenta: c.iva21.cuenta, debe: 0, haber: ivaCom, localId: loc, comun: !loc, iva: { tipoId: c.iva21.tipoId, tipo: 21, base: s.comision, libro: 'issued' } })
  }
  // Compensación (respuesta 3, punto 4): lo que te debe (tu comisión, en su 430)
  // se cobra primero de lo que cobraste por cuenta de él (su cuenta de
  // liquidación, bajo la 410) y, si no llega, de lo que le debes por compras
  // (su 400). Lo cobrado por cuenta de él NUNCA pasa a su 400: esa es la de la
  // mercancía, y mezclarlo deja su Mayor ilegible. Lo que quede en su cuenta de
  // liquidación es lo que se le paga.
  const leDebes = compras + cent(s.ventasCobradas)
  const contraLiquidacion = Math.min(cent(s.ventasCobradas), factura)
  if (contraLiquidacion > 0) {
    lineas.push({ cuenta: c.pendienteSocio, debe: deCent(contraLiquidacion), haber: 0, localId: loc, comun: !loc, terceroId: s.terceroId, concepto: 'Compensación con lo cobrado por cuenta de él' })
    lineas.push({ cuenta: c.cliente, debe: 0, haber: deCent(contraLiquidacion), localId: loc, comun: !loc, terceroId: s.terceroId, concepto: 'Compensación con lo cobrado por cuenta de él' })
  }
  const contraCompras = Math.min(compras, factura - contraLiquidacion)
  if (contraCompras > 0) {
    lineas.push({ cuenta: c.proveedor, debe: deCent(contraCompras), haber: 0, localId: loc, comun: !loc, terceroId: s.terceroId, concepto: 'Compensación con sus compras' })
    lineas.push({ cuenta: c.cliente, debe: 0, haber: deCent(contraCompras), localId: loc, comun: !loc, terceroId: s.terceroId, concepto: 'Compensación con sus compras' })
  }
  if (lineas.length < 2) return { propuesta: null, sinPropuesta: 'La liquidación del socio está a cero.' }
  const neto = leDebes - factura
  return {
    sinPropuesta: null,
    propuesta: {
      serie: 4, fecha: s.fecha, concepto: `Liquidación ${s.socio}`, origen: { tipo: 'licensed_settlement', id: s.id }, lineas,
      confianza: avisos.length ? 'duda' : 'seguro',
      porque: `Su resumen mensual como compra, tu comisión como ingreso con IVA, y se compensan: ${neto >= 0 ? `le pagas ${eurosExactos(deCent(neto))}` : `te paga ${eurosExactos(deCent(-neto))}`}.`,
      razones: [
        { decision: 'Su resumen mensual es la factura de compra', porque: 'lo que te llega con albarán a su nombre sirve para contrastar, no se asienta' },
        { decision: 'Tu comisión, ingreso por servicios (705) con IVA 21 %', porque: 'es lo único tuyo de sus ventas', cita: cita('ivaMediacionNombreAjeno') },
        ...(cent(s.ventasCobradas) ? [{ decision: 'Lo cobrado por cuenta de él, en su cuenta de liquidación', porque: 'no es tuyo ni es lo que le compras: se compensa con tu comisión y el resto se le paga', cita: cita('ingresosPorCuentaDeTerceros') }] : []),
      ],
      avisos, terceroId: s.terceroId,
    },
  }
}

// ── Nómina ──────────────────────────────────────────────────────────────────

// ── Compras (10/10), §2.5: la liquidación mensual, desde sus documentos ────
// Tres asientos, con los dos documentos con valor fiscal que manda cada mes:
//   · su factura → compra, con sus tipos de IVA, a su cuenta de proveedor
//     (origen supplier_invoice: la factura queda registrada como recibida);
//   · la factura que le haces (la extiende él en tu nombre) → ingreso, con su
//     IVA, a su cuenta de cliente, y al libro de expedidas con SU número;
//   · la compensación de una con otra (origen supplier_payment de su factura:
//     se la «pagas» con lo que te debe). Lo que queda en su cuenta de cliente
//     es lo que te paga por el banco.
// Ni sus ventas ni el género que manda pasan por tu dinero: no se apunta nada
// «cobrado por cuenta de él». Lo que el lector no sabe qué es, para (bloqueos).

export interface FacturaLiquidacion {
  numero: string
  fecha: string
  lineas: readonly { concepto: string; base: number; tipo: number }[]
  /** El total que dice el documento: manda (es lo que se paga). */
  total: number
}
export interface EntradaLiquidacionMensual {
  /** licensed_settlement.id */
  id: string
  /** supplier_invoice.id de su factura, registrada al guardar la liquidación. */
  facturaRecibidaId: string
  socio: string
  terceroId: string | null
  localId: string | null
  /** La que le haces: tú le facturas. */
  emitida: FacturaLiquidacion
  /** La suya: él te factura. */
  recibida: FacturaLiquidacion
  /** El saldo que dice la transacción (null si no vino). */
  saldo: number | null
  /** Lo que el lector no ha podido dar por bueno. */
  bloqueos: readonly string[]
}
export interface CuentasLiquidacionMensual {
  cliente: string | null
  proveedor: string | null
  compras: string | null
  ingresoServicios: string | null
  ingresoMercaderias: string | null
  ivaRepercutido: (porcentaje: number) => { cuenta: string; tipoId: string } | null
  ivaSoportado: (porcentaje: number) => { cuenta: string; tipoId: string } | null
}

/**
 * Las cuotas por tipo (base del tipo × tipo, al céntimo) que suman EXACTAMENTE
 * el total del documento. Si el documento redondea su total de otra forma
 * (1 céntimo por tipo como mucho), el céntimo va al tipo que más subió (o
 * menos bajó) al redondear, y se dice. Más que eso no es redondeo: null.
 */
export function cuotasQueCuadran(lineas: readonly { base: number; tipo: number }[], total: number):
  { porTipo: { tipo: number; base: number; cuota: number }[]; ajuste: number } | null {
  const porTipo = new Map<number, number>()
  for (const l of lineas) porTipo.set(l.tipo, (porTipo.get(l.tipo) ?? 0) + cent(l.base))
  const filas = [...porTipo].sort((a, b) => a[0] - b[0]).map(([tipo, b]) => {
    const exacta = (b * tipo) / 100 // en céntimos, sin redondear
    const cuota = cent(cuotaIva(deCent(b), tipo))
    return { tipo, base: b, cuota, exceso: cuota - exacta }
  })
  const suma = filas.reduce((t, f) => t + f.base + f.cuota, 0)
  let dif = cent(total) - suma
  if (Math.abs(dif) > filas.length) return null
  const ajuste = dif
  const orden = [...filas].sort((a, b) => (dif < 0 ? b.exceso - a.exceso : a.exceso - b.exceso))
  for (const f of orden) {
    if (dif === 0) break
    const paso = Math.sign(dif)
    f.cuota += paso; dif -= paso
  }
  return { porTipo: filas.map((f) => ({ tipo: f.tipo, base: deCent(f.base), cuota: deCent(f.cuota) })), ajuste: deCent(ajuste) }
}

const esMercaderia = (c: string) => /mercader/i.test(c)
const esServicio = (c: string) => /servicio|fee|comisi|reparto|delivery|env[ií]o/i.test(c)

export function liquidacionMensual(e: EntradaLiquidacionMensual, c: CuentasLiquidacionMensual):
  { propuestas: Propuesta[]; sinPropuesta: string | null } {
  const no = (porque: string) => ({ propuestas: [] as Propuesta[], sinPropuesta: porque })
  if (e.bloqueos.length) return no(e.bloqueos.join(' '))
  if (!c.proveedor) return no(`${e.socio} no tiene su cuenta de proveedor (Contabilidad de su ficha).`)
  if (!c.cliente) return no(`${e.socio} no tiene su cuenta de cliente: es a quien le facturas.`)
  if (!c.compras) return no(`A ${e.socio} le falta el tipo de gasto: ponlo en su ficha y su factura se propone.`)
  const raras = e.emitida.lineas.filter((l) => !esMercaderia(l.concepto) && !esServicio(l.concepto))
  if (raras.length) return no(`En la factura que le haces, Folvy no sabe si «${raras[0].concepto}» es un servicio o una venta de mercaderías: dímelo.`)
  if (e.emitida.lineas.some((l) => esServicio(l.concepto)) && !c.ingresoServicios) return no('Falta en tu plan la cuenta de ingresos por servicios (705).')
  if (e.emitida.lineas.some((l) => esMercaderia(l.concepto)) && !c.ingresoMercaderias) return no('Falta en tu plan la cuenta de ventas de mercaderías (700).')
  const cuotasR = cuotasQueCuadran(e.recibida.lineas, e.recibida.total)
  const cuotasE = cuotasQueCuadran(e.emitida.lineas, e.emitida.total)
  if (!cuotasR) return no(`Su factura ${e.recibida.numero} no cuadra: sus bases y su IVA no dan su total, y no es un céntimo de redondeo.`)
  if (!cuotasE) return no(`La factura que le haces ${e.emitida.numero} no cuadra: sus bases y su IVA no dan su total, y no es un céntimo de redondeo.`)
  const saldo = deCent(cent(e.emitida.total) - cent(e.recibida.total))
  if (e.saldo !== null && cent(e.saldo) !== cent(saldo)) return no(`La transacción dice ${eurosExactos(e.saldo)} de saldo y las dos facturas dan ${eurosExactos(saldo)}.`)
  const loc = e.localId
  const comun = !loc

  // 1 · Su factura: la compra.
  const avisosR: string[] = cuotasR.ajuste ? [`Su factura dice ${eurosExactos(e.recibida.total)}; con la cuota de cada tipo redondeada saldría ${eurosExactos(deCent(cent(e.recibida.total) - cent(cuotasR.ajuste)))}. Manda su total: el céntimo va al IVA.`] : []
  const lineasR: LineaAsiento[] = [{ cuenta: c.compras, debe: deCent(cent(e.recibida.lineas.reduce((t, l) => t + l.base, 0))), haber: 0, localId: loc, comun, documento: e.recibida.numero }]
  for (const t of cuotasR.porTipo) {
    if (t.tipo === 0) continue
    const cta = c.ivaSoportado(t.tipo)
    if (!cta) return no(`No hay 472 del ${t.tipo} % en tu plan.`)
    lineasR.push({ cuenta: cta.cuenta, debe: t.cuota, haber: 0, localId: loc, comun, documento: e.recibida.numero, iva: { tipoId: cta.tipoId, tipo: t.tipo, base: t.base, libro: 'received', deducible: 'yes' } })
  }
  lineasR.push({ cuenta: c.proveedor, debe: 0, haber: e.recibida.total, localId: loc, comun, documento: e.recibida.numero, terceroId: e.terceroId })
  const compra: Propuesta = {
    serie: 2, fecha: e.recibida.fecha, concepto: `Factura ${e.socio} · ${e.recibida.numero}`, origen: { tipo: 'supplier_invoice', id: e.facturaRecibidaId },
    lineas: lineasR, confianza: cuotasR.ajuste ? 'probable' : 'seguro',
    porque: 'Lo que te factura cada mes: compra, con su IVA por tipo, a su cuenta de proveedor.',
    razones: [{ decision: 'Su factura de la liquidación del mes', porque: 'no factura las entregas: sus albaranes no se apuntan uno a uno' }],
    avisos: avisosR, terceroId: e.terceroId, documento: e.recibida.numero,
  }

  // 2 · La que le haces: el ingreso, a su cuenta de cliente y al libro de expedidas.
  const servicios = e.emitida.lineas.filter((l) => esServicio(l.concepto)).reduce((t, l) => t + cent(l.base), 0)
  const mercaderias = e.emitida.lineas.filter((l) => esMercaderia(l.concepto)).reduce((t, l) => t + cent(l.base), 0)
  const lineasE: LineaAsiento[] = [{ cuenta: c.cliente, debe: e.emitida.total, haber: 0, localId: loc, comun, documento: e.emitida.numero, terceroId: e.terceroId }]
  if (servicios) lineasE.push({ cuenta: c.ingresoServicios!, debe: 0, haber: deCent(servicios), localId: loc, comun, documento: e.emitida.numero, concepto: 'Servicios por sus ventas' })
  if (mercaderias) lineasE.push({ cuenta: c.ingresoMercaderias!, debe: 0, haber: deCent(mercaderias), localId: loc, comun, documento: e.emitida.numero, concepto: 'Género que le pones tú' })
  for (const t of cuotasE.porTipo) {
    if (t.tipo === 0) continue
    const cta = c.ivaRepercutido(t.tipo)
    if (!cta) return no(`No hay 477 del ${t.tipo} % en tu plan.`)
    lineasE.push({ cuenta: cta.cuenta, debe: 0, haber: t.cuota, localId: loc, comun, documento: e.emitida.numero, iva: { tipoId: cta.tipoId, tipo: t.tipo, base: t.base, libro: 'issued' } })
  }
  const ingreso: Propuesta = {
    serie: 4, fecha: e.emitida.fecha, concepto: `Le facturas a ${e.socio} · ${e.emitida.numero}`, origen: { tipo: 'licensed_settlement', id: e.id },
    lineas: lineasE, confianza: cuotasE.ajuste ? 'probable' : 'seguro',
    porque: 'La factura que le haces (la extiende él en tu nombre): ingreso con su IVA, a su cuenta de cliente, con su número en el libro de expedidas.',
    razones: [
      { decision: 'Servicios a la 705, el género que pones tú a la 700', porque: 'cada línea por lo que es' },
      { decision: `Nº ${e.emitida.numero} en el libro de expedidas`, porque: 'es una factura tuya aunque la haya extendido él' },
    ],
    avisos: cuotasE.ajuste ? [`La factura que le haces dice ${eurosExactos(e.emitida.total)}; el céntimo de redondeo va al IVA.`] : [],
    terceroId: e.terceroId, documento: e.emitida.numero,
  }

  // 3 · La compensación: su factura se paga con lo que te debe.
  const menor = Math.min(cent(e.emitida.total), cent(e.recibida.total))
  const compensa: Propuesta = {
    serie: 4, fecha: e.emitida.fecha > e.recibida.fecha ? e.emitida.fecha : e.recibida.fecha,
    concepto: `Compensación con ${e.socio} · ${e.emitida.numero} y ${e.recibida.numero}`, origen: { tipo: 'supplier_payment', id: e.facturaRecibidaId },
    lineas: [
      { cuenta: c.proveedor, debe: deCent(menor), haber: 0, localId: loc, comun, documento: e.recibida.numero, terceroId: e.terceroId },
      { cuenta: c.cliente, debe: 0, haber: deCent(menor), localId: loc, comun, documento: e.emitida.numero, terceroId: e.terceroId },
    ],
    confianza: 'seguro',
    porque: saldo >= 0
      ? `Su factura se paga con lo que te debe. Te paga ${eurosExactos(saldo)}: es lo que queda en su cuenta de cliente, y llega por el banco.`
      : `Lo que le facturas se descuenta de su factura. Le pagas ${eurosExactos(-saldo)}: es lo que queda en su cuenta de proveedor.`,
    razones: [{ decision: 'Una factura contra otra', porque: 'así lo liquida: se paga la diferencia' }],
    avisos: [], terceroId: e.terceroId,
  }
  return { propuestas: [compra, ingreso, compensa], sinPropuesta: null }
}

export interface EntradaNomina {
  id: string
  mes: string
  localId: string | null
  bruto: number
  ssEmpresa: number
  ssTrabajador: number
  irpf: number
  otras: number
  neto: number
  retencionTipoId: string | null
}
export interface CuentasNomina { sueldos: string; ssEmpresa: string; ssAcreedora: string; irpf: string; remuneraciones: string }

export function nomina(n: EntradaNomina, c: CuentasNomina): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  if (cent(n.bruto) !== cent(n.ssTrabajador) + cent(n.irpf) + cent(n.otras) + cent(n.neto)) {
    return { propuesta: null, sinPropuesta: `Bruto ${eurosExactos(n.bruto)} ≠ SS del trabajador + IRPF + otras + líquido: revisa el resumen de la gestoría.` }
  }
  if (cent(n.otras)) return { propuesta: null, sinPropuesta: 'El resumen trae otras deducciones (embargos, anticipos): dime a qué cuenta van antes de proponerla.' }
  if (cent(n.irpf) && !n.retencionTipoId) return { propuesta: null, sinPropuesta: 'Falta el tipo de retención de trabajo en Tablas › Retenciones.' }
  const loc = n.localId
  const fin = `${n.mes.slice(0, 7)}-${String(new Date(Date.UTC(+n.mes.slice(0, 4), +n.mes.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`
  const lineas: LineaAsiento[] = [
    { cuenta: c.sueldos, debe: n.bruto, haber: 0, localId: loc, comun: !loc },
    { cuenta: c.ssEmpresa, debe: n.ssEmpresa, haber: 0, localId: loc, comun: !loc },
    { cuenta: c.ssAcreedora, debe: 0, haber: red2(n.ssEmpresa + n.ssTrabajador), localId: loc, comun: !loc },
    ...(cent(n.irpf) ? [{ cuenta: c.irpf, debe: 0, haber: n.irpf, localId: loc, comun: !loc, retencion: { tipoId: n.retencionTipoId!, tipo: 0, base: n.bruto, modelo: '111' as const } }] : []),
    { cuenta: c.remuneraciones, debe: 0, haber: n.neto, localId: loc, comun: !loc },
  ].filter((l) => cent(l.debe) + cent(l.haber) > 0)
  return {
    sinPropuesta: null,
    propuesta: {
      serie: 9, fecha: fin, concepto: `Nóminas de ${n.mes.slice(5, 7)}/${n.mes.slice(0, 4)}`, origen: { tipo: 'payroll', id: n.id }, lineas,
      confianza: loc ? 'seguro' : 'probable',
      porque: 'El resumen de la gestoría: sueldos y SS de la empresa como gasto; SS, IRPF y líquido como lo que se debe.',
      razones: [{ decision: `IRPF ${eurosExactos(n.irpf)} a la 4751`, porque: 'retenciones de trabajo: van al 111 del trimestre' }],
      avisos: [],
    },
  }
}

// ── Regla 11 · aprendizaje ──────────────────────────────────────────────────

export interface Correccion {
  /** Mismo origen: «channel_settlement:<canal>», «supplier_invoice:<proveedor>». */
  clave: string
  /** Qué cuenta propuso Folvy y cuál eligió la persona. */
  propuesta: string
  elegida: string
  quien: string | null
  cuando: string
}

/** Aplica la última corrección del mismo origen: cambia la cuenta y lo dice (con «Cambiar» y porqué, como en terceros). */
export function aplicarAprendizaje(p: Propuesta, clave: string, correcciones: readonly Correccion[]): Propuesta {
  const delOrigen = correcciones.filter((x) => x.clave === clave).sort((a, b) => b.cuando.localeCompare(a.cuando))
  if (!delOrigen.length) return p
  const ultimaPor = new Map<string, Correccion>()
  for (const x of delOrigen) if (!ultimaPor.has(x.propuesta)) ultimaPor.set(x.propuesta, x)
  let cambiadas = 0
  const lineas = p.lineas.map((l) => {
    const x = ultimaPor.get(l.cuenta)
    if (!x || x.elegida === l.cuenta) return l
    cambiadas += 1
    return { ...l, cuenta: x.elegida }
  })
  if (!cambiadas) return p
  const x = delOrigen[0]
  return {
    ...p, lineas,
    razones: [...p.razones, { decision: 'Lo has corregido antes', porque: `en la anterior del mismo origen cambiaste ${x.propuesta} por ${x.elegida}${x.quien ? ` (${x.quien})` : ''}: lo hago igual` }],
  }
}

// ── Regla 12 · una cuenta genérica traída de Diez ───────────────────────────

/**
 * Una cuenta genérica de lo traído (47200000, 47700000, 40000000, 43000000…)
 * tiene su hoja buena en el plan de la empresa: la de IVA por el tipo del
 * apunte; la del tercero, su subcuenta si la tiene.
 */
export function cuentaDeBoe(codigo: string, ctx: { tipo?: number; ivaPorTipo: (prefijo: '472' | '477', porcentaje: number) => string | null; subcuentaDelTercero?: string | null }): { cuenta: string; porque: string } | null {
  if (/^47[27]0+$/.test(codigo) && ctx.tipo !== undefined) {
    const prefijo = codigo.slice(0, 3) as '472' | '477'
    const h = ctx.ivaPorTipo(prefijo, ctx.tipo)
    return h && h !== codigo ? { cuenta: h, porque: `La ${codigo} de Diez junta todos los tipos; en tu plan hay una ${prefijo} por tipo: la del ${ctx.tipo} % es la ${h}.` } : null
  }
  if (/^4[03]0+$/.test(codigo) && ctx.subcuentaDelTercero && ctx.subcuentaDelTercero !== codigo) {
    return { cuenta: ctx.subcuentaDelTercero, porque: `La ${codigo} es la común; este tercero tiene la suya, la ${ctx.subcuentaDelTercero}.` }
  }
  return null
}

// ── Cierre del día · la liquidación manda (T4) ─────────────────────────────
//
// Un pedido que se cerró como no confirmado al cierre del día y que luego una
// liquidación de la plataforma PAGA: es venta de su día. Se propone APARTE,
// como lo que decidió la plataforma (sales_adjustment, origen = la venta), con
// las mismas líneas que tendría en el asiento del día (las de ventasDelDia con
// ese único pedido). El asiento del día no se toca, esté propuesto o validado:
// el pedido no está en él, y así no puede contarse dos veces. Se acepta
// validándolo y se descarta como cualquier propuesta (el descarte lo recuerda).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «2026-10-06» → «6 de octubre». */
export const diaYMes = (iso: string): string => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`

export interface NoConfirmadoPagado {
  /** El pedido, como lo da conta_pedidos_del_dia (su estado se ignora: la plataforma lo ha pagado). */
  pedido: PedidoDia
  /** Su día (sold_at en Madrid). */
  dia: string
  /** La liquidación que lo paga. */
  liquidacion: { ref: string | null; fecha: string | null }
  /** El día ya tiene su asiento de ventas validado. */
  diaValidado: boolean
}

export function noConfirmadoPagado(
  x: NoConfirmadoPagado,
  e: Omit<EntradaVentasDia, 'pedidos' | 'devoluciones' | 'fecha'>,
): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  const canal = e.nombreCanal(x.pedido.canalId)
  const codigo = x.pedido.codigo ?? 'sin código'
  const res = ventasDelDia({ ...e, fecha: x.dia, pedidos: [{ ...x.pedido, estado: 'closed', marcaPropia: true }], devoluciones: [] })
  if (!res.propuesta) return { propuesta: null, sinPropuesta: res.sinPropuesta }
  const porque = `${canal} ha pagado el pedido ${codigo}, que se cerró sin confirmar el ${diaYMes(x.dia)}`
  const liq = x.liquidacion.ref ? `la liquidación ${x.liquidacion.ref}${x.liquidacion.fecha ? ` del ${diaYMes(x.liquidacion.fecha)}` : ''}` : 'su liquidación'
  return {
    sinPropuesta: null,
    propuesta: {
      ...res.propuesta,
      concepto: `Venta del ${diaYMes(x.dia)} pagada después · ${canal} · pedido ${codigo}`,
      origen: { tipo: 'sales_adjustment', id: x.pedido.id },
      documento: x.pedido.codigo,
      porque,
      razones: [
        { decision: 'Es venta de su día', porque: `al cierre del día seguía abierto y se cerró como no confirmado; ${liq} lo paga, y la liquidación de la plataforma tiene la última palabra` },
        { decision: x.diaValidado ? 'Va aparte del asiento del día, que está validado y no se toca' : 'Va aparte del asiento del día', porque: 'ese pedido no está en el asiento del día, así que no puede contarse dos veces' },
        ...res.propuesta.razones.filter((r) => !/^\d+ tickets? de tus marcas/.test(r.decision)),
      ],
    },
  }
}
