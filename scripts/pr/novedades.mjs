// scripts/pr/novedades.mjs
//
// NV1 (Julio, 03/11) · Cada PR a main dice qué cambia para quien lo usa, en
// palabras de usuario, y esa frase es la que enseña el cartel de versión nueva.
//
// La descripción lleva «## Novedades» con «### Sumied» y «### Folvy» (y, si
// algo es de los dos, «### Común»). En cada grupo, «ninguna» o de 1 a 3 líneas:
//
//   - **Liquidaciones:** Un mes entero en una pantalla, por plataforma y tienda. (/conta/ventas/liquidaciones)
//
// El apartado en negrita, una o dos frases, y si se quiere, al final y entre
// paréntesis, la pantalla a la que lleva (una ruta que empieza por «/»).
// No pasa sin la sección, sin uno de los dos grupos, o con jerga: palabras de
// quien programa («PR», «migración», «fix»…) o nombres de tablas y funciones
// (lo_que_lleva_guiones_bajos, lo que va entre comillas invertidas).
// Puro (sin red ni disco): lo llaman revisar-pr.mjs, el workflow al fusionar y
// las unitarias.

export const GRUPOS = { sumied: 'Sumied', folvy: 'Folvy', comun: 'Común' }
const MAX_LINEAS = 3
const MAX_FRASE = 220

/** Las palabras que no dice quien usa Sumied o Folvy. Se buscan como palabra entera, sin mayúsculas. */
export const JERGA = [
  'pr', 'pull request', 'merge', 'commit', 'push', 'branch', 'fix', 'hotfix', 'bug', 'bugfix', 'refactor', 'refactorizar',
  'migración', 'migraciones', 'tanda', 'deploy', 'desplegar', 'despliegue', 'staging', 'e2e', 'unitarias',
  'sql', 'rpc', 'api', 'endpoint', 'json', 'cte', 'schema', 'trigger', 'cron', 'workflow', 'frontend', 'front', 'backend',
  'edge function', 'supabase', 'vercel', 'react', 'typescript',
]

const quitarTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** La jerga que lleva un texto: las palabras de la lista y los nombres de código. */
export function jergaDe(texto) {
  const t = ` ${quitarTildes(String(texto).toLowerCase())} `
  const out = []
  for (const p of JERGA) {
    const q = quitarTildes(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9ñ])${q}([^a-z0-9ñ]|$)`, 'i').test(t)) out.push(p)
  }
  for (const m of String(texto).matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g)) out.push(m[0])
  if (/`/.test(String(texto))) out.push('comillas invertidas (`…`)')
  return [...new Set(out)]
}

/**
 * La sección «Novedades» del cuerpo: { sumied, folvy, comun } con sus líneas
 * ({ apartado, frase, ruta }) o null si el grupo no está, y los fallos de forma.
 * null si no está la sección.
 */
export function novedadesDelCuerpo(cuerpo) {
  const lineas = String(cuerpo ?? '').split(/\r?\n/)
  const i = lineas.findIndex((l) => /^##\s*novedades\s*$/i.test(l.trim()))
  if (i < 0) return null
  const grupos = { sumied: null, folvy: null, comun: null }
  const fallos = []
  let actual = null
  for (const crudo of lineas.slice(i + 1)) {
    const l = crudo.trim()
    if (/^#{1,2}\s/.test(l)) break
    const h = l.match(/^###\s+(.+?)\s*$/)
    if (h) {
      const nombre = quitarTildes(h[1].toLowerCase())
      actual = nombre === 'sumied' ? 'sumied' : nombre === 'folvy' ? 'folvy' : nombre === 'comun' ? 'comun' : null
      if (!actual) fallos.push(`«### ${h[1]}» no es un grupo de Novedades: van «### Sumied», «### Folvy» y, si es de los dos, «### Común».`)
      else grupos[actual] = grupos[actual] ?? []
      continue
    }
    if (!l || !actual) continue
    if (/^[-*]?\s*ninguna\.?$/i.test(l)) continue
    const m = l.match(/^[-*]\s*\*\*([^*]+?):?\*\*:?\s*(.+)$/)
    if (!m) { fallos.push(`En «### ${GRUPOS[actual]}», «${l}» no tiene la forma «- **Apartado:** lo que cambia.»`); continue }
    let frase = m[2].trim()
    let ruta = null
    const r = frase.match(/\s*\((\/[^\s)]*)\)\s*$/)
    if (r) { ruta = r[1]; frase = frase.slice(0, r.index).trim() }
    grupos[actual].push({ apartado: m[1].trim().replace(/:$/, ''), frase, ruta })
  }
  return { ...grupos, fallos }
}

/** Lo que no cumple la sección «Novedades» de un PR, en frases. [] si cumple. */
export function revisarNovedades(cuerpo) {
  const n = novedadesDelCuerpo(cuerpo)
  if (!n) {
    return ['Falta la sección «## Novedades»: lo que cambia para quien lo usa, en una o dos frases, con «### Sumied» y «### Folvy» (o «ninguna» en cada uno). Es lo que enseña el cartel de versión nueva.']
  }
  const fallos = [...n.fallos]
  for (const g of ['sumied', 'folvy']) {
    if (n[g] === null) fallos.push(`En «## Novedades» falta «### ${GRUPOS[g]}» (con sus frases o «ninguna»).`)
  }
  for (const g of ['sumied', 'folvy', 'comun']) {
    const ls = n[g] ?? []
    if (ls.length > MAX_LINEAS) fallos.push(`«### ${GRUPOS[g]}» lleva ${ls.length} novedades: como mucho ${MAX_LINEAS}. Junta las que sean del mismo apartado.`)
    for (const x of ls) {
      const jerga = jergaDe(`${x.apartado} ${x.frase}`)
      if (jerga.length) fallos.push(`«${x.apartado}: ${x.frase}» lleva palabras de quien programa (${jerga.join(', ')}). Dilo como lo diría quien lo usa.`)
      if (x.frase.length > MAX_FRASE) fallos.push(`«${x.apartado}» tiene ${x.frase.length} caracteres: como mucho ${MAX_FRASE} (una o dos frases).`)
      if ((x.frase.match(/[.!?](\s|$)/g) ?? []).length > 2) fallos.push(`«${x.apartado}» lleva más de dos frases.`)
    }
  }
  return fallos
}

/**
 * El fichero de novedades de un PR fusionado: lo que escribe el workflow en
 * novedades/pr-<n>.json. null si no trae ninguna (no se escribe nada).
 */
export function ficheroDeNovedades({ pr, fecha, cuerpo }) {
  const n = novedadesDelCuerpo(cuerpo)
  if (!n) return null
  const lista = []
  let i = 0
  for (const producto of ['sumied', 'folvy', 'comun']) {
    for (const x of n[producto] ?? []) {
      i++
      lista.push({ id: `${pr}-${i}`, pr, fecha, producto, apartado: x.apartado, frase: x.frase, ruta: x.ruta })
    }
  }
  return lista.length ? lista : null
}
