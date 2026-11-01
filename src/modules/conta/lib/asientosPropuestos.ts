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
//   · (nomina y finDeMesCompras — S01 · PR 3: viven en SQL, conta_propuesta_nomina
//     y conta_propuestas_recibido.)
//   · aprendizaje (regla 11) y cuentaDeBoe (regla 12).

import { NORMAS } from './normas'
import { eurosExactos } from './formato'
import {
  baseDeTotal, cent, cuotaIva, deCent, peor,
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
  /** C06b (16/10): el descuento del pedido, con el IVA dentro (sale.discount_amount). */
  descuento?: number
  /** C06b: el envío que pagó el cliente, con el IVA dentro (HubRise charges «delivery»). */
  envio?: number
  /** C06b: qué se hace con el envío (conta_cargos_de_pedidos): a Envíos cobrados, por aclarar o fuera. */
  claseEnvio?: 'ninguno' | 'cobrado' | 'por_aclarar' | 'fuera'
  /** C06b: por qué está por aclarar («repartió la plataforma»…). */
  porQueEnvio?: string | null
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
  /** C04b R5: la subcuenta de ventas (7000000x) de cada marca. La que falte va a `ventas` y se avisa. */
  ventasPorMarca?: Record<string, string>
  /** C04b R5: la de reembolsos (7080000x) de cada marca. La que falte va a `devoluciones` y se avisa. */
  devolucionesPorMarca?: Record<string, string>
  /** C06b (16/10): la subcuenta de promociones (7000900x) de cada canal. Sin ella, la promoción queda restada de la venta y se avisa. */
  promocionesPorCanal?: Record<string, string>
  /** C06b: la de envíos cobrados (70500001) de cada canal. Sin ella, el envío queda dentro de la venta y se avisa. */
  enviosPorCanal?: Record<string, string>
}

/**
 * C04b R5 · La regla de ventas definitiva (Julio, 13/10): un asiento por
 * plataforma, local y día (Uber Eats, Just Eat), y por marca, plataforma,
 * local y día en los canales que van por marca (Glovo). `clave` es lo que
 * distingue la unidad dentro del día y el local: el canal, o canal:marca.
 */
export interface UnidadVentas { canalId: string | null; marcaId: string | null; clave: string }

export const claveDeUnidad = (canalId: string | null, marcaId: string | null): string =>
  `${canalId ?? 'sin-canal'}${marcaId ? `:${marcaId}` : ''}`

