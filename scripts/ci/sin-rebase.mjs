#!/usr/bin/env node
// scripts/ci/sin-rebase.mjs <antes> <despues>
//
// W12 · Regla T8 (29/10): en la rama de un PR, merge y nunca rebase. Un rebase o
// un push forzado reescribe la historia: el commit que ya estaba en el PR deja
// de estar en la del nuevo, y quien tenía la rama (otra sesión, Julio) se queda
// con una historia que ya no existe. Del 17 al 29/10 pasó en 3 ramas
// (l1a-fichar-en-el-servidor, i01c-trimestre y p01-despacho).
//
// Lo mira pr-a-main en cada push a un PR (synchronize): pregunta a GitHub cómo
// queda el commit de antes frente al nuevo (compare). «ahead» o «identical»:
// la historia sigue. «diverged» o «behind»: se ha reescrito, y sale en rojo.
// Reiniciar una rama cuyo PR ya se fusionó no pasa por aquí: va en un PR nuevo.

import { execFileSync } from 'node:child_process'

/** El mensaje si la historia se ha reescrito (qué ha pasado, dónde y qué hacer); null si sigue. */
export function veredicto(estado, antes, despues, run = '') {
  if (estado === 'ahead' || estado === 'identical') return null
  const a = antes.slice(0, 8), d = despues.slice(0, 8)
  return `La rama del PR se ha reescrito (un rebase o un push forzado): el commit ${a}, que ya estaba en el PR, no está en la historia del nuevo, ${d}. `
    + `Dónde: el push que llevó la rama de ${a} a ${d}${run ? ` (ejecución ${run})` : ''}. `
    + `Qué hacer: en la rama de un PR, nunca rebase ni push forzado. Para traer main, «git merge origin/main» y un push normal. `
    + `Para recuperar lo que se haya perdido, haz merge del commit ${a} («git merge ${a}») y vuelve a empujar.`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [antes, despues] = process.argv.slice(2)
  if (!antes || /^0+$/.test(antes)) { console.log('Primer push del PR: no hay historia de antes que comparar.'); process.exit(0) }
  const estado = execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/compare/${antes}...${despues}`, '-q', '.status'], { encoding: 'utf8' }).trim()
  const m = veredicto(estado, antes, despues, process.env.GITHUB_RUN_ID ?? '')
  if (m) { console.log(`::error::${m}`); process.exit(1) }
  console.log(`La historia sigue: ${antes.slice(0, 8)} está en la de ${despues.slice(0, 8)} (${estado}).`)
}
