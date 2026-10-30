#!/usr/bin/env node
// scripts/ci/esperar-e2e.mjs [minutos]
//
// W12 · Regla T9 (29/10): nunca una e2e de staging y un ensayo a la vez en la
// misma rama. El ensayo de producción y la prueba de staging (aplicar-staging
// desde una rama) esperan a que acabe la e2e de SU rama; entre ramas distintas
// no hay cerrojo (W04). Con tope: si la e2e no acaba en `minutos` (45 por
// defecto), en rojo, diciendo cuál y qué hacer.
//
// Por qué: del 17 al 29/10, 6 de los 112 ensayos de producción corrieron con
// una e2e de su rama en marcha (el 308 del B01c con la e2e 1067, entre ellos),
// y el 29/10 el 180 tuvo un interbloqueo justo por esto.
//
// Va en un job aparte, ANTES del que aplica y sin su cola (concurrency): esperar
// aquí no deja parado el «aplicar» de las demás ramas.

import { execFileSync } from 'node:child_process'

/** Las e2e de la rama que aún no han acabado. */
export const enMarcha = (runs) => runs.filter((r) => r.status !== 'completed')

/** Qué ha pasado, dónde y qué hacer, cuando se pasa el tope. */
export function mensajeTope(rama, minutos, runs, servidor, repo) {
  const enlaces = runs.map((r) => `${servidor}/${repo}/actions/runs/${r.id}`).join(' y ')
  return `La e2e de la rama «${rama}» sigue en marcha después de ${minutos} minutos: no se ensaya a la vez que ella (regla T9), y este run se para. `
    + `Dónde: ${enlaces}. `
    + `Qué hacer: espera a que acabe y vuelve a lanzar este run. Si la e2e está atascada, cancélala antes.`
}

const dormir = (s) => new Promise((r) => setTimeout(r, s * 1000))

if (import.meta.url === `file://${process.argv[1]}`) {
  const minutos = Number(process.argv[2] ?? 45)
  // W12b: desde main, la rama nombrada en «rama» (RAMA); si no, la del run.
  const repo = process.env.GITHUB_REPOSITORY, rama = process.env.RAMA || process.env.GITHUB_REF_NAME
  const leer = () => enMarcha(JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/workflows/e2e-staging-conta.yml/runs?branch=${encodeURIComponent(rama)}&per_page=20`,
    '-q', '.workflow_runs | map({id, status, created_at})'], { encoding: 'utf8' })))
  const hasta = Date.now() + minutos * 60_000
  // Un push lanza la e2e y este run a la vez: unos segundos para que la e2e exista.
  await dormir(15)
  let ahora = leer()
  if (!ahora.length) { console.log(`Ninguna e2e de «${rama}» en marcha: sigue.`); process.exit(0) }
  console.log(`Esperando a la e2e de «${rama}»: ${ahora.map((r) => r.id).join(', ')} (como mucho ${minutos} min).`)
  while (ahora.length && Date.now() < hasta) { await dormir(30); ahora = leer() }
  if (ahora.length) { console.log(`::error::${mensajeTope(rama, minutos, ahora, process.env.GITHUB_SERVER_URL, repo)}`); process.exit(1) }
  console.log(`La e2e de «${rama}» ha acabado: sigue.`)
}
