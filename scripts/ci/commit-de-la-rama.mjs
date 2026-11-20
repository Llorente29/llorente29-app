// scripts/ci/commit-de-la-rama.mjs — el commit de «commit», comprobado al lanzar.
//
// X09 (19/11). En aplicar-produccion-conta.yml, el ensayo y el real se lanzan desde main con
// la rama en «rama» y su último commit en «commit». Si el commit iba corto o pegado dos
// veces, nadie lo decía hasta muy tarde: el 19/11 un real con el commit duplicado cayó en
// «guarda-diez» con un «exit code 128» (el git fetch de un commit que no existe), sin decir
// qué pasaba; y el 18/11 el #847 no encontró su ensayo. Aquí:
//   · validarCommit: 40 caracteres hexadecimales, que existe y que es el último de la rama;
//     si no, una frase que dice qué se ha puesto y cuál es el último;
//   · fraseSinEnsayo: si el real no encuentra su ensayo en verde, el título exacto que buscó
//     y los ensayos que hay de esa rama (con su estado y su hora);
//   · sigueSiendoElUltimo (N11, 20/11): el «Aplicar SQL en staging» de una rama, antes de aplicar
//     nada de verdad, comprueba con validarCommit que su commit sigue siendo el último de la rama.
//     El 19/11 el de un commit anterior de R esperó a su e2e (T9), acabó 82 s después que el del
//     commit nuevo y dejó en staging la semilla vieja (runs 44610968533 y 44610813373).
// Lo usa el primer job del workflow («commit»), antes de «guarda-diez»; las funciones son
// puras (tests/unit/ci/commitDeLaRama.test.ts).
//
//   node scripts/ci/commit-de-la-rama.mjs validar     (RAMA, COMMIT; mira el último con git ls-remote)
//   node scripts/ci/commit-de-la-rama.mjs sin-ensayo  (RAMA, BUSCADO, ENSAYOS=fichero con la lista de runs)
//   node scripts/ci/commit-de-la-rama.mjs vigente     (RAMA, COMMIT; sale con 1 si ya no es el último)

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const HEX40 = /^[0-9a-f]{40}$/
const PRINCIPIO = 'El commit tiene que ser el último de la rama, entero (40 caracteres).'

/** Cómo se ve lo que se ha puesto, sin perder lo raro (espacios, saltos de línea). */
function visible(x) {
  return `«${String(x).replace(/\n/g, '⏎').replace(/\t/g, '⇥')}»`
}

/** Por qué no son 40 caracteres hexadecimales, en palabras. */
function queLePasa(commit) {
  const t = String(commit)
  const limpio = t.trim()
  if (t !== limpio || /\s/.test(limpio)) return 'lleva espacios o saltos de línea'
  const mitad = limpio.length / 2
  if (limpio.length === 80 && limpio.slice(0, mitad) === limpio.slice(mitad)) return 'está pegado dos veces'
  if (/[A-F]/.test(limpio) && HEX40.test(limpio.toLowerCase())) return 'va en mayúsculas'
  if (!/^[0-9a-fA-F]*$/.test(limpio)) return 'lleva caracteres que no son de un commit (0-9 y a-f)'
  if (limpio.length < 40) return `es corto (${limpio.length} caracteres)`
  return `es largo (${limpio.length} caracteres)`
}

/**
 * ¿Vale el commit? `ultimo`: el último commit de la rama (nulo si la rama no existe);
 * `existe(sha)`: si un commit de 40 caracteres está en el repositorio (para decir si lo que
 * se ha puesto es un commit viejo o no es de nadie).
 */
export function validarCommit({ rama, commit, ultimo, existe = () => true }) {
  const r = String(rama ?? '').trim()
  const c = String(commit ?? '')
  if (!r) return { ok: true, frase: 'Sin «rama»: es una tanda ya fusionada; el commit es el de main.' }
  if (ultimo === null || ultimo === undefined || ultimo === '') return { ok: false, frase: `No existe la rama «${r}». Mira el nombre en el PR (sin espacios).` }
  const yUltimo = ` · El último es: ${ultimo}`
  if (!c.trim()) return { ok: false, frase: `${PRINCIPIO} No has puesto ninguno${yUltimo}` }
  if (!HEX40.test(c)) return { ok: false, frase: `${PRINCIPIO} Has puesto: ${visible(c)}, que ${queLePasa(c)}${yUltimo}` }
  if (c === ultimo) return { ok: true, frase: `El commit ${c} es el último de «${r}».` }
  if (!existe(c)) return { ok: false, frase: `${PRINCIPIO} Has puesto: ${c}, que no está en el repositorio${yUltimo}` }
  return { ok: false, frase: `${PRINCIPIO} Has puesto: ${c}, que no es el último de «${r}» (después ha habido otro push)${yUltimo}` }
}

