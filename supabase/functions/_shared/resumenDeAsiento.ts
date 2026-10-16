// supabase/functions/_shared/resumenDeAsiento.ts
//
// C04b · R15 · De lo que devuelve la base (conta_resumen_ventas) al «Resumen de
// ventas» del PDF, y a su factura de Diez cuando la plataforma la tiene medida.
// Núcleo puro: sin red ni base. Lo usan el Libro (al validar, para generar y
// guardar el PDF) y el envío a Diez (para mandar la misma factura).
//
// Las cifras salen del ASIENTO, no de los pedidos: el PDF lo cuadra después
// contra los pedidos (comprobarResumen) y, si no cuadra, no hay PDF.
//   · las líneas por marca = sus 700 (haber) y 708 (debe, en negativo);
//   · la base = su suma; el IVA = la 477 (haber − debe); el total = la 430
//     (debe − haber), que es lo que cobra la plataforma;
//   · cada reembolso, de sus líneas con el mismo documento: la 708 (base), la
//     477 al debe (IVA) y la 430 al haber (total);
//   · la base de cada pedido, como la propuesta: la que trae si cuadra con su
//     total; si no, del total al tipo del asiento.

import type { Correspondencia } from './diezAnalitica.ts'
import { facturaDeVentas, type AsientoVentas, type FacturaVentas } from './diezFactura.ts'
import type { DatosResumenVentas, MarcaResumen, PedidoResumen } from './resumenVentasPdf.ts'

/** Lo que devuelve public.conta_resumen_ventas(asiento). */
export type ResumenBD = {
  id: string
  account_id: string
  company_id: string
  estado: string
  serie: number
  numero: number | null
  /** AAAA-MM-DD, el día de las ventas. */
  fecha: string
  empresa: { nombre: string; nif: string } | null
  local: { id: string; nombre: string } | null
  canal: { id: string; slug: string; nombre: string } | null
  /** C06b (16/10): descuento y envío con el IVA dentro, y qué se hizo con el envío (conta_cargos_de_pedidos). */
  pedidos: { hora: string; codigo: string; marca: string | null; total: number; base: number | null; cuota: number | null
    descuento?: number | null; envio?: number | null; clase?: 'ninguno' | 'cobrado' | 'por_aclarar' | 'fuera' | null }[]
  /** C06b: `papel`, si la línea es la de promociones o la de envíos cobrados de su plataforma. */
  lineas: { cuenta: string; debe: number; haber: number; marca: string | null; tipoIva: number | null; documento: string | null; papel?: 'promociones' | 'envios' | null }[]
  documento: { id: string; ruta: string; nombre: string; sha256: string; bytes: number; creado_en: string; creado_por: string | null } | null
}

export type ResumenListo = {
  datos: DatosResumenVentas
  /** La factura de Diez de este asiento, o null y por qué no la hay. */
  factura: FacturaVentas | null
  sinFactura: string | null
  /** El nombre del fichero: ResumenDeVentas_<factura o asiento>.pdf */
  nombreFichero: string
}

const c = (x: number | null | undefined) => Math.round(Number(x ?? 0) * 100)
const e = (x: number) => x / 100
const SIN_MARCA = 'Sin marca'
/** C06b: cómo se llaman en el PDF las líneas de promociones y de envíos cobrados. */
export const LINEA_PROMOCIONES = 'Promociones'
export const LINEA_ENVIOS = 'Envíos cobrados'

/** «Ventas nº 1287», como lo dice el Libro (NOMBRE_SERIE y toLocaleString es-ES). */
export const nombreAsiento = (numero: number | null) => (numero == null ? 'Ventas (sin número)' : `Ventas nº ${numero.toLocaleString('es-ES')}`)

/**
 * Los datos del PDF de un asiento de ventas de una plataforma. Lanza si el
 * asiento no lleva resumen (sin plataforma, sin local, sin empresa, sin
 * número): nada a medias.
 */
