#!/usr/bin/env node
// scripts/conta/produccion/tanda.mjs — la tanda de producción de una RAMA (C10, Julio, 23/10).
//
// «Que dos PR con tanda no choquen nunca más.» Hasta el C10 había un solo
// supabase/produccion/aplicar.txt (y su vuelta-atras.txt y su contexto) para
// todas las ramas: dos PR con tanda editaban el mismo fichero, y fusionar uno
// dejaba sin manifiesto al otro (el #301 y la D07, el 23/10).
//
// Ahora cada rama tiene SU tanda, en su carpeta, y nadie más la edita:
//
//   supabase/produccion/tandas/<producto>/<rama>/aplicar.txt      lo que se aplica, en su orden
//   supabase/produccion/tandas/<producto>/<rama>/vuelta-atras.txt  la vuelta atrás, en su orden
//   supabase/produccion/tandas/<producto>/<rama>/contexto.json     el contexto medido en producción
//
//   <producto>: sumied (contabilidad) o folvy (el resto).
//   <rama>: el nombre de la rama con «/» cambiada por «-» (conta/c10-x → conta-c10-x).
//
// El workflow aplica la tanda de la rama desde la que se lanza (o la que se
// nombra en «tanda», para lanzar desde main una ya fusionada). Al fusionar, la
// carpeta queda en main tal cual: ése es su archivo. No hay nada que copiar a
// mano ni ningún fichero que dos PR editen a la vez.
//
//   node scripts/conta/produccion/tanda.mjs carpeta [rama|nombre]  → la carpeta (sale con 1 si no hay)
//   node scripts/conta/produccion/tanda.mjs slug <rama>            → el nombre de la carpeta
//   node scripts/conta/produccion/tanda.mjs todas                  → todas las carpetas, una por línea
//   node scripts/conta/produccion/tanda.mjs workflow <rama|nombre> → (el workflow) la carpeta a
//     /tmp/tanda-dir.txt, a $GITHUB_ENV (TANDA_DIR) y al informe ($INFORME); sale con 1 si no hay
//   node scripts/conta/produccion/tanda.mjs ajenos <rama> <cambiados.txt> → (pr-a-main.yml) para si
//     el PR edita una tanda que no es la suya o uno de los manifiestos únicos de antes

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const RAIZ = 'supabase/produccion/tandas'
export const PRODUCTOS = ['sumied', 'folvy']

/** El nombre de la carpeta de una rama: «/» → «-», y solo letras, números, «.», «_» y «-». */
export function slugDeRama(rama) {
  return String(rama ?? '').trim().replace(/\//g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Las carpetas de tanda que hay (producto/slug), en orden. */
export function todas(raiz = RAIZ) {
  const out = []
  for (const p of PRODUCTOS) {
    const d = join(raiz, p)
    if (!existsSync(d)) continue
    for (const n of readdirSync(d).sort()) if (statSync(join(d, n)).isDirectory()) out.push(`${p}/${n}`)
  }
  return out
}

/**
 * La carpeta de la tanda de una rama (o de un nombre de carpeta), o null.
 * Si el mismo nombre estuviera en los dos productos, para: no se adivina.
 */
export function carpetaDeTanda(ramaONombre, raiz = RAIZ) {
  const slug = slugDeRama(ramaONombre)
  if (!slug) return null
  const hay = PRODUCTOS.map((p) => join(raiz, p, slug)).filter((d) => existsSync(join(d, 'aplicar.txt')))
  if (hay.length > 1) throw new Error(`la tanda «${slug}» está en ${hay.join(' y ')}: tiene que estar en un solo producto`)
  return hay[0] ?? null
}

/** Los ficheros de la tanda de una carpeta. */
export function ficherosDeTanda(dir) {
  return { aplicar: join(dir, 'aplicar.txt'), vueltaAtras: join(dir, 'vuelta-atras.txt'), contexto: join(dir, 'contexto.json') }
}

/** La rama de ahora (la de GitHub en el workflow, o la de git en local). */
export function ramaActual() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME
  try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '' }
}

/** Los manifiestos únicos de antes del C10: ya no se editan (el de staging queda cerrado, con lo de antes dentro). */
export const CERRADOS = [
  'supabase/produccion/aplicar.txt',
  'supabase/produccion/vuelta-atras.txt',
  'tests/conta/produccion/contexto-produccion-tanda-viva.json',
  'supabase/staging/aplicar.txt',
]
/** La de antes del C10: la termina el PR que la tenía (#299), y solo ése la edita. */
export const HEREDADA = 'heredada'

/**
 * Lo que un PR no puede editar, en frases: una tanda de otra rama (de
 * producción o de staging) o un manifiesto único de antes. `cambiados`: los
 * ficheros añadidos o cambiados del PR (los borrados no cuentan).
 */
export function ajenos(rama, cambiados) {
  const mia = slugDeRama(rama)
  const fallos = []
  for (const f of cambiados.map((x) => String(x).trim()).filter(Boolean)) {
    if (CERRADOS.includes(f)) {
      fallos.push(`${f}: ya no se edita (C10). La tanda va en ${RAIZ}/<producto>/${mia}/ y lo de staging en supabase/staging/tandas/<producto>/${mia}.txt`)
      continue
    }
    let m = /^supabase\/produccion\/tandas\/([^/]+)\/([^/]+)\/[^/]+$/.exec(f)
    if (m) {
      if (!PRODUCTOS.includes(m[1])) fallos.push(`${f}: el producto es sumied o folvy, no «${m[1]}»`)
      else if (m[2] !== mia && m[2] !== HEREDADA) fallos.push(`${f}: es la tanda de otra rama («${m[2]}»); la de ésta es «${mia}»`)
      continue
    }
    m = /^supabase\/staging\/tandas\/([^/]+)\/([^/]+)\.txt$/.exec(f)
    if (m) {
      if (!PRODUCTOS.includes(m[1])) fallos.push(`${f}: el producto es sumied o folvy, no «${m[1]}»`)
      else if (m[2] !== mia) fallos.push(`${f}: es el manifiesto de staging de otra rama («${m[2]}»); el de ésta es «${mia}.txt»`)
    }
  }
  return fallos
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [orden, arg] = process.argv.slice(2)
  if (orden === 'carpeta') {
    let d
    try { d = carpetaDeTanda(arg || ramaActual()) } catch (e) { console.error(`✗ ${e.message}`); process.exit(2) }
    if (!d) process.exit(1)
    console.log(d)
  } else if (orden === 'workflow') {
    let d = null
    try { d = carpetaDeTanda(arg) } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
    if (!d) process.exit(1)
    writeFileSync('/tmp/tanda-dir.txt', d)
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `TANDA_DIR=${d}\n`)
    if (process.env.INFORME) appendFileSync(process.env.INFORME, `Tanda: \`${d}\`\n\n`)
  } else if (orden === 'ajenos') {
    const fichero = process.argv[4]
    const fallos = ajenos(arg, readFileSync(fichero, 'utf8').split('\n'))
    for (const f of fallos) console.log(`::error::${f}`)
    if (fallos.length) process.exit(1)
    console.log(`El PR solo edita su tanda («${slugDeRama(arg)}»).`)
  } else if (orden === 'slug') {
    console.log(slugDeRama(arg))
  } else if (orden === 'todas') {
    for (const t of todas()) console.log(t)
  } else {
    console.error('uso: tanda.mjs carpeta [rama|nombre] | slug <rama> | todas | workflow <rama|nombre> | ajenos <rama> <cambiados.txt>'); process.exit(2)
  }
}
