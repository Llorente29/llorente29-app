#!/usr/bin/env node
// scripts/conta/s02/dr180.mjs
//
// S02 · EL DISEÑO DE REGISTRO DEL 180, sacado del texto oficial del BOE y nunca
// escrito a mano: el anexo VI de la Orden de 21 de noviembre de 2000
// (BOE-A-2000-21430), en su versión vigente desde el 01/12/2023 (Orden
// HFP/1284/2023, BOE-A-2023-24412), que el propio texto dice «aplicable, por
// primera vez, a las declaraciones informativas correspondientes al ejercicio
// 2023».
//
// Por qué del XML y no de docs/conta/fuentes/textos/orden-modelo-180.txt: en
// este anexo las celdas de la tabla no llevan párrafos, y fuentes.mjs solo
// guarda los párrafos: el texto se quedó sin posiciones ni nombres de campo.
// El bloque del BOE se guarda tal cual en docs/conta/fuentes/boe/ con su huella.
//
// De cada tipo de registro (1, declarante; 2, perceptor) se leen, en orden,
// los campos de su tabla: posiciones, naturaleza, nombre y descripción, y sus
// partes («59-67 TELÉFONO…», «135-139 TIPO DE VÍA.»). Se comprueba que los
// campos cubren las 500 posiciones sin pisarse. La tabla de provincias va
// dentro del campo «CÓDIGO PROVINCIA» de los perceptores.
//
// Escribe:
//   · docs/conta/referencia/dr180.json — el diseño, con la huella del bloque;
//   · supabase/functions/_shared/impuestos/dr180.ts — el mismo diseño, para el
//     generador (Deno, el navegador y las pruebas).
//
//   node scripts/conta/s02/dr180.mjs            → genera los dos
//   node scripts/conta/s02/dr180.mjs comprobar  → sin escribir: falla si no son los que salen del bloque

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

export const FUENTE = 'docs/conta/fuentes/boe/orden-modelo-180-anexo-vi.xml'
export const REFERENCIA = 'docs/conta/referencia/dr180.json'
export const MODULO = 'supabase/functions/_shared/impuestos/dr180.ts'
export const VERSION = 'BOE-A-2023-24412'
export const LONGITUD = 500

const RANGO = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/
const PARTE = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s+(\S.*)$/

function entidades(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}
const limpio = (s) => entidades(s).replace(/\s+/g, ' ').trim()

/** La versión vigente del anexo: la última `<version>` del bloque, que tiene que ser la esperada. */
export function versionVigente(xml) {
  const i = xml.lastIndexOf('<version ')
  if (i < 0) throw new Error(`No hay ninguna versión en ${FUENTE}.`)
  const v = xml.slice(i)
  const id = (v.match(/id_norma="([^"]+)"/) ?? [])[1]
  if (id !== VERSION) throw new Error(`La versión vigente del anexo VI es «${id}», no «${VERSION}»: el diseño ha cambiado.`)
  return v
}

/**
 * Las tablas de primer nivel, con sus filas y celdas. Cada celda guarda sus
 * párrafos (texto de cada `<p>`, o el texto suelto si no lleva) y las tablas
 * anidadas que tenga dentro.
 */
export function tablas(xml) {
  const re = /<(\/?)(table|tr|td|th|p)\b[^>]*>|([^<]+)|<[^>]+>/g
  const pila = []
  const fuera = []
  let m
  let enP = null
  while ((m = re.exec(xml)) !== null) {
    const [, cierra, tag, texto] = m
    const t = pila[pila.length - 1]
    const celda = t?.filas.at(-1)?.at(-1)
    if (tag === 'table') {
      if (!cierra) pila.push({ filas: [] })
      else {
        const hecha = pila.pop()
        if (pila.length === 0) fuera.push(hecha)
        else pila[pila.length - 1].filas.at(-1)?.at(-1)?.tablas.push(hecha)
      }
    } else if (tag === 'tr' && !cierra && t) t.filas.push([])
    else if ((tag === 'td' || tag === 'th') && !cierra && t) t.filas.at(-1)?.push({ parrafos: [], suelto: '', tablas: [] })
    else if (tag === 'p' && celda) {
      if (!cierra) enP = ''
      else { if (limpio(enP ?? '')) celda.parrafos.push(limpio(enP)); enP = null }
    } else if (texto !== undefined && celda) {
      if (enP !== null) enP += texto
      else celda.suelto += texto
    }
  }
  const lineas = (c) => [...(limpio(c.suelto) ? [limpio(c.suelto)] : []), ...c.parrafos]
  return fuera.map((tb) => tb.filas.map((f) => f.map((c) => ({ lineas: lineas(c), tablas: c.tablas }))))
}