export function resumenDeAsiento(r: ResumenBD, o: { correspondencia: Correspondencia | null; generado: Date; hoy: string }): ResumenListo {
  if (!r.canal) throw new Error('Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.')
  if (!r.local) throw new Error('El asiento no tiene local: no se puede hacer su resumen.')
  if (!r.empresa?.nombre || !r.empresa.nif) throw new Error('La empresa no tiene nombre o NIF: el resumen los lleva en la cabecera.')
  if (r.estado !== 'validado' || r.numero == null) throw new Error('El resumen de ventas se hace del asiento validado: lleva su número.')

  const de = (pref: string) => r.lineas.filter((l) => l.cuenta.startsWith(pref))
  const tipoIva = [...new Set(de('477').map((l) => Number(l.tipoIva ?? 10)))]
  if (tipoIva.length > 1) throw new Error(`El asiento tiene IVA a más de un tipo (${tipoIva.join(', ')} %): el resumen es de un tipo.`)
  const tipo = tipoIva[0] ?? 10

  // Las líneas por marca: 700 en positivo y 708 en negativo, por cuenta. C06b:
  // la de promociones (al debe, resta) y la de envíos cobrados (705), con su nombre.
  const porCuenta = new Map<string, MarcaResumen>()
  const nombreDe = (l: ResumenBD['lineas'][number]) => (l.papel === 'promociones' ? LINEA_PROMOCIONES : l.papel === 'envios' ? LINEA_ENVIOS : l.marca ?? SIN_MARCA)
  for (const l of [...de('700'), ...de('705'), ...de('708')]) {
    const x = porCuenta.get(l.cuenta) ?? { marca: nombreDe(l), cuenta: l.cuenta, importe: 0, ...(l.papel ? { papel: l.papel } : {}) }
    x.importe = e(c(x.importe) + c(l.haber) - c(l.debe))
    porCuenta.set(l.cuenta, x)
  }
  const lineasFactura = [...porCuenta.values()]
  const base = lineasFactura.reduce((t, l) => t + c(l.importe), 0)
  const cuota = de('477').reduce((t, l) => t + c(l.haber) - c(l.debe), 0)
  const cobro = de('430').reduce((t, l) => t + c(l.debe) - c(l.haber), 0)

  // Los pedidos, con su base como la propuesta. C06b: si el asiento lleva la
  // línea de promociones o la de envíos, cada pedido lleva la suya en base (al
  // tipo y al céntimo, como conta_propuesta_ventas_unidad); un envío «fuera»
  // (la plataforma no lo paga) sale de su total.
  const conPromo = r.lineas.some((l) => l.papel === 'promociones')
  const conEnvio = r.lineas.some((l) => l.papel === 'envios')
  const enBase = (x: number) => Math.round((x * 100) / (100 + tipo))
  const pedidos: PedidoResumen[] = r.pedidos.map((p) => {
    const fuera = p.clase === 'fuera' && c(p.envio) > 0
    const t = c(p.total) - (fuera ? c(p.envio) : 0)
    const trae = !fuera && p.base != null && p.cuota != null && c(p.base) + c(p.cuota) === t
    const b = trae ? c(p.base) : Math.sign(t) * Math.round((Math.abs(t) * 100) / (100 + tipo))
    const promocion = conPromo && c(p.descuento) > 0 ? e(enBase(c(p.descuento))) : 0
    const envio = conEnvio && p.clase === 'cobrado' && c(p.envio) > 0 ? e(enBase(c(p.envio))) : 0
    return { hora: p.hora, codigo: p.codigo, marca: p.marca ?? SIN_MARCA, base: e(b), cuota: e(t - b), total: e(t), ...(promocion ? { promocion } : {}), ...(envio ? { envio } : {}) }
  })

  // Los reembolsos, de sus líneas: la 708 lleva el documento (el pedido).
  const reembolsos: PedidoResumen[] = de('708').filter((l) => c(l.debe) > 0).map((l) => {
    const doc = l.documento ?? ''
    const iva = de('477').filter((x) => x.documento === doc && doc !== '').reduce((t, x) => t + c(x.debe), 0)
    const total = de('430').filter((x) => x.documento === doc && doc !== '').reduce((t, x) => t + c(x.haber), 0)
    return { hora: '—', codigo: doc || 'sin código', marca: l.marca ?? SIN_MARCA, base: e(c(l.debe)), cuota: e(iva), total: e(total || c(l.debe) + iva) }
  })

  // La factura de Diez, si la plataforma tiene su patrón medido y el local su grupo.
  let factura: FacturaVentas | null = null
  let sinFactura: string | null = null
  if (!o.correspondencia) sinFactura = 'la empresa no tiene correspondencia con Diez'
  else {
    try {
      const a: AsientoVentas = { fecha: r.fecha, local: r.local.nombre, canal: r.canal.slug, lineas: r.lineas.map((l) => ({ cuenta: l.cuenta, debe: Number(l.debe), haber: Number(l.haber), marca: l.marca, tipoIva: l.tipoIva })) }
      factura = facturaDeVentas(a, { correspondencia: o.correspondencia, nombreCliente: '—', hoy: o.hoy, conAnalitica: false })
    } catch (x) { sinFactura = x instanceof Error ? x.message : String(x) }
  }
  const numeroFactura = factura ? String(factura.factura.NumeroFactura) : null
  const asiento = nombreAsiento(r.numero)
  const datos: DatosResumenVentas = {
    empresa: { nombre: r.empresa.nombre, nif: r.empresa.nif }, local: r.local.nombre, plataforma: r.canal.nombre, fecha: r.fecha,
    numeroFactura, asiento, generado: o.generado, tipoIva: tipo, pedidos, reembolsos, lineasFactura,
    factura: { base: e(base), cuota: e(cuota), total: e(cobro) }, cobro: e(cobro),
  }
  const ref = (numeroFactura ?? asiento.replace('nº ', '')).replace(/[^A-Za-z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return { datos, factura, sinFactura, nombreFichero: `ResumenDeVentas_${ref}.pdf` }
}
