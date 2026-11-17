#!/usr/bin/env node
// scripts/e2e/ultima-noche.mjs — la última noche REAL de main: la que corrió pruebas.
//
// Q02 (17/11). Cada noche hay dos disparos (01:00 y 02:00 UTC) y solo corre el
// que en Madrid son las 03:00. Hasta el Q02 el otro acababa en verde en 10 s
// sin pasar ni una prueba, y el 17/11 se tomó por «la e2e de las 09:39 en
// verde». Aquí una noche es REAL si su job «entera» llegó a correr (no saltado
// ni cancelado): el disparo que no toca nunca lo es, ni antes ni después del Q02.
//
// Si la noche se repitió por staging, manda lo que dijo la repetición (su
// «noche-resumen» lleva el run de la noche en «noche»).
//
//   node scripts/e2e/ultima-noche.mjs anterior --antes-de <run> --salida <resumen.json>
//        → el resumen de la última noche real ANTERIOR a ese run (o «null»).
//   node scripts/e2e/ultima-noche.mjs pr
//        → unas líneas para el resumen de un PR: fecha, ficheros en rojo y enlace.
//   node scripts/e2e/ultima-noche.mjs comparar <informe.json>
//        → para una entera lanzada a mano: lo que también falla en la noche y lo
//          que solo falla aquí.
//
// Necesita `gh` con permiso de leer Actions (GH_TOKEN) y GITHUB_REPOSITORY.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fallos, fechaDeMadrid, resumen as resumenDe } from './noche.mjs'

const WORKFLOW = 'e2e-staging-conta.yml'

/** ¿Corrió pruebas? Su job «entera» acabó en algo que no es «saltado» ni «cancelado». */
export function esNocheReal(jobs) {
  return (jobs ?? []).some((j) => j.name === 'entera' && j.conclusion && !['skipped', 'cancelled'].includes(j.conclusion))
}

/**
 * La última noche real, de las de «schedule» sobre main (las más nuevas
 * primero), sin contar la de «antesDe» ni las posteriores.
 */
export async function ultimaNoche({ noches, jobsDe, antesDe = null, mirarComoMucho = 20 }) {
  let vistas = 0
  for (const r of noches) {
    if (antesDe && Number(r.id) >= Number(antesDe)) continue
    if (r.status !== 'completed' || r.conclusion === 'cancelled') continue
    if (++vistas > mirarComoMucho) break
    if (esNocheReal(await jobsDe(r.id))) return r
  }
  return null
}

/**
 * El resumen de esa noche: el de su repetición si la hubo, si no el suyo, y si
 * es de antes del Q02 (sin «noche-resumen»), el que sale de su informe JSON.
 */
