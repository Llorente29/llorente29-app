// supabase/functions/_shared/impuestos/modelo190.ts
//
// S02 · EL FICHERO DEL 190 (resumen anual de retenciones del trabajo y de
// actividades económicas) Y SU COMPROBACIÓN.
//
// Núcleo puro: sin red, sin base, sin Deno ni Node. Ni una posición escrita a
// mano: cada registro se construye recorriendo el diseño (dr190.ts, que sale
// del anexo de la Orden EHA/3127/2009 del BOE con scripts/conta/s02/dr190.mjs)
// y se comprueba releyéndolo contra el mismo diseño. Los campos se nombran por
// su NOMBRE en el diseño, no por su posición: si el nombre no está, falla.
//
// Las reglas generales son las del propio anexo:
//   · registros de 500 posiciones; primero el tipo 1 y después los tipo 2;
//   · numéricos a la derecha y rellenos de ceros, sin signo;
//   · alfanuméricos a la izquierda, rellenos de blancos, en mayúsculas, sin
//     caracteres especiales ni vocales acentuadas (la Ñ y la Ç sí, ISO-8859-1);
//   · lo que no tiene contenido: ceros si es numérico, blancos si no;
//   · los NIF, ajustados a la derecha y con ceros a la izquierda;
//   · todos los importes, positivos (el signo «N» es para los reintegros).
//
// Lo que el anexo NO dice, y se decide aquí a la vista:
//   · las posiciones 323-387 del registro 2 no las describe el texto
//     (DR190.sinDescribir): van en blanco;
//   · el separador entre registros: el texto no lo nombra. Se usa CRLF, uno
//     detrás de cada registro;
//   · la tabla de provincias del anexo vigente no trae «JAÉN 23» (el
//     consolidado del BOE la perdió en 2023): sale de la versión de 2022 del
//     mismo texto, y DR190.provincias lo dice en su `fuente`.

import { DR190, type CampoDr190 } from './dr190.ts'

export const LONGITUD = DR190.longitud
export const SALTO = '\r\n'

/** Las claves de percepción del anexo («A. Empleados por cuenta ajena»…). */
export type Clave = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L'
/** Las claves que llevan subclave obligatoria (campo SUBCLAVE del anexo). */
export const CON_SUBCLAVE: readonly Clave[] = ['B', 'C', 'E', 'F', 'G', 'H', 'I', 'K', 'L']

export interface Perceptor190 {
  nif: string
  /** Primer apellido, segundo apellido y nombre, en ese orden; o la denominación. */
  nombre: string
  /** Dos cifras (01-53) o 98: la provincia del domicilio del perceptor. */
  provincia: string
  clave: Clave
  /** Dos cifras, solo en las claves que la llevan. */
  subclave?: string | null
  /** Percepción íntegra dineraria del año, en euros. */
  integra: number
  /** Retenciones practicadas sobre ella, en euros. */
  retenciones: number
  /** Solo claves A, B y C: el año de nacimiento. */
  anioNacimiento?: number | null
  /** Claves A, B y C: las cotizaciones a la Seguridad Social a cargo del perceptor (art. 19.2 LIRPF), en euros. */
  gastos?: number | null
  /** Solo clave A: el tipo de contrato (1 general, 2 menos de un año, 3, 4). */
  contrato?: '1' | '2' | '3' | '4' | null
  /** Solo claves A, B y C: 1, 2 o 3 («3» si no la comunicó). */
  situacionFamiliar?: '1' | '2' | '3' | null
}

export interface Datos190 {
  ejercicio: number
  nif: string
  nombre: string
  /** Persona con quien relacionarse. */
  contacto: { telefono: string; nombre: string; correo: string }
  /** 13 cifras: el número identificativo de la declaración. */
  numero: string
  /** Complementaria (C) o sustitutiva (S) de la declaración `anterior`. */
  tipo?: 'C' | 'S' | null
  anterior?: string | null
  perceptores: Perceptor190[]
}

