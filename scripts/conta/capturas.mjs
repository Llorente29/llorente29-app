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
//   node scripts/conta/capturas.mjs frente <rama>          → a, b, c, d o nada
//   node scripts/conta/capturas.mjs fijar <rama>           → git add de las del frente
//   node scripts/conta/capturas.mjs recoger <marca> <dir>  → copia las de este run
//   node scripts/conta/capturas.mjs comprobar [rama]       → sale con 1 si hay de otro

import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { zonasTocadas } from '../e2e/area.mjs'

export const CARPETAS = ['docs/conta/capturas', 'docs/reparto/capturas', 'docs/inventario/capturas']

/**
 * El frente de la rama: el MISMO reparto que el paso «Frente» de
 * e2e-staging-conta.yml (una prueba compara los dos, línea a línea).
 */
export function frenteDeLaRama(rama) {
  if (/^conta\/d\d/.test(rama)) return 'a'      // A · facturas recibidas (D01…)
  if (/^conta\/b\d/.test(rama)) return 'b'      // B · bancos (B01…)
  if (/^conta\/(c06|f\d)/.test(rama)) return 'c' // C · contabilidad sola y facturas emitidas (C06, F01…)
  if (/^conta\/[ms]\d/.test(rama)) return 'd'   // D · el marco nuevo, sus piezas y el esqueleto (M01, S01…)
  return ''
}

/**
 * De quién son las capturas que puede fijar una rama. El reparto (R02) no es
 * un frente de usuarios, pero sí tiene sus capturas.
 * cierre/ y diez/ no son de ningún frente de hoy: nadie las fija.
 */
export const DE_QUIEN = {
  a: /^docs\/conta\/capturas\/d\d[^/]*\//,
  b: /^docs\/conta\/capturas\/b\d[^/]*\//,
  c: /^docs\/conta\/capturas\/c\d[^/]*\//,
  d: /^docs\/conta\/capturas\/[ms]\d[^/]*\//,
  reparto: /^docs\/reparto\/capturas\//,
  // I01b (18/10): Impuestos (conta/i01…) no es un frente de usuarios —sus e2e
  // van con los de siempre, en su carril—, pero tiene sus capturas: i01b/…
  impuestos: /^docs\/conta\/capturas\/i\d[^/]*\//,
  // P01 (19/10): «Impuestos de tus clientes» (conta/p01…), igual que Impuestos:
  // sin frente de usuarios, con sus capturas en p01/…
  despacho: /^docs\/conta\/capturas\/p\d[^/]*\//,
  // Compras (21/10, «Compras pasa a ser tuya»): conta/compras-…, sin frente de
  // usuarios, con sus capturas en compras/…
  compras: /^docs\/conta\/capturas\/compras\//,
  // Autoconteo (21/10): las de inventario son de la ZONA, no de un frente. Las
  // fija una rama sin frente que toque inventario (duenoDeLaRama, abajo).
  inventario: /^docs\/inventario\/capturas\//,
}

/**
 * El dueño de las capturas de una rama: el de su nombre y, si el nombre no es de
 * nadie, la zona por fichero que toca contra main (scripts/e2e/area.mjs,
 * ZONAS_POR_FICHERO), si toca una sola con capturas. Así una rama sin frente que
 * toca inventario fija las de docs/inventario/capturas y ninguna más.
 */
export function duenoDeLaRama(rama, cambiados = []) {
  if (/^reparto-/.test(rama)) return 'reparto'
  if (/^conta\/i\d/.test(rama)) return 'impuestos'
  if (/^conta\/p\d/.test(rama)) return 'despacho'
  if (/^conta\/compras/.test(rama)) return 'compras'
  const frente = frenteDeLaRama(rama)
  if (frente) return frente
  const zonas = zonasTocadas(cambiados).filter((z) => z.zona in DE_QUIEN)
  return zonas.length === 1 ? zonas[0].zona : null
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
  // Lo que la rama cambia contra main (para el dueño por zona). En Actions el
  // checkout es de un solo commit y no trae origin/main (run 762, 21/10): se trae
  // main y se ahonda la rama hasta encontrar dónde se separaron. Sin eso, nada.
  const cambiadosContraMain = () => {
    const diff = () => execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
    try { return diff() } catch { /* sin origin/main o sin la base común: se trae abajo */ }
    try {
      execFileSync('git', ['fetch', '--no-tags', '-q', '--depth=200', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { stdio: 'ignore' })
      execFileSync('git', ['fetch', '--no-tags', '-q', '--deepen=200', 'origin', 'HEAD'], { stdio: 'ignore' })
      return diff()
    } catch { return [] }
  }

  if (orden === 'frente') {
    process.stdout.write(frenteDeLaRama(args[0] ?? ramaActual()))
  } else if (orden === 'fijar') {
    const rama = args[0] ?? ramaActual()
    const dueno = duenoDeLaRama(rama, cambiadosContraMain())
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
    const dueno = duenoDeLaRama(rama, cambiadosContraMain())
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
