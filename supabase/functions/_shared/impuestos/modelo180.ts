// supabase/functions/_shared/impuestos/modelo180.ts
//
// S02 · EL FICHERO DEL 180 (resumen anual de retenciones sobre el alquiler de
// inmuebles urbanos) Y SU COMPROBACIÓN.
//
// Núcleo puro: sin red, sin base, sin Deno ni Node. Ni una posición escrita a
// mano: cada registro se construye recorriendo el diseño (dr180.ts, que sale
// del anexo VI de la Orden de 21/11/2000 del BOE con scripts/conta/s02/dr180.mjs)
// y se comprueba releyéndolo contra el mismo diseño. Los campos se nombran por
// su NOMBRE en el diseño, no por su posición: si el nombre no está, falla.
//
// Las reglas generales son las del propio anexo, las mismas que en el 190
// (el formato se comparte con modelo190.ts): registros de 500 posiciones,
// numéricos a la derecha con ceros, alfanuméricos a la izquierda en
// mayúsculas sin acentos, lo vacío a ceros o a blancos, importes positivos.
//
// Lo que el anexo NO dice, y se decide aquí a la vista:
//   · el separador entre registros: CRLF, como en el 190;
//   · el sello electrónico: la tabla lo pone en 238-500 y el texto de arriba
//     en 488-500. Va en blanco en los dos casos («será cumplimentado
//     exclusivamente por los programas de la A.E.A.T.»);
//   · el código de municipio del INE: Sumied no lo tiene de todos los
//     municipios; si no se sabe, va en blanco (el campo es alfanumérico).

import { DR180, type CampoDr180 } from './dr180.ts'
import { alfanumerico, FicheroNoVale as FicheroNoVale190, nif, nifValido, numerico } from './modelo190.ts'

export const LONGITUD = DR180.longitud
export const SALTO = '\r\n'

/** El inmueble arrendado (campos 114-327 del registro de perceptor). */
export interface Inmueble180 {
  /** 1 con referencia catastral (fuera del País Vasco y Navarra); 2 País Vasco; 3 Navarra; 4 sin referencia catastral. */
  situacion: '1' | '2' | '3' | '4'
  /** 20 caracteres; vacía en la situación 4. */
  catastral?: string | null
  tipoVia?: string | null
  nombreVia: string
  tipoNumeracion?: string | null
  numero?: string | null
  calificador?: string | null
  bloque?: string | null
  portal?: string | null
  escalera?: string | null
  planta?: string | null
  puerta?: string | null
  complemento?: string | null
  localidad?: string | null
  municipio: string
  /** Cinco cifras del INE, si se saben. */
  codigoMunicipio?: string | null
  /** Dos cifras: la provincia del inmueble. */
  provincia: string
  /** Cinco cifras. */
  cp: string
}

export interface Perceptor180 {
  nif: string
  /** Primer apellido, segundo apellido y nombre, en ese orden; o la denominación. */
  nombre: string
  /** Dos cifras (01-53): la provincia del domicilio del arrendador. */
  provincia: string
  /** 1 dinerario; 2 en especie. */
  modalidad?: '1' | '2'
  /** Lo pagado en el año por el alquiler, sin IVA, en euros. */
  base: number
  /** El porcentaje de retención (el último del año, si hubo varios). */
  porcentaje: number
  retenciones: number
  inmueble: Inmueble180
}

export interface Datos180 {
  ejercicio: number
  nif: string
  nombre: string
  contacto: { telefono: string; nombre: string }
  /** 13 cifras: el número identificativo de la declaración (empieza por 180). */
  numero: string
  tipo?: 'C' | 'S' | null
  anterior?: string | null
  perceptores: Perceptor180[]
}

export class FicheroNoVale extends Error {
  readonly fallos: string[]
  constructor(fallos: string[]) {
    super(fallos.length === 1 ? fallos[0] : `El fichero del 180 no vale: ${fallos.length} cosas no cuadran. ${fallos.slice(0, 3).join(' ')}`)
    this.name = 'FicheroNoVale'
    this.fallos = fallos
  }
}

type Tipo = '1' | '2'
const campos = (t: Tipo) => DR180.registros[t] as readonly CampoDr180[]

/** El campo por su nombre en el diseño (el comienzo basta). Si no está, el diseño ha cambiado: falla. */
export function campo(t: Tipo, nombre: string): CampoDr180 {
  const c = campos(t).find((x) => x.nombre.startsWith(nombre))
  if (!c) throw new FicheroNoVale([`El diseño del 180 no tiene en el registro ${t} el campo «${nombre}».`])
  return c
}

