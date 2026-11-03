// build/novedadesPlugin.ts
//
// NV1 (Julio, 03/11) · LAS NOVEDADES LAS PUBLICA EL BUILD, CON SU VERSIÓN.
//
// Cada PR fusionado deja sus frases en novedades/pr-<n>.json
// (novedades-al-fusionar.yml). Este plugin, en cada build:
//   1. las junta en `dist/novedades.json`, de lo más nuevo a lo más antiguo: lo
//      que lee el cartel de versión nueva y Ayuda › Novedades;
//   2. sella en el bundle los ids de las que conoce (__NOVEDADES_IDS__): el
//      cartel enseña las que trae lo publicado y no lo que se está ejecutando.
// Un fichero que no se puede leer para el build: una novedad rota que no sale
// es una versión que no dice qué trae.

import type { Plugin } from 'vite'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface Novedad { id: string; pr: number; fecha: string; producto: 'sumied' | 'folvy' | 'comun'; apartado: string; frase: string; ruta: string | null }

/** Las novedades de la carpeta, de lo más nuevo a lo más antiguo (fecha, y dentro de un PR, su orden). */
export function leerNovedades(carpeta = 'novedades'): Novedad[] {
  if (!existsSync(carpeta)) return []
  const out: Novedad[] = []
  for (const f of readdirSync(carpeta).filter((x) => /^pr-\d+\.json$/.test(x)).sort()) {
    const lista = JSON.parse(readFileSync(join(carpeta, f), 'utf8')) as Novedad[]
    if (!Array.isArray(lista)) throw new Error(`novedades: ${f} no es una lista.`)
    for (const n of lista) {
      if (!n.id || !n.fecha || !n.apartado || !n.frase || !['sumied', 'folvy', 'comun'].includes(n.producto)) {
        throw new Error(`novedades: en ${f}, «${JSON.stringify(n).slice(0, 120)}» no tiene id, fecha, producto, apartado y frase.`)
      }
      out.push({ ...n, ruta: n.ruta ?? null })
    }
  }
  const orden = (id: string) => Number(id.split('-')[1] ?? 0)
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.pr - a.pr || orden(a.id) - orden(b.id))
}

export function novedadesPlugin(carpeta = 'novedades'): Plugin {
  const lista = leerNovedades(carpeta)
  return {
    name: 'folvy-novedades',
    apply: 'build',
    config() {
      return { define: { __NOVEDADES_IDS__: JSON.stringify(lista.map((n) => n.id)) } }
    },
    writeBundle(options) {
      writeFileSync(join(options.dir ?? 'dist', 'novedades.json'), JSON.stringify(lista, null, 1) + '\n', 'utf8')
    },
  }
}
