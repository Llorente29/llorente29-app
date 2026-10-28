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
// La regla (W08b, Julio, 28/10; antes C06b y W04): las capturas, FUERA del PR.
//   · en cada e2e, las capturas que ha sacado ESE run van como artefacto del
//     run (`recoger`);
//   · si sale en verde, las del frente de la rama (`suyas`) se publican en una
//     rama aparte, `capturas/<rama>`, un solo commit sin historia que el bot
//     reescribe en cada run. El bot NO hace commits en la rama del PR: un push
//     con el token del workflow deja las comprobaciones del PR en «Action
//     required» y los PNG chocaban con main;
//   · un comentario del PR (uno solo, que se edita) las enseña en miniatura,
//     por tablero (`comentario`);
//   · al fusionar el PR, capturas-al-cerrar.yml las pasa a main en su carpeta de
//     siempre; al fusionarlo o cerrarlo, borra `capturas/<rama>`;
//   · antes de subir, `comprobar` para si la rama trae capturas de otro frente.
//
//   node scripts/conta/capturas.mjs frente <rama>          → a, b, c, d o nada
//   node scripts/conta/capturas.mjs suyas <rama> <dir>     → las del frente que hay en <dir>
//   node scripts/conta/capturas.mjs comentario <repo> <sha> <rama> <lista>
//       → el Markdown del comentario (miniaturas por tablero) de las rutas de <lista>
//   node scripts/conta/capturas.mjs recoger <marca> <dir>  → copia las de este run
//   node scripts/conta/capturas.mjs comprobar [rama]       → sale con 1 si hay de otro
//   node scripts/conta/capturas.mjs revisar <rama> <base> <head>
//       → lo mismo, para un PR (pr-a-main.yml), sobre base...head: nombra cada
//         PNG que no es del frente de la rama (W08, 28/10).

import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { zonasDuenas } from '../e2e/area.mjs'

export const CARPETAS = ['docs/conta/capturas', 'docs/reparto/capturas', 'docs/inventario/capturas', 'docs/marcas/capturas']

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
 * De quién son las capturas que puede publicar una rama. El reparto (R02) no es
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
  // F01 (27/10): las marcas de Last, igual que inventario: de la ZONA.
  marcas: /^docs\/marcas\/capturas\//,
}

/**
 * El dueño de las capturas de una rama: el de su nombre y, si el nombre no es de
 * nadie, la zona de la que ES lo que cambia contra main (scripts/e2e/area.mjs,
 * ZONAS_POR_FICHERO, su lista `duenos`), si es de una sola con capturas. Así una
 * rama sin frente que cambia inventario fija las de docs/inventario/capturas y
 * ninguna más; y una que solo toca a un vecino de la zona (el portal del
 * trabajador) no fija ninguna (W08, 28/10). Las capturas que cambia la propia
 * rama no cuentan para decidirlo.
 */
export function duenoDeLaRama(rama, cambiados = []) {
  // A mano (W08b): la e2e lanzada con «frente» publica las de ese frente.
  const forzado = process.env.CAPTURAS_DUENO?.trim()
  if (forzado && forzado in DE_QUIEN) return forzado
  if (/^reparto-/.test(rama)) return 'reparto'
  if (/^conta\/i\d/.test(rama)) return 'impuestos'
  if (/^conta\/p\d/.test(rama)) return 'despacho'
  if (/^conta\/compras/.test(rama)) return 'compras'
  const frente = frenteDeLaRama(rama)
  if (frente) return frente
  const zonas = zonasDuenas(cambiados.filter((f) => !esCaptura(f))).filter((z) => z.zona in DE_QUIEN)
  return zonas.length === 1 ? zonas[0].zona : null
}

/** Si una ruta es de una de las carpetas de capturas. */
export function esCaptura(ruta) {
  return CARPETAS.some((c) => ruta.startsWith(`${c}/`))
}

/**
 * Las capturas que cambia una rama y no son de su dueño (W08): las que chocan
 * con main. De lo cambiado contra main saca el dueño y devuelve, fichero a
 * fichero, las de otro.
 */