export class FicheroNoVale extends Error {
  readonly fallos: string[]
  constructor(fallos: string[]) {
    super(fallos.length === 1 ? fallos[0] : `El fichero del 190 no vale: ${fallos.length} cosas no cuadran. ${fallos.slice(0, 3).join(' ')}`)
    this.name = 'FicheroNoVale'
    this.fallos = fallos
  }
}

type Tipo = '1' | '2'
const campos = (t: Tipo) => DR190.registros[t] as readonly CampoDr190[]

/** El campo por su nombre en el diseño (el comienzo basta). Si no está, el diseño ha cambiado: falla. */
export function campo(t: Tipo, nombre: string): CampoDr190 {
  const c = campos(t).find((x) => x.nombre.startsWith(nombre))
  if (!c) throw new FicheroNoVale([`El diseño del 190 no tiene en el registro ${t} el campo «${nombre}».`])
  return c
}

/** Una parte de un campo, por el comienzo de su texto en el diseño. */
export function parte(c: CampoDr190, texto: string): { desde: number; hasta: number } {
  const p = c.partes.find((x) => x.texto.startsWith(texto))
  if (!p) throw new FicheroNoVale([`El campo «${c.nombre}» del 190 no tiene la parte «${texto}».`])
  return p
}

// ── Formato ─────────────────────────────────────────────────────────────────
/** Mayúsculas sin acentos ni caracteres especiales; la Ñ y la Ç se quedan. */
export function alfanumerico(v: string, lon: number): string {
  // Letra a letra: la Ñ y la Ç se quedan; el resto pierde el acento; lo que no es letra ni cifra, blanco.
  const limpio = [...v.toUpperCase()].map((ch) => {
    if (ch === 'Ñ' || ch === 'Ç') return ch
    const base = ch.normalize('NFD')[0]
    return /[A-Z0-9]/.test(base) ? base : ' '
  }).join('').replace(/\s+/g, ' ').trim()
  return limpio.slice(0, lon).padEnd(lon, ' ')
}

export function numerico(v: string | number, lon: number): string {
  const s = String(v)
  if (!/^[0-9]*$/.test(s)) throw new FicheroNoVale([`«${s}» no es un número sin signo.`])
  if (s.length > lon) throw new FicheroNoVale([`«${s}» no cabe en ${lon} posiciones.`])
  return s.padStart(lon, '0')
}

/** NIF ajustado a la derecha, el control en la última y ceros a la izquierda. */
export function nif(v: string): string {
  const s = v.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (s.length === 0 || s.length > 9) throw new FicheroNoVale([`El NIF «${v}» no tiene entre 1 y 9 letras o cifras.`])
  return s.padStart(9, '0')
}

/** Un importe en euros como «parte entera + 2 decimales», sin coma: `lon` cifras en total. */
export function importe(euros: number, lon: number): string {
  const cent = Math.round(euros * 100)
  if (cent < 0) throw new FicheroNoVale([`Todos los importes del 190 son positivos (${euros}).`])
  return numerico(cent, lon)
}

// ── Construcción de un registro: lo que no se pone, como manda el anexo ────
function vacio(t: Tipo): string[] {
  const r = new Array<string>(LONGITUD).fill(' ')
  for (const c of campos(t)) {
    // Los campos numéricos se rellenan a ceros; dentro de un campo alfanumérico
    // con partes (los importes), las partes numéricas también, y el signo en blanco.
    if (c.tipo === 'Numérico') for (let p = c.desde; p <= c.hasta; p++) r[p - 1] = '0'
    else if (c.tipo === 'Alfanumérico') {
      for (const pt of c.partes) {
        if (/^SIGNO/.test(pt.texto) || /^(TELÉFONO|APELLIDOS)/.test(pt.texto)) continue
        if (/^(PERCEPCIÓN|RETENCIONES|VALORACIÓN|INGRESOS|IMPORTE|Parte)/.test(pt.texto)) {
          for (let p = pt.desde; p <= pt.hasta; p++) r[p - 1] = '0'
        }
      }
    }
  }
  return r
}

