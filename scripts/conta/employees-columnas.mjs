#!/usr/bin/env node
// scripts/conta/employees-columnas.mjs
//
// N1 (Julio, 29/10) · Toda columna nueva de employees lleva su «grant select»,
// o dice que es privada.
//
// Por qué: la 0731 de la L1a (20261029T0731_l1a_columnas_privadas.sql) quitó a
// la sesión (authenticated y anon) el SELECT de TABLA de employees y le dio el
// de cada columna que no es privada. Desde entonces, una columna que se añada a
// employees NO la ve la sesión hasta que alguien le dé su permiso: el front la
// pide, PostgREST contesta «permission denied for table employees» y la pantalla
// entera se queda en blanco. tsc, el lint y las pruebas de staging (que corren
// como postgres) no lo ven.
//
// Qué mira: cada «alter table … employees … add [column] [if not exists] <col>»
// de los ficheros, también dentro del SQL dinámico de una cadena. Cada columna
// añadida tiene que ir, en el MISMO fichero, con una de estas dos:
//   grant select (<col>[, …]) on [table] [public.]employees to authenticated[, anon]
//   -- privada: employees.<col> · <por qué>
// La privada no se da a la sesión y la lee quien tiene derecho por una función
// de servidor (como empleados_datos_privados).
//
// Uso:
//   node scripts/conta/employees-columnas.mjs                 las añadidas o cambiadas contra origin/main, con lo no commiteado
//   node scripts/conta/employees-columnas.mjs <base> [<head>] las de ese diff (pr-a-main.yml)
//   node scripts/conta/employees-columnas.mjs revisar <f>…    esos ficheros
//   node scripts/conta/employees-columnas.mjs todas           todas las de supabase/migrations (para medir; no para)
// Sale con 1 si alguna no cumple.

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sinComentariosNiCadenas } from './sql-sin-where.mjs'

const ALTER = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\s*\.\s*)?"?employees"?\s+([^;]*)/gi
const ADD = /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][\w$]*)"?/gi
// Lo que va detrás de «add» y no es una columna.
const NO_COLUMNA = new Set(['constraint', 'primary', 'foreign', 'unique', 'check', 'exclude'])
const GRANT = /\bgrant\s+select\s*\(([^)]*)\)\s*on\s+(?:table\s+)?(?:"?public"?\s*\.\s*)?"?employees"?\s+to\s+([^;]*)/gi

const lineaDe = (texto, pos) => texto.slice(0, pos).split('\n').length

/** Las columnas que el texto añade a employees, con su línea. Sin comentarios; también en las cadenas. */
function columnasAnadidas(texto) {
  const { codigo, cadenas } = sinComentariosNiCadenas(texto)
  const out = []
  const mirar = (trozo, base) => {
    for (const a of trozo.matchAll(ALTER)) {
      const cuerpo = a[1]
      const inicioCuerpo = a.index + a[0].length - cuerpo.length
      for (const c of cuerpo.matchAll(ADD)) {
        const col = c[1].toLowerCase()
        if (NO_COLUMNA.has(col)) continue
        out.push({ columna: col, linea: lineaDe(texto, base(inicioCuerpo + c.index)) })
      }
    }
  }
  mirar(codigo, (p) => p)
  for (const c of cadenas) mirar(sinComentariosNiCadenas(c.texto).codigo, () => c.inicio)
  return out
}

/** Las columnas de employees a las que el texto da SELECT para la sesión (authenticated). */
function columnasConPermiso(texto) {
  const { codigo, cadenas } = sinComentariosNiCadenas(texto)
  const si = new Set()
  const mirar = (trozo) => {
    for (const g of trozo.matchAll(GRANT)) {
      if (!/\bauthenticated\b/i.test(g[2])) continue
      for (const c of g[1].split(',')) si.add(c.trim().replace(/"/g, '').toLowerCase())
    }
  }
  mirar(codigo)
  for (const c of cadenas) mirar(sinComentariosNiCadenas(c.texto).codigo)
  return si
}

/** Las que el fichero declara privadas: «-- privada: employees.<col> · <por qué>». */
function columnasPrivadas(texto) {
  const si = new Set()
  for (const m of String(texto).matchAll(/--\s*privada:\s*employees\.([a-z_][\w$]*)\s*·\s*\S/gi)) si.add(m[1].toLowerCase())
  return si
}

/** Las columnas añadidas a employees sin «grant select» para la sesión ni «-- privada:». */
export function columnasSinPermiso(texto) {
  const permiso = columnasConPermiso(texto)
  const privada = columnasPrivadas(texto)
  return columnasAnadidas(texto).filter((c) => !permiso.has(c.columna) && !privada.has(c.columna))
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql'))

function ficherosDelDiff(base, head) {
  if (head) return git('diff', '--name-only', '--diff-filter=AM', `${base}...${head}`, '--', 'supabase/migrations')
  const desde = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim()
  return [...new Set([
    ...git('diff', '--name-only', '--diff-filter=AM', desde, '--', 'supabase/migrations'),
    ...git('ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations'),
  ])].sort()
}

function revisar(ficheros, { para = true } = {}) {
  let n = 0
  for (const f of ficheros) {
    for (const x of columnasSinPermiso(readFileSync(f, 'utf8'))) {
      n++
      console.log(`${para ? '::error ' : ''}${f}:${x.linea} · employees.${x.columna} sin «grant select» para la sesión`)
    }
  }
  const que = `${ficheros.length} migraci${ficheros.length === 1 ? 'ón' : 'ones'}`
  if (n) {
    console.log(`\n${n} columna${n === 1 ? '' : 's'} nueva${n === 1 ? '' : 's'} de employees sin permiso en ${que}. Desde la 0731 la sesión solo lee las columnas que tienen el suyo: añade en el mismo fichero «grant select (<columna>) on public.employees to authenticated, anon;» o, si es privada, «-- privada: employees.<columna> · <por qué>».`)
    return para ? 1 : 0
  }
  console.log(`Ninguna columna nueva de employees sin su permiso en ${que}.`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, ...resto] = process.argv.slice(2)
  if (a === 'revisar') process.exit(revisar(resto))
  if (a === 'todas') process.exit(revisar(readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `supabase/migrations/${f}`), { para: false }))
  process.exit(revisar(ficherosDelDiff(a ?? 'origin/main', resto[0])))
}
