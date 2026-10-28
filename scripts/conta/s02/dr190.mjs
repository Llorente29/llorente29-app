#!/usr/bin/env node
// scripts/conta/s02/dr190.mjs
//
// S02 · EL DISEÑO DE REGISTRO DEL 190, sacado del texto oficial del BOE que
// guarda el repositorio y nunca escrito a mano: la Orden EHA/3127/2009,
// consolidada (docs/conta/fuentes/textos/orden-modelo-190.txt), en su «Anexo»
// vigente desde el 13/12/2025 (Orden HAC/1431/2025, BOE-A-2025-25390), que el
// propio texto dice «aplicable por primera vez para la presentación del modelo
// 190 correspondiente al ejercicio 2025 y siguientes».
//
// De cada tipo de registro (1, declarante; 2, perceptor) se leen, en orden,
// los campos: posiciones, naturaleza, nombre y descripción, y sus partes
// («82-94 PERCEPCIÓN ÍNTEGRA…», «82-92 Parte entera…»). Se comprueba que los
// campos cubren las 500 posiciones sin pisarse; lo que el texto no describe se
// apunta en «sinDescribir» y va en blanco (no se inventa).
//
// Escribe:
//   · docs/conta/referencia/dr190.json — el diseño, con la huella del texto
//     del que sale;
//   · supabase/functions/_shared/impuestos/dr190.ts — el mismo diseño, para el
//     generador (Deno, el navegador y las pruebas).
//
//   node scripts/conta/s02/dr190.mjs            → genera los dos
//   node scripts/conta/s02/dr190.mjs comprobar  → sin escribir: falla si no son los que salen del texto

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

export const TEXTO = 'docs/conta/fuentes/textos/orden-modelo-190.txt'
export const REFERENCIA = 'docs/conta/referencia/dr190.json'
export const MODULO = 'supabase/functions/_shared/impuestos/dr190.ts'
export const SECCION = '## [an]'
export const VERSION = '### versión · vigente desde 2025-12-13 · BOE-A-2025-25390'
export const LONGITUD = 500

const NATURALEZA = new Set(['Numérico', 'Alfanumérico', 'Alfabético'])
const RANGO = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/
const RANGO_EN_LINEA = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s+(.+)$/