function poner(r: string[], pos: { desde: number; hasta: number }, v: string) {
  const lon = pos.hasta - pos.desde + 1
  if (v.length !== lon) throw new FicheroNoVale([`El valor «${v}» mide ${v.length} y su sitio (${pos.desde}-${pos.hasta}) mide ${lon}.`])
  for (let i = 0; i < lon; i++) r[pos.desde - 1 + i] = v[i]
}

function registro1(d: Datos190): string {
  const r = vacio('1')
  const total = d.perceptores.reduce((s, p) => s + Math.round(p.integra * 100), 0) / 100
  const retenido = d.perceptores.reduce((s, p) => s + Math.round(p.retenciones * 100), 0) / 100
  const c = (n: string) => campo('1', n)
  poner(r, c('TIPO DE REGISTRO'), '1')
  poner(r, c('MODELO DECLARACIÓN'), '190')
  poner(r, c('EJERCICIO'), numerico(d.ejercicio, 4))
  poner(r, c('NIF DEL DECLARANTE'), nif(d.nif))
  poner(r, c('APELLIDOS Y NOMBRE, DENOMINACIÓN'), alfanumerico(d.nombre, c('APELLIDOS Y NOMBRE, DENOMINACIÓN').lon))
  poner(r, c('TIPO DE SOPORTE'), 'T')
  const persona = c('PERSONA CON QUIÉN RELACIONARSE')
  const tel = parte(persona, 'TELÉFONO')
  poner(r, tel, numerico(d.contacto.telefono.replace(/\D/g, ''), tel.hasta - tel.desde + 1))
  const quien = parte(persona, 'APELLIDOS Y NOMBRE')
  poner(r, quien, alfanumerico(d.contacto.nombre, quien.hasta - quien.desde + 1))
  poner(r, c('NÚMERO IDENTIFICATIVO DE LA DECLARACIÓN'), numerico(d.numero, 13))
  const comp = c('DECLARACIÓN COMPLEMENTARIA O SUSTITUTIVA')
  poner(r, parte(comp, 'DECLARACIÓN COMPLEMENTARIA'), d.tipo === 'C' ? 'C' : ' ')
  poner(r, parte(comp, 'DECLARACIÓN SUSTITUTIVA'), d.tipo === 'S' ? 'S' : ' ')
  poner(r, c('NÚMERO IDENTIFICATIVO DE LA DECLARACIÓN ANTERIOR'), numerico(d.tipo ? (d.anterior ?? '') : '', 13))
  poner(r, c('NÚMERO TOTAL DE PERCEPCIONES'), numerico(d.perceptores.length, 9))
  const imp = c('IMPORTE TOTAL DE LAS PERCEPCIONES')
  poner(r, parte(imp, 'SIGNO'), ' ')
  poner(r, parte(imp, 'IMPORTE'), importe(total, 15))
  poner(r, c('IMPORTE TOTAL DE LAS RETENCIONES'), importe(retenido, 15))
  // El campo del correo lleva en el nombre toda su descripción: se busca por el comienzo.
  const correo = c('CORREO ELECTRÓNICO')
  // El correo admite @ y punto: el anexo dice «una dirección de correo electrónico».
  poner(r, correo, d.contacto.correo.trim().slice(0, correo.lon).padEnd(correo.lon, ' '))
  return r.join('')
}

