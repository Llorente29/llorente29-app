#!/usr/bin/env node
// scripts/conta/produccion/cuenta-crece.mjs
//
// W06 (Julio, 26/10) · UNA CUENTA NO PUEDE MEDIR ALGO QUE CRECE SOLO.
//
// El ensayo de producción cuenta antes de la tanda y otra vez después de
// deshacerla, y entre las dos pasan minutos con el negocio abierto. El #241 se
// paró porque la cuenta del V02 medía «asientos (base entera)» y un asiento de
// banco entró a mitad del ensayo: 15.223 → 15.224, sin que la tanda tuviera
// nada que ver. Esto lo caza en la revisión del PR, antes de gastar una vuelta
// de Julio:
//
//   cada medida de una cuenta («select N, '<clave>', <valor> union all …») que
//   lee una TABLA DE DATOS (no el catálogo: pg_*, information_schema,
//   storage.buckets, cron.job, el historial de migraciones o los catálogos
//   globales) tiene que llevar un CORTE DE FECHA fijo («created_at <
//   timestamptz '2026-10-26 06:00:00+00'», «between … and '…'»), o decir por
//   qué no crece con «-- quieta: <por qué>» dentro de la medida.
//
// Una tabla que crea la propia tanda (la medida la mira con to_regclass) no
// existe ni antes ni después de deshacerla: no cuenta.
//
//   cuenta-crece.mjs revisar <base> <head>   → las cuentas que cambia el PR (para si alguna medida crece)
//   cuenta-crece.mjs <fichero.sql>...        → las que se le digan (sale con 1 si alguna crece)
//
// Las cuentas ya fusionadas no se tocan: la revisión mira solo las que el PR
// añade o cambia.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const QUIETAS = [
  /^pg_catalog\./, /^pg_/, /^information_schema\./, /^storage\.buckets$/, /^cron\.job$/,
  /^supabase_migrations\./,
  // Catálogos globales sin account_id (CLAUDE.md, regla 9): se leen enteros a propósito.
  /^(public\.)?(vat_category|vat_rate|family_vat_default|connector)$/,
]

const sinComentarios = (sql) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
// Lo que dice «from» sin ser una tabla, y los nombres partidos en dos cadenas
// («'… from public.' || 'tabla …'»), que se juntan.
const normalizar = (sql) => sql
  .replace(/'\s*\|\|\s*'/g, '')
  .replace(/\bdistinct\s+from\b/gi, 'distinct_de')
  .replace(/\b(extract|substring|trim|overlay)\s*\(([^()]*?)\bfrom\b/gi, '$1($2 desde_')

/** Las medidas: los trozos entre «union all» del cuerpo. */
export function medidas(sql) {
  return sql.split(/\bunion\s+all\b/i)
}

/** Nombres que siguen a from/join (también dentro de query_to_xml). */
export function tablas(texto, ctes = new Set()) {
  const out = new Set()
  const re = /\b(?:from|join)\s+(?!\()(?:only\s+)?("?[A-Za-z_][\w$]*"?(?:\s*\.\s*"?[A-Za-z_][\w$]*"?)?)(\s*\(|\.%I|\.'+)?/gi
  let m
  while ((m = re.exec(texto))) {
    const nombre = m[1].replace(/"/g, '').replace(/\s+/g, '').toLowerCase()
    if (['lateral', 'unnest', 'generate_series', 'jsonb_array_elements', 'jsonb_each', 'json_array_elements', 'regexp_split_to_table', 'xpath', 'values'].includes(nombre)) continue
    if (!nombre.includes('.') && ctes.has(nombre) && !m[2]) continue
    // «from public.%I» (format) o «from public.' || t»: una tabla que se elige al vuelo; de datos.
    out.add(m[2]?.startsWith('.') ? `${nombre}.* (al vuelo)` : m[2] ? `${nombre}()` : nombre)
  }
  return [...out]
}

/** Los nombres de las CTE del fichero («with x as (», «, y as (»): no son tablas. */
export function ctes(sql) {
  return new Set([...sinComentarios(sql).matchAll(/(?:\bwith(?:\s+recursive)?|,)\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s+as\s+(?:not\s+)?(?:materialized\s+)?\(/gi)].map((m) => m[1].toLowerCase()))
}

const esQuieta = (t) => QUIETAS.some((re) => re.test(t))
// Un corte: una comparación «<», «<=» o «between» con una fecha literal fija.
const CORTE = /(<=?|\bbetween\b)\s*(?:\(?\s*(?:timestamptz|timestamp|date)\s*)?'+\d{4}-\d{2}-\d{2}/i
const CORTE_AL_REVES = /'+\d{4}-\d{2}-\d{2}[^']*'+\s*(?:::\s*(?:timestamptz|timestamp|date)\s*)?(>=?)/i

/** Lo que crece solo en una cuenta: [{ medida, tablas }]. */
export function creceSolo(sql) {
  const out = []
  const nombresCte = ctes(sql)
  for (const trozo of medidas(sql)) {
    if (/--[ \t]*quieta:[ \t]*\S/i.test(trozo)) continue
    const limpio = normalizar(sinComentarios(trozo))
    const creadas = new Set([...limpio.matchAll(/to_regclass\(\s*'+([\w.]+)'+\s*\)/gi)].map((m) => (m[1].includes('.') ? m[1] : `public.${m[1]}`).toLowerCase()))
    const datos = tablas(limpio, nombresCte).filter((t) => !esQuieta(t) && !creadas.has(t) && !creadas.has(`public.${t}`))
    if (!datos.length) continue
    if (CORTE.test(limpio) || CORTE_AL_REVES.test(limpio)) continue
    const clave = limpio.match(/'((?:[^']|'')+)'/)?.[1] ?? limpio.trim().slice(0, 60)
    out.push({ medida: clave.replace(/''/g, "'"), tablas: datos })
  }
  return out
}

function cambiadas(base, head) {
  const r = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', `${base}...${head}`, '--', 'scripts/conta/produccion/cuentas/'], { encoding: 'utf8' })
  return r.split('\n').filter((f) => /\.sql$/.test(f) && existsSync(f))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const ficheros = args[0] === 'revisar' ? cambiadas(args[1], args[2]) : args
  if (args[0] === 'revisar' && !ficheros.length) { console.log('El PR no añade ni cambia ninguna cuenta de tanda.'); process.exit(0) }
  let mal = 0
  for (const f of ficheros) {
    const r = creceSolo(readFileSync(f, 'utf8'))
    if (!r.length) { console.log(`✓ ${f}: ninguna medida lee algo que crezca solo sin un corte de fecha.`); continue }
    mal += r.length
    for (const x of r) {
      console.log(`::error file=${f},title=Cuenta que crece sola::«${x.medida}» lee ${x.tablas.join(', ')} sin un corte de fecha fijo: otro proceso puede escribir ahí a mitad del ensayo y pararlo sin culpa de la tanda (el #241). Ponle «created_at < timestamptz '…'» o di por qué no crece con «-- quieta: <por qué>» dentro de la medida.`)
    }
  }
  if (mal) { console.log(`${mal} medidas leen algo que crece solo.`); process.exit(1) }
}
