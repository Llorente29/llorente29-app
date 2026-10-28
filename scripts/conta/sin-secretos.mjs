#!/usr/bin/env node
// scripts/conta/sin-secretos.mjs
//
// W10a (Julio, 28/10) · Ningún fichero nuevo o cambiado trae un secreto. El
// repositorio es PÚBLICO: lo que entra en git lo puede leer cualquiera, y se
// queda en el historial aunque se borre después. El 28/10 había tres secretos
// vivos escritos en migraciones (order-advance, el despacho de disponibilidad
// y el de estado de locales: con ellos se pueden pausar locales y platos en
// las plataformas) y un token de Last en CONTEXTO_CLAUDE.md.
//
// Qué mira: las LÍNEAS QUE AÑADE el PR (o lo no commiteado, en local), en
// cualquier fichero de texto, con la misma búsqueda que la estructura de
// staging (scripts/staging/esquema.mjs): un JWT que no sea anon, una clave de
// Stripe, un «fv_…» interno, una URL con contraseña, una clave privada… Solo lo
// añadido: un fichero que ya traía algo de antes no para a quien lo toca por
// otra cosa (eso se limpia cambiando el secreto, no el fichero).
// No hay forma de saltarla. Un dato de prueba con forma de secreto se
// construye en la prueba (por ejemplo, 'fv_x_' + '0'.repeat(20)), nunca entero.
//
// Uso:
//   node scripts/conta/sin-secretos.mjs                 lo añadido contra origin/main, con lo no commiteado
//   node scripts/conta/sin-secretos.mjs <base> <head>   lo añadido en ese diff (pr-a-main.yml)
// Sale con 1 si encuentra alguno.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buscarSecretos } from '../staging/esquema.mjs'

/** De un diff unificado (-U0): [{ fichero, linea, texto }] de lo añadido. */
export function lineasAnadidas(diff) {
  const out = []
  let fichero = null
  let linea = 0
  for (const l of String(diff).split('\n')) {
    if (l.startsWith('+++ ')) { fichero = l.startsWith('+++ b/') ? l.slice(6) : null; continue }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (h) { linea = Number(h[1]); continue }
    if (!fichero) continue
    if (l.startsWith('+')) { out.push({ fichero, linea, texto: l.slice(1) }); linea++ }
    else if (!l.startsWith('-') && !l.startsWith('\\')) linea++
  }
  return out
}

/** Los secretos de lo añadido: [{ fichero, linea, que }]. */
export function secretosAnadidos(diff) {
  const mal = []
  for (const a of lineasAnadidas(diff)) for (const s of buscarSecretos(a.texto)) mal.push({ fichero: a.fichero, linea: a.linea, que: s.que })
  return mal
}

function diffDe(base, head) {
  const op = ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--diff-filter=AM', '--text']
  if (head) return execFileSync('git', [...op, `${base}...${head}`], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const desde = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim()
  let d = execFileSync('git', [...op, desde], { encoding: 'utf8', maxBuffer: 1 << 28 })
  // Lo nuevo sin commitear: entero.
  const nuevos = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const f of nuevos) {
    try { d += execFileSync('git', ['diff', '-U0', '--no-color', '--no-index', '--text', '/dev/null', f], { encoding: 'utf8', maxBuffer: 1 << 28 }) } catch (e) { d += e.stdout ?? '' }
  }
  return d
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base = 'origin/main', head] = process.argv.slice(2)
  const mal = secretosAnadidos(diffDe(base, head))
  for (const x of mal) console.log(`::error file=${x.fichero},line=${x.linea}::${x.fichero}:${x.linea} · ${x.que}`)
  if (mal.length) {
    console.log(`\n${mal.length} secreto${mal.length === 1 ? '' : 's'} en lo que añade este cambio. El repositorio es público: un secreto se lee del Vault (la base) o de los secretos de las funciones (Deno.env), nunca se escribe. Si ya ha llegado a un commit, hay que CAMBIARLO, no solo borrarlo: se queda en el historial.`)
    process.exit(1)
  }
  console.log('Ningún secreto en lo que añade este cambio.')
}