export async function resumenDeLaNoche(noche, { repeticiones = [], descargar }) {
  const base = { fecha: fechaDeMadrid(noche.created_at), enlace: noche.html_url }
  for (const rep of repeticiones) {
    if (new Date(rep.created_at) < new Date(noche.created_at)) continue
    const r = await descargar(rep.id, 'noche-resumen')
    if (r && String(r.noche) === String(noche.id)) return { ...r, ...base, enlace: rep.html_url, repetida: true }
  }
  const propio = await descargar(noche.id, 'noche-resumen')
  if (propio) return { ...propio, ...base }
  const informe = await descargar(noche.id, 'informe-json')
  if (informe) return { ...resumenDe({ fallos: fallos(informe), run: noche.id, sha: noche.head_sha, fecha: base.fecha }), ...base }
  return null
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/** Para el resumen de un PR. No bloquea: solo lo dice. */
export function lineasPr(r) {
  if (!r) return ['**La última noche real de `main`:** no se ha encontrado (o su informe ya no está).']
  const estado = r.ficheros.length ? `**${plural(r.ficheros.length, 'fichero', 'ficheros')} en rojo**` : '**en verde**'
  const l = [`**La última noche real de \`main\` (${r.fecha}):** ${estado}${r.repetida ? ', después de repetir lo de staging' : ''}. ${r.enlace}`]
  if (r.ficheros.length) l.push('', 'Si tu PR falla en alguno de estos, ya fallaba en `main`: ' + r.ficheros.map((f) => `\`${f.replace('tests/e2e/', '')}\``).join(', ') + '.')
  l.push('', '*No bloquea fusionar: es para que se sepa.*')
  return l
}

/** Para una entera lanzada a mano en una rama: qué es de la rama y qué ya estaba en main. */
export function compararConLaNoche(f, r) {
  const rojos = [...new Set(f.map((x) => x.fichero))].sort()
  if (!rojos.length) return ['**En esta entera no ha fallado ninguna prueba.**']
  if (!r) return [`**${plural(rojos.length, 'fichero', 'ficheros')} en rojo.** No se ha encontrado la última noche real de \`main\` para comparar.`]
  const enMain = new Set(r.ficheros)
  const tambien = rojos.filter((x) => enMain.has(x))
  const solo = rojos.filter((x) => !enMain.has(x))
  const n = (fi) => f.filter((x) => x.fichero === fi).length
  const l = [`**${plural(rojos.length, 'fichero', 'ficheros')} en rojo: ${solo.length} solo en esta rama, ${tambien.length} que también fallan en \`main\`** (la noche real del ${r.fecha}: ${r.enlace}).`, '']
  l.push(`### Solo fallan en esta rama (${solo.length})`, '')
  if (solo.length) for (const fi of solo) l.push(`- \`${fi}\` (${plural(n(fi), 'prueba', 'pruebas')})`)
  else l.push('Ninguno: todo lo que falla aquí falla también en `main`.')
  l.push('', `### También fallan en la noche de \`main\` (${tambien.length})`, '')
  for (const fi of tambien) l.push(`- \`${fi}\` (${plural(n(fi), 'prueba', 'pruebas')})`)
  return l
}

// ── Lo que habla con GitHub (solo en el CLI) ──────────────────────────────────

const repo = () => process.env.GITHUB_REPOSITORY
const api = (ruta) => JSON.parse(execFileSync('gh', ['api', ruta], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const runs = (evento) => api(`repos/${repo()}/actions/workflows/${WORKFLOW}/runs?branch=main&event=${evento}&status=completed&per_page=40`).workflow_runs
const jobsDe = async (id) => api(`repos/${repo()}/actions/runs/${id}/jobs?per_page=50`).jobs
async function descargar(id, nombre) {
  const dir = mkdtempSync(join(tmpdir(), 'noche-'))
  try {
    execFileSync('gh', ['run', 'download', String(id), '--repo', repo(), '-n', nombre, '-D', dir], { stdio: 'ignore' })
  } catch { return null }
  const f = join(dir, nombre === 'noche-resumen' ? 'noche-resumen.json' : 'informe.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}
async function laUltima(antesDe = null) {
  const noche = await ultimaNoche({ noches: runs('schedule'), jobsDe, antesDe })
  if (!noche) return null
  const repeticiones = runs('workflow_dispatch').filter((r) => /^e2e · repetición de la noche/.test(r.display_title ?? r.name ?? ''))
  return resumenDeLaNoche(noche, { repeticiones, descargar })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modo, ...args] = process.argv.slice(2)
  const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? '' : undefined }
  if (modo === 'anterior') {
    const r = await laUltima(valor('--antes-de') || null)
    writeFileSync(valor('--salida'), JSON.stringify(r, null, 1))
    console.log(r ? `La noche real anterior: ${r.fecha}, ${r.ficheros.length} ficheros en rojo (${r.enlace}).` : 'No hay noche real anterior con su lista.')
  } else if (modo === 'pr') {
    console.log(lineasPr(await laUltima()).join('\n'))
  } else if (modo === 'comparar') {
    const ruta = args[0]
    const informe = ruta && existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null
    console.log(compararConLaNoche(informe ? fallos(informe) : [], await laUltima()).join('\n'))
  } else {
    console.error('Uso: ultima-noche.mjs anterior --antes-de <run> --salida <f> | pr | comparar <informe.json>')
    process.exit(2)
  }
}