/** Una parte de un campo, por el comienzo de su texto en el diseño. */
export function parte(c: CampoDr180, texto: string): { desde: number; hasta: number } {
  const p = c.partes.find((x) => x.texto.startsWith(texto))
  if (!p) throw new FicheroNoVale([`El campo «${c.nombre}» del 180 no tiene la parte «${texto}».`])
  return p
}

const lon = (p: { desde: number; hasta: number }) => p.hasta - p.desde + 1

/** Un importe en euros como «parte entera + 2 decimales», sin coma. */
export function importe(euros: number, n: number): string {
  const cent = Math.round(euros * 100)
  if (cent < 0) throw new FicheroNoVale([`Todos los importes del 180 son positivos (${euros}).`])
  return numerico(cent, n)
}

function vacio(t: Tipo): string[] {
  const r = new Array<string>(LONGITUD).fill(' ')
  for (const c of campos(t)) {
    if (c.tipo === 'Numérico') for (let p = c.desde; p <= c.hasta; p++) r[p - 1] = '0'
    // Los importes de un campo alfanumérico (el signo aparte): su parte «IMPORTE», a ceros.
    else if (c.tipo === 'Alfanumérico') for (const pt of c.partes) if (/^IMPORTE/.test(pt.texto)) for (let p = pt.desde; p <= pt.hasta; p++) r[p - 1] = '0'
  }
  return r
}

function poner(r: string[], pos: { desde: number; hasta: number }, v: string) {
  if (v.length !== lon(pos)) throw new FicheroNoVale([`El valor «${v}» mide ${v.length} y su sitio (${pos.desde}-${pos.hasta}) mide ${lon(pos)}.`])
  for (let i = 0; i < v.length; i++) r[pos.desde - 1 + i] = v[i]
}

const texto = (r: string[], pos: { desde: number; hasta: number }, v: string | null | undefined) => poner(r, pos, alfanumerico(v ?? '', lon(pos)))

function registro1(d: Datos180): string {
  const r = vacio('1')
  const base = d.perceptores.reduce((s, p) => s + Math.round(p.base * 100), 0) / 100
  const retenido = d.perceptores.reduce((s, p) => s + Math.round(p.retenciones * 100), 0) / 100
  const c = (n: string) => campo('1', n)
  poner(r, c('TIPO DE REGISTRO'), '1')
  poner(r, c('MODELO DECLARACIÓN'), '180')
  poner(r, c('EJERCICIO'), numerico(d.ejercicio, 4))
  poner(r, c('N.I.F. DEL DECLARANTE'), nif(d.nif))
  texto(r, c('APELLIDOS Y NOMBRE O RAZÓN SOCIAL DEL DECLARANTE'), d.nombre)
  poner(r, c('TIPO DE SOPORTE'), 'T')
  const persona = c('PERSONA CON QUIÉN RELACIONARSE')
  const tel = parte(persona, 'TELÉFONO')
  poner(r, tel, numerico(d.contacto.telefono.replace(/\D/g, ''), lon(tel)))
  texto(r, parte(persona, 'APELLIDOS Y NOMBRE'), d.contacto.nombre)
  poner(r, c('NÚMERO DE IDENTIFICATIVO DE LA DECLARACIÓN'), numerico(d.numero, 13))
  const comp = c('DECLARACIÓN COMPLEMENTARIA O SUSTITUTIVA')
  poner(r, parte(comp, 'DECLARACIÓN COMPLEMENTARIA'), d.tipo === 'C' ? 'C' : ' ')
  poner(r, parte(comp, 'DECLARACIÓN SUSTITUTIVA'), d.tipo === 'S' ? 'S' : ' ')
  poner(r, c('NÚMERO IDENTIFICATIVO DE LA DECLARACIÓN ANTERIOR'), numerico(d.tipo ? (d.anterior ?? '') : '', 13))
  // «Si un mismo perceptor figura en varios registros, se computará una sola vez.»
  poner(r, c('NÚMERO TOTAL DE PERCEPTORES'), numerico(new Set(d.perceptores.map((p) => nif(p.nif))).size, 9))
  const b = c('BASE RETENCIONES E INGRESOS A CUENTA')
  poner(r, parte(b, 'SIGNO'), ' ')
  const bi = parte(b, 'IMPORTE')
  poner(r, bi, importe(base, lon(bi)))
  const ret = c('RETENCIONES E INGRESOS A CUENTA')
  poner(r, ret, importe(retenido, ret.lon))
  return r.join('')
}