export function capturasAjenas(rama, cambiados) {
  const dueno = duenoDeLaRama(rama, cambiados)
  return { dueno, ajenas: repartir(cambiados.filter(esCaptura), dueno).ajenas }
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

/** La rama aparte donde se publican las capturas de una rama (W08b). */
export function ramaDeCapturas(rama) {
  return `capturas/${rama}`
}

/** El tablero de una captura, para agruparlas: «c00», «r02», «inventario». */
export function tableroDe(ruta) {
  const m = ruta.match(/^docs\/(conta|reparto)\/capturas\/([^/]+)\//)
  if (m) return m[2]
  return ruta.split('/')[1]
}

/**
 * El Markdown del comentario: las capturas en miniatura (enlazadas a su PNG),
 * por tablero y por nombre, de tres en tres. Con el sha del commit publicado,
 * no con el nombre de la rama: el comentario enseña ESE run aunque la rama se
 * reescriba o se borre después.
 */
export function comentarioCapturas({ servidor = 'https://github.com', repo, sha, rama, rutas }) {
  const png = [...rutas].filter((r) => /\.(png|jpe?g|webp)$/i.test(r)).sort()
  if (!png.length) return ''
  const porTablero = new Map()
  for (const r of png) { const t = tableroDe(r); if (!porTablero.has(t)) porTablero.set(t, []); porTablero.get(t).push(r) }
  const url = (r) => `${servidor}/${repo}/blob/${sha}/${r}`
  const partes = [`**${png.length} capturas del frente** en [\`${ramaDeCapturas(rama)}\`](${servidor}/${repo}/tree/${ramaDeCapturas(rama)}) (\`${sha.slice(0, 7)}\`). Al fusionar, pasan a main en su carpeta.`]
  for (const [t, rs] of [...porTablero].sort(([a], [b]) => a.localeCompare(b))) {
    partes.push('', `**${t}** · ${rs.length}`, '', '<table>')
    for (let i = 0; i < rs.length; i += 3) {
      const fila = rs.slice(i, i + 3).map((r) => `<td valign="top"><a href="${url(r)}"><img src="${url(r)}?raw=true" width="240" alt="${r.split('/').pop()}"></a><br><sub>${r.split('/').pop()}</sub></td>`)
      partes.push(`<tr>${fila.join('')}</tr>`)
    }
    partes.push('</table>')
  }
  return partes.join('\n')
}

/** Las capturas que hay en <raiz>, con su ruta relativa (las de las CARPETAS). */
export function capturasEn(raiz) {
  const fuera = []
  const andar = (d) => {
    for (const e of readdirSync(join(raiz, d), { withFileTypes: true })) {
      const r = `${d}/${e.name}`
      if (e.isDirectory()) andar(r); else fuera.push(r)
    }
  }
  for (const c of CARPETAS) if (existsSync(join(raiz, c))) andar(c)
  return fuera.sort()
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
  // CAPTURAS_CAMBIADOS (L00, 27/10): lo que cambia la rama, dado a mano (ficheros
  // separados por comas; vacío = nada). Lo usan las pruebas, que si no leían el
  // diff del checkout donde corren: en una rama que toca inventario salía dueña
  // de inventario y la prueba caía (unitarias #103).
  const cambiadosContraMain = () => {
    if (process.env.CAPTURAS_CAMBIADOS !== undefined) return process.env.CAPTURAS_CAMBIADOS.split(',').map((f) => f.trim()).filter(Boolean)
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
  } else if (orden === 'suyas') {
    // Las de este run que son del frente de la rama (las que se publican en capturas/<rama>).
    // Una rama sin frente (C10, 23/10) no tiene: lo dice y sale con 0, sin poner el run en rojo.
    const [rama, dir] = args
    if (!rama || !dir) { console.error('Uso: capturas.mjs suyas <rama> <dir>'); process.exit(1) }
    const dueno = duenoDeLaRama(rama, cambiadosContraMain())
    if (!dueno) { console.error(`La rama «${rama}» no es de ningún frente: no hay capturas que publicar (se salta).`); process.exit(0) }
    const { suyas, ajenas } = repartir(capturasEn(dir), dueno)
    console.error(`Frente ${dueno}: ${suyas.length} capturas para publicar.${ajenas.length ? ` No se publican ${ajenas.length} de otras carpetas (${carpetasDe(ajenas).join(', ')}): van solo en el artefacto.` : ''}`)
    if (suyas.length) process.stdout.write(suyas.join('\n') + '\n')
  } else if (orden === 'comentario') {
    const [repo, sha, rama, lista] = args
    if (!repo || !sha || !rama || !lista) { console.error('Uso: capturas.mjs comentario <repo> <sha> <rama> <lista>'); process.exit(1) }
    const rutas = readFileSync(lista, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    process.stdout.write(comentarioCapturas({ servidor: process.env.GITHUB_SERVER_URL || undefined, repo, sha, rama, rutas }) + '\n')
  } else if (orden === 'recoger') {
    const [marca, destino] = args
    if (!marca || !destino) { console.error('Uso: capturas.mjs recoger <marca> <dir>'); process.exit(1) }
    const estas = despuesDe('.', statSync(marca).mtimeMs)
    for (const r of estas) { mkdirSync(dirname(join(destino, r)), { recursive: true }); copyFileSync(r, join(destino, r)) }
    console.log(`${estas.length} capturas de este run${estas.length ? ` (${carpetasDe(estas).join(', ')})` : ''}.`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `n=${estas.length}\n`)
  } else if (orden === 'comprobar' || orden === 'revisar') {
    // comprobar [rama]: antes de subir, contra origin/main. revisar <rama> <base> <head>:
    // en pr-a-main.yml, sobre el diff del PR (también cuando el último commit es del bot).
    const rama = args[0] ?? ramaActual()
    const cambiados = orden === 'revisar'
      ? git('diff', '--name-only', `${args[1]}...${args[2]}`).split('\n').filter(Boolean)
      : cambiadosContraMain()
    const { dueno, ajenas } = capturasAjenas(rama, cambiados)
    const enLaRama = cambiados.filter(esCaptura)
    if (ajenas.length) {
      console.error(`✗ La rama «${rama}» trae ${ajenas.length} capturas que no son de su frente (${dueno ?? 'no es de ninguno'}); son las que chocan con main:`)
      for (const f of ajenas) console.error(`  · ${f}`)
      console.error(`  Devuélvelas a las de main: git checkout origin/main -- ${ajenas.join(' ')}  (y lo que main no tenga: git rm)`)
      if (process.env.GITHUB_ACTIONS) for (const f of ajenas) console.log(`::error file=${f}::Captura que no es del frente de la rama (${dueno ?? 'ninguno'}): vuelve a la de main.`)
      process.exit(1)
    }
    console.log(`Capturas de la rama: ${enLaRama.length}, todas de su frente (${dueno ?? 'ninguno'}).`)
  } else {
    console.error('Uso: capturas.mjs frente|suyas|comentario|recoger|comprobar|revisar …'); process.exit(1)
  }
}
