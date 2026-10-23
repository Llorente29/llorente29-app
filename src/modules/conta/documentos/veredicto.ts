// src/modules/conta/documentos/veredicto.ts
//
// S02 · El veredicto de la IA sobre una factura recibida, con su motivo
// (encargo S02, regla 3 del patrón; tablero 3): arriba de la ficha, «Lista
// para contabilizar», «Revisa esto» o «No encaja», con una frase que dice POR
// QUÉ y el detalle detrás de «Por qué». Nunca solo «Propuesto» ni un
// porcentaje (no hay porcentajes en ninguna tabla contable: paso 1 del S02).
//
// Sin migración (paso 1, punto 4): todo sale de lo que ya se guarda y se
// calcula hoy:
//   · las comprobaciones de la lectura del PDF (supplier_invoice.reading:
//     cuadra, IVA por tipo, NIF, número, fecha…), con su gravedad;
//   · la propuesta del asiento (verPropuestaFactura): su confianza (seguro ·
//     probable · duda), sus avisos y sus razones;
//   · el proveedor reconocido y su NIF contra el de su ficha;
//   · de dónde sale la cuenta de gasto (su ficha, lo aprendido de sus
//     facturas anteriores) y si ya está pagada.
// Y el motivo de cada campo (PROPUESTO + una línea) y lo que se queda en
// ámbar («Por revisar») salen de lo mismo. Núcleo puro: se prueba sin React.

import type { TipoVeredicto, TonoCampo } from '@/modules/conta/diseno/plantillas'
import { AVISO_NIF_LEIDO_MAL, casaNif } from './paraValidar'

export interface Comprobacion { id: string; ok: boolean; texto: string; grave?: boolean }

export interface DatosVeredicto {
  validada: boolean
  /** Número del asiento validado, si lo hay. */
  numeroAsiento: number | null
  descartada: boolean
  motivoDescarte: string | null
  proveedor: { nombre: string; nif: string | null } | null
  /** El NIF que trae la factura (leído o propuesto). */
  nifFactura: string | null
  fecha: string | null
  /** Las comprobaciones de la lectura. Vacío: no viene de leer un fichero. */
  comprobaciones: readonly Comprobacion[]
  /** La propuesta del asiento: null si no la hay (con su porqué), undefined mientras se prepara. */
  propuesta: { confianza: 'seguro' | 'probable' | 'duda'; avisos: readonly string[]; razones: readonly { decision: string; porque: string }[] } | null | undefined
  porqueSinPropuesta: string | null
  /** De dónde sale la cuenta de gasto (proveedor.gasto.origen o lo aprendido). */
  origenGasto: string | null
  pagada: { fecha: string } | null
  /**
   * Ficha completa (tablero 3b): ¿base + IVA de sus importes por tipo dan el
   * total del PDF? Sale de la ficha (fichaRecibida.contraElPdf), también para
   * la que entró desde una recepción sin lectura propia. null: no se sabe.
   */
  cuadraConElPdf?: boolean | null
  /**
   * D03: la diferencia con el PDF es 1 céntimo de redondeo (sus líneas traen más de
   * dos decimales, como la Orange). Se dice en ámbar en los importes, pero no es
   * «Revisa esto»: el aviso «Base + IVA = …» de la propuesta no cuenta.
   */
  redondeo?: boolean
  /** D06 · Por qué no se puede validar por falta de documento (paraValidar.faltaDocumento); null o sin dar: lo tiene. */
  faltaDocumento?: string | null
  /** D06 · Si puede estar repetida, el aviso (paraValidar.textoDuplicada). */
  duplicada?: string | null
}

export interface Veredicto {
  tipo: TipoVeredicto
  titulo: string
  porque: string
  detalle: { ok: boolean | null; texto: string }[]
}

