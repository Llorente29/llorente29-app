// scripts/pr/revisar-pr.mjs
//
// Lo que corre pr-a-main.yml: lee el diff del PR (base...head), qué ficheros de
// _shared importa cada función (siguiendo los imports relativos), y aplica
// revisarPr. Sale con 1 y las frases si el PR no cumple.
//
//   PR_TITULO=… PR_CUERPO=… node scripts/pr/revisar-pr.mjs <base> <head>

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { funcionesTocadas, revisarPr } from './funcionesADesplegar.mjs'

const [base, head] = process.argv.slice(2)
const cambiados = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' }).split('\n').filter(Boolean)

const RAIZ = 'supabase/functions'
const importsDe = (fichero) => {
  if (!existsSync(fichero)) return []
  const src = readFileSync(fichero, 'utf8')
  return [...src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => normalize(join(dirname(fichero), m[1])))
}
const importa = {}
for (const fn of readdirSync(RAIZ)) {
  const dir = join(RAIZ, fn)
  if (fn === '_shared' || !statSync(dir).isDirectory()) continue
  const vistos = new Set()
  const pendientes = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f)).map((f) => join(dir, f))
  while (pendientes.length) {
    const f = pendientes.pop()
    if (vistos.has(f)) continue
    vistos.add(f)
    pendientes.push(...importsDe(f))
  }
  importa[fn] = [...vistos].filter((f) => f.startsWith(`${RAIZ}/_shared/`))
}

const fallos = revisarPr({ titulo: process.env.PR_TITULO, cuerpo: process.env.PR_CUERPO, cambiados, importa })
const tocadas = funcionesTocadas(cambiados, importa)
console.log(`Funciones que toca este PR: ${tocadas.length ? tocadas.join(', ') : 'ninguna'}.`)
if (fallos.length) {
  for (const f of fallos) console.log(`::error::${f}`)
  process.exit(1)
}
console.log('El PR cumple: título sin marca de saltar CI y las funciones a desplegar a mano, dichas.')