function registro2(d: Datos180, p: Perceptor180): string {
  const r = vacio('2')
  const c = (n: string) => campo('2', n)
  poner(r, c('TIPO DE REGISTRO'), '2')
  poner(r, c('MODELO DECLARACIÓN'), '180')
  poner(r, c('EJERCICIO'), numerico(d.ejercicio, 4))
  poner(r, c('N.I.F. DEL DECLARANTE'), nif(d.nif))
  poner(r, c('N.I.F. DEL PERCEPTOR'), nif(p.nif))
  poner(r, c('N.I.F. DEL REPRESENTANTE LEGAL'), ' '.repeat(9))
  texto(r, c('APELLIDOS Y NOMBRE, RAZÓN SOCIAL'), p.nombre)
  poner(r, c('CÓDIGO PROVINCIA'), numerico(p.provincia, 2))
  poner(r, c('MODALIDAD'), p.modalidad ?? '1')
  const b = c('BASE RETENCIONES E INGRESOS A CUENTA')
  poner(r, parte(b, 'SIGNO'), ' ')
  const bi = parte(b, 'IMPORTE')
  poner(r, bi, importe(p.base, lon(bi)))
  const pct = c('% RETENCIÓN')
  poner(r, parte(pct, 'ENTERO'), numerico(Math.floor(Math.round(p.porcentaje * 100) / 100), 2))
  poner(r, parte(pct, 'DECIMAL'), numerico(Math.round(p.porcentaje * 100) % 100, 2))
  const ret = c('RETENCIONES E INGRESOS A CUENTA')
  poner(r, ret, importe(p.retenciones, ret.lon))
  poner(r, c('EJERCICIO DEVENGO'), '0000')
  const i = p.inmueble
  poner(r, c('SITUACIÓN DEL INMUEBLE'), i.situacion)
  texto(r, c('REFERENCIA CATASTRAL'), i.situacion === '4' ? '' : i.catastral)
  const dir = c('DIRECCIÓN DEL INMUEBLE')
  const pd = (t: string) => parte(dir, t)
  texto(r, pd('TIPO DE VÍA'), i.tipoVia)
  texto(r, pd('NOMBRE VÍA PÚBLICA'), i.nombreVia)
  // Los valores del anexo llevan barra y punto («NUM», «KM.», «S/N»): van tal cual, sin limpiar.
  const tn = pd('TIPO DE NUMERACIÓN')
  const numeracion = (i.tipoNumeracion ?? (i.numero ? 'NUM' : 'S/N')).toUpperCase().replace(/Ú/g, 'U')
  if (!/^(NUM|KM\.|S\/N)$/.test(numeracion)) throw new FicheroNoVale([`${p.nombre}: el tipo de numeración es NUM, KM. o S/N, no «${numeracion}».`])
  poner(r, tn, numeracion.padEnd(lon(tn), ' '))
  texto(r, pd('NÚMERO DE CASA'), i.numero)
  texto(r, pd('CALIFICADOR DEL NÚMERO'), i.calificador)
  texto(r, pd('BLOQUE'), i.bloque)
  texto(r, pd('PORTAL'), i.portal)
  texto(r, pd('ESCALERA'), i.escalera)
  texto(r, pd('PLANTA O PISO'), i.planta)
  texto(r, pd('PUERTA'), i.puerta)
  texto(r, pd('COMPLEMENTO'), i.complemento)
  texto(r, pd('LOCALIDAD O POBLACIÓN'), i.localidad)
  texto(r, pd('MUNICIPIO'), i.municipio)
  texto(r, pd('CÓDIGO DE MUNICIPIO'), i.codigoMunicipio)
  poner(r, pd('CÓDIGO PROVINCIA'), numerico(i.provincia, 2))
  poner(r, pd('CÓDIGO POSTAL'), numerico(i.cp, 5))
  return r.join('')
}

/** Los códigos de provincia del anexo VI (DR180.provincias: no escritos aquí). */
export function provinciasDelAnexo(): Set<string> {
  return new Set(DR180.provincias.map((p) => p.codigo))
}

