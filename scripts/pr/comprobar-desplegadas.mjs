#!/usr/bin/env node
// scripts/pr/comprobar-desplegadas.mjs
//
// W06 (Julio, 22/10) · Después de desplegar, lo desplegado de cada función se
// compara con lo de este commit, fichero a fichero (comparar-desplegada.mjs).
// Se baja con «supabase functions download --use-api» en una carpeta aparte.
//
//   node scripts/pr/comprobar-desplegadas.mjs <ref del proyecto> <detalle.md> <función>…
//
// El detalle (qué fichero es igual, cuál difiere, falta o sobra) va al fichero
// <detalle.md>, que el workflow sube como artefacto: deploy-edge-functions lee
// producción y al registro solo salen números (por la puerta de salida).
// Sale con 1 si alguna no es igual o no se ha podido bajar: una comprobación que
// no se ha podido hacer no es una comprobación en verde.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { comparar, rutaEnFunciones } from './comparar-desplegada.mjs'
import { ficherosDeFuncion, RAIZ } from './importsDeFunciones.mjs'

const todos = (dir) => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? todos(join(dir, e)) : [join(dir, e)]))

const [ref, detalle, ...funciones] = process.argv.slice(2)
if (!ref || !detalle || !funciones.length) { console.error('uso: comprobar-desplegadas.mjs <ref> <detalle.md> <función>…'); process.exit(2) }

const md = ['## Lo desplegado contra este commit, fichero a fichero', '', '| función | resultado |', '|---|---|']
const lineas = []
let iguales = 0, distintas = 0, sinBajar = 0
for (const fn of funciones) {
  const t = mkdtempSync(join(tmpdir(), 'desplegada-'))
  mkdirSync(join(t, 'supabase'), { recursive: true })
  cpSync('supabase/config.toml', join(t, 'supabase/config.toml'))
  try {
    execFileSync('supabase', ['functions', 'download', fn, '--project-ref', ref, '--use-api'], { cwd: t, stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    sinBajar++
    md.push(`| \`${fn}\` | :x: no se ha podido bajar lo desplegado |`)
    lineas.push(`${fn}: no se ha podido bajar (${String(e?.stderr ?? e).trim().split('\n').slice(-1)[0]})`)
    continue
  }
  const bajada = join(t, 'supabase/functions')
  const bajados = new Map()
  if (existsSync(bajada)) for (const f of todos(bajada)) bajados.set(rutaEnFunciones(relative(bajada, f)), readFileSync(f))
  const leerRepo = (r) => (existsSync(join(RAIZ, r)) ? readFileSync(join(RAIZ, r)) : null)
  const usa = ficherosDeFuncion(fn, RAIZ, { soloEjecucion: true }).map((f) => f.slice(RAIZ.length + 1))
  const r = comparar(fn, bajados, leerRepo, usa)
  if (r.bien) iguales++; else distintas++
  md.push(`| \`${fn}\` | ${r.bien ? ':white_check_mark: igual' : ':x: no es la de este commit'} |`)
  lineas.push(`${fn}:`, ...r.lineas)
}
writeFileSync(detalle, [...md, '', '```', ...lineas, '```', ''].join('\n'))
// Lo único que va al registro: números, por la puerta de salida.
console.log(`@@ funciones_comprobadas ${funciones.length}`)
console.log(`@@ funciones_iguales ${iguales}`)
console.log(`@@ funciones_distintas ${distintas}`)
console.log(`@@ funciones_sin_bajar ${sinBajar}`)
process.exit(distintas || sinBajar ? 1 : 0)