const NATURALEZA = { 'Numérico.': 'Numérico', 'Alfanumérico.': 'Alfanumérico', 'Alfabético.': 'Alfabético' }
const rango = (a, b) => ({ desde: Number(a), hasta: Number(b ?? a) })

/** Los campos de una tabla de registro: una fila con posiciones abre un campo; las siguientes sin posiciones lo describen. */
export function campos(filas) {
  const out = []
  let actual = null
  for (const f of filas) {
    if (f.length < 3) continue
    const pos = f[0].lineas.join(' ')
    const m = pos.match(RANGO)
    if (m) {
      const nat = f[1].lineas.join(' ')
      const tipo = NATURALEZA[nat] ?? (/^-+$/.test(nat) ? 'Blancos' : null)
      if (!tipo) throw new Error(`El campo ${pos} tiene una naturaleza que no se conoce: «${nat}».`)
      actual = { ...rango(m[1], m[2]), tipo, nombre: f[2].lineas.join(' ').replace(/\.$/, ''), descripcion: [], partes: [], tablas: [] }
      out.push(actual)
      continue
    }
    if (!actual) continue
    for (const l of f[2].lineas) {
      const p = l.match(PARTE)
      if (p) {
        const r = rango(p[1], p[2])
        if (r.desde >= actual.desde && r.hasta <= actual.hasta && r.hasta >= r.desde) { actual.partes.push({ ...r, texto: p[3] }); continue }
      }
      actual.descripcion.push(l)
    }
    actual.tablas.push(...f[2].tablas)
  }
  return out
}

/** Lo que cubren los campos: huecos y lo que se pisa. */
export function cobertura(cs, longitud = LONGITUD) {
  const usada = new Array(longitud + 1).fill(0)
  const pisan = []
  for (const c of cs) for (let p = c.desde; p <= c.hasta; p++) { if (usada[p]) pisan.push(p); usada[p] = 1 }
  const huecos = []
  for (let p = 1; p <= longitud; p++) {
    if (usada[p]) continue
    const ult = huecos.at(-1)
    if (ult && ult.hasta === p - 1) ult.hasta = p
    else huecos.push({ desde: p, hasta: p })
  }
  return { huecos, pisan: [...new Set(pisan)] }
}

/** Las provincias de la tabla anidada del campo «CÓDIGO PROVINCIA»: pares nombre / dos cifras, en las dos mitades de cada fila. */
export function provincias(campo) {
  const pares = []
  for (const t of campo.tablas) {
    for (const f of t.filas) {
      const celdas = f.map((c) => [...(limpio(c.suelto) ? [limpio(c.suelto)] : []), ...c.parrafos].join(' '))
      for (let i = 0; i + 1 < celdas.length; i += 2) {
        const nombre = celdas[i]
        const codigo = celdas[i + 1]
        if (nombre && /^\d{2}$/.test(codigo)) pares.push({ codigo, nombre: nombre.replace(/\.$/, '') })
      }
    }
  }
  return pares.sort((a, b) => a.codigo.localeCompare(b.codigo))
}