const frase = (x: string) => (/[.!?…:]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`)
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/**
 * ¿Coincide el NIF de la factura con el de su ficha? null si falta uno de los dos. D06: normalizado
 * (sin guiones, espacios ni «ES»), y un NIF leído mal en un solo carácter (no válido, cuando el de la
 * ficha sí lo es) cuenta como el de la ficha: se usa ése y se avisa (nifLeidoMal).
 */
export function nifCoincide(ficha: string | null | undefined, factura: string | null | undefined): boolean | null {
  const c = casaNif(ficha, factura)
  return c === null ? null : c !== 'distinto'
}

/** D06 · ¿Se leyó mal el NIF (un carácter, el leído no es válido y el de la ficha sí)? */
export const nifLeidoMal = (ficha: string | null | undefined, factura: string | null | undefined): boolean => casaNif(ficha, factura) === 'leido_mal'

/** El motivo de la cuenta de gasto, en palabras de calle. */
export function motivoDelGasto(origen: string | null): string | null {
  if (!origen) return null
  if (/ficha/i.test(origen)) return 'Es la cuenta de su ficha.'
  if (/asiento/i.test(origen)) return 'Es la de su asiento, ya propuesto.'
  if (/aprend|anterior|historial/i.test(origen)) return 'Lo usaste en sus facturas anteriores.'
  if (/diez/i.test(origen)) return 'Es la que llevaba en Diez.'
  return frase(origen.charAt(0).toUpperCase() + origen.slice(1))
}

/** El veredicto de la factura. */
export function veredictoFactura(d: DatosVeredicto): Veredicto {
  const detalle: Veredicto['detalle'] = [
    ...d.comprobaciones.map((c) => ({ ok: c.ok, texto: frase(c.texto) })),
    ...(d.propuesta?.razones ?? []).map((r) => ({ ok: null, texto: frase(`${r.decision}: ${r.porque}`) })),
    ...(d.propuesta?.avisos ?? []).map((a) => ({ ok: false, texto: frase(a) })),
  ]
  if (d.validada) {
    return { tipo: 'hecha', titulo: 'Ya está contabilizada', porque: `Tiene su asiento validado${d.numeroAsiento ? ` (el ${d.numeroAsiento})` : ''}: no hay nada que hacer.`, detalle }
  }
  if (d.descartada) {
    return { tipo: 'no_encaja', titulo: 'No es una factura', porque: frase(d.motivoDescarte ? `Se descartó: ${d.motivoDescarte}` : 'Se descartó como «no es una factura»'), detalle }
  }
  if (!d.proveedor) {
    return { tipo: 'no_encaja', titulo: 'No encaja', porque: 'No reconozco quién la emite: dime de quién es y la contabilizo.', detalle }
  }
  const coincide = nifCoincide(d.proveedor.nif, d.nifFactura)
  if (coincide === false) {
    return { tipo: 'no_encaja', titulo: 'No encaja', porque: `El NIF de la factura (${d.nifFactura}) no es el de la ficha de ${d.proveedor.nombre} (${d.proveedor.nif}): ¿es de otro proveedor?`, detalle }
  }
  const graves = d.comprobaciones.filter((c) => !c.ok && c.grave !== false)
  const cuadra = d.comprobaciones.find((c) => c.id === 'suma' || c.id === 'total')
  if (cuadra && !cuadra.ok) return { tipo: 'no_encaja', titulo: 'No encaja', porque: frase(cuadra.texto), detalle }
  if (!d.fecha) return { tipo: 'no_encaja', titulo: 'No encaja', porque: 'No tiene fecha: sin ella no se puede contabilizar.', detalle }
  if (d.propuesta === null) {
    return { tipo: 'no_encaja', titulo: 'No encaja', porque: frase(d.porqueSinPropuesta ?? 'No he podido preparar su asiento'), detalle }
  }
  // D06: sin documento no se valida (salvo «Sin PDF» con su motivo); una posible duplicada se avisa antes.
  if (d.faltaDocumento) return { tipo: 'revisa', titulo: 'Revisa esto', porque: frase(d.faltaDocumento), detalle }
  if (d.duplicada) return { tipo: 'revisa', titulo: 'Revisa esto', porque: frase(d.duplicada), detalle }
  // D06: el NIF leído mal en un carácter no es «No encaja»: se usa el de su ficha y se avisa en ámbar (el asiento se propone).
  if (nifLeidoMal(d.proveedor.nif, d.nifFactura)) {
    return { tipo: 'revisa', titulo: 'Revisa esto', porque: `${AVISO_NIF_LEIDO_MAL} (leí ${d.nifFactura}; su ficha dice ${d.proveedor.nif}).`, detalle }
  }
  if (d.cuadraConElPdf === false) {
    return { tipo: 'revisa', titulo: 'Revisa esto', porque: 'Base + IVA no dan el total del PDF: corrige los importes por tipo de IVA.', detalle }
  }
  const leves = d.comprobaciones.filter((c) => !c.ok && c.grave === false)
  const avisos = (d.propuesta?.avisos ?? []).filter((a) => !(d.redondeo && /^Base \+ IVA = /.test(a)))
  // Ficha completa (tablero 3b): «Revisa esto» solo si falta algo DE VERDAD, y
  // diciendo qué. Una propuesta «probable» dice por qué en sus razones (el
  // local, varias cuentas en sus facturas anteriores): eso es lo que se dice.
  // Sin una razón que la haga dudosa, si el gasto es el de su ficha o el de sus
  // facturas anteriores y los importes cuadran, está lista.
  // El redondeo de 1 céntimo pone la propuesta en «duda» (su aviso «Base + IVA = …»): quitado ese aviso, no cuenta.
  const soloRedondeo = !!d.redondeo && (d.propuesta?.avisos ?? []).length > avisos.length && avisos.length === 0
  const prop = d.propuesta && soloRedondeo && d.propuesta.confianza === 'duda' ? { ...d.propuesta, confianza: 'probable' as const } : d.propuesta
  const duda = prop && prop.confianza !== 'seguro' ? motivoDeLaDuda(prop, d.origenGasto, d.comprobaciones.length > 0 || d.cuadraConElPdf === true) : null
  if (graves.length > 0 || leves.length > 0 || avisos.length > 0 || duda) {
    const motivo = graves[0]?.texto ?? avisos[0] ?? leves[0]?.texto ?? duda ?? ''
    return { tipo: 'revisa', titulo: 'Revisa esto', porque: frase(motivo), detalle }
  }
  if (d.propuesta === undefined) {
    return { tipo: 'revisa', titulo: 'Preparando su asiento…', porque: 'Estoy comprobando la cuenta y el IVA.', detalle }
  }
  // Lista: se dice por qué, con lo que de verdad se ha comprobado.
  const partes: string[] = []
  const deFicha = coincide === true
  const gasto = motivoDelGasto(d.origenGasto)
  const deAnteriores = !!d.origenGasto && /aprend|anterior|historial|diez/i.test(d.origenGasto)
  if (deAnteriores) partes.push(deFicha ? 'El proveedor coincide con su ficha y el gasto es el de sus facturas anteriores' : `Es de ${d.proveedor.nombre} y el gasto es el de sus facturas anteriores`)
  else if (deFicha && gasto) partes.push('El proveedor, el IVA y la cuenta coinciden con su ficha y sus facturas anteriores')
  else if (deFicha) partes.push('El proveedor y su NIF coinciden con su ficha')
  else partes.push(`Es de ${d.proveedor.nombre}`)
  if (d.comprobaciones.length > 0 || d.cuadraConElPdf === true) partes.push('los importes del PDF cuadran')
  const primera = `${partes.join(', y ')}.`
  const pagada = d.pagada ? ` Ya está pagada en el banco (${ddmm(d.pagada.fecha)}).` : ''
  return { tipo: 'lista', titulo: 'Lista para contabilizar', porque: `${primera}${pagada}`, detalle }
}

/**
 * Por qué una propuesta no es segura, dicho como lo que falta. null si no hay
 * una razón de verdad: el gasto es el de su ficha o el de sus facturas
 * anteriores y los importes cuadran (entonces no hay nada que revisar).
 */
export function motivoDeLaDuda(p: NonNullable<DatosVeredicto['propuesta']>, origenGasto: string | null, cuadra: boolean): string | null {
  if (p.razones.some((r) => r.decision === 'Común')) return 'No sé de qué local es: elígelo en «A qué gasto va» (si no, queda común y el informe lo reparte).'
  const varias = p.razones.find((r) => /Probable, no segura|varias cuentas|\d+ cuentas/i.test(r.porque))
  if (varias) return varias.porque.replace(/\s*\([^)]*\)\s*$/, '')
  if (p.confianza === 'duda') return 'La cuenta de gasto es una duda: confírmala.'
  if (origenGasto && cuadra) return null
  return origenGasto ? 'Los importes no se han comprobado con el PDF: compáralos antes de validar.' : 'No sé de dónde sale la cuenta de gasto: confírmala.'
}

/** El tono y el motivo de cada campo de la ficha (PROPUESTO, Por revisar o bien). */
export interface MotivoCampo { tono: TonoCampo; motivo?: string; marca?: string }

export function motivoProveedor(d: Pick<DatosVeredicto, 'proveedor' | 'nifFactura'>): MotivoCampo {
  if (!d.proveedor) return { tono: 'revisar', motivo: d.nifFactura ? `NIF ${d.nifFactura}: no está en tus proveedores.` : 'No está en tus proveedores.' }
  if (nifLeidoMal(d.proveedor.nif, d.nifFactura)) return { tono: 'revisar', motivo: `${AVISO_NIF_LEIDO_MAL}: leí ${d.nifFactura}, su ficha dice ${d.proveedor.nif}.` }
  const c = nifCoincide(d.proveedor.nif, d.nifFactura)
  if (c === true) return { tono: 'ok', marca: 'NIF de su ficha' }
  if (c === false) return { tono: 'revisar', motivo: `La factura trae el NIF ${d.nifFactura}; su ficha, el ${d.proveedor.nif}.` }
  if (!d.proveedor.nif && !d.nifFactura) return { tono: 'revisar', motivo: 'Sin NIF: ni su ficha ni la factura lo traen. Sin él no se deduce su IVA.' }
  return { tono: 'normal', motivo: d.proveedor.nif ? `NIF ${d.proveedor.nif}, de su ficha.` : `La factura trae el NIF ${d.nifFactura}; su ficha no tiene.` }
}

export function motivoImportes(comprobaciones: readonly Comprobacion[]): MotivoCampo {
  const malas = comprobaciones.filter((c) => !c.ok && (c.id === 'suma' || c.id === 'total' || c.id.startsWith('cuota_') || c.id.startsWith('recargo_') || c.id === 'retencion'))
  if (malas.length > 0) return { tono: 'revisar', motivo: frase(malas[0].texto) }
  if (comprobaciones.length === 0) return { tono: 'normal', motivo: 'No viene de leer un fichero: compruébalos con la factura.' }
  return { tono: 'ok', motivo: 'Cuadran con el PDF, al céntimo.' }
}

export function motivoGasto(o: { cuenta: string | null; origen: string | null; confirmada: boolean }): MotivoCampo {
  if (!o.cuenta) return { tono: 'revisar', motivo: 'No sé en qué cuenta va: elígela y la recuerdo para las siguientes.' }
  const m = motivoDelGasto(o.origen)
  return { tono: o.confirmada ? 'normal' : 'propuesto', motivo: m ?? undefined }
}