function registro2(d: Datos190, p: Perceptor190): string {
  const r = vacio('2')
  const c = (n: string) => campo('2', n)
  poner(r, c('TIPO DE REGISTRO'), '2')
  poner(r, c('MODELO DECLARACIÓN'), '190')
  poner(r, c('EJERCICIO'), numerico(d.ejercicio, 4))
  poner(r, c('NIF DEL DECLARANTE'), nif(d.nif))
  poner(r, c('NIF DEL PERCEPTOR'), nif(p.nif))
  poner(r, c('NIF DEL REPRESENTANTE LEGAL'), ' '.repeat(9))
  poner(r, c('APELLIDOS Y NOMBRE O DENOMINACIÓN DEL PERCEPTOR'), alfanumerico(p.nombre, c('APELLIDOS Y NOMBRE O DENOMINACIÓN DEL PERCEPTOR').lon))
  poner(r, c('CÓDIGO PROVINCIA'), numerico(p.provincia, 2))
  poner(r, c('CLAVE DE PERCEPCIÓN'), p.clave)
  poner(r, c('SUBCLAVE'), CON_SUBCLAVE.includes(p.clave) ? numerico(p.subclave ?? '', 2) : '00')
  const din = c('PERCEPCIONES DINERARIAS NO DERIVADAS')
  poner(r, parte(din, 'SIGNO'), ' ')
  const integra = parte(din, 'PERCEPCIÓN ÍNTEGRA')
  poner(r, integra, importe(p.integra, integra.hasta - integra.desde + 1))
  const ret = parte(din, 'RETENCIONES PRACTICADAS')
  poner(r, ret, importe(p.retenciones, ret.hasta - ret.desde + 1))
  if (['A', 'B', 'C'].includes(p.clave)) {
    poner(r, c('AÑO DE NACIMIENTO'), numerico(p.anioNacimiento ?? 0, 4))
    poner(r, c('SITUACIÓN FAMILIAR'), p.situacionFamiliar ?? '3')
    const gastos = c('GASTOS DEDUCIBLES')
    poner(r, gastos, importe(p.gastos ?? 0, gastos.lon))
  }
  if (p.clave === 'A') poner(r, c('CONTRATO O RELACIÓN'), p.contrato ?? '1')
  return r.join('')
}

/** El fichero entero: el registro 1 y uno 2 por perceptor y clave. Lanza FicheroNoVale si algo no casa. */
export function generar190(d: Datos190): string {
  const f = validarEntrada(d)
  if (f.length) throw new FicheroNoVale(f)
  const regs = [registro1(d), ...d.perceptores.map((p) => registro2(d, p))]
  const fichero = regs.map((x) => x + SALTO).join('')
  const r = comprobar190(fichero, d)
  if (!r.ok) throw new FicheroNoVale(r.fallos)
  return fichero
}

/** Los códigos de provincia del anexo (DR190.provincias: no escritos aquí). */
export function provinciasDelAnexo(): Set<string> {
  return new Set(DR190.provincias.map((p) => p.codigo))
}

/** Valida un NIF español (DNI, NIE o NIF de entidad) por su carácter de control. */
export function nifValido(v: string): boolean {
  const s = v.toUpperCase().replace(/[^0-9A-Z]/g, '')
  const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE'
  if (/^\d{8}[A-Z]$/.test(s)) return LETRAS[Number(s.slice(0, 8)) % 23] === s[8]
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return LETRAS[Number('XYZ'.indexOf(s[0]) + s.slice(1, 8)) % 23] === s[8]
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    const d = s.slice(1, 8).split('').map(Number)
    let suma = 0
    d.forEach((x, i) => { if (i % 2 === 0) { const y = x * 2; suma += Math.floor(y / 10) + (y % 10) } else suma += x })
    const control = (10 - (suma % 10)) % 10
    const letra = 'JABCDEFGHI'[control]
    if ('PQRSNW'.includes(s[0])) return s[8] === letra
    if ('ABEH'.includes(s[0])) return s[8] === String(control)
    return s[8] === String(control) || s[8] === letra
  }
  return false
}

