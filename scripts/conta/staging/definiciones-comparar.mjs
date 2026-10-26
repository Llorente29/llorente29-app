#!/usr/bin/env node
// scripts/conta/staging/definiciones-comparar.mjs
//
// W06 (26/10) · Compara dos fotos de definiciones (foto-definiciones.sql, en
// CSV «clave,valor») y saca SOLO lo que cambia, en Markdown. La foto es de la
// base entera (unas 16.000 filas en staging): lo que sale igual a los dos
// lados no se enseña, se cuenta.
//
//   definiciones-comparar.mjs <antes.csv> <después.csv> [etiqueta-antes] [etiqueta-después]
//       → la tabla de lo que no vuelve; sale con 1 si algo cambia.
//   definiciones-comparar.mjs toca <antes.csv> <con-la-tanda.csv>
//       → lo que la tanda toca (solo para enseñarlo; sale con 0).
//   definiciones-comparar.mjs delta <antes.csv> <después.csv>
//       → «clave,valor-de-antes» de lo que cambia (vacío si no existía), en
//         CSV: lo que guarda el registro de staging cuando algo va de verdad.
//   definiciones-comparar.mjs registro <foto.csv> <registro.csv>
//       → compara la foto con lo que el registro dice que había antes; sale
//         con 1 si algo no ha vuelto a como estaba.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** CSV de psql (--csv): comillas dobles, «""» dentro, saltos de línea dentro de comillas. */
export function leerCsv(texto) {
  const filas = []
  let fila = []
  let campo = ''
  let entre = false
  let citado = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (entre) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else entre = false
      } else campo += c
    } else if (c === '"') { entre = true; citado = true }
    else if (c === ',') { fila.push(citado || campo !== '' ? campo : null); campo = ''; citado = false }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      fila.push(citado || campo !== '' ? campo : null); campo = ''; citado = false
      if (fila.length > 1 || fila[0] !== null) filas.push(fila)
      fila = []
    } else campo += c
  }
  if (campo !== '' || citado || fila.length) {
    fila.push(citado || campo !== '' ? campo : null)
    if (fila.length > 1 || fila[0] !== null) filas.push(fila)
  }
  return filas
}

/** Foto → Map(clave → valor). */
export function leerFoto(texto) {
  const m = new Map()
  for (const [clave, valor] of leerCsv(texto)) if (clave) m.set(clave, valor ?? '')
  return m
}

/** Lo que cambia entre dos fotos: [{ clave, antes, despues }] (undefined = no está). */
export function diferencias(antes, despues) {
  const out = []
  for (const k of new Set([...antes.keys(), ...despues.keys()])) {
    const a = antes.get(k)
    const d = despues.get(k)
    if (a !== d) out.push({ clave: k, antes: a, despues: d })
  }
  return out.sort((x, y) => x.clave.localeCompare(y.clave))
}

const celda = (x) => (x === undefined || x === null ? '—' : `\`${String(x).replace(/\|/g, '\\|').replace(/`/g, "'")}\``)
const nota = (a, d) => (a === undefined || a === null ? '**no estaba antes**' : d === undefined || d === null ? '**ya no está**' : '**distinta**')

export function tabla(difs, ea = 'Antes', ed = 'Después') {
  return [`| Qué | ${ea} | ${ed} | |`, '|---|---|---|---|', ...difs.map((x) => `| ${x.clave} | ${celda(x.antes)} | ${celda(x.despues)} | ${nota(x.antes, x.despues)} |`), ''].join('\n')
}

/** CSV del registro: «clave,valor» con el valor vacío (sin comillas) si no existía. */
export function delta(antes, despues) {
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`
  return diferencias(antes, despues).map((x) => `${q(x.clave)},${x.antes === undefined ? '' : q(x.antes)}`).join('\n') + '\n'
}

/** Lo que el registro dice que había antes, contra la foto de ahora. */
export function contraRegistro(foto, registro) {
  const out = []
  for (const [clave, valor] of leerCsv(registro)) {
    if (!clave) continue
    const ahora = foto.get(clave)
    const antes = valor ?? undefined
    if (ahora !== antes) out.push({ clave, antes, despues: ahora })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const leer = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  const modo = ['toca', 'delta', 'registro'].includes(args[0]) ? args.shift() : 'comparar'
  const [fa, fd, ea, ed] = args
  if (!fa || !fd) { console.error('Uso: definiciones-comparar.mjs [toca|delta|registro] <a.csv> <b.csv> [etiquetas]'); process.exit(2) }
  const a = leerFoto(leer(fa))
  if (modo === 'registro') {
    const difs = contraRegistro(a, leer(fd))
    if (difs.length) {
      console.log(tabla(difs, 'Antes de ir de verdad', 'Tras deshacer'))
      console.log(`**${difs.length} definiciones no vuelven a como estaban antes de ir de verdad a staging.**`)
      process.exitCode = 1
    } else console.log('Lo que fue de verdad a staging vuelve a como estaba antes al deshacerlo.')
  } else {
    const b = leerFoto(leer(fd))
    if (a.size === 0 || b.size === 0) { console.log('**Falta una de las dos fotos de definiciones**: no se puede comparar.'); process.exit(1) }
    const difs = diferencias(a, b)
    if (modo === 'delta') { process.stdout.write(delta(a, b)); process.exit(0) }
    if (modo === 'toca') {
      console.log(difs.length ? tabla(difs, 'Antes', 'Con la tanda') : '')
      console.log(`La tanda toca **${difs.length}** definiciones (de ${b.size}).`)
      process.exit(0)
    }
    if (difs.length) {
      console.log(tabla(difs, ea ?? 'Antes', ed ?? 'Después'))
      console.log(`**${difs.length} de ${a.size} definiciones distintas.**`)
      process.exitCode = 1
    } else console.log(`Las ${a.size} definiciones, iguales.`)
  }
}
