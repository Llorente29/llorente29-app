// scripts/pr/importsDeFunciones.mjs
//
// Qué ficheros de _shared usa cada edge function, directa o indirectamente,
// siguiendo los imports relativos desde los ficheros de su carpeta. Lo usan
// pr-a-main (la lista «Funciones a desplegar a mano») y deploy-edge-functions
// (qué redesplegar cuando cambia _shared): una sola cuenta para los dos.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

export const RAIZ = 'supabase/functions'

// Un «import type …» o «export type … from» lo quita Deno al empaquetar: el
// fichero que solo se importa así no se despliega (catcherTipos.ts, 22/10).
const SOLO_TIPOS = /(?:^|[;\n])\s*(?:import|export)\s+type\s[^;]*?from\s*['"][^'"]+['"]/g

const importsDe = (fichero, soloEjecucion = false) => {
  if (!existsSync(fichero)) return []
  let src = readFileSync(fichero, 'utf8')
  if (soloEjecucion) src = src.replace(SOLO_TIPOS, '\n')
  return [...src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => normalize(join(dirname(fichero), m[1])))
}

/**
 * Todos los ficheros que usa una función: los de su carpeta y lo que importan,
 * directa o indirectamente. Con `soloEjecucion`, sin los que solo se importan
 * como tipos: los que de verdad van en lo desplegado.
 */
export function ficherosDeFuncion(fn, raiz = RAIZ, { soloEjecucion = false } = {}) {
  const dir = join(raiz, fn)
  const vistos = new Set()
  const pendientes = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f)).map((f) => join(dir, f))
  while (pendientes.length) {
    const f = pendientes.pop()
    if (vistos.has(f) || !existsSync(f)) continue
    vistos.add(f)
    pendientes.push(...importsDe(f, soloEjecucion))
  }
  return [...vistos].sort()
}

/** { función: [rutas de _shared que importa, directa o indirectamente] } */
export function importaDeFunciones(raiz = RAIZ) {
  const importa = {}
  for (const fn of readdirSync(raiz).sort()) {
    if (fn === '_shared' || !statSync(join(raiz, fn)).isDirectory()) continue
    importa[fn] = ficherosDeFuncion(fn, raiz).filter((f) => f.startsWith(`${raiz}/_shared/`))
  }
  return importa
}