/** El trozo del texto con el anexo vigente: de su cabecera de versión hasta la siguiente sección. */
export function anexo(texto) {
  const lineas = texto.split('\n')
  const i = lineas.findIndex((l) => l.trim() === SECCION)
  if (i < 0) throw new Error(`No está la sección «${SECCION}» en ${TEXTO}.`)
  const fin = lineas.findIndex((l, k) => k > i && /^## /.test(l))
  const trozo = lineas.slice(i, fin < 0 ? undefined : fin)
  if (!trozo.some((l) => l.trim() === VERSION)) throw new Error(`La sección «${SECCION}» no es la versión «${VERSION}».`)
  return trozo
}

const rango = (a, b) => ({ desde: Number(a), hasta: Number(b ?? a) })

/** Los campos de un tipo de registro, de su título hasta el siguiente título (o el final). */
export function camposDe(lineas, tipo) {
  const ini = lineas.findIndex((l) => new RegExp(`^[AB]\\. TIPO DE REGISTRO ${tipo}\\b`).test(l.trim()))
  if (ini < 0) throw new Error(`No está el tipo de registro ${tipo}.`)
  const fin = lineas.findIndex((l, k) => k > ini && /^[AB]\. TIPO DE REGISTRO \d/.test(l.trim()))
  const ls = lineas.slice(ini + 1, fin < 0 ? undefined : fin).map((l) => l.trim())
  const campos = []
  let actual = null
  for (let k = 0; k < ls.length; k++) {
    const l = ls[k]
    const m = l.match(RANGO)
    // Un campo: «posiciones» y, en la línea siguiente, su naturaleza («Numérico»…) o «–» (blancos).
    if (m && (NATURALEZA.has(ls[k + 1]) || ls[k + 1] === '–')) {
      const blanco = ls[k + 1] === '–'
      const nombre = blanco ? (ls[k + 2] ?? 'BLANCOS') : (ls[k + 2] ?? '')
      actual = { ...rango(m[1], m[2]), tipo: blanco ? 'Blancos' : ls[k + 1], nombre: nombre.replace(/[.:]$/, ''), descripcion: [], partes: [] }
      campos.push(actual)
      k += 2
      continue
    }
    if (!actual) continue
    // Una parte en línea: «82-94 PERCEPCIÓN ÍNTEGRA (Dineraria): …» dentro de las posiciones del campo.
    const p = l.match(RANGO_EN_LINEA)
    if (p) {
      const r = rango(p[1], p[2])
      if (r.desde >= actual.desde && r.hasta <= actual.hasta && r.hasta >= r.desde) { actual.partes.push({ ...r, texto: p[3] }); continue }
    }
    // Una parte en su propia línea («59-67», y en la siguiente «TELÉFONO: …»).
    if (m) {
      const r = rango(m[1], m[2])
      if (r.desde >= actual.desde && r.hasta <= actual.hasta && r.hasta >= r.desde && ls[k + 1] && !RANGO.test(ls[k + 1])) {
        actual.partes.push({ ...r, texto: ls[k + 1] }); k += 1; continue
      }
    }
    actual.descripcion.push(l)
  }
  return campos.map((c) => ({ ...c, lon: c.hasta - c.desde + 1, descripcion: c.descripcion.join('\n') }))
}

/** Lo que cubren los campos: huecos (sin describir) y lo que se pisa. */
export function cobertura(campos, longitud = LONGITUD) {
  const usada = new Array(longitud + 1).fill(0)
  const pisan = []
  for (const c of campos) for (let p = c.desde; p <= c.hasta; p++) { if (usada[p]) pisan.push(p); usada[p] = 1 }
  const huecos = []
  for (let p = 1; p <= longitud; p++) {
    if (usada[p]) continue
    const ult = huecos[huecos.length - 1]
    if (ult && ult.hasta === p - 1) ult.hasta = p
    else huecos.push({ desde: p, hasta: p })
  }
  return { huecos, pisan: [...new Set(pisan)] }
}

/** Pares «PROVINCIA / código» de una tabla del anexo (un nombre y, en la línea siguiente, sus dos cifras). */
export function paresDeProvincias(lineas) {
  const ini = lineas.findIndex((l) => l.trim() === 'CÓDIGO PROVINCIA.')
  if (ini < 0) return []
  const pares = []
  for (let k = ini + 1; k < lineas.length - 1; k++) {
    const l = lineas[k].trim()
    if (/^b\) Supuesto especial/.test(l)) break
    const sig = lineas[k + 1].trim()
    if (/^\d{2}$/.test(sig) && !/^\d/.test(l) && l.length < 60) { pares.push({ codigo: sig, nombre: l.replace(/\.$/, '') }); k++ }
  }
  return pares
}

