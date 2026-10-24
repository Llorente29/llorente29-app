// supabase/functions/_shared/impuestos/dr303.ts
//
// I01a · 5 · EL FICHERO DEL 303 (diseño de registro DR303e26v101 de la AEAT,
// para presentaciones desde el ejercicio 2026) Y SU COMPROBACIÓN.
//
// Núcleo puro: sin red, sin base, sin Deno ni Node. Ni una posición escrita a
// mano: el fichero se construye recorriendo el diseño (dr303e26v101.ts, que
// sale del Excel oficial con scripts/conta/i01/dr303.mjs), y se comprueba
// releyéndolo contra el mismo diseño.
//
// Lo que se genera: la cabecera, la página 01 (identificación y régimen
// general), la 03 (información adicional y resultado) y la DID (cuenta). No
// se generan la 02 (régimen simplificado), la 04 (exonerados del 390, último
// periodo) ni la 05 (prorrata): quien las necesite no presenta desde Sumied
// todavía, y lo dice la comprobación del 303 antes de llegar aquí.
//
// Los importes van en euros con dos decimales: 15 enteros y 2 decimales, sin
// coma, ceros a la izquierda; los campos «N» con una N delante si son
// negativos. Lo alfanumérico, en mayúsculas, solo letras, números y blancos.

import { DR303E26V101, type CampoDr } from './dr303e26v101.ts'

export type TipoDeclaracion = 'C' | 'D' | 'G' | 'I' | 'N' | 'V' | 'U' | 'X'

export interface Datos303 {
  ejercicio: number
  /** '1T'…'4T' o '01'…'12'. */
  periodo: string
  nif: string
  nombre: string
  tipo: TipoDeclaracion
  /** Inscrita en el registro de devolución mensual (REDEME). */
  redeme: boolean
  sii: boolean
  /** Casillas con valor ('01', '27', '110'…). Las que falten van a cero. */
  casillas: Record<string, number>
  /** Para domiciliar (U) o para la devolución (D). ES + 22 cifras. */
  iban?: string | null
  sinActividad?: boolean
  /** Del programa que genera el fichero (Nota 1 de la cabecera). */
  programa: { version: string; nifDesarrollo: string }
}

export class FicheroNoVale extends Error {
  readonly fallos: string[]
  constructor(fallos: string[]) {
    super(fallos.length === 1 ? fallos[0] : `El fichero del 303 no vale: ${fallos.length} cosas no cuadran. ${fallos.slice(0, 3).join(' ')}`)
    this.name = 'FicheroNoVale'
    this.fallos = fallos
  }
}

const H = DR303E26V101.hojas
const ULTIMO = new Set(['4T', '12'])
const MENSUAL_1 = '01'

// ── Formato de cada campo ───────────────────────────────────────────────────
export function alfanumerico(v: string, lon: number): string {
  const limpio = v.normalize('NFD').replace(/Ñ/g, 'Ñ').replace(/ñ/g, 'ñ').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9Ñ ]/g, ' ').replace(/\s+/g, ' ').trim()
  return limpio.slice(0, lon).padEnd(lon, ' ')
}

/** Un importe en céntimos, como pide el campo: Num sin signo, N con N delante si es negativo. */
export function importe(euros: number, lon: number, conSigno: boolean): string {
  const cent = Math.round(euros * 100)
  if (cent < 0 && !conSigno) throw new FicheroNoVale([`Un importe sin signo no puede ser negativo (${euros}).`])
  const cifras = String(Math.abs(cent))
  if (cent < 0) {
    if (cifras.length > lon - 1) throw new FicheroNoVale([`El importe ${euros} no cabe en ${lon} posiciones.`])
    return 'N' + cifras.padStart(lon - 1, '0')
  }
  if (cifras.length > lon) throw new FicheroNoVale([`El importe ${euros} no cabe en ${lon} posiciones.`])
  return cifras.padStart(lon, '0')
}

const esImporte = (c: CampoDr) => c.lon === 17 && (c.tipo === 'Num' || c.tipo === 'N')
const conSigno = (c: CampoDr) => c.tipo === 'N'

/** El valor de un campo que no es una casilla ni una constante: lo que dice la página de cada uno. */
type Relleno = (c: CampoDr) => string | undefined

