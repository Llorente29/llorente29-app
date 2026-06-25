// scripts/gen-types.mjs
//
// Regenera src/types/database.ts desde la BD viva y lo deja LIMPIO:
//   1) supabase gen types typescript (--project-id, --schema public)
//   2) quita BOM (escribe UTF-8 sin BOM, determinista en Windows/Unix)
//   3) SCRUB: elimina las entidades de sistema de PostGIS que viven en `public`
//      (spatial_ref_sys, geography_columns, geometry_columns). Esas vistas/tabla
//      envenenan la inferencia de tipos de supabase-js (rompen `from(string)` y
//      los selects con relaciones embebidas en ~14 servicios). PostGIS se queda
//      en `public`; solo las ocultamos del TYPE generado, no de la BD.
//
// Uso: npm run gen:types
//
// Nota: invoca el CLI `supabase` GLOBAL del sistema (no `npx`): el binario local
// de la devDependency está en cuarentena por McAfee en esta máquina, así que
// `npx supabase` falla con ENOENT. Como npm antepone node_modules/.bin al PATH
// (donde vive el shim local roto), limpiamos del PATH las entradas node_modules
// para que `supabase` resuelva al global. Funciona con --linked (proyecto ya
// linkeado). Portable: cualquier máquina con supabase global en PATH.

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { delimiter } from 'node:path'

const OUT = 'src/types/database.ts'
const TARGETS = ['spatial_ref_sys', 'geography_columns', 'geometry_columns']

// PATH sin las entradas node_modules (evita el shim local roto de supabase).
const cleanPath = (process.env.PATH || '')
  .split(delimiter)
  .filter(p => !/node_modules/i.test(p))
  .join(delimiter)

// 1) Generar (stderr heredado → los avisos del CLI no contaminan el fichero).
let raw = execSync(
  `supabase gen types typescript --linked --schema public`,
  {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PATH: cleanPath, Path: cleanPath },
  },
)

// 2) Quita BOM si lo hubiera.
raw = raw.replace(/^﻿/, '')

// 3) Scrub por emparejamiento de llaves: borra el bloque `name: { ... }` completo.
const lines = raw.split('\n')
const out = []
let removed = 0
for (let i = 0; i < lines.length;) {
  const m = lines[i].match(/^\s+(spatial_ref_sys|geography_columns|geometry_columns): \{\s*$/)
  if (m) {
    let depth = 0, started = false, j = i
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') depth--
      }
      if (started && depth === 0) break
    }
    removed++
    i = j + 1
    continue
  }
  out.push(lines[i])
  i++
}

writeFileSync(OUT, out.join('\n'), { encoding: 'utf8' })
console.error(`gen:types → ${OUT} · entidades PostGIS de sistema eliminadas: ${removed}/${TARGETS.length}`)
