#!/usr/bin/env node
// scripts/conta/i01/festivos.mjs
//
// I01a · Los festivos que mueven los plazos de Hacienda, sacados del BOE y
// nunca escritos a mano. De cada resolución anual de fiestas laborales de la
// Dirección General de Trabajo se leen dos cosas de la tabla oficial (la XML,
// que conserva filas y columnas):
//
//   · ES    · las fiestas NACIONALES del art. 45.1 del RD 2001/1983: las que la
//             tabla marca con * o ** en alguna comunidad, aunque Madrid u otra
//             la haya sustituido. Son las «festividades nacionales» de la Orden
//             EHA/1658/2009, art. 3.2.b (domiciliación). Con ellas sale el
//             16/03/2026 del calendario de la AEAT: sin el 19/03 (San José,
//             que Madrid no celebra en 2026), saldría el 17/03.
//   · ES-MD · la columna de la Comunidad de Madrid: los días que no se trabaja
//             allí (nacionales que celebra y la suya).
//
// Escribe:
//   · docs/conta/referencia/festivos.json — cada fila con su fuente y la huella
//     del XML del que sale;
//   · el bloque entre las marcas «festivos:» de la migración de plazos.
//
//   node scripts/conta/i01/festivos.mjs            → baja el BOE y genera
//   node scripts/conta/i01/festivos.mjs comprobar  → sin red: rehace el bloque
//                                                    desde festivos.json y falla
//                                                    si la migración no es igual

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const REFERENCIA = 'docs/conta/referencia/festivos.json'
export const MIGRACION = 'supabase/migrations/20261122T0100_i01_plazos.sql'
const INICIO = '-- festivos: desde aquí lo escribe scripts/conta/i01/festivos.mjs (no se toca a mano)'
const FIN = '-- festivos: hasta aquí'

/** Las resoluciones del BOE, por año. provisional: lo que falta para darlo por bueno. */
export const RESOLUCIONES = [
  { anio: 2026, clave: 'boe-fiestas-laborales-2026', id: 'BOE-A-2025-21667', provisional: null },
  { anio: 2027, clave: 'boe-fiestas-laborales-2027', id: 'BOE-A-2026-21254',
    provisional: 'Publicado el BOE (BOE-A-2026-21254); falta cotejarlo con el calendario de la Comunidad de Madrid en el BOCM.' },
]

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const entidades = (s) => s.replace(/&nbsp;/g, ' ').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
  .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&amp;/g, '&')