function validarEntrada(d: Datos180): string[] {
  const f: string[] = []
  if (!Number.isInteger(d.ejercicio) || d.ejercicio < 2023) f.push(`Este diseño es para el 180 del ejercicio 2023 en adelante, no para ${d.ejercicio}.`)
  if (!nifValido(d.nif)) f.push(`El NIF de la empresa («${d.nif}») no es válido.`)
  if (!alfanumerico(d.nombre, 40).trim()) f.push('Falta la razón social.')
  if (!/^180\d{10}$/.test(d.numero)) f.push('El número identificativo de la declaración tiene 13 cifras y empieza por 180.')
  if (d.tipo && !/^\d{13}$/.test(d.anterior ?? '')) f.push('Una complementaria o sustitutiva lleva el número de la declaración anterior (13 cifras).')
  if (d.contacto.telefono.replace(/\D/g, '').length !== 9) f.push('El teléfono de contacto tiene que tener 9 cifras.')
  if (!alfanumerico(d.contacto.nombre, 40).trim()) f.push('Falta la persona con quien relacionarse.')
  if (d.perceptores.length === 0) f.push('No hay ningún arrendador: un 180 sin alquileres no se presenta.')
  const prov = provinciasDelAnexo()
  d.perceptores.forEach((p, k) => {
    const quien = p.nombre || `El arrendador ${k + 1}`
    const i = p.inmueble
    if (!nifValido(p.nif)) f.push(`${quien}: el NIF («${p.nif || 'falta'}») no es válido.`)
    if (!alfanumerico(p.nombre, 40).trim()) f.push(`El arrendador ${k + 1} no tiene nombre.`)
    if (!prov.has(p.provincia)) f.push(`${quien}: la provincia de su domicilio («${p.provincia || 'falta'}») no es un código del anexo.`)
    if (p.base < 0 || p.retenciones < 0) f.push(`${quien}: los importes del 180 son positivos.`)
    if (!(p.porcentaje >= 0 && p.porcentaje < 100)) f.push(`${quien}: el porcentaje de retención («${p.porcentaje}») no es un porcentaje.`)
    if (!i) { f.push(`${quien}: falta el inmueble arrendado.`); return }
    if (!['1', '2', '3', '4'].includes(i.situacion)) f.push(`${quien}: la situación del inmueble es 1, 2, 3 o 4.`)
    if (i.situacion !== '4' && !/^[0-9A-Z]{20}$/.test((i.catastral ?? '').toUpperCase().replace(/\s/g, ''))) f.push(`${quien}: con la situación ${i.situacion} la referencia catastral tiene 20 caracteres (sin ella, la situación es la 4).`)
    if (!alfanumerico(i.nombreVia ?? '', 50).trim()) f.push(`${quien}: falta la calle del inmueble.`)
    if (!alfanumerico(i.municipio ?? '', 30).trim()) f.push(`${quien}: falta el municipio del inmueble.`)
    if (i.codigoMunicipio && !/^\d{5}$/.test(i.codigoMunicipio)) f.push(`${quien}: el código de municipio del INE tiene 5 cifras.`)
    if (!prov.has(i.provincia)) f.push(`${quien}: la provincia del inmueble («${i.provincia || 'falta'}») no es un código del anexo.`)
    if (!/^\d{5}$/.test(i.cp ?? '')) f.push(`${quien}: el código postal del inmueble tiene 5 cifras.`)
  })
  return f
}

/** El fichero entero: el registro 1 y uno 2 por arrendador e inmueble. Lanza FicheroNoVale si algo no casa. */
export function generar180(d: Datos180): string {
  const f = validarEntrada(d)
  if (f.length) throw new FicheroNoVale(f)
  let fichero: string
  try {
    fichero = [registro1(d), ...d.perceptores.map((p) => registro2(d, p))].map((x) => x + SALTO).join('')
  } catch (e) {
    // Los formatos compartidos con el 190 lanzan su error: aquí es del 180.
    if (e instanceof FicheroNoVale190) throw new FicheroNoVale(e.fallos)
    throw e
  }
  const r = comprobar180(fichero, d)
  if (!r.ok) throw new FicheroNoVale(r.fallos)
  return fichero
}

// ── La comprobación: releer el fichero contra el diseño ────────────────────
export interface Comprobacion180 {
  ok: boolean
  fallos: string[]
  registros: number
  perceptores: number
  base: number
  retenciones: number
}

const en = (r: string, pos: { desde: number; hasta: number }) => r.slice(pos.desde - 1, pos.hasta)
// Para los mensajes: céntimos leídos del propio fichero, en euros con dos decimales.
// eslint-disable-next-line no-restricted-syntax
const euros = (cent: string | number) => (Number(cent) / 100).toFixed(2)