function pagina(hoja: keyof typeof H, d: Datos303, relleno: Relleno): string {
  const campos = H[hoja].campos as readonly CampoDr[]
  let out = ''
  for (const c of campos) {
    if (c.pos === null || c.lon === null) throw new FicheroNoVale([`El diseño de ${hoja} tiene un campo sin posición (${c.n}).`])
    if (out.length + 1 !== c.pos) throw new FicheroNoVale([`${hoja}: el campo ${c.n} empieza en ${c.pos} y va en ${out.length + 1}.`])
    let v = relleno(c)
    if (v === undefined && c.constante !== null) v = c.constante
    if (v === undefined && c.casilla !== null) {
      if (esImporte(c)) v = importe(d.casillas[c.casilla] ?? 0, c.lon, conSigno(c))
    }
    if (v === undefined && /^Reservado/i.test(c.descripcion)) v = ' '.repeat(c.lon)
    if (v === undefined) throw new FicheroNoVale([`${hoja}: no se sabe qué poner en el campo ${c.n} («${c.descripcion.slice(0, 60)}»).`])
    if (v.length !== c.lon) throw new FicheroNoVale([`${hoja}: el campo ${c.n} mide ${v.length} y tiene que medir ${c.lon}.`])
    out += v
  }
  return out
}

/** Los indicadores de la página 01 (notas 3 a 9 del diseño), para el régimen general sin prorrata ni foral. */
function indicadores01(d: Datos303): Record<number, string> {
  const ultimo = ULTIMO.has(d.periodo)
  return {
    11: '2', // no tributa exclusivamente a una Administración foral
    12: d.redeme ? '1' : '2',
    13: '3', // solo régimen general
    14: '2', // no es autoliquidación conjunta
    15: '2', // sin criterio de caja (lo comprueba el 303 antes)
    16: '2', // no se declara destinataria de operaciones con criterio de caja
    17: ultimo ? '2' : ' ', // prorrata especial: blanco salvo en el último periodo (Nota 6)
    18: ultimo ? '2' : ' ',
    19: '2', // sin concurso de acreedores
    20: ' '.repeat(8),
    21: ' ',
    22: d.sii ? '1' : '2',
    23: ultimo ? '2' : '0', // no exonerada del 390 (Nota 4): la 04 no se genera
    24: '0', // Nota 3: «0» para los no exonerados también en el último periodo
    25: ['1T', '2T', '3T', '4T', MENSUAL_1].includes(d.periodo) ? '0' : '2', // Notas 8 y 9
  }
}

/** El fichero entero, listo para F01 de PresBasicaDos. Lanza FicheroNoVale si algo no cabe o no casa. */
export function generar303(d: Datos303): string {
  const fallosEntrada = validarEntrada(d)
  if (fallosEntrada.length) throw new FicheroNoVale(fallosEntrada)
  const eeee = String(d.ejercicio)
  const ind = indicadores01(d)

  const p01 = pagina('DP30301', d, (c) => {
    switch (c.n) {
      case 5: return ' '
      case 6: return d.tipo
      case 7: return alfanumerico(d.nif, 9)
      case 8: return alfanumerico(d.nombre, 80)
      case 9: return eeee
      case 10: return d.periodo
      default: return ind[c.n]
    }
  })
  const p03 = pagina('DP30303', d, (c) => {
    if (c.casilla === '65') return importe(d.casillas['65'] ?? 100, c.lon as number, false)
    switch (c.n) {
      case 30: return d.sinActividad ? 'X' : ' '
      case 31: return ' '
      case 32: return ' '.repeat(13)
      case 33: return ' '
      case 35: return ' '
      case 36: return ' '
      default: return undefined
    }
  })
  const iban = (d.iban ?? '').replace(/\s+/g, '').toUpperCase()
  const devolucion = d.tipo === 'D' || d.tipo === 'X'
  const did = pagina('DP303DID', d, (c) => {
    switch (c.n) {
      case 5: return ' '.repeat(11)
      case 6: return (d.tipo === 'U' || devolucion ? iban : '').padEnd(34, ' ')
      case 7: return ' '.repeat(70)
      case 8: return ' '.repeat(35)
      case 9: return ' '.repeat(30)
      case 10: return ' '.repeat(2)
      case 11: return devolucion ? '1' : '0'
      default: return undefined
    }
  })

  const contenido = p01 + p03 + did
  let cab = ''
  for (const c of H.DP30300.campos as readonly CampoDr[]) {
    switch (c.n) {
      case 4: cab += eeee; break
      case 5: cab += d.periodo; break
      case 9: cab += alfanumerico(d.programa.version, 4); break
      case 11: cab += alfanumerico(d.programa.nifDesarrollo, 9); break
      case 14: cab += contenido; break
      case 15: cab += `</T3030${eeee}${d.periodo}0000>`; break
      default:
        if (c.constante !== null) cab += c.constante
        else if (/Reservado/i.test(c.descripcion) && c.lon) cab += ' '.repeat(c.lon)
        else throw new FicheroNoVale([`Cabecera: no se sabe qué poner en el campo ${c.n}.`])
    }
  }
  const r = comprobar303(cab, d)
  if (!r.ok) throw new FicheroNoVale(r.fallos)
  return cab
}

