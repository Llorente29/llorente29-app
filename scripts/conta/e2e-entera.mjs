#!/usr/bin/env node
// scripts/conta/e2e-entera.mjs [commit]
//
// C06b (respuesta 6 de Julio, tarea 5): antes de pedir tanda o abrir un PR a
// main, la suite e2e ENTERA tiene que haber pasado en verde EN ESTE COMMIT.
// En un push solo corre la carpeta del frente (e2e-staging-conta.yml); la
// entera se lanza a mano y su título lo dice: «e2e · entera · <rama> · <commit>».
// Esto pregunta a la API pública de GitHub (el repositorio es público: sin
// credenciales) y sale con 1 si no la hay.
//
//   node scripts/conta/e2e-entera.mjs            → el commit de HEAD
//   node scripts/conta/e2e-entera.mjs <sha>

import { execFileSync } from 'node:child_process'

const REPO = 'Llorente29/llorente29-app'
const sha = process.argv[2] ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const url = `https://api.github.com/repos/${REPO}/actions/workflows/e2e-staging-conta.yml/runs?head_sha=${sha}&per_page=100`

/**
 * De los runs de ese commit, la entera en verde (o null y por qué no).
 *
 * W02 (paso 1c, 16/10): la entera corre en 4 trozos y el run sale en verde solo
 * si los 4 lo están y entre todos han pasado todos los ficheros (el job
 * «entera» del workflow). Y cuenta solo en su PRIMER intento: relanzar el trozo
 * que falló («Re-run failed jobs») sirve para diagnosticar, pero un verde así
 * es un reintento, y los valores para producción salen de una entera en verde
 * de una vez.
 */
export function enteraEnVerde(runs, commit) {
  const enteras = runs.filter((r) => r.head_sha === commit && / · entera · /.test(r.display_title ?? ''))
  const verde = enteras.find((r) => r.status === 'completed' && r.conclusion === 'success' && (r.run_attempt ?? 1) === 1)
  if (verde) return { ok: true, run: verde }
  if (!enteras.length) return { ok: false, porque: 'no hay ninguna suite entera de este commit: lánzala a mano (Actions → «Pruebas e2e en staging-conta» → Run workflow, «pruebas» vacío)' }
  const repetida = enteras.find((r) => r.status === 'completed' && r.conclusion === 'success')
  if (repetida) return { ok: false, porque: `la entera de este commit salió en verde en el intento ${repetida.run_attempt} (run ${repetida.id}): un trozo relanzado sirve para diagnosticar, no como entera. Lánzala otra vez entera` }
  const ultima = enteras[0]
  return { ok: false, porque: `la suite entera de este commit está ${ultima.status === 'completed' ? `en ${ultima.conclusion}` : 'sin acabar'} (run ${ultima.id})` }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Con curl: respeta el proxy del entorno (fetch de Node sale directo y la API
  // anónima tiene un límite por IP). Con GITHUB_TOKEN, autenticado.
  const cab = ['-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: folvy-antes-de-subir']
  if (process.env.GITHUB_TOKEN) cab.push('-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`)
  let cuerpo
  try { cuerpo = JSON.parse(execFileSync('curl', ['-sS', '--fail-with-body', ...cab, url], { encoding: 'utf8' })) } catch (e) {
    console.error(`✗ No he podido preguntar a GitHub: ${String(e.stdout || e.message).slice(0, 200)}`); process.exit(1)
  }
  const runs = cuerpo.workflow_runs ?? []
  const v = enteraEnVerde(runs, sha)
  if (!v.ok) { console.error(`✗ e2e entera de ${sha.slice(0, 7)}: ${v.porque}.`); process.exit(1) }
  console.log(`e2e entera de ${sha.slice(0, 7)} en verde: run ${v.run.id}.`)
}