/** Las unidades de un día y un local, en el orden en que aparecen sus pedidos (y después sus reembolsos). */
export function unidadesDelDia(pedidos: readonly PedidoDia[], devoluciones: readonly DevolucionDia[], porMarca: (canalId: string | null) => boolean): UnidadVentas[] {
  const vistas = new Map<string, UnidadVentas>()
  const poner = (canalId: string | null, marcaId: string | null) => {
    const m = porMarca(canalId) ? marcaId : null
    const clave = claveDeUnidad(canalId, m)
    if (!vistas.has(clave)) vistas.set(clave, { canalId, marcaId: m, clave })
  }
  for (const p of pedidos) if (p.marcaPropia && p.estado === 'closed') poner(p.canalId, p.marcaId)
  for (const d of devoluciones) if (d.marcaPropia) poner(d.canalId, d.marcaId)
  return [...vistas.values()]
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
  /** C04b R5: la unidad del asiento (plataforma, o plataforma y marca). Sin ella, el día y el local enteros (la regla de antes). */
  unidad?: UnidadVentas
  /** Para escribir la marca junto a su subcuenta. */
  nombreMarca?: (id: string | null) => string
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

export function ventasDelDia(entrada: EntradaVentasDia): ResultadoVentasDia {
  const u = entrada.unidad
  const enUnidad = (canalId: string | null, marcaId: string | null) => !u || (canalId === u.canalId && (u.marcaId === null || marcaId === u.marcaId))
  const e: EntradaVentasDia = u
    ? { ...entrada, pedidos: entrada.pedidos.filter((p) => enUnidad(p.canalId, p.marcaId)), devoluciones: entrada.devoluciones.filter((d) => enUnidad(d.canalId, d.marcaId)) }
    : entrada
  const nombreMarca = (id: string | null) => (id ? e.nombreMarca?.(id) ?? 'una marca' : 'sin marca')
  const cuentaVentas = (marcaId: string | null) => (u && marcaId ? e.cuentas.ventasPorMarca?.[marcaId] : undefined) ?? e.cuentas.ventas
  const cuentaDevoluciones = (marcaId: string | null) => (u && marcaId ? e.cuentas.devolucionesPorMarca?.[marcaId] : undefined) ?? e.cuentas.devoluciones
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
  // C06b (16/10): la promoción y el envío cobrado de cada pedido, en base, al
  // tipo de la venta y al céntimo (como conta_propuesta_ventas_unidad). Un envío
  // que la plataforma no paga («fuera») sale del total del pedido.
  const ctaPromo = u?.canalId ? e.cuentas.promocionesPorCanal?.[u.canalId] : undefined
  const ctaEnvio = u?.canalId ? e.cuentas.enviosPorCanal?.[u.canalId] : undefined
  const enBase = (x: number) => Math.round(cent(x) * 100 / (100 + tipo) + 1e-9)
  const filas = propios.map((p) => {
    if (p.tiposEnLineas.some((t) => t !== tipo)) otroTipo += 1
    const clase = p.claseEnvio ?? 'ninguno'
    const fuera = clase === 'fuera' && (p.envio ?? 0) > 0
    const tot = fuera ? deCent(cent(p.total) - cent(p.envio ?? 0)) : p.total
    const promo = u && ctaPromo && (p.descuento ?? 0) > 0 ? enBase(p.descuento ?? 0) : 0
    const envio = u && ctaEnvio && clase === 'cobrado' && (p.envio ?? 0) > 0 ? enBase(p.envio ?? 0) : 0
    if (!fuera && p.base !== null && p.cuota !== null && cent(p.base) + cent(p.cuota) === cent(p.total)) return { p, total: tot, base: p.base, cuota: p.cuota, promo, envio, clase }
    calculada = true
    return { p, total: tot, ...baseDeTotal(tot, tipo), promo, envio, clase }
  })
  const devs = e.devoluciones.filter((d) => d.marcaPropia).map((d) => ({ d, ...baseDeTotal(d.importe, tipo) }))
  const sum = (xs: number[]) => deCent(xs.reduce((t, x) => t + cent(x), 0))
  const total = sum(filas.map((f) => f.total))
  const base = sum(filas.map((f) => f.base))
  const cuota = sum(filas.map((f) => f.cuota))

  const porCanalMap = new Map<string | null, number>()
  for (const f of filas) porCanalMap.set(f.p.canalId, (porCanalMap.get(f.p.canalId) ?? 0) + cent(f.total))
  // La venta de cada marca, a precio de carta: lo pagado + su promoción − el envío cobrado.
  const porMarcaMap = new Map<string | null, number>()
  for (const f of filas) porMarcaMap.set(f.p.marcaId, (porMarcaMap.get(f.p.marcaId) ?? 0) + cent(f.base) + f.promo - f.envio)
  const conPromo = filas.filter((f) => f.promo > 0)
  const conEnvio = filas.filter((f) => f.envio > 0)
  const fueraEnvio = filas.filter((f) => f.clase === 'fuera' && (f.p.envio ?? 0) > 0)
  const porAclarar = filas.filter((f) => f.clase === 'por_aclarar')
  const promoSinCuenta = u ? filas.filter((f) => (f.p.descuento ?? 0) > 0 && f.promo === 0).length : 0
  const envioSinCuenta = u ? filas.filter((f) => f.clase === 'cobrado' && (f.p.envio ?? 0) > 0 && f.envio === 0).length : 0
  const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`
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
  if (conPromo.length) {
    lineas.push({ cuenta: ctaPromo!, debe: deCent(conPromo.reduce((t, f) => t + f.promo, 0)), haber: 0, localId: e.localId, marcaId: u?.marcaId ?? null,
      concepto: `Promociones ${e.nombreCanal(u!.canalId)} · ${plural(conPromo.length, 'pedido')}` })
  }
  if (e.porMarca) {
    for (const [marcaId, c] of porMarcaMap) lineas.push({ cuenta: cuentaVentas(marcaId), debe: 0, haber: deCent(c), localId: e.localId, marcaId, concepto: u ? `Ventas ${nombreMarca(marcaId)}` : 'Ventas de tus marcas' })
  } else if (filas.length) {
    lineas.push({ cuenta: e.cuentas.ventas, debe: 0, haber: base, localId: e.localId, concepto: 'Ventas de tus marcas' })
  }
  if (conEnvio.length) {
    lineas.push({ cuenta: ctaEnvio!, debe: 0, haber: deCent(conEnvio.reduce((t, f) => t + f.envio, 0)), localId: e.localId, marcaId: u?.marcaId ?? null,
      concepto: `Envíos cobrados · ${plural(conEnvio.length, 'pedido')}` })
  }
  if (filas.length) {
    lineas.push({ cuenta: e.cuentas.ivaRepercutido, debe: 0, haber: cuota, localId: e.localId, concepto: `IVA repercutido ${tipo} %`,
      iva: { tipoId: e.tipo.id, tipo, base, libro: 'issued', facturas: filas.length } })
  }
  // Devoluciones: su línea propia y el pedido (art. 80.Dos).
  for (const d of devs) {
    const ref = d.d.codigo ?? d.d.pedidoId
    lineas.push({ cuenta: cuentaDevoluciones(d.d.marcaId), debe: d.base, haber: 0, localId: e.localId, marcaId: d.d.marcaId, documento: ref,
      concepto: u ? `Reembolso al cliente · ${nombreMarca(d.d.marcaId)} · pedido ${ref ?? 'sin código'}` : `Devolución del pedido ${ref ?? 'sin código'}` })
    lineas.push({ cuenta: e.cuentas.ivaRepercutido, debe: d.cuota, haber: 0, localId: e.localId, documento: ref, concepto: u ? `IVA del reembolso ${ref ?? ''}`.trim() : `IVA de la devolución ${ref ?? ''}`.trim(),
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
    ...(conPromo.length ? [{ decision: `Promociones: ${plural(conPromo.length, 'pedido')}, ${eurosExactos(sum(conPromo.map((f) => f.p.descuento ?? 0)))} con el IVA dentro`,
      porque: `la venta va a precio de carta en su marca y la promoción, en su subcuenta (${ctaPromo}), resta; el IVA va sobre lo que paga el cliente`, cita: 'Ley 37/1992, art. 78.Tres.2.º' }] : []),
    ...(conEnvio.length ? [{ decision: `Envíos cobrados: ${plural(conEnvio.length, 'pedido')}, ${eurosExactos(sum(conEnvio.map((f) => f.p.envio ?? 0)))} con el IVA dentro`,
      porque: `lo repartimos nosotros: el envío es del restaurante y va a su subcuenta (${ctaEnvio}), con su local; forma parte de la base, al tipo de la venta`, cita: 'Ley 37/1992, art. 78.Dos.1.º' }] : []),
    ...(fueraEnvio.length ? [{ decision: `Fuera: el envío de ${plural(fueraEnvio.length, 'pedido')} (${eurosExactos(sum(fueraEnvio.map((f) => f.p.envio ?? 0)))})`,
      porque: 'lo repartió la plataforma y su liquidación no lo paga: no es venta del restaurante ni lo cobra la plataforma para él' }] : []),
  )
  if (calculada) {
    razones.push({ decision: 'Base calculada', porque: `algún pedido no trae la base imponible: la calculo del total al ${tipo} % (el tipo de tus ventas); no la invento, la deduzco y lo digo` })
    confs.push('probable')
  }
  if (otroTipo) {
    avisos.push(`${otroTipo} pedido${otroTipo === 1 ? ' trae' : 's traen'} en sus líneas un tipo distinto del ${tipo} %: mira cuáles antes de validar.`)
    confs.push('duda')
  }
  // C04b R5: la marca que no tiene su subcuenta va a la general, y se dice (no se esconde).
  if (u && e.porMarca) {
    const sinSubcuenta = [...new Set([...porMarcaMap.keys()].filter((m) => !m || !e.cuentas.ventasPorMarca?.[m])
      .concat(devs.map((d) => d.d.marcaId).filter((m) => !m || !e.cuentas.devolucionesPorMarca?.[m])))]
    if (sinSubcuenta.length) {
      avisos.push(`${sinSubcuenta.map(nombreMarca).join(', ')} no ${sinSubcuenta.length === 1 ? 'tiene' : 'tienen'} su subcuenta de ventas o de reembolsos: va a la general (${e.cuentas.ventas} / ${e.cuentas.devoluciones}). Enlázala antes de validar.`)
      confs.push('duda')
    }
  }
  // C06b (16/10): el envío que no se sabe si es del restaurante, sin adivinar.
  if (porAclarar.length) {
    avisos.push(`Por aclarar: ${plural(porAclarar.length, 'pedido')} con envío y sin saber si es del restaurante (${porAclarar.map((f) =>
      `${f.p.codigo ?? f.p.id.slice(0, 8)} · ${nombreMarca(f.p.marcaId)} · envío ${eurosExactos(f.p.envio ?? 0)} · ${f.p.porQueEnvio ?? 'sin decir quién repartió'}`).join('; ')}). Se resuelve con la liquidación de esa semana: si la plataforma lo paga, va a Envíos cobrados; si no, sale de la venta y del cobro. Hasta entonces no se valida.`)
    confs.push('duda')
  }
  if (promoSinCuenta) {
    avisos.push(`${promoSinCuenta} pedido${promoSinCuenta === 1 ? ' lleva' : 's llevan'} promoción y ${e.nombreCanal(u!.canalId)} no tiene su subcuenta de promociones: queda restada de la venta. Enlázala antes de validar.`)
    confs.push('duda')
  }
  if (envioSinCuenta) {
    avisos.push(`${envioSinCuenta} pedido${envioSinCuenta === 1 ? ' lleva' : 's llevan'} envío cobrado y ${e.nombreCanal(u!.canalId)} no tiene su subcuenta de envíos: queda dentro de la venta. Enlázala antes de validar.`)
    confs.push('duda')
  }
  if (cedidas.length) {
    razones.push({ decision: `Fuera: ${cedidas.length} pedido${cedidas.length === 1 ? '' : 's'} de marcas cedidas (${eurosExactos(resumen.cedidasFuera.total)})`, porque: 'son ventas del socio y su IVA es del socio: entran solo en su liquidación mensual, que comparas con estos tickets', cita: cita('ivaMediacionNombreAjeno') })
  }
  if (cancelados.length) razones.push({ decision: `Fuera: ${cancelados.length} cancelado${cancelados.length === 1 ? '' : 's'}`, porque: 'cancelado antes de entregar no es venta' })

  return {
    propuesta: {
      serie: 1, fecha: e.fecha,
      concepto: u ? `Ventas ${e.nombreCanal(u.canalId)}${u.marcaId ? ` · ${nombreMarca(u.marcaId)}` : ''} · ${e.nombreLocal}` : `Ventas del día · ${e.nombreLocal}`,
      origen: { tipo: 'sales_day', id: null }, lineas,
      confianza: peor('seguro', ...confs),
      porque: u
        ? `${filas.length} ${filas.length === 1 ? 'ticket de tus marcas en ' + e.nombreCanal(u.canalId) + ' cuadra' : 'tickets de tus marcas en ' + e.nombreCanal(u.canalId) + ' cuadran'} con lo que cobra, al céntimo${calculada ? '; base calculada al ' + tipo + ' %' : ''}.`
        : `${filas.length} ${filas.length === 1 ? 'ticket de tus marcas cuadra' : 'tickets de tus marcas cuadran'} con lo que cobran las plataformas, al céntimo${calculada ? '; base calculada al ' + tipo + ' %' : ''}.`,
      razones, avisos,
    },
    sinPropuesta: null,
    resumen,
  }
}

// ── Liquidación de plataforma (regla 7) ─────────────────────────────────────
// (liquidacionPlataforma vive en SQL desde el S01 · PR 3: _conta_plataforma_regla.
// Queda aquí la serie de tesorería, que usa el pago de una factura.)

/** La serie de los asientos de cobro y pago: 3 (C04) o la que la empresa use para tesorería (Foodint, la 4, como Diez). */
export type SerieTesoreria = 3 | 4

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
  /**
   * Compras (repaso, 10/10): «Apuntarla sin descontar el IVA». La factura no va
   * a nombre de la empresa: su IVA es más gasto, no va a la 472 ni al libro de
   * recibidas como deducible (supplier_invoice.vat_non_deductible).
   */
  ivaNoDeducible?: boolean
  /** D07 · Por qué no se deduce, dicho para la persona («el ticket no lleva NIF»). Sin él, «no va a nombre de tu empresa». */
  motivoNoDeducible?: string | null
  /**
   * D01 · Liquidaciones: el IVA tal como lo dice la factura, por tipo (la de
   * comisión de Uber: la base del total y su cuota, que a veces no es base ×
   * 21 % al céntimo). Sin esto, se calcula por tipo como siempre.
   */
  cuotas?: readonly { porcentaje: number; base: number; cuota: number }[]
  /** D01 · La marca de la factura (analítica de cada apunte). */
  marcaId?: string | null
  /** D01 · La factura de comisión de una liquidación sale sin número: se propone, pero en duda y diciéndolo. */
  faltaNumero?: boolean
  /** D01 (Julio, 16/10) · Lo que la deja por aclarar (un solape, su liquidación que no cuadra): no se propone hasta aclararlo. */
  porAclarar?: readonly string[]
  /**
   * I01d · La ficha del proveedor dice que su IVA lo declaras tú: compra
   * intracomunitaria (otro país de la UE con NIF-IVA) o inversión del sujeto
   * pasivo (de fuera de la UE, o nacional marcada a mano). Su factura no trae
   * IVA español; se autoliquida al tipo del catálogo con su 472 y su 477.
   */
  autoliquidacion?: { tipo: 'ue_compra' | 'isp'; porque: string } | null
  /**
   * E05 (Julio, 21/10) · La factura de un lote que reparte entre varios locales
   * («Varios locales»): sin local propio, su gasto se parte a partes iguales
   * entre estos locales (los del reparto del lote). El IVA y el proveedor
   * quedan comunes. Con uno o ninguno, nada cambia.
   */
  reparto?: readonly { localId: string; nombre: string }[]
}
export interface CuentasFactura {
  proveedor: string
  ivaSoportado: (porcentaje: number) => { cuenta: string; tipoId: string } | null
  retencion: string
  /** I01d · El tipo de la autoliquidación (ue_compra o isp) con su 472 y su 477. */
  autoliquidada?: (tipo: 'ue_compra' | 'isp') => { tipoId: string; porcentaje: number; soportado: string; repercutido: string } | null
}

/**
 * E05 · Lo de una factura de lote (riders y flotas de Catcher) que no sale de
 * su ficha, porque RIDERS es una ficha genérica con la 41000100: el emisor y su
 * NIF están en la factura (issuer_*); no tiene líneas, así que su gasto sale de
 * su IVA por tipo (supplier_invoice_tax) contra el gasto de la ficha, con la
 * cuota que dice; y, si reparte entre varios locales (Julio, 21/10), los
 * locales de su reparto, para partirlo a partes iguales.
 */
export function deLaFacturaDeLote(
  f: { issuer_name?: unknown; issuer_tax_id?: unknown; reading?: unknown; supplier_invoice_line?: unknown; supplier_invoice_tax?: unknown },
  gasto: string | null,
  tipoDe: (porcentaje: number) => { id: string; rate: number } | null,
  nombreLocal: (id: string) => string | null,
): { proveedor: string | null; tieneNif: boolean; lineas: LineaFactura[] | undefined; cuotas: { porcentaje: number; base: number; cuota: number }[]; reparto: { localId: string; nombre: string }[] } {
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown) => Number(v ?? 0)
  const tasas = (Array.isArray(f.supplier_invoice_tax) ? f.supplier_invoice_tax : []) as { vat_pct?: unknown; base?: unknown; vat_amount?: unknown }[]
  const conLineas = Array.isArray(f.supplier_invoice_line) && f.supplier_invoice_line.length > 0
  const lote = ((f.reading ?? {}) as { lote?: { reparto?: unknown } }).lote
  const reparto = new Map<string, { localId: string; nombre: string }>()
  for (const x of (Array.isArray(lote?.reparto) ? lote!.reparto : []) as { localId?: unknown; tienda?: unknown }[]) {
    const id = texto(x.localId)
    if (id && !reparto.has(id)) reparto.set(id, { localId: id, nombre: nombreLocal(id) ?? texto(x.tienda) ?? 'local' })
  }
  return {
    proveedor: texto(f.issuer_name),
    tieneNif: !!texto(f.issuer_tax_id),
    lineas: conLineas ? undefined : tasas.map((x) => {
      const t = tipoDe(num(x.vat_pct))
      return { base: num(x.base), tipo: t ? { id: t.id, porcentaje: t.rate } : null, cuentaGasto: gasto }
    }),
    cuotas: tasas.map((x) => ({ porcentaje: num(x.vat_pct), base: num(x.base), cuota: num(x.vat_amount) })),
    reparto: [...reparto.values()],
  }
}

export function facturaProveedor(f: EntradaFactura, c: CuentasFactura): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  if (f.esSocio) return { propuesta: null, sinPropuesta: `${f.proveedor} es tu socio de marca: lo que te vende a su nombre no es gasto tuyo, va en su liquidación mensual.` }
  // Compras (10/10), §2.6: lo que falta en la ficha se dice, no se tapa. Una
  // factura sin NIF o sin tipo de gasto NO cae a una cuenta genérica.
  if (!f.tieneNif && !f.ivaNoDeducible) return { propuesta: null, sinPropuesta: `A ${f.proveedor} le falta el NIF: ponlo en su ficha. Sin él no se puede deducir el IVA.` }
  if (f.lineas.some((l) => !l.cuentaGasto)) return { propuesta: null, sinPropuesta: `A ${f.proveedor} le falta el tipo de gasto: ponlo en su ficha y la factura se propone.` }
  if (f.porAclarar?.length) return { propuesta: null, sinPropuesta: f.porAclarar.join(' ') }
  const razones: Razon[] = []
  const avisos: string[] = []
  const confs: Confianza[] = []
  const loc = f.localId
  const lineas: LineaAsiento[] = []
  const gastos = new Map<string, number>()
  for (const l of f.lineas) gastos.set(l.cuentaGasto!, (gastos.get(l.cuentaGasto!) ?? 0) + cent(l.base))
  if (f.ivaNoDeducible) {
    // La cuota, por cuenta de gasto y tipo, va a su gasto: no hay 472.
    // D07 · En su PROPIA línea, en la cuenta de gasto, con su tipo y su base, al
    // libro de recibidas como NO deducible: sale en el libro registro (con
    // deducible 0) y no entra en el 303 (conta_impuesto_303_cajas, 0840).
    const porCuentaTipo = new Map<string, { cuenta: string; pct: number; tipoId: string | null; base: number }>()
    for (const l of f.lineas) {
      const pct = l.tipo?.porcentaje ?? 0
      const k = `${l.cuentaGasto}|${pct}`
      const x = porCuentaTipo.get(k) ?? { cuenta: l.cuentaGasto!, pct, tipoId: l.tipo?.id ?? null, base: 0 }
      x.base += cent(l.base)
      porCuentaTipo.set(k, x)
    }
    let ivaNd = 0
    for (const [cuenta, cc] of gastos) lineas.push({ cuenta, debe: deCent(cc), haber: 0, localId: loc, comun: !loc, documento: f.numero })
    for (const x of porCuentaTipo.values()) {
      if (!x.pct) continue
      const cuota = cent(cuotaIva(deCent(x.base), x.pct))
      if (!cuota) continue
      ivaNd += cuota
      lineas.push({ cuenta: x.cuenta, debe: deCent(cuota), haber: 0, localId: loc, comun: !loc, documento: f.numero,
        concepto: `IVA no deducible ${x.pct} %`,
        ...(x.tipoId ? { iva: { tipoId: x.tipoId, tipo: x.pct, base: deCent(x.base), libro: 'received' as const, deducible: 'no' as const } } : {}) })
    }
    const totalNd = f.lineas.reduce((t, l) => t + cent(l.base), 0) + ivaNd
    lineas.push({ cuenta: c.proveedor, debe: 0, haber: deCent(totalNd), localId: loc, comun: !loc, documento: f.numero, terceroId: f.terceroId })
    if (totalNd !== cent(f.total)) { avisos.push(`Base + IVA = ${eurosExactos(deCent(totalNd))}, y la factura dice ${eurosExactos(f.total)}.`); confs.push('duda') }
    const porQueNd = f.motivoNoDeducible ?? 'la factura no va a nombre de tu empresa'
    razones.push({ decision: 'IVA no deducible: más gasto', porque: `${porQueNd}: su IVA no se descuenta. Va a su gasto, no a la 472; sale en el libro de recibidas como no deducible y no entra en el 303` })
    if (!loc) { razones.push({ decision: 'Común', porque: 'la factura no dice de qué local es: queda común y el informe la reparte' }); confs.push('probable') }
    return {
      sinPropuesta: null,
      propuesta: {
        serie: 2, fecha: f.fecha, concepto: `Factura ${f.proveedor}${f.numero ? ` · ${f.numero}` : ''} (sin descontar el IVA)`, origen: { tipo: 'supplier_invoice', id: f.id },
        lineas, confianza: peor('seguro', ...confs),
        porque: `Gasto con su IVA dentro y el total a su cuenta: ${porQueNd}.`,
        razones, avisos, terceroId: f.terceroId, documento: f.numero,
      },
    }
  }
  const marca = f.marcaId ?? null
  if (f.autoliquidacion) return autoliquidada(f, c, gastos, razones, avisos, confs)
  const partes = !loc && (f.reparto?.length ?? 0) > 1 ? f.reparto! : null
  for (const [cuenta, cc] of gastos) {
    if (!partes) { lineas.push({ cuenta, debe: deCent(cc), haber: 0, localId: loc, comun: !loc, documento: f.numero, ...(marca ? { marcaId: marca } : {}) }); continue }
    // A partes iguales, al céntimo: lo que sobra de dividir va a los primeros.
    const cada = Math.floor(cc / partes.length)
    partes.forEach((p, i) => lineas.push({ cuenta, debe: deCent(cada + (i < cc - cada * partes.length ? 1 : 0)), haber: 0, localId: p.localId, comun: false,
      documento: f.numero, ...(marca ? { marcaId: marca } : {}) }))
  }
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
    const dicha = f.cuotas?.find((q) => q.porcentaje === pct)
    if (dicha && cent(dicha.base) !== x.base) { avisos.push(`La base del ${pct} % de la factura (${eurosExactos(dicha.base)}) no es la de sus líneas (${eurosExactos(base)}).`); confs.push('duda') }
    const cuota = dicha ? dicha.cuota : cuotaIva(base, pct)
    ivaTotal += cent(cuota)
    lineas.push({ cuenta: cta.cuenta, debe: cuota, haber: 0, localId: loc, comun: !loc, documento: f.numero, ...(marca ? { marcaId: marca } : {}),
      iva: { tipoId: cta.tipoId, tipo: pct, base, libro: 'received', deducible: 'yes' } })
  }
  if (f.retencion) {
    lineas.push({ cuenta: c.retencion, debe: 0, haber: f.retencion.importe, localId: loc, comun: !loc, documento: f.numero,
      retencion: { tipoId: f.retencion.tipoId, tipo: f.retencion.porcentaje, base: f.retencion.base, modelo: f.retencion.modelo } })
    razones.push({ decision: `Retención ${f.retencion.porcentaje} % (${eurosExactos(f.retencion.importe)})`, porque: `se la ingresas tú a Hacienda en el ${f.retencion.modelo}` })
  }
  const baseTotal = f.lineas.reduce((t, l) => t + cent(l.base), 0)
  const aPagar = deCent(baseTotal + ivaTotal - cent(f.retencion?.importe ?? 0))
  lineas.push({ cuenta: c.proveedor, debe: 0, haber: aPagar, localId: loc, comun: !loc, documento: f.numero, terceroId: f.terceroId, ...(marca ? { marcaId: marca } : {}) })
  if (f.cuotas?.length) razones.push({ decision: 'IVA el de la factura', porque: 'la cuota de cada tipo es la que dice la factura, no la base por el tipo redondeada' })
  if (f.faltaNumero) {
    avisos.push('Falta el número de la factura: la plataforma no lo manda en el correo. Sin él no se valida ni va a Diez.')
    confs.push('duda')
  }
  if (cent(deCent(baseTotal + ivaTotal)) !== cent(f.total)) {
    avisos.push(`Base + IVA = ${eurosExactos(deCent(baseTotal + ivaTotal))}, y la factura dice ${eurosExactos(f.total)}.`)
    confs.push('duda')
  }
  if (partes) razones.push({ decision: `Gasto a partes iguales: ${partes.map((p) => p.nombre).join(' y ')}`, porque: 'la factura reparte entre varios locales: su gasto se parte a partes iguales entre los del lote; el IVA y el proveedor quedan comunes' })
  else if (!loc) { razones.push({ decision: 'Común', porque: 'la factura no dice de qué local es: queda común y el informe la reparte' }); confs.push('probable') }
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

/**
 * I01d · La factura de un proveedor cuyo IVA declaras tú (intracomunitaria o
 * inversión del sujeto pasivo): gasto, la 472 del tipo autoliquidado con su
 * base, la 477 de la autorrepercusión por la MISMA cuota (sin tipo ni libro:
 * la validación la casa con la 472) y el total, que es la base, a su cuenta.
 * Si la factura trae IVA español, contradice la ficha: no se propone.
 */
function autoliquidada(f: EntradaFactura, c: CuentasFactura, gastos: Map<string, number>, razones: Razon[], avisos: string[], confs: Confianza[]):
  { propuesta: Propuesta | null; sinPropuesta: string | null } {
  const a = f.autoliquidacion!
  const conIva = f.lineas.filter((l) => (l.tipo?.porcentaje ?? 0) > 0)
  if (conIva.length) {
    return { propuesta: null, sinPropuesta: `${a.porque} Pero su factura trae IVA español (${[...new Set(conIva.map((l) => `${l.tipo!.porcentaje} %`))].join(', ')}): o la factura o su ficha están mal. Revísalas antes de apuntarla.` }
  }
  const t = c.autoliquidada?.(a.tipo) ?? null
  if (!t) return { propuesta: null, sinPropuesta: `${a.porque} Falta en tu plan la 472 o la 477 del ${a.tipo === 'ue_compra' ? 'IVA intracomunitario' : 'IVA de la inversión del sujeto pasivo'} (las del 21 %).` }
  const loc = f.localId
  const marca = f.marcaId ?? null
  const m = marca ? { marcaId: marca } : {}
  const lineas: LineaAsiento[] = []
  for (const [cuenta, cc] of gastos) lineas.push({ cuenta, debe: deCent(cc), haber: 0, localId: loc, comun: !loc, documento: f.numero, ...m })
  const baseC = f.lineas.reduce((x, l) => x + cent(l.base), 0)
  const base = deCent(baseC)
  const cuota = cuotaIva(base, t.porcentaje)
  lineas.push({ cuenta: t.soportado, debe: cuota, haber: 0, localId: loc, comun: !loc, documento: f.numero, ...m,
    iva: { tipoId: t.tipoId, tipo: t.porcentaje, base, libro: 'received', deducible: 'yes' } })
  lineas.push({ cuenta: t.repercutido, debe: 0, haber: cuota, localId: loc, comun: !loc, documento: f.numero, ...m })
  if (f.retencion) {
    lineas.push({ cuenta: c.retencion, debe: 0, haber: f.retencion.importe, localId: loc, comun: !loc, documento: f.numero,
      retencion: { tipoId: f.retencion.tipoId, tipo: f.retencion.porcentaje, base: f.retencion.base, modelo: f.retencion.modelo } })
    razones.push({ decision: `Retención ${f.retencion.porcentaje} % (${eurosExactos(f.retencion.importe)})`, porque: `se la ingresas tú a Hacienda en el ${f.retencion.modelo}` })
  }
  lineas.push({ cuenta: c.proveedor, debe: 0, haber: deCent(baseC - cent(f.retencion?.importe ?? 0)), localId: loc, comun: !loc, documento: f.numero, terceroId: f.terceroId, ...m })
  if (baseC !== cent(f.total)) {
    avisos.push(`Su factura no trae IVA, así que el total tendría que ser la base (${eurosExactos(base)}), y dice ${eurosExactos(f.total)}.`)
    confs.push('duda')
  }
  if (f.faltaNumero) { avisos.push('Falta el número de la factura: sin él no se valida ni va a Diez.'); confs.push('duda') }
  if (!loc) { razones.push({ decision: 'Común', porque: 'la factura no dice de qué local es: queda común y el informe la reparte' }); confs.push('probable') }
  razones.unshift({ decision: `Autoliquidación al ${t.porcentaje} % (${eurosExactos(cuota)})`, porque: `${a.porque} El IVA lo declaras y lo deduces tú: 472 y 477 por la misma cuota, al libro de recibidas.` })
  return {
    sinPropuesta: null,
    propuesta: {
      serie: 2, fecha: f.fecha, concepto: `Factura ${f.proveedor}${f.numero ? ` · ${f.numero}` : ''}`, origen: { tipo: 'supplier_invoice', id: f.id },
      lineas, confianza: peor('seguro', ...confs),
      porque: `Gasto, el IVA autoliquidado (472 y 477) y el total a su cuenta.`,
      razones, avisos, terceroId: f.terceroId, documento: f.numero,
    },
  }
}

export function pagoFactura(p: { facturaId: string; fecha: string; proveedor: string; numero: string | null; importe: number; localId: string | null; terceroId: string | null },
  c: { proveedor: string; banco: string | null; serieTesoreria?: SerieTesoreria }): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  if (!c.banco) return { propuesta: null, sinPropuesta: 'Falta la cuenta del banco del local: ponla en Tablas › Bancos.' }
  return {
    sinPropuesta: null,
    propuesta: {
      serie: c.serieTesoreria ?? 3, fecha: p.fecha, concepto: `Pago a ${p.proveedor}${p.numero ? ` · ${p.numero}` : ''}`, origen: { tipo: 'supplier_payment', id: p.facturaId },
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

// (liquidacionSocio y liquidacionMensual —el socio de marca— viven en SQL desde
// el S01 · PR 3: conta_propuestas_socio, con _conta_cuotas_y_redondeo.)

// ── Regla 11 · aprendizaje ──────────────────────────────────────────────────
// (aplicarAprendizaje vive en SQL desde el S01 · PR 3: _conta_aprendizaje. Queda
// aquí la forma de una corrección, que el navegador lee para saber si preguntar.)

export interface Correccion {
  /** Mismo origen: «channel_settlement:<canal>», «supplier_invoice:<proveedor>». */
  clave: string
  /** Qué cuenta propuso Folvy y cuál eligió la persona. */
  propuesta: string
  elegida: string
  quien: string | null
  cuando: string
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

// ── Fechas en palabras ──────────────────────────────────────────────────────
// (El no confirmado que una liquidación paga —noConfirmadoPagado— vive en SQL
// desde el S01 · PR 3: conta_propuesta_pagado_despues, sobre la regla de ventas.)

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «2026-10-06» → «6 de octubre». */
export const diaYMes = (iso: string): string => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`

// ── Cierre del día · cerrado sin confirmar que la liquidación no cobra (N2) ──
//
// C11b: el cierre del día cerró como vendido un pedido de plataforma que la
// plataforma no confirmó; su liquidación cubre su día y no lo trae cobrado. Si
// no se cobró, la venta se deshace con una DEVOLUCIÓN de su día (o del primer
// día abierto), aparte, como lo que decidió la plataforma (sales_adjustment,
// origen = la venta): las mismas líneas que una devolución del día (la 708 de
// la marca, la 477 y el cobro de la plataforma), con su porqué. El asiento del
// día no se toca. Se valida o se descarta como cualquier propuesta.

export interface SinCobrarEnLiquidacion {
  pedido: { id: string; codigo: string | null; canalId: string | null; marcaId: string | null; total: number }
  /** Su día de venta. */
  dia: string
  /** La fecha del asiento: su día si está abierto; si no, el primer día abierto. */
  fecha: string
  liquidacion: { ref: string | null; fecha: string | null }
}

export function devolucionSinCobrar(
  x: SinCobrarEnLiquidacion,
  e: Omit<EntradaVentasDia, 'pedidos' | 'devoluciones' | 'fecha'>,
): { propuesta: Propuesta | null; sinPropuesta: string | null } {
  const canal = e.nombreCanal(x.pedido.canalId)
  const codigo = x.pedido.codigo ?? 'sin código'
  const res = ventasDelDia({
    ...e, fecha: x.fecha, pedidos: [],
    devoluciones: [{ pedidoId: x.pedido.id, codigo: x.pedido.codigo, canalId: x.pedido.canalId, marcaId: x.pedido.marcaId, marcaPropia: true, importe: x.pedido.total, conFactura: false }],
  })
  if (!res.propuesta) return { propuesta: null, sinPropuesta: res.sinPropuesta }
  const liq = x.liquidacion.ref ? `la liquidación ${x.liquidacion.ref}${x.liquidacion.fecha ? ` del ${diaYMes(x.liquidacion.fecha)}` : ''}` : 'su liquidación'
  return {
    sinPropuesta: null,
    propuesta: {
      ...res.propuesta,
      concepto: `Devolución del ${diaYMes(x.dia)} · ${canal} · pedido ${codigo}, no cobrado`,
      origen: { tipo: 'sales_adjustment', id: x.pedido.id },
      documento: x.pedido.codigo,
      porque: `${canal} no ha cobrado el pedido ${codigo}, que se cerró como vendido sin confirmar el ${diaYMes(x.dia)}`,
      razones: [
        { decision: 'Se deshace la venta con una devolución', porque: `al cierre del día seguía abierto y se cerró como vendido sin confirmación; ${liq} cubre su día y no lo trae cobrado, y la liquidación de la plataforma tiene la última palabra` },
        { decision: x.fecha === x.dia ? 'Va aparte del asiento del día' : `Va el ${diaYMes(x.fecha)}, el primer día abierto`, porque: x.fecha === x.dia ? 'el asiento del día ya lleva el pedido como venta; esta devolución lo compensa sin tocarlo' : `su día (${diaYMes(x.dia)}) está cerrado; el asiento del día no se toca` },
        ...res.propuesta.razones,
      ],
    },
  }
}

// ── S01h · El abono de un proveedor ─────────────────────────────────────────

/**
 * La cuenta de devoluciones de una cuenta de compras, si el plan la tiene:
 * 600 → 608, 601 → 6081, 602 → 6082 (PGC, 608 «Devoluciones de compras y
 * operaciones similares»). Lo que no es una compra (un servicio de la 62, por
 * ejemplo) no tiene devolución propia: va al Haber de su misma cuenta.
 */
export function plantillaDevolucion(cuenta: string): string | null {
  if (cuenta.startsWith('600')) return '6080'
  if (cuenta.startsWith('601')) return '6081'
  if (cuenta.startsWith('602')) return '6082'
  return null
}

/**
 * S01h · El asiento de un abono de proveedor: el de su factura, al revés. Se
 * arma con los importes en positivo (como una factura) y aquí se le da la
 * vuelta: al Debe el proveedor; al Haber la compra (o su devolución, si el
 * plan la tiene) y el IVA soportado de cada tipo. Cada importe, en positivo
 * en su columna (el CHECK journal_line_debe_o_haber). El libro de recibidas lo
 * lee al revés: base y cuota restan, como rectificativa (R1), en el
 * trimestre del asiento.
 */
export function comoAbono(p: Propuesta, devolucion: (cuenta: string) => string | null, anula: string | null): Propuesta {
  const cambiadas: { de: string; a: string }[] = []
  const lineas = p.lineas.map((l) => {
    let cuenta = l.cuenta
    if (cuenta.startsWith('6') && l.debe > 0) {
      const d = devolucion(cuenta)
      if (d && d !== cuenta) { cambiadas.push({ de: cuenta, a: d }); cuenta = d }
    }
    return { ...l, cuenta, debe: l.haber, haber: l.debe }
  })
  const razones = [
    { decision: 'Abono: el asiento de su factura, al revés', porque: `Al Debe el proveedor, por lo que te devuelve; al Haber la compra y el IVA soportado de cada tipo. En el libro de recibidas va como rectificativa y resta en el 303 del trimestre del asiento${anula ? `. Anula ${anula}` : ''}` },
    ...[...new Map(cambiadas.map((x) => [x.de, x])).values()].map((x) => ({ decision: `Devolución de compras: ${x.a}`, porque: `La compra fue a la ${x.de}; lo que se devuelve va a su cuenta de devoluciones, que tu plan tiene` })),
    ...p.razones,
  ]
  return { ...p, concepto: p.concepto.replace(/^Factura\b/, 'Abono'), lineas, razones }
}