function validarEntrada(d: Datos303): string[] {
  const f: string[] = []
  if (!Number.isInteger(d.ejercicio) || d.ejercicio < 2026) f.push(`Este diseño de registro es para el ejercicio 2026 en adelante, no para ${d.ejercicio}.`)
  if (!/^([1-4]T|0[1-9]|1[0-2])$/.test(d.periodo)) f.push(`El periodo «${d.periodo}» no es de un 303.`)
  if (!/^[0-9A-Z]{9}$/.test(alfanumerico(d.nif, 9).trim())) f.push('El NIF de la empresa tiene que tener 9 letras o cifras.')
  if (!alfanumerico(d.nombre, 80).trim()) f.push('Falta la razón social.')
  if (!/^[0-9A-Z]{9}$/.test(alfanumerico(d.programa.nifDesarrollo, 9).trim())) f.push('Falta el NIF de la empresa que hace el programa (Nota 1 de la cabecera).')
  const iban = (d.iban ?? '').replace(/\s+/g, '').toUpperCase()
  if ((d.tipo === 'U' || d.tipo === 'D') && !/^ES\d{22}$/.test(iban)) f.push(d.tipo === 'U' ? 'Para domiciliar hace falta la cuenta (IBAN español).' : 'Para la devolución hace falta la cuenta (IBAN español).')
  return f
}

// ── La comprobación: releer el fichero contra el diseño ────────────────────
export interface Comprobacion { ok: boolean; fallos: string[]; casillas: Record<string, number> }

function leerPagina(hoja: keyof typeof H, texto: string, fallos: string[], casillas: Record<string, number>) {
  const total = H[hoja].total as number
  if (texto.length !== total) { fallos.push(`${hoja}: mide ${texto.length} y tiene que medir ${total}.`); return }
  for (const c of H[hoja].campos as readonly CampoDr[]) {
    const v = texto.slice((c.pos as number) - 1, (c.pos as number) - 1 + (c.lon as number))
    const donde = `${hoja} campo ${c.n}${c.casilla ? ` [${c.casilla}]` : ''}`
    if (c.constante !== null && v !== c.constante) fallos.push(`${donde}: tiene «${v}» y tiene que ser «${c.constante}».`)
    else if (c.tipo === 'Num' && !/^[0-9]+$/.test(v) && !(v.trim() === '' && c.casilla === null)) fallos.push(`${donde}: solo admite cifras («${v}»).`)
    else if (c.tipo === 'N' && !/^N?[0-9]+$/.test(v)) fallos.push(`${donde}: solo admite cifras y una N delante («${v}»).`)
    else if ((c.tipo === 'An' || c.tipo === 'A') && !/^[0-9A-ZÑ <>/]*$/.test(v)) fallos.push(`${donde}: solo admite letras, cifras y blancos.`)
    if (c.casilla !== null && esImporte(c) && /^N?[0-9]+$/.test(v)) {
      casillas[c.casilla] = (v.startsWith('N') ? -1 : 1) * Number(v.replace('N', '')) / 100
    }
    if (c.casilla === '65' && /^[0-9]+$/.test(v)) casillas['65'] = Number(v) / 100
  }
}

// Para los mensajes: un cálculo local que siempre es un número (la casilla leída o 0).
// eslint-disable-next-line no-restricted-syntax
const dos = (n: number) => n.toFixed(2)

const suma = (c: Record<string, number>, k: string[]) => Math.round(k.reduce((s, x) => s + (c[x] ?? 0), 0) * 100) / 100

