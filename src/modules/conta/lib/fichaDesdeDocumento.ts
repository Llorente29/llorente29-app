// src/modules/conta/lib/fichaDesdeDocumento.ts
//
// D07b · La ficha del proveedor, completada desde el documento (Julio, 23/10).
// Si a la ficha le falta el NIF, la dirección o el nombre fiscal y el documento
// escaneado los trae, se proponen y se guardan al validar. Si el documento
// CONTRADICE la ficha, se avisa y no se cambia nada. Núcleo puro.
//
// S01b (28/10) · La misma regla, ampliada (una sola copia):
//   · además, el correo, el teléfono y la web, si la ficha no los tiene;
//   · lo que no coincide no se pisa: sale con su pregunta («Su dirección ha
//     cambiado: ¿la actualizo?») y lo que se guardaría si se pulsa;
//   · el NIF distinto, aparte (dos botones: «Es la misma, guarda el nuevo» y
//     «Elegir otro»);
//   · el IBAN NUNCA entra solo: se dice cómo está (nuevo, igual, distinto o
//     mal leído) y lo guarda quien pulsa. Un IBAN que no pasa el módulo 97 no
//     se ofrece.

import { casaNif } from '@/modules/conta/documentos/paraValidar'
import { claveNombre } from '@/modules/conta/lib/importarPlan'
import { formatearIban, normalizarIban, validarIban } from '@/modules/conta/lib/iban'

export interface FichaFiscal {
  nif: string | null; nombreFiscal: string | null; calle: string | null; codigoPostal: string | null; ciudad: string | null
  /** S01b · Los correos y teléfonos de sus contactos (supplier_contact), y su web y su IBAN. */
  correos?: readonly string[]; telefonos?: readonly string[]; web?: string | null; iban?: string | null
}
export interface LeidoDelDocumento {
  nif: string | null; nombre: string | null; direccion: string | null
  correo?: string | null; telefono?: string | null; web?: string | null; iban?: string | null
}

/** Lo que se guarda en la ficha (los campos de FichaProveedor). */
export interface CambiosFicha { taxId?: string; legalName?: string; fiscalStreet?: string; fiscalPostalCode?: string; fiscalCity?: string; website?: string }

/** Un campo de la ficha, como se dice y como se apunta de dónde sale (supplier.data_from_invoice). */
export type CampoDeFicha = 'nif' | 'nombreFiscal' | 'direccion' | 'correo' | 'telefono' | 'web' | 'iban'

/** Lo que el documento dice distinto de la ficha: no se pisa; se pregunta. */
export interface Cambiado {
  campo: Exclude<CampoDeFicha, 'nif' | 'iban'>
  /** «Su dirección ha cambiado: ¿la actualizo?». */
  pregunta: string
  ficha: string
  documento: string
  /** Lo que se guarda en la ficha si se pulsa (correo y teléfono van a sus contactos: `contacto`). */
  cambios: CambiosFicha
  contacto?: { correo?: string; telefono?: string }
}

export type EstadoIban =
  | { estado: 'sin_dato' }
  | { estado: 'igual' }
  /** La ficha no tiene IBAN y el de la factura es válido: se ofrece «Guardar este IBAN». */
  | { estado: 'nuevo'; iban: string; formateado: string }
  /** La ficha tiene otro: el aviso en rojo. `valido` dice si se podría cambiar. */
  | { estado: 'distinto'; iban: string; formateado: string; ficha: string; valido: boolean; motivo: string | null }
  /** La ficha no tiene y el de la factura no es un IBAN: no se ofrece. */
  | { estado: 'invalido'; iban: string; motivo: string }

export interface CompletarFicha {
  /** Lo que se guardará en la ficha al validar (solo lo que le falta). */
  proponer: CambiosFicha
  /** S01b · El correo y el teléfono que le faltan: van a un contacto nuevo, «de la factura …». */
  contacto: { correo?: string; telefono?: string }
  /** Lo que se propone, dicho para la persona. */
  frases: string[]
  /** De qué campos sale lo que se propone (para apuntar «de la factura …»). */
  campos: CampoDeFicha[]
  /** Lo que el documento dice distinto de la ficha: se avisa, no se cambia. */
  contradice: string[]
  /** S01b · Lo mismo, con su pregunta y lo que se guardaría al pulsar (sin el NIF). */
  cambiados: Cambiado[]
  /** S01b · La factura trae otro NIF que el de su ficha: ¿es otra empresa? */
  nifDistinto: { documento: string; ficha: string } | null
  iban: EstadoIban
}

const limpio = (x: string | null | undefined): string | null => {
  const t = (x ?? '').replace(/\s+/g, ' ').trim()
  return t ? t : null
}
const correoNorma = (x: string | null | undefined): string | null => {
  const t = limpio(x)?.toLowerCase() ?? null
  return t && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}