export function leer(xml) {
  const v = versionVigente(xml)
  const ts = tablas(v).filter((t) => t[0]?.[0]?.lineas.join(' ') === 'Posiciones')
  if (ts.length !== 2) throw new Error(`El anexo VI vigente tiene ${ts.length} tablas de registro, y se esperan 2 (declarante y perceptor).`)
  const registros = {}
  let provs = []
  ts.forEach((filas, i) => {
    const tipo = String(i + 1)
    const cs = campos(filas)
    const c = cobertura(cs)
    if (c.pisan.length) throw new Error(`Registro ${tipo}: hay campos que se pisan en ${c.pisan.slice(0, 10).join(', ')}.`)
    if (c.huecos.length) throw new Error(`Registro ${tipo}: hay posiciones sin campo: ${c.huecos.map((h) => `${h.desde}-${h.hasta}`).join(', ')}.`)
    const constante = (n) => cs.find((x) => x.nombre === n)?.descripcion.join(' ')
    if (!new RegExp(`Constante «${tipo}»`).test(constante('TIPO DE REGISTRO') ?? '')) throw new Error(`La tabla ${i + 1} no es la del registro de tipo ${tipo}.`)
    if (tipo === '2') provs = provincias(cs.find((x) => x.nombre === 'CÓDIGO PROVINCIA') ?? { tablas: [] })
    registros[tipo] = cs.map(({ tablas: _t, ...x }) => ({ ...x, lon: x.hasta - x.desde + 1, descripcion: x.descripcion.join('\n') }))
  })
  return {
    fuente: FUENTE,
    boe: VERSION,
    norma: 'Orden de 21 de noviembre de 2000, anexo VI (modificado por la Orden HFP/1284/2023, de 28 de noviembre)',
    vigenteDesde: '2023-12-01',
    aplicaDesde: 'Modelo 180 del ejercicio 2023 y siguientes (lo dice el propio texto)',
    sha256: createHash('sha256').update(v).digest('hex'),
    longitud: LONGITUD,
    registros,
    provincias: provs,
  }
}

export function moduloTs(ref) {
  return `// ${MODULO}
//
// NO SE TOCA A MANO: lo escribe scripts/conta/s02/dr180.mjs desde
// ${REFERENCIA} (y este, del ${ref.norma},
// ${ref.boe}, vigente desde ${ref.vigenteDesde}, en ${ref.fuente};
// sha256 de la versión vigente ${ref.sha256}).

export interface ParteDr180 { desde: number; hasta: number; texto: string }
export interface CampoDr180 { desde: number; hasta: number; lon: number; tipo: string; nombre: string; descripcion: string; partes: ParteDr180[] }
export interface ProvinciaDr180 { codigo: string; nombre: string }

export const DR180 = ${JSON.stringify({ boe: ref.boe, vigenteDesde: ref.vigenteDesde, sha256: ref.sha256, longitud: ref.longitud, registros: ref.registros, provincias: ref.provincias }, null, 2)} as const satisfies {
  boe: string; vigenteDesde: string; sha256: string; longitud: number
  registros: Record<'1' | '2', readonly CampoDr180[]>
  provincias: readonly ProvinciaDr180[]
}
`
}

const esPrincipal = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (esPrincipal) {
  const ref = leer(readFileSync(FUENTE, 'utf8'))
  const json = JSON.stringify(ref, null, 2) + '\n'
  const ts = moduloTs(ref)
  if (process.argv[2] === 'comprobar') {
    const malos = [[REFERENCIA, json], [MODULO, ts]].filter(([f, c]) => { try { return readFileSync(f, 'utf8') !== c } catch { return true } }).map(([f]) => f)
    if (malos.length) { console.error(`No son los que salen del anexo: ${malos.join(', ')}. Ejecuta node scripts/conta/s02/dr180.mjs.`); process.exit(1) }
    console.log('El diseño del 180 es el que sale del anexo VI del BOE.')
  } else {
    writeFileSync(REFERENCIA, json)
    writeFileSync(MODULO, ts)
    console.log(`Escritos ${REFERENCIA} y ${MODULO}: registro 1, ${ref.registros['1'].length} campos; registro 2, ${ref.registros['2'].length}; ${ref.provincias.length} provincias.`)
  }
}