function validarEntrada(d: Datos190): string[] {
  const f: string[] = []
  if (!Number.isInteger(d.ejercicio) || d.ejercicio < 2025) f.push(`Este diseño es para el 190 del ejercicio 2025 en adelante, no para ${d.ejercicio}.`)
  if (!nifValido(d.nif)) f.push(`El NIF de la empresa («${d.nif}») no es válido.`)
  if (!alfanumerico(d.nombre, 40).trim()) f.push('Falta la razón social.')
  if (!/^\d{13}$/.test(d.numero)) f.push('El número identificativo de la declaración tiene que tener 13 cifras.')
  if (d.tipo && !/^\d{13}$/.test(d.anterior ?? '')) f.push('Una complementaria o sustitutiva lleva el número de la declaración anterior (13 cifras).')
  if (d.contacto.telefono.replace(/\D/g, '').length !== 9) f.push('El teléfono de contacto tiene que tener 9 cifras.')
  if (!alfanumerico(d.contacto.nombre, 40).trim()) f.push('Falta la persona con quien relacionarse.')
  if (d.perceptores.length === 0) f.push('No hay ningún perceptor: un 190 sin percepciones no se presenta.')
  const prov = provinciasDelAnexo()
  d.perceptores.forEach((p, i) => {
    const quien = `${p.nombre || `El perceptor ${i + 1}`}`
    if (!nifValido(p.nif)) f.push(`${quien}: el NIF («${p.nif || 'falta'}») no es válido.`)
    if (!alfanumerico(p.nombre, 40).trim()) f.push(`El perceptor ${i + 1} no tiene nombre.`)
    if (!prov.has(p.provincia)) f.push(`${quien}: la provincia «${p.provincia || 'falta'}» no es un código del anexo.`)
    if (CON_SUBCLAVE.includes(p.clave) && !/^\d{2}$/.test(p.subclave ?? '')) f.push(`${quien}: la clave ${p.clave} lleva subclave de dos cifras.`)
    if (p.integra < 0 || p.retenciones < 0 || (p.gastos ?? 0) < 0) f.push(`${quien}: los importes del 190 son positivos.`)
    if (['A', 'B', 'C'].includes(p.clave) && !(p.anioNacimiento && p.anioNacimiento > 1900 && p.anioNacimiento <= d.ejercicio)) f.push(`${quien}: la clave ${p.clave} lleva el año de nacimiento.`)
  })
  return f
}

// ── La comprobación: releer el fichero contra el diseño ────────────────────
export interface Comprobacion190 {
  ok: boolean
  fallos: string[]
  perceptores: number
  integra: number
  retenciones: number
}

const en = (r: string, pos: { desde: number; hasta: number }) => r.slice(pos.desde - 1, pos.hasta)
// Para los mensajes: céntimos leídos del propio fichero (siempre un número), en euros con dos decimales.
// eslint-disable-next-line no-restricted-syntax
const euros = (cent: string | number) => (Number(cent) / 100).toFixed(2)

function leerCampos(t: Tipo, r: string, n: number, fallos: string[]) {
  const donde = (c: CampoDr190) => `Registro ${n} (tipo ${t}), ${c.desde}-${c.hasta} «${c.nombre.slice(0, 40)}»`
  for (const c of campos(t)) {
    const v = en(r, c)
    if (c.tipo === 'Numérico' && !/^[0-9]+$/.test(v)) fallos.push(`${donde(c)}: solo admite cifras («${v}»).`)
    else if (c.tipo === 'Blancos' && v.trim() !== '') fallos.push(`${donde(c)}: tiene que ir en blanco.`)
    else if (c.tipo === 'Alfabético' && !/^[A-ZÑÇ ]+$/.test(v)) fallos.push(`${donde(c)}: solo admite letras y blancos.`)
    else if (c.tipo === 'Alfanumérico' && !/^[0-9A-ZÑÇ ]+$/.test(v) && !c.nombre.startsWith('CORREO')) fallos.push(`${donde(c)}: solo admite letras, cifras y blancos.`)
  }
  for (const h of DR190.sinDescribir[t]) if (en(r, h).trim() !== '') fallos.push(`Registro ${n}: las posiciones ${h.desde}-${h.hasta}, que el anexo no describe, tienen que ir en blanco.`)
}