/** Solo los dígitos, sin el +34 ni el 0034 de delante: «91 123 45 67» y «+34 911234567» son el mismo. */
const telefonoNorma = (x: string | null | undefined): string | null => {
  const d = (x ?? '').replace(/\D/g, '').replace(/^(0034|34)(?=\d{9}$)/, '')
  return d.length >= 9 ? d : null
}
/** La web sin «https://», sin «www.» y sin la barra del final. */
const webNorma = (x: string | null | undefined): string | null => {
  const t = limpio(x)?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') ?? null
  return t && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/.test(t) ? t : null
}
const sinTildes = (x: string): string => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** «Calle Mayor 3, 28013 Madrid» → calle, código postal y ciudad (lo que se pueda; el resto, null). */
export function partirDireccion(direccion: string | null): { calle: string | null; codigoPostal: string | null; ciudad: string | null } {
  const d = limpio(direccion)
  if (!d) return { calle: null, codigoPostal: null, ciudad: null }
  const m = d.match(/^(.*?)[,\s-]*\b((?:0[1-9]|[1-4]\d|5[0-2])\d{3})\b[,\s-]*(.*)$/)
  if (!m) return { calle: d, codigoPostal: null, ciudad: null }
  const calle = limpio(m[1]?.replace(/[,\s-]+$/, ''))
  // La ciudad: hasta la primera coma, sin la provincia entre paréntesis ni un guion suelto;
  // y si sale repetida («MADRID MADRID», la ciudad y la provincia), una vez.
  let ciudad = limpio(m[3]?.replace(/\(.*?\)/g, '').split(',')[0]?.replace(/[\s-]+$/, ''))
  const pal = ciudad?.split(' ') ?? []
  if (pal.length % 2 === 0 && pal.length > 0 && pal.slice(0, pal.length / 2).join(' ').toUpperCase() === pal.slice(pal.length / 2).join(' ').toUpperCase()) ciudad = pal.slice(0, pal.length / 2).join(' ')
  return { calle, codigoPostal: m[2], ciudad }
}

const textoDireccion = (calle: string | null, cp: string | null, ciudad: string | null): string =>
  [calle, [cp, ciudad].filter(Boolean).join(' ')].filter(Boolean).join(', ')

/** Cómo está el IBAN de la factura frente al de la ficha. Nunca guarda nada. */
export function estadoIban(ibanFicha: string | null | undefined, ibanDocumento: string | null | undefined): EstadoIban {
  const leido = ibanDocumento ? normalizarIban(ibanDocumento) : ''
  if (!leido) return { estado: 'sin_dato' }
  const ficha = ibanFicha ? normalizarIban(ibanFicha) : ''
  const v = validarIban(leido)
  if (ficha && ficha === leido) return { estado: 'igual' }
  if (ficha) return { estado: 'distinto', iban: leido, formateado: formatearIban(leido), ficha: formatearIban(ficha), valido: v.ok, motivo: v.ok ? null : v.motivo }
  return v.ok ? { estado: 'nuevo', iban: v.normalizado, formateado: formatearIban(v.normalizado) } : { estado: 'invalido', iban: leido, motivo: v.motivo }
}

