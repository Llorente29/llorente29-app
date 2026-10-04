// tests/conta/cumplimiento/textoVigente.ts
//
// Lee la versión VIGENTE de un artículo de una norma descargada en
// docs/conta/fuentes/textos/. Si el texto trae marcas de versión
// («### versión · vigente desde …»), es lo que va detrás de la última; si es
// de la descarga anterior, sin marcas, lo que va desde la última repetición
// del título del artículo.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve(__dirname, '../../../docs/conta/fuentes')

export function registroFuentes(): { fuentes: Record<string, { fichero: string | null; url: string; sha256: string | null; fecha: string }> } {
  return JSON.parse(readFileSync(resolve(DIR, 'registro.json'), 'utf8'))
}

export function textoVigente(fuente: string, bloque: string): string {
  const reg = registroFuentes().fuentes[fuente]
  if (!reg?.fichero) throw new Error(`La fuente ${fuente} no está descargada`)
  const ruta = resolve(DIR, reg.fichero)
  if (!existsSync(ruta)) throw new Error(`Falta el fichero ${reg.fichero}`)
  const t = readFileSync(ruta, 'utf8')
  const i = t.indexOf(`## [${bloque}]`)
  if (i < 0) throw new Error(`No está el bloque ${bloque} en ${fuente}`)
  const j = t.indexOf('\n## [', i + 4)
  const b = t.slice(i, j < 0 ? undefined : j)
  const v = b.lastIndexOf('\n### versión')
  if (v >= 0) return b.slice(v)
  const lineas = b.split('\n')
  const titulo = lineas[1]
  const ultima = lineas.lastIndexOf(titulo)
  return lineas.slice(ultima).join('\n')
}
