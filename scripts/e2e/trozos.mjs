#!/usr/bin/env node
// scripts/e2e/trozos.mjs — la e2e repartida en trozos que corren a la vez (W02, paso 1c).
//
//   node scripts/e2e/trozos.mjs reparto <i> <n> [pruebas…]   ficheros del trozo i de n
//   node scripts/e2e/trozos.mjs todos [pruebas…]             todos los ficheros (para comprobar)
//
// [pruebas…]: carpetas o ficheros de tests/e2e (lo mismo que el campo «pruebas»
// del workflow); sin nada, la suite entera.
//
// Cómo reparte: fichero a fichero (los dos tamaños de un fichero van juntos,
// como corrían), del más lento al más rápido, cada uno al trozo que menos lleva.
// Los tiempos son los de la última entera medida (tests/e2e/tiempos/, uno por prueba); un
// fichero nuevo cuenta como la mediana. Es determinista: los cuatro trozos de
// una entera calculan el mismo reparto sin hablar entre ellos, y el job que los
// junta comprueba que entre todos están todos los ficheros, una vez cada uno.
//
// Medido el 16/10 sobre la entera de B (33,3 min con 1 worker): en 4 trozos, el
// más largo lleva 8,3 min de pruebas.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const RAIZ = 'tests/e2e'
// El testMatch por defecto de Playwright.
const ES_PRUEBA = /\.(spec|test)\.[cm]?[jt]sx?$/

/** Todos los ficheros de prueba bajo tests/e2e, relativos a él, ordenados. */
export function ficheros(raiz = RAIZ) {
  const fuera = []
  const andar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) andar(p)
      else if (ES_PRUEBA.test(e.name)) fuera.push(relative(raiz, p).split('\\').join('/'))
    }
  }
  andar(raiz)
  return fuera.sort()
}

/** Los ficheros que caen dentro de «pruebas» (carpetas o ficheros de tests/e2e). Sin nada, todos. */
export function filtrar(todos, pruebas = []) {
  if (!pruebas.length) return todos
  const pref = pruebas.map((p) => p.replace(/^tests\/e2e\/?/, '').replace(/\/+$/, ''))
  return todos.filter((f) => pref.some((p) => p === '' || f === p || f.startsWith(`${p}/`)))
}

/** Reparte los ficheros en n trozos: el más lento primero, al trozo que menos lleva. */
export function repartir(lista, n, tiempos = {}) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n tiene que ser un entero ≥ 1: ${n}`)
  const conocidos = lista.map((f) => tiempos[f]).filter((t) => typeof t === 'number').sort((a, b) => a - b)
  const mediana = conocidos.length ? conocidos[Math.floor(conocidos.length / 2)] : 1
  const t = (f) => (typeof tiempos[f] === 'number' ? tiempos[f] : mediana)
  const orden = [...lista].sort((a, b) => t(b) - t(a) || a.localeCompare(b))
  const trozos = Array.from({ length: n }, () => ({ ficheros: [], segundos: 0 }))
  for (const f of orden) {
    let k = 0
    for (let j = 1; j < n; j++) if (trozos[j].segundos < trozos[k].segundos) k = j
    trozos[k].ficheros.push(f)
    trozos[k].segundos += t(f)
  }
  for (const tr of trozos) tr.ficheros.sort()
  return trozos
}

/**
 * W12 (29/10): los tiempos medidos, uno por prueba, en tests/e2e/tiempos/<ruta>.json
 * ({ "segundos": n, "medido": "…" }), y el techo en tests/e2e/tiempos/_techo.json.
 * Devuelve lo mismo que el tiempos.json único de antes: { "<ruta>": segundos,
 * "_techo_4_trozos_min": …, "_techo_porque": … }. Antes, dos PR que añadían un
 * tiempo chocaban siempre (la misma nota y la misma última línea).
 */
export const TIEMPOS = join(RAIZ, 'tiempos')
export function tiemposDelRepo(carpeta = TIEMPOS) {
  const t = {}
  if (!existsSync(carpeta)) return t
  const andar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) andar(p)
      else if (e.name === '_techo.json') Object.assign(t, JSON.parse(readFileSync(p, 'utf8')))
      else if (e.name.endsWith('.json')) {
        const v = JSON.parse(readFileSync(p, 'utf8'))
        if (typeof v.segundos === 'number') t[relative(carpeta, p).split('\\').join('/').replace(/\.json$/, '')] = v.segundos
      }
    }
  }
  andar(carpeta)
  return t
}

/** Escribe el tiempo de una prueba en su fichero (tests/e2e/tiempos/<ruta>.json, o bajo `carpeta`). */
export function escribirTiempo(ruta, segundos, medido, carpeta = TIEMPOS) {
  const f = join(carpeta, `${ruta}.json`)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(medido ? { segundos, medido } : { segundos }) + '\n')
  return f
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [orden, ...args] = process.argv.slice(2)
  if (orden === 'todos') {
    console.log(filtrar(ficheros(), args).map((f) => `${RAIZ}/${f}`).join('\n'))
  } else if (orden === 'reparto') {
    const [i, n, ...pruebas] = args
    const ii = Number(i), nn = Number(n)
    if (!(ii >= 1 && ii <= nn)) { console.error('uso: trozos.mjs reparto <i> <n> [pruebas…]  (1 ≤ i ≤ n)'); process.exit(2) }
    const lista = filtrar(ficheros(), pruebas)
    if (!lista.length) { console.error(`✗ «${pruebas.join(' ')}» no casa con ningún fichero de prueba de tests/e2e.`); process.exit(1) }
    const trozos = repartir(lista, nn, tiemposDelRepo())
    const mio = trozos[ii - 1]
    console.error(`Trozo ${ii} de ${nn}: ${mio.ficheros.length} ficheros, unos ${Math.round(mio.segundos / 60 * 10) / 10} min (los ${nn}: ${trozos.map((t) => Math.round(t.segundos / 60 * 10) / 10).join(' · ')} min).`)
    console.log(mio.ficheros.map((f) => `${RAIZ}/${f}`).join('\n'))
  } else {
    console.error('uso: trozos.mjs reparto <i> <n> [pruebas…] | todos [pruebas…]'); process.exit(2)
  }
}