/**
 * ¿Sigue siendo `commit` el último de la rama? Antes de aplicar algo de verdad desde una rama: si
 * después ha habido otro push, este run es de un commit viejo y no aplica nada (lo aplicará el run
 * del commit nuevo). La misma comprobación que validarCommit; solo cambia la frase.
 */
export function sigueSiendoElUltimo({ rama, commit, ultimo }) {
  const r = validarCommit({ rama, commit, ultimo })
  if (r.ok) return r
  if (ultimo === null || ultimo === undefined || ultimo === '') {
    return { ok: false, frase: `No he podido leer el último commit de «${String(rama ?? '').trim()}» · Este run no aplica nada` }
  }
  return { ok: false, frase: `Hay un commit más nuevo en la rama: ${ultimo} · Este run no aplica nada (es de ${String(commit).slice(0, 7)})` }
}

const hora = (iso) => {
  try {
    return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '')
  } catch { return iso }
}
const ESTADO = { success: 'en verde', failure: 'en rojo', cancelled: 'cancelado', skipped: 'saltado', timed_out: 'se pasó de tiempo' }

/**
 * El real no ha encontrado su ensayo: el título exacto que buscó y los ensayos que hay de esa
 * rama (de la lista de runs del workflow), los más nuevos primero, con su estado y su hora.
 */
export function fraseSinEnsayo({ buscado, rama, runs, max = 8 }) {
  const deLaRama = (runs ?? [])
    .filter((x) => String(x.display_title ?? '').startsWith(`ensayo · ${rama} · `))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const l = [`No hay ningún ENSAYO en verde lanzado desde main con el título exacto «${buscado}». Primero el ensayo de este commit, luego el real.`]
  if (!deLaRama.length) l.push(`De «${rama}» no hay ningún ensayo.`)
  else {
    l.push(`De «${rama}» hay ${deLaRama.length === 1 ? 'este' : `estos ${deLaRama.length}`}:`)
    for (const x of deLaRama.slice(0, max)) {
      const estado = x.status === 'completed' ? (ESTADO[x.conclusion] ?? x.conclusion) : 'en marcha'
      const desde = x.head_branch === 'main' ? '' : `, lanzado desde «${x.head_branch}» (no cuenta)`
      l.push(`  · «${x.display_title}» · ${estado} · ${hora(x.created_at)}${desde}`)
    }
    if (deLaRama.length > max) l.push(`  … y ${deLaRama.length - max} más.`)
  }
  return l.join('\n')
}

// ── Desde el workflow ──────────────────────────────────────────────────────────

/** El último commit de la rama, del remoto (nulo si no existe o no se puede leer). */
function ultimoDe(rama) {
  if (!String(rama ?? '').trim()) return null
  try { return execFileSync('git', ['ls-remote', 'origin', `refs/heads/${rama.trim()}`], { encoding: 'utf8' }).split('\t')[0].trim() || null } catch { return null }
}

function main() {
  const que = process.argv[2]
  const resumen = (t) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${t}\n\n`) }
  if (que === 'vigente') {
    const r = sigueSiendoElUltimo({ rama: process.env.RAMA ?? '', commit: process.env.COMMIT ?? '', ultimo: ultimoDe(process.env.RAMA ?? '') })
    console.log(r.frase)
    if (!r.ok) { resumen(`⏭️ ${r.frase}`); console.log(`::notice::${r.frase}`); process.exit(1) }
    return
  }
  if (que === 'validar') {
    const rama = process.env.RAMA ?? ''
    const ultimo = ultimoDe(rama)
    const existe = (sha) => {
      try { execFileSync('git', ['fetch', '-q', '--depth=1', 'origin', sha], { stdio: 'ignore' }); return true } catch { return false }
    }
    const r = validarCommit({ rama, commit: process.env.COMMIT ?? '', ultimo, existe })
    console.log(r.frase)
    resumen(`${r.ok ? '✅' : '❌'} ${r.frase}`)
    if (!r.ok) { console.log(`::error::${r.frase}`); process.exit(1) }
    return
  }
  if (que === 'sin-ensayo') {
    const runs = JSON.parse(readFileSync(process.env.ENSAYOS, 'utf8')).workflow_runs ?? []
    const frase = fraseSinEnsayo({ buscado: process.env.BUSCADO ?? '', rama: process.env.RAMA ?? '', runs })
    console.log(frase)
    resumen(frase)
    console.log(`::error::${frase.split('\n')[0]}`)
    process.exit(1)
  }
  console.error('Uso: node scripts/ci/commit-de-la-rama.mjs validar|sin-ensayo|vigente')
  process.exit(2)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
