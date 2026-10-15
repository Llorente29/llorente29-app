#!/usr/bin/env node
// scripts/conta/capturas.mjs
//
// Las capturas de las e2e, sin choques entre PRs (C06b, Julio, 15/10).
//
// Hasta hoy cada e2e en verde commiteaba en la rama TODAS las capturas que
// sacaba, también las de otros frentes (la suite entera pasa por b01, c00, d01
// y r02). Un PNG cambia unos bytes en cada pasada, así que dos PRs abiertos a
// la vez chocaban casi seguro: el #194 chocó con main en 12 PNG de b01 y c00.
// Medido en esa rama: sus commits de capturas tocaron 14 carpetas, entre ellas
// b01, d01 y r02, que no eran suyas.
//
// La regla: «capturas: artefacto en cada push y fijar las de tu frente antes
// del informe».
//   · en cada e2e, las capturas que ha sacado ESE run van como artefacto del
//     run (`recoger`), nunca como commit, y un comentario en el PR da el enlace;
//   · antes de dar su informe, cada sesión lanza la e2e a mano con
//     «fijar_capturas», que commitea SOLO la carpeta del frente de la rama
//     (`fijar`): es lo que Julio ve en «Files changed»;
//   · antes de subir, `comprobar` para si la rama trae capturas de otro frente.
//
//   node scripts/conta/capturas.mjs frente <rama>          → a, b, c o nada
//   node scripts/conta/capturas.mjs fijar <rama>           → git add de las del frente
//   node scripts/conta/capturas.mjs recoger <marca> <dir>  → copia las de este run
//   node scripts/conta/capturas.mjs comprobar [rama]       → sale con 1 si hay de otro

import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const CARPETAS = ['docs/conta/capturas', 'docs/reparto/capturas']

/**
 * El frente de la rama: el MISMO reparto que el paso «Frente» de
 * e2e-staging-conta.yml (una prueba compara los dos, línea a línea).
 */
export function frenteDeLaRama(rama) {
  if (/^conta\/d\d/.test(rama)) return 'a'      // A · facturas recibidas (D01…)
  if (/^conta\/b\d/.test(rama)) return 'b'      // B · bancos (B01…)
  if (/^conta\/(c06|f\d)/.test(rama)) return 'c' // C · contabilidad sola y facturas emitidas (C06, F01…)
  return ''
}

/**
 * De quién son las capturas que puede fijar una rama. El reparto (R02) no es
 * un frente de usuarios, pero sí tiene sus capturas.
 * cierre/, compras/ y diez/ no son de ningún frente de hoy: nadie las fija.
 */
export const DE_QUIEN = {
  a: /^docs\/conta\/capturas\/d\d[^/]*\//,
  b: /^docs\/conta\/capturas\/b\d[^/]*\//,
  c: /^docs\/conta\/capturas\/c\d[^/]*\//,
  reparto: /^docs\/reparto\/capturas\//,
}

export function duenoDeLaRama(rama) {
  if (/^reparto-/.test(rama)) return 'reparto'
  return frenteDeLaRama(rama) || null
}

/** Reparte rutas de capturas entre las del dueño y las de otros. */
export function repartir(rutas, dueno) {
  const suyas = [], ajenas = []
  for (const r of rutas) {
    if (!CARPETAS.some((c) => r.startsWith(`${c}/`))) continue
    if (dueno && DE_QUIEN[dueno].test(r)) suyas.push(r); else ajenas.push(r)
  }
  return { suyas, ajenas }
}

/** Las carpetas de primer nivel de unas rutas («docs/conta/capturas/b01»). */
export function carpetasDe(rutas) {
  return [...new Set(rutas.map((r) => r.split('/').slice(0, 4).join('/')))].sort()
}

/** Las capturas escritas después de la marca (en ms), recorriendo las carpetas. */
export function despuesDe(raiz, marcaMs) {
  const fuera = []
  const andar = (d) => {
    for (const e of readdirSync(join(raiz, d), { withFileTypes: true })) {
      const r = `${d}/${e.name}`
      if (e.isDirectory()) andar(r)
      else if (statSync(join(raiz, r)).mtimeMs > marcaMs) fuera.push(r)
    }
  }
  for (const c of CARPETAS) if (existsSync(join(raiz, c))) andar(c)
  return fuera.sort()
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' })

if (import.meta.url === `file://${process.argv[1]}`) {
  const [orden, ...args] = process.argv.slice(2)
  const ramaActual = () => git('rev-parse', '--abbrev-ref', 'HEAD').trim()

  if (orden === 'frente') {
    process.stdout.write(frenteDeLaRama(args[0] ?? ramaActual()))
  } else if (orden === 'fijar') {
    const rama = args[0] ?? ramaActual()
    const dueno = duenoDeLaRama(rama)
    if (!dueno) { console.error(`✗ La rama «${rama}» no es de ningún frente: no se fija ninguna captura.`); process.exit(1) }
    // Lo cambiado y lo nuevo, fichero a fichero (-uall), solo en las carpetas de capturas.
    const cambiadas = git('status', '--porcelain', '-uall', '--', ...CARPETAS).split('\n').filter(Boolean).map((l) => l.slice(3))
    const { suyas, ajenas } = repartir(cambiadas, dueno)
    if (suyas.length) execFileSync('git', ['add', '--', ...suyas])
    console.log(`Frente ${dueno}: ${suyas.length} capturas para fijar.`)
    if (ajenas.length) console.log(`No se fijan ${ajenas.length} de otras carpetas (${carpetasDe(ajenas).join(', ')}): van solo en el artefacto.`)
  } else if (orden === 'recoger') {
    const [marca, destino] = args
    if (!marca || !destino) { console.error('Uso: capturas.mjs recoger <marca> <dir>'); process.exit(1) }
    const estas = despuesDe('.', statSync(marca).mtimeMs)
    for (const r of estas) { mkdirSync(dirname(join(destino, r)), { recursive: true }); copyFileSync(r, join(destino, r)) }
    console.log(`${estas.length} capturas de este run${estas.length ? ` (${carpetasDe(estas).join(', ')})` : ''}.`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `n=${estas.length}\n`)
  } else if (orden === 'comprobar') {
    const rama = args[0] ?? ramaActual()
    const dueno = duenoDeLaRama(rama)
    const enLaRama = git('diff', '--name-only', 'origin/main...HEAD', '--', ...CARPETAS).split('\n').filter(Boolean)
    const { ajenas } = repartir(enLaRama, dueno)
    if (ajenas.length) {
      const cs = carpetasDe(ajenas)
      console.error(`✗ La rama «${rama}» trae ${ajenas.length} capturas que no son de su frente (${cs.join(', ')}): son las que chocan entre PRs.`)
      console.error(`  Devuélvelas a las de main: git checkout origin/main -- ${cs.join(' ')}  (y lo que main no tenga: git rm)`)
      process.exit(1)
    }
    console.log(`Capturas de la rama: ${enLaRama.length}, todas de su frente (${dueno ?? 'ninguno'}).`)
  } else {
    console.error('Uso: capturas.mjs frente|fijar|recoger|comprobar …'); process.exit(1)
  }
}