/** Las versiones del anexo II anterior (`## [anii]`), de la más nueva a la más vieja. */
function versionesAnteriores(texto) {
  const lineas = texto.split('\n')
  const i = lineas.findIndex((l) => l.trim() === '## [anii]')
  if (i < 0) return []
  const fin = lineas.findIndex((l, k) => k > i && /^## /.test(l))
  const trozo = lineas.slice(i + 1, fin < 0 ? undefined : fin)
  const out = []
  let actual = null
  for (const l of trozo) {
    if (/^### versión/.test(l)) { actual = { cabecera: l.trim(), lineas: [] }; out.push(actual) } else if (actual) actual.lineas.push(l)
  }
  return out.reverse()
}

/**
 * La tabla de provincias: la del anexo vigente. Si a esa tabla le falta alguna
 * provincia que sí trae la última versión anterior completa del mismo texto
 * (el consolidado del BOE perdió «JAÉN 23» desde 2023), se toma de ahí y se
 * dice de qué versión sale. Lo especial (98) lo dice el propio campo.
 */
export function provincias(texto, lineasVigente) {
  const vigente = paresDeProvincias(lineasVigente).map((p) => ({ ...p, fuente: VERSION.replace('### ', '') }))
  const tiene = new Set(vigente.map((p) => p.codigo))
  for (const v of versionesAnteriores(texto)) {
    const faltan = paresDeProvincias(v.lineas).filter((p) => !tiene.has(p.codigo))
    if (faltan.length === 0) continue
    for (const p of faltan) { vigente.push({ ...p, fuente: `${v.cabecera.replace('### ', '')} (anexo II anterior: falta en la tabla vigente)` }); tiene.add(p.codigo) }
    break
  }
  const especial = lineasVigente.some((l) => /se consignarán como código de provincia los dígitos 98/.test(l))
  if (especial) vigente.push({ codigo: '98', nombre: 'RESIDENTES EN EL EXTRANJERO (artículos 8.2 y 10 de la Ley)', fuente: VERSION.replace('### ', '') })
  return vigente.sort((a, b) => a.codigo.localeCompare(b.codigo))
}

export function leer(texto) {
  const lineas = anexo(texto)
  const registros = {}
  const sinDescribir = {}
  for (const tipo of ['1', '2']) {
    const campos = camposDe(lineas, tipo)
    const c = cobertura(campos)
    if (c.pisan.length) throw new Error(`Registro ${tipo}: hay campos que se pisan en ${c.pisan.slice(0, 10).join(', ')}.`)
    registros[tipo] = campos
    sinDescribir[tipo] = c.huecos
  }
  return {
    fuente: TEXTO,
    boe: 'BOE-A-2025-25390',
    norma: 'Orden EHA/3127/2009 (anexo modificado por la Orden HAC/1431/2025, de 3 de diciembre)',
    vigenteDesde: '2025-12-13',
    aplicaDesde: 'Modelo 190 del ejercicio 2025 y siguientes (lo dice el propio texto)',
    sha256: createHash('sha256').update(lineas.join('\n')).digest('hex'),
    longitud: LONGITUD,
    registros,
    sinDescribir,
    provincias: provincias(texto, lineas),
  }
}

export function moduloTs(ref) {
  return `// ${MODULO}
//
// NO SE TOCA A MANO: lo escribe scripts/conta/s02/dr190.mjs desde
// ${REFERENCIA} (y este, del anexo de la ${ref.norma},
// ${ref.boe}, vigente desde ${ref.vigenteDesde}, en ${ref.fuente};
// sha256 del anexo ${ref.sha256}).

export interface ParteDr190 { desde: number; hasta: number; texto: string }
export interface CampoDr190 { desde: number; hasta: number; lon: number; tipo: string; nombre: string; descripcion: string; partes: ParteDr190[] }
export interface ProvinciaDr190 { codigo: string; nombre: string; fuente: string }

export const DR190 = ${JSON.stringify({ boe: ref.boe, vigenteDesde: ref.vigenteDesde, sha256: ref.sha256, longitud: ref.longitud, registros: ref.registros, sinDescribir: ref.sinDescribir, provincias: ref.provincias }, null, 2)} as const satisfies {
  boe: string; vigenteDesde: string; sha256: string; longitud: number
  registros: Record<'1' | '2', readonly CampoDr190[]>; sinDescribir: Record<'1' | '2', readonly { desde: number; hasta: number }[]>
  provincias: readonly ProvinciaDr190[]
}
`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ref = leer(readFileSync(TEXTO, 'utf8'))
  const json = JSON.stringify(ref, null, 2) + '\n'
  const ts = moduloTs(ref)
  if (process.argv[2] === 'comprobar') {
    const malos = [[REFERENCIA, json], [MODULO, ts]].filter(([f, t]) => { try { return readFileSync(f, 'utf8') !== t } catch { return true } }).map(([f]) => f)
    if (malos.length) { console.error(`No son los que salen de ${TEXTO}: ${malos.join(', ')}. Vuelve a generar con node scripts/conta/s02/dr190.mjs.`); process.exit(1) }
    console.log(`${REFERENCIA} y ${MODULO} salen de ${TEXTO}.`)
  } else {
    writeFileSync(REFERENCIA, json)
    writeFileSync(MODULO, ts)
    for (const t of ['1', '2']) {
      console.log(`Registro ${t}: ${ref.registros[t].length} campos; sin describir: ${ref.sinDescribir[t].map((h) => `${h.desde}-${h.hasta}`).join(', ') || 'nada'}.`)
    }
    const fuera = ref.provincias.filter((p) => !p.fuente.startsWith('versión · vigente desde 2025'))
    console.log(`Provincias: ${ref.provincias.length}${fuera.length ? `; de una versión anterior: ${fuera.map((p) => `${p.nombre} ${p.codigo} (${p.fuente})`).join(', ')}` : ''}.`)
  }
}
