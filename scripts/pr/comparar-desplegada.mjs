// scripts/pr/comparar-desplegada.mjs
//
// W06 (Julio, 22/10) · ¿Lo desplegado de una función es lo del repositorio,
// fichero a fichero? Lo usa deploy-edge-functions después de desplegar.
//
//   node scripts/pr/comparar-desplegada.mjs <función> <carpeta bajada> <supabase/functions>
//     → una línea por fichero («  igual», «  DIFIERE», «  FALTA», «  SOBRA»);
//       sale con 1 si alguno no es «igual» o si no se ha bajado nada.
//
// La carpeta bajada es lo que deja «supabase functions download --use-api»:
// cada fichero se lleva a su ruta dentro de supabase/functions por lo que
// sigue a «functions/» en su ruta (la última vez que aparece), o tal cual si
// no lo lleva. Tiene que estar la entrada (<función>/index.ts) y cada fichero
// que la función usa en el repositorio.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ficherosDeFuncion } from './importsDeFunciones.mjs'

/** La ruta, dentro de supabase/functions, de un fichero bajado. */
export function rutaEnFunciones(rutaBajada) {
  const r = rutaBajada.split(sep).join('/').replace(/^\.?\/+/, '')
  const i = r.lastIndexOf('functions/')
  return i >= 0 ? r.slice(i + 'functions/'.length) : r
}

function todos(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...todos(p))
    else out.push(p)
  }
  return out
}

/**
 * Compara lo bajado (ruta → bytes) con el repositorio. `usa`: las rutas (dentro
 * de supabase/functions) que la función usa en el repositorio.
 */
export function comparar(fn, bajados, leerRepo, usa) {
  const lineas = []
  let bien = bajados.size > 0
  if (!bajados.size) lineas.push(`  NADA no se ha bajado ningún fichero de ${fn}`)
  for (const [ruta, b] of [...bajados].sort(([a], [c]) => a.localeCompare(c))) {
    const r = leerRepo(ruta)
    if (!r) { lineas.push(`  SOBRA ${ruta} (desplegado, y no está en el repositorio)`); bien = false; continue }
    if (Buffer.compare(Buffer.from(b), Buffer.from(r)) !== 0) { lineas.push(`  DIFIERE ${ruta}`); bien = false; continue }
    lineas.push(`  igual ${ruta}`)
  }
  for (const u of [...new Set([`${fn}/index.ts`, ...usa])].sort()) {
    if (!bajados.has(u)) { lineas.push(`  FALTA ${u} (la función lo usa y no está desplegado)`); bien = false }
  }
  return { bien, lineas }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fn, bajada, raiz] = process.argv.slice(2)
  if (!fn || !bajada || !raiz) { console.error('uso: comparar-desplegada.mjs <función> <carpeta bajada> <supabase/functions>'); process.exit(2) }
  const bajados = new Map()
  if (existsSync(bajada)) for (const f of todos(bajada)) bajados.set(rutaEnFunciones(relative(bajada, f)), readFileSync(f))
  const leerRepo = (r) => (existsSync(join(raiz, r)) ? readFileSync(join(raiz, r)) : null)
  const usa = ficherosDeFuncion(fn, raiz, { soloEjecucion: true }).map((f) => f.slice(raiz.length + 1))
  const { bien, lineas } = comparar(fn, bajados, leerRepo, usa)
  console.log(`${fn}:`)
  for (const l of lineas) console.log(l)
  process.exit(bien ? 0 : 1)
}
