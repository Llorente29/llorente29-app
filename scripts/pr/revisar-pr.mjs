// scripts/pr/revisar-pr.mjs
//
// Lo que corre pr-a-main.yml: lee el diff del PR (base...head), qué ficheros de
// _shared importa cada función (siguiendo los imports relativos), y aplica
// revisarPr y revisarProducto (N2: «## Producto»). Sale con 1 y las frases si
// el PR no cumple.
//
//   PR_TITULO=… PR_CUERPO=… node scripts/pr/revisar-pr.mjs <base> <head>

import { execFileSync } from 'node:child_process'
import { funcionesTocadas, revisarPr } from './funcionesADesplegar.mjs'
import { importaDeFunciones } from './importsDeFunciones.mjs'
import { revisarProducto, productosDelDiff, funcionesPorProducto } from './productoDelPr.mjs'

const [base, head] = process.argv.slice(2)
const cambiados = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' }).split('\n').filter(Boolean)
const importa = importaDeFunciones()

const fallos = [
  ...revisarPr({ titulo: process.env.PR_TITULO, cuerpo: process.env.PR_CUERPO, cambiados, importa }),
  ...revisarProducto({ cuerpo: process.env.PR_CUERPO, cambiados }),
]
const tocadas = funcionesTocadas(cambiados, importa)
const porProducto = funcionesPorProducto(tocadas)
const { pide } = productosDelDiff(cambiados)
console.log(`Productos que pide el diff: ${pide.length ? pide.join(', ') : 'ninguno por el nombre de sus ficheros'}.`)
console.log(`Funciones que toca este PR: Sumied: ${porProducto.sumied.join(', ') || 'ninguna'} · Folvy: ${porProducto.folvy.join(', ') || 'ninguna'}.`)
if (fallos.length) {
  for (const f of fallos) console.log(`::error::${f}`)
  process.exit(1)
}
console.log('El PR cumple: título sin marca de saltar CI, su producto y las funciones a desplegar a mano, dichas.')
