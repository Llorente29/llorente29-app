// scripts/gen-types.mjs
//
// Regenera src/types/database.ts desde la BD viva y lo deja LIMPIO:
//   1) supabase gen types typescript (--project-id, --schema public)
//   2) quita BOM (escribe UTF-8 sin BOM, determinista en Windows/Unix)
//   3) LIMPIEZA (scripts/lib/limpiarTipos.mjs): quita del TIPO (no de la BD)
//      las entidades que envenenan la inferencia de supabase-js (las de PostGIS
//      y, desde el 05/10, goods_receipt_posting_status y vat_category_rate), y
//      deja account_id opcional al insertar donde lo rellena trg_fill_acc.
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
import { CON_FILL_ACC, SIN_TIPO, limpiarTipos } from './lib/limpiarTipos.mjs'

const OUT = 'src/types/database.ts'

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

// 2) y 3) Limpieza: BOM, entidades que rompen la inferencia y account_id
// opcional donde lo rellena trg_fill_acc (scripts/lib/limpiarTipos.mjs).
const { texto, quitadas, opcionales } = limpiarTipos(raw)
writeFileSync(OUT, texto, { encoding: 'utf8' })
console.error(`gen:types → ${OUT} · quitadas del tipo: ${quitadas.length}/${SIN_TIPO.length} (${quitadas.join(', ')}) · account_id opcional al insertar: ${opcionales}/${CON_FILL_ACC.length}`)