function leerCampos(t: Tipo, r: string, n: number, fallos: string[]) {
  const donde = (c: CampoDr180) => `Registro ${n} (tipo ${t}), ${c.desde}-${c.hasta} «${c.nombre.slice(0, 40)}»`
  for (const c of campos(t)) {
    const v = en(r, c)
    if (c.tipo === 'Numérico' && !/^[0-9]+$/.test(v)) fallos.push(`${donde(c)}: solo admite cifras («${v}»).`)
    else if (c.tipo === 'Blancos' && v.trim() !== '') fallos.push(`${donde(c)}: tiene que ir en blanco.`)
    else if (c.tipo === 'Alfabético' && !/^[A-ZÑÇ ]+$/.test(v)) fallos.push(`${donde(c)}: solo admite letras y blancos.`)
    else if (c.tipo === 'Alfanumérico' && !/^[0-9A-ZÑÇ /.]+$/.test(v)) fallos.push(`${donde(c)}: solo admite letras, cifras y blancos.`)
  }
  // El sello electrónico, en blanco: lo pone solo el programa de Hacienda.
  if (t === '1' && en(r, campo('1', 'SELLO ELECTRÓNICO')).trim() !== '') fallos.push(`Registro ${n}: el sello electrónico va en blanco.`)
}

/** Relee el fichero: estructura, cada campo contra el diseño y que el registro 1 sume los 2. */
export function comprobar180(fichero: string, d?: Pick<Datos180, 'ejercicio' | 'nif'>): Comprobacion180 {
  const fallos: string[] = []
  const malo = (m: string): Comprobacion180 => ({ ok: false, fallos: [...fallos, m], registros: 0, perceptores: 0, base: 0, retenciones: 0 })
  if (!fichero.endsWith(SALTO)) return malo('Cada registro acaba en un salto de línea (CRLF), también el último.')
  const regs = fichero.slice(0, -SALTO.length).split(SALTO)
  if (regs.some((r) => r.length !== LONGITUD)) return malo(`Todos los registros miden ${LONGITUD} posiciones.`)
  if (regs[0]?.[0] !== '1') return malo('El primer registro tiene que ser el del declarante (tipo 1).')
  if (regs.slice(1).some((r) => r[0] !== '2')) return malo('Después del registro 1 solo van registros de perceptor (tipo 2).')
  regs.forEach((r, i) => leerCampos(i === 0 ? '1' : '2', r, i + 1, fallos))

  const r1 = regs[0]
  const c1 = (n: string) => campo('1', n)
  const ejercicio = en(r1, c1('EJERCICIO'))
  const nifDecl = en(r1, c1('N.I.F. DEL DECLARANTE'))
  if (d && ejercicio !== String(d.ejercicio)) fallos.push(`El fichero es del ${ejercicio} y la declaración del ${d.ejercicio}.`)
  if (d && nifDecl !== nif(d.nif)) fallos.push('El NIF del declarante del fichero no es el de la empresa.')
  if (en(r1, c1('MODELO DECLARACIÓN')) !== '180') fallos.push('El registro 1 no es de un 180.')

  let base = 0
  let retenciones = 0
  const nifs = new Set<string>()
  const b2 = campo('2', 'BASE RETENCIONES E INGRESOS A CUENTA')
  regs.slice(1).forEach((r, i) => {
    const c2 = (n: string) => campo('2', n)
    if (en(r, c2('EJERCICIO')) !== ejercicio || en(r, c2('N.I.F. DEL DECLARANTE')) !== nifDecl) fallos.push(`Registro ${i + 2}: el ejercicio o el NIF del declarante no son los del registro 1.`)
    if (en(r, c2('MODELO DECLARACIÓN')) !== '180') fallos.push(`Registro ${i + 2}: no es de un 180.`)
    const v = en(r, parte(b2, 'IMPORTE'))
    const w = en(r, c2('RETENCIONES E INGRESOS A CUENTA'))
    if (/^\d+$/.test(v)) base += Number(v)
    if (/^\d+$/.test(w)) retenciones += Number(w)
    nifs.add(en(r, c2('N.I.F. DEL PERCEPTOR')))
  })
  const n = Number(en(r1, c1('NÚMERO TOTAL DE PERCEPTORES')))
  if (n !== nifs.size) fallos.push(`El registro 1 dice ${n} perceptores y hay ${nifs.size} NIF distintos en los registros de perceptor.`)
  const b1 = c1('BASE RETENCIONES E INGRESOS A CUENTA')
  const total = en(r1, parte(b1, 'IMPORTE'))
  if (Number(total) !== base) fallos.push(`El registro 1 dice ${euros(total)} € de base y los perceptores suman ${euros(base)} €.`)
  const ret = en(r1, c1('RETENCIONES E INGRESOS A CUENTA'))
  if (Number(ret) !== retenciones) fallos.push(`El registro 1 dice ${euros(ret)} € de retenciones y los perceptores suman ${euros(retenciones)} €.`)
  return { ok: fallos.length === 0, fallos, registros: regs.length - 1, perceptores: nifs.size, base: base / 100, retenciones: retenciones / 100 }
}