/** Relee el fichero: estructura, cada campo contra el diseño y que el registro 1 sume los 2. */
export function comprobar190(fichero: string, d?: Pick<Datos190, 'ejercicio' | 'nif'>): Comprobacion190 {
  const fallos: string[] = []
  const malo = (m: string): Comprobacion190 => ({ ok: false, fallos: [...fallos, m], perceptores: 0, integra: 0, retenciones: 0 })
  if (!fichero.endsWith(SALTO)) return malo('Cada registro acaba en un salto de línea (CRLF), también el último.')
  const regs = fichero.slice(0, -SALTO.length).split(SALTO)
  if (regs.some((r) => r.length !== LONGITUD)) return malo(`Todos los registros miden ${LONGITUD} posiciones: ${regs.map((r, i) => `el ${i + 1} mide ${r.length}`).filter((_, i) => regs[i].length !== LONGITUD).join(', ')}.`)
  if (regs[0]?.[0] !== '1') return malo('El primer registro tiene que ser el del declarante (tipo 1).')
  if (regs.slice(1).some((r) => r[0] !== '2')) return malo('Después del registro 1 solo van registros de perceptor (tipo 2).')
  regs.forEach((r, i) => leerCampos(i === 0 ? '1' : '2', r, i + 1, fallos))

  const r1 = regs[0]
  const c1 = (n: string) => campo('1', n)
  const ejercicio = en(r1, c1('EJERCICIO'))
  const nifDecl = en(r1, c1('NIF DEL DECLARANTE'))
  if (d && ejercicio !== String(d.ejercicio)) fallos.push(`El fichero es del ${ejercicio} y la declaración del ${d.ejercicio}.`)
  if (d && nifDecl !== nif(d.nif)) fallos.push('El NIF del declarante del fichero no es el de la empresa.')
  if (en(r1, c1('MODELO DECLARACIÓN')) !== '190') fallos.push('El registro 1 no es de un 190.')

  let integra = 0
  let retenciones = 0
  const din = campo('2', 'PERCEPCIONES DINERARIAS NO DERIVADAS')
  regs.slice(1).forEach((r, i) => {
    const c2 = (n: string) => campo('2', n)
    if (en(r, c2('EJERCICIO')) !== ejercicio || en(r, c2('NIF DEL DECLARANTE')) !== nifDecl) fallos.push(`Registro ${i + 2}: el ejercicio o el NIF del declarante no son los del registro 1.`)
    if (en(r, c2('MODELO DECLARACIÓN')) !== '190') fallos.push(`Registro ${i + 2}: no es de un 190.`)
    const v = en(r, parte(din, 'PERCEPCIÓN ÍNTEGRA'))
    const w = en(r, parte(din, 'RETENCIONES PRACTICADAS'))
    if (/^\d+$/.test(v)) integra += Number(v)
    if (/^\d+$/.test(w)) retenciones += Number(w)
  })
  const n = Number(en(r1, c1('NÚMERO TOTAL DE PERCEPCIONES')))
  if (n !== regs.length - 1) fallos.push(`El registro 1 dice ${n} percepciones y hay ${regs.length - 1} registros de perceptor.`)
  const imp = c1('IMPORTE TOTAL DE LAS PERCEPCIONES')
  const total = en(r1, parte(imp, 'IMPORTE'))
  if (Number(total) !== integra) fallos.push(`El registro 1 dice ${euros(total)} € de percepciones y los perceptores suman ${euros(integra)} €.`)
  const ret = en(r1, c1('IMPORTE TOTAL DE LAS RETENCIONES'))
  if (Number(ret) !== retenciones) fallos.push(`El registro 1 dice ${euros(ret)} € de retenciones y los perceptores suman ${euros(retenciones)} €.`)
  return { ok: fallos.length === 0, fallos, perceptores: regs.length - 1, integra: integra / 100, retenciones: retenciones / 100 }
}