/** Relee el fichero: estructura, cada campo contra el diseño y las sumas de la AEAT. */
export function comprobar303(fichero: string, d?: Pick<Datos303, 'ejercicio' | 'periodo' | 'tipo'>): Comprobacion {
  const fallos: string[] = []
  const casillas: Record<string, number> = {}
  if (/[\r\n\t]/.test(fichero)) fallos.push('El fichero no puede llevar saltos de línea ni tabuladores (PresBasicaDos, F01).')
  const m = fichero.match(/^<T3030(\d{4})([0-9T]{2})0000><AUX>([\s\S]{300})<\/AUX>([\s\S]*)<\/T3030\1(?:\2)0000>$/)
  if (!m) return { ok: false, fallos: [...fallos, 'La cabecera o el cierre del fichero no son los del diseño (<T3030EEEEPP0000> … </T3030EEEEPP0000>).'], casillas }
  if (d && (m[1] !== String(d.ejercicio) || m[2] !== d.periodo)) fallos.push(`El fichero es del ${m[2]}/${m[1]} y la declaración del ${d.periodo}/${d.ejercicio}.`)
  const cuerpo = m[4]
  const p01 = cuerpo.match(/<T30301000>[\s\S]*?<\/T30301000>/)?.[0]
  const p03 = cuerpo.match(/<T30303000>[\s\S]*?<\/T30303000>/)?.[0]
  const did = cuerpo.match(/<T303DID00>[\s\S]*?<\/T303DID00>/)?.[0]
  if (!p01) fallos.push('Falta la página 01.')
  else leerPagina('DP30301', p01, fallos, casillas)
  if (!p03) fallos.push('Falta la página 03.')
  else leerPagina('DP30303', p03, fallos, casillas)
  if (!did) fallos.push('Falta la página DID.')
  else leerPagina('DP303DID', did, fallos, casillas)
  if ((p01?.length ?? 0) + (p03?.length ?? 0) + (did?.length ?? 0) !== cuerpo.length) fallos.push('El fichero lleva algo más que las páginas 01, 03 y DID.')

  if (p01 && p03) {
    const c = casillas
    const debe = (casilla: string, valor: number, como: string) => {
      if (Math.abs((c[casilla] ?? 0) - valor) > 0.004) fallos.push(`La casilla [${casilla}] dice ${dos(c[casilla] ?? 0)} y ${como} da ${dos(valor)}.`)
    }
    debe('27', suma(c, ['152', '167', '03', '155', '06', '09', '11', '13', '15', '158', '170', '18', '21', '24', '26']), 'la suma del IVA devengado')
    debe('45', suma(c, ['29', '31', '33', '35', '37', '39', '41', '42', '43', '44']), 'la suma del IVA deducible')
    debe('46', suma(c, ['27']) - suma(c, ['45']), '[27] − [45]')
    debe('64', suma(c, ['46', '58', '76']), '[46] + [58] + [76]')
    debe('66', Math.round((c['64'] ?? 0) * (c['65'] ?? 0)) / 100, '[64] × [65] %')
    debe('87', suma(c, ['110']) - suma(c, ['78']), '[110] − [78]')
    debe('69', suma(c, ['66', '77', '68', '108']) - suma(c, ['78']), '[66] + [77] − [78] + [68] + [108]')
    debe('71', suma(c, ['69', '109']) - suma(c, ['70', '112']), '[69] − [70] + [109] − [112]')
    const tipo = d?.tipo ?? p01.slice(12, 13)
    const r = c['71'] ?? 0
    if (r > 0 && !['I', 'U', 'G'].includes(tipo)) fallos.push(`Sale a ingresar (${dos(r)}) y el tipo de declaración es «${tipo}».`)
    if (r < 0 && !['C', 'D', 'V', 'X'].includes(tipo)) fallos.push(`Sale a compensar o devolver (${dos(r)}) y el tipo de declaración es «${tipo}».`)
    if (r === 0 && tipo !== 'N') fallos.push(`Sale cero y el tipo de declaración es «${tipo}», no «N».`)
    if (tipo === 'D' && !ULTIMO.has(m[2]) && p01.slice(109, 110) !== '1') fallos.push('Solo se pide la devolución en el último periodo, salvo en el registro de devolución mensual.')
  }
  return { ok: fallos.length === 0, fallos, casillas }
}
