#!/usr/bin/env node
// scripts/vercel/saltar-build.mjs
//
// W08b (Julio, 28/10). El «ignoreCommand» de vercel.json: decide si Vercel se
// salta el build de un commit. Vercel lo corre antes de construir: salir con 0
// = SALTAR, salir con 1 = construir.
//
// Se salta UNO solo: el commit que deja en main las capturas de un PR fusionado
// (capturas-al-cerrar.yml). Ese commit solo cambia PNG de las carpetas de
// capturas, y construirlo sería un despliegue de producción con el mismo código
// que el de la fusión de un minuto antes. Para saltarlo tienen que darse LAS
// TRES cosas:
//   · el mensaje empieza por la marca del bot (MARCA);
//   · todos los ficheros que cambia son de las carpetas de capturas;
//   · cambia al menos uno.
// Ante cualquier duda (sin el commit de antes, git falla, un fichero que no es
// captura) se construye: saltarse un despliegue de verdad es peor que hacer uno
// de más.

import { execFileSync } from 'node:child_process'
import { CARPETAS } from '../conta/capturas.mjs'

export const MARCA = 'Capturas en producción ·'

/** true = saltar el build. */
export function saltarBuild({ mensaje, ficheros }) {
  if (!String(mensaje ?? '').startsWith(MARCA)) return false
  if (!Array.isArray(ficheros) || ficheros.length === 0) return false
  return ficheros.every((f) => CARPETAS.some((c) => f.startsWith(`${c}/`)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let decision = false
  let porque = ''
  try {
    const mensaje = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? execFileSync('git', ['log', '-1', '--format=%B'], { encoding: 'utf8' })
    const ficheros = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
    decision = saltarBuild({ mensaje, ficheros })
    porque = decision ? `solo capturas (${ficheros.length}) del bot` : 'no es solo un commit de capturas del bot'
  } catch (e) {
    porque = `no se pudo comprobar (${e instanceof Error ? e.message.split('\n')[0] : e}): se construye`
  }
  console.log(`saltar-build: ${decision ? 'SE SALTA' : 'se construye'} · ${porque}`)
  process.exit(decision ? 0 : 1)
}