const limpio = (s) => entidades(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** De la XML de una resolución, las filas ES y ES-MD. Pura: se prueba con el XML guardado. */
export function leerResolucion(xml, anio) {
  const tabla = xml.slice(xml.indexOf('<table'), xml.lastIndexOf('</table>'))
  const filas = [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => limpio(c[1])))
  const cabecera = filas.find((c) => c.some((v) => v.includes('Madrid')))
  if (!cabecera) throw new Error(`${anio}: la tabla no tiene la columna de la Comunidad de Madrid.`)
  const madrid = cabecera.findIndex((v) => v.includes('Madrid')) + 1
  const out = []
  let mes = null
  for (const c of filas) {
    if (c.length && MESES.includes(c[0])) { mes = MESES.indexOf(c[0]) + 1; continue }
    if (c.length !== cabecera.length + 1 || !mes || !/^\d+ /.test(c[0])) continue
    const dia = Number(c[0].split(' ')[0])
    const nombre = c[0].slice(c[0].indexOf(' ') + 1).replace(/\.$/, '')
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    if (c.slice(1).some((m) => m === '*' || m === '**')) out.push({ fecha, ambito: 'ES', nombre })
    if (c[madrid]) out.push({ fecha, ambito: 'ES-MD', nombre })
  }
  if (!out.some((f) => f.ambito === 'ES-MD')) throw new Error(`${anio}: no ha salido ningún festivo de Madrid.`)
  return out
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

/** El bloque SQL desde la referencia: los años, las fuentes y los días. */
export function bloqueSql(ref) {
  const l = [INICIO]
  for (const r of ref.resoluciones) {
    l.push(`insert into public.official_source (key, name, url, sha256, downloaded_at) values (${q(r.clave)}, ${q(r.nombre)}, ${q(r.url)}, ${q(r.sha256)}, ${q(r.descargado)})`,
      `  on conflict (key) do nothing;`)
    for (const ambito of ['ES', 'ES-MD']) {
      l.push(`insert into public.tax_holiday_year (year, scope, source_key, provisional_reason) values (${r.anio}, ${q(ambito)}, ${q(r.clave)}, ${r.provisional ? q(r.provisional) : 'null'})`,
        `  on conflict (year, scope) do nothing;`)
    }
    const dias = ref.festivos.filter((f) => f.fecha.startsWith(`${r.anio}-`))
    l.push('insert into public.tax_holiday (day, scope, name, source_key) values')
    l.push(dias.map((f) => `  (${q(f.fecha)}, ${q(f.ambito)}, ${q(f.nombre)}, ${q(r.clave)})`).join(',\n'))
    l.push('  on conflict (day, scope) do nothing;')
  }
  l.push(FIN)
  return l.join('\n')
}

function ponerBloque(sql, bloque) {
  const i = sql.indexOf(INICIO), j = sql.indexOf(FIN)
  if (i < 0 || j < 0) throw new Error(`${MIGRACION} no tiene las marcas del bloque de festivos.`)
  return sql.slice(0, i) + bloque + sql.slice(j + FIN.length)
}

async function generar() {
  const resoluciones = [], festivos = []
  for (const r of RESOLUCIONES) {
    const url = `https://www.boe.es/diario_boe/xml.php?id=${r.id}`
    const res = await fetch(url, { headers: { Accept: 'application/xml' } })
    if (!res.ok) throw new Error(`${r.id}: HTTP ${res.status}`)
    const xml = await res.text()
    const titulo = limpio((xml.match(/<titulo>([\s\S]*?)<\/titulo>/) ?? [])[1] ?? '')
    if (!titulo.includes(`fiestas laborales para el año ${r.anio}`)) throw new Error(`${r.id}: el título no es el de las fiestas de ${r.anio}: «${titulo}»`)
    resoluciones.push({ anio: r.anio, clave: r.clave, id: r.id, nombre: titulo, url: `https://www.boe.es/diario_boe/txt.php?id=${r.id}`,
      sha256: createHash('sha256').update(xml).digest('hex'), descargado: new Date().toISOString(), provisional: r.provisional })
    festivos.push(...leerResolucion(xml, r.anio))
  }
  const ref = { que_es: 'I01a · Festivos que mueven los plazos de Hacienda, sacados del BOE por scripts/conta/i01/festivos.mjs. ES: fiestas nacionales del art. 45.1 del RD 2001/1983 (las que la tabla marca * o **). ES-MD: la columna de la Comunidad de Madrid.', resoluciones, festivos }
  writeFileSync(REFERENCIA, JSON.stringify(ref, null, 2) + '\n')
  writeFileSync(MIGRACION, ponerBloque(readFileSync(MIGRACION, 'utf8'), bloqueSql(ref)))
  console.log(`Festivos: ${festivos.length} filas de ${resoluciones.length} resoluciones.`)
}

function comprobar() {
  const ref = JSON.parse(readFileSync(REFERENCIA, 'utf8'))
  const sql = readFileSync(MIGRACION, 'utf8')
  if (ponerBloque(sql, bloqueSql(ref)) !== sql) {
    console.error(`Los festivos de ${MIGRACION} no son los de ${REFERENCIA}: vuelve a generar (node scripts/conta/i01/festivos.mjs).`)
    process.exit(1)
  }
  console.log('Festivos: la migración es la referencia.')
}

if (process.argv[1]?.endsWith('festivos.mjs')) {
  if (process.argv[2] === 'comprobar') comprobar()
  else await generar()
}