export function completarFicha(ficha: FichaFiscal, leido: LeidoDelDocumento): CompletarFicha {
  const r: CompletarFicha = { proponer: {}, contacto: {}, frases: [], campos: [], contradice: [], cambiados: [], nifDistinto: null, iban: estadoIban(ficha.iban, leido.iban) }
  const nif = limpio(leido.nif)?.toUpperCase().replace(/[\s.-]/g, '') ?? null
  if (nif) {
    if (!limpio(ficha.nif)) { r.proponer.taxId = nif; r.frases.push(`el NIF ${nif}`); r.campos.push('nif') }
    else if (casaNif(ficha.nif, nif) === 'distinto') {
      r.contradice.push(`El NIF del documento (${nif}) no es el de su ficha (${ficha.nif}).`)
      r.nifDistinto = { documento: nif, ficha: ficha.nif! }
    }
  }
  const nombre = limpio(leido.nombre)
  if (nombre) {
    if (!limpio(ficha.nombreFiscal)) { r.proponer.legalName = nombre; r.frases.push(`el nombre fiscal «${nombre}»`); r.campos.push('nombreFiscal') }
    else if (claveNombre(nombre) && claveNombre(ficha.nombreFiscal!) && claveNombre(nombre) !== claveNombre(ficha.nombreFiscal!)) {
      r.contradice.push(`El nombre del documento («${nombre}») no es el nombre fiscal de su ficha («${ficha.nombreFiscal}»).`)
      r.cambiados.push({ campo: 'nombreFiscal', pregunta: 'Su nombre fiscal ha cambiado: ¿lo actualizo?', ficha: ficha.nombreFiscal!, documento: nombre, cambios: { legalName: nombre } })
    }
  }
  const dir = partirDireccion(leido.direccion)
  if (dir.calle || dir.codigoPostal) {
    const nueva: CambiosFicha = {}
    if (dir.calle) nueva.fiscalStreet = dir.calle
    if (dir.codigoPostal) nueva.fiscalPostalCode = dir.codigoPostal
    if (dir.ciudad) nueva.fiscalCity = dir.ciudad
    const delDocumento = textoDireccion(dir.calle, dir.codigoPostal, dir.ciudad)
    if (!limpio(ficha.calle) && !limpio(ficha.codigoPostal)) {
      Object.assign(r.proponer, nueva)
      r.frases.push(`la dirección «${delDocumento}»`); r.campos.push('direccion')
    } else {
      const otroCp = !!dir.codigoPostal && !!limpio(ficha.codigoPostal) && dir.codigoPostal !== limpio(ficha.codigoPostal)
      // Con el mismo código postal, otra calle también es otra dirección (sin contar mayúsculas, tildes ni comas).
      const otraCalle = !otroCp && !!dir.calle && !!limpio(ficha.calle) && sinTildes(dir.calle) !== sinTildes(ficha.calle!)
      if (otroCp) r.contradice.push(`La dirección del documento (${dir.codigoPostal}${dir.ciudad ? ` ${dir.ciudad}` : ''}) no es la de su ficha (${ficha.codigoPostal}${ficha.ciudad ? ` ${ficha.ciudad}` : ''}).`)
      if (otroCp || otraCalle) {
        r.cambiados.push({ campo: 'direccion', pregunta: 'Su dirección ha cambiado: ¿la actualizo?', ficha: textoDireccion(limpio(ficha.calle), limpio(ficha.codigoPostal), limpio(ficha.ciudad)), documento: delDocumento, cambios: nueva })
      }
    }
  }
  // S01b · El correo y el teléfono, de sus contactos: si no tiene ninguno, al validar; si tiene otro, se pregunta.
  const correo = correoNorma(leido.correo)
  if (correo) {
    const suyos = (ficha.correos ?? []).map(correoNorma).filter((x): x is string => !!x)
    if (!suyos.length) { r.contacto.correo = correo; r.frases.push(`el correo ${correo}`); r.campos.push('correo') }
    else if (!suyos.includes(correo)) r.cambiados.push({ campo: 'correo', pregunta: 'Esta factura trae otro correo: ¿lo añado a sus contactos?', ficha: suyos.join(', '), documento: correo, cambios: {}, contacto: { correo } })
  }
  const tel = telefonoNorma(leido.telefono)
  if (tel) {
    const suyos = (ficha.telefonos ?? []).map(telefonoNorma).filter((x): x is string => !!x)
    const visto = limpio(leido.telefono)!
    if (!suyos.length) { r.contacto.telefono = visto; r.frases.push(`el teléfono ${visto}`); r.campos.push('telefono') }
    else if (!suyos.includes(tel)) r.cambiados.push({ campo: 'telefono', pregunta: 'Esta factura trae otro teléfono: ¿lo añado a sus contactos?', ficha: (ficha.telefonos ?? []).join(', '), documento: visto, cambios: {}, contacto: { telefono: visto } })
  }
  const web = webNorma(leido.web)
  if (web) {
    const suya = webNorma(ficha.web)
    if (!limpio(ficha.web)) { r.proponer.website = web; r.frases.push(`la web ${web}`); r.campos.push('web') }
    else if (suya && suya !== web) r.cambiados.push({ campo: 'web', pregunta: 'Su web ha cambiado: ¿la actualizo?', ficha: ficha.web!, documento: web, cambios: { website: web } })
  }
  return r
}

/** «el NIF X, el nombre fiscal «Y» y la dirección «Z»». */
export function enUnaFrase(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/** «de la factura R0672» (o «de una factura», si no tiene número). */
export function deLaFactura(numero: string | null | undefined): string {
  const n = limpio(numero)
  return n ? `de la factura ${n}` : 'de una factura'
}

/** Lo que se apunta en supplier.data_from_invoice por cada campo que sale de una factura. */
export interface OrigenDato { factura: string | null; facturaId: string; fecha: string; quien: string | null }

/** Une lo apuntado con lo nuevo: cada campo, su última factura. */
export function apuntarOrigen(antes: Readonly<Record<string, OrigenDato>> | null | undefined, campos: readonly CampoDeFicha[], origen: OrigenDato): Record<string, OrigenDato> {
  const r: Record<string, OrigenDato> = { ...(antes ?? {}) }
  for (const c of campos) r[c] = origen
  return r
}

/** «De la factura R0672» de un campo de la ficha, si salió de una factura (supplier.data_from_invoice); si no, null. */
export function origenDelCampo(datos: Readonly<Record<string, OrigenDato>> | null | undefined, campo: CampoDeFicha): string | null {
  const o = datos?.[campo]
  if (!o) return null
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(o.fecha) ? ` el ${o.fecha.slice(8, 10)}/${o.fecha.slice(5, 7)}` : ''
  return `${deLaFactura(o.factura).replace(/^d/, 'D')}${o.quien ? `, la guardó ${o.quien}${fecha}` : fecha}.`
}
