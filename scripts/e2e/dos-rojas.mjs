#!/usr/bin/env node
// scripts/e2e/dos-rojas.mjs
//
// W12 · Regla T6 (29/10): un solo push a staging por paso; si la e2e de una rama
// sale en rojo dos veces seguidas, la sesión para y avisa: no hay un tercer
// intento. Del 17 al 29/10, 9 de las 103 ramas con push encadenaron 3 o más
// e2e en rojo (hasta 5: i01c-trimestre y v03-e2), cada una con su build, su
// carril y sus minutos de staging.
//
// La mira el primer job de e2e-staging-conta (plan), solo en un PUSH: si las
// dos últimas e2e acabadas de la rama (push o a mano, sin contar las
// canceladas) salieron en rojo, esta para enseguida y dice qué hacer. Lo que la
// desbloquea es una e2e en verde lanzada a mano por Julio (workflow_dispatch):
// cuenta como la última, y la racha se rompe.

import { execFileSync } from 'node:child_process'

/** ¿Para? Con las e2e de la rama, de la más nueva a la más vieja, sin la de ahora. */
export function decidir(runs, actual) {
  const acabadas = runs.filter((r) => r.id !== actual && r.status === 'completed' && (r.conclusion === 'failure' || r.conclusion === 'success'))
  const [a, b] = acabadas
  if (a?.conclusion === 'failure' && b?.conclusion === 'failure') return { para: true, rojas: [a, b] }
  return { para: false, rojas: [] }
}

/** Qué ha pasado, dónde y qué hacer. */
export function mensaje(rama, rojas, servidor, repo) {
  const enlaces = rojas.map((r) => `${servidor}/${repo}/actions/runs/${r.id}`).join(' y ')
  return `Las dos últimas e2e de la rama «${rama}» salieron en rojo: esta no corre (regla T6: no hay un tercer intento). `
    + `Dónde: ${enlaces}. `
    + `Qué hacer: para y avisa a Julio con los dos enlaces y lo que has visto en ellos. La rama se desbloquea con una e2e en verde lanzada a mano por Julio (Run workflow).`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.GITHUB_REPOSITORY, rama = process.env.GITHUB_REF_NAME, actual = Number(process.env.GITHUB_RUN_ID)
  const salida = execFileSync('gh', ['api', `repos/${repo}/actions/workflows/e2e-staging-conta.yml/runs?branch=${encodeURIComponent(rama)}&per_page=20`,
    '-q', '.workflow_runs | map({id, status, conclusion, event}) | map(select(.event == "push" or .event == "workflow_dispatch"))'], { encoding: 'utf8' })
  const r = decidir(JSON.parse(salida), actual)
  if (r.para) { console.log(`::error::${mensaje(rama, r.rojas, process.env.GITHUB_SERVER_URL, repo)}`); process.exit(1) }
  console.log(`La rama «${rama}» no lleva dos e2e seguidas en rojo: sigue.`)
}
