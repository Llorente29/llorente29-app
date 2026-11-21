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
//
// Y las VISTAS PREVIAS de las ramas (Julio, 20/11, para ahorrar en Vercel): se
// saltan, salvo que la rama tenga en Vercel su base de staging-conta
// (VITE_SUPABASE_URL de vista previa con REF_STAGING). Medido el 20/11: 66 de
// cada 100 despliegues eran vistas previas que la guarda (build/guardaVistaPrevia.ts)
// tiraba DESPUÉS de instalar y pasar `tsc -b` (~1,5 min de 4 núcleos cada una),
// y las de ramas fuera de conta/ salían verdes contra la base de PRODUCCIÓN.
// Nadie las usa: las pruebas van a staging. Producción (main) no cambia.

import { execFileSync } from 'node:child_process'
import { CARPETAS } from '../conta/capturas.mjs'

export const MARCA = 'Capturas en producción ·'

// El mismo ref que REF_STAGING_CONTA de build/guardaVistaPrevia.ts (lo vigila una prueba).
export const REF_STAGING = 'oseymswjlzplqoxrfjzi'

/** true = saltar el build de una vista previa: solo se construye si su base es staging-conta. */
export function saltarVistaPrevia({ entorno, urlBase }) {
  if (entorno !== 'preview') return false
  return !String(urlBase ?? '').includes(REF_STAGING)
}

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
    if (saltarVistaPrevia({ entorno: process.env.VERCEL_ENV, urlBase: process.env.VITE_SUPABASE_URL })) {
      console.log(`saltar-build: SE SALTA · vista previa de «${process.env.VERCEL_GIT_COMMIT_REF ?? '?'}» sin base de staging-conta (las pruebas van a staging)`)
      process.exit(0)
    }
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
