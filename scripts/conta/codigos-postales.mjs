#!/usr/bin/env node
// scripts/conta/codigos-postales.mjs
//
// GENERA la tabla de serie código postal → población (respuesta 4 del C00,
// arreglo 3) desde el fichero de GeoNames que descargó GitHub Actions
// (docs/conta/fuentes/textos/geonames-cp-es.tsv, fuente «geonames-cp-es» de
// fuentes.json; licencia CC BY 4.0, atribución en la fila de official_source).
// Nunca de memoria ni en vivo.
//
// Escribe supabase/migrations/20261003T0210_c00_codigo_postal.sql: la tabla
// global `postal_code_place` (sin account_id, de solo lectura, como los demás
// catálogos de serie) y sus filas, en el orden del fichero.
//
//   node scripts/conta/codigos-postales.mjs             → genera
//   node scripts/conta/codigos-postales.mjs comprobar   → falla si la migración
//                                                         no es idéntica a lo generado
//
// Columnas de GeoNames (readme de export/zip): país, código postal, población,
// comunidad, cód. comunidad, provincia, cód. provincia, municipio, cód.
// municipio (INE), latitud, longitud, precisión.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const CLAVE = 'geonames-cp-es'
const MIGRACION = 'supabase/migrations/20261003T0210_c00_codigo_postal.sql'
const modo = process.argv[2] ?? 'generar'

const registro = JSON.parse(readFileSync('docs/conta/fuentes/registro.json', 'utf8')).fuentes[CLAVE]
if (!registro?.fichero) throw new Error(`La fuente «${CLAVE}» no está descargada: no se carga nada.`)
const fuente = JSON.parse(readFileSync('docs/conta/fuentes/fuentes.json', 'utf8')).fuentes.find((f) => f.clave === CLAVE)
const texto = readFileSync(`docs/conta/fuentes/${registro.fichero}`, 'utf8')

const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

const filas = []
const malas = []
for (const [i, linea] of texto.split('\n').entries()) {
  if (linea.trim() === '') continue
  const c = linea.split('\t')
  if (c[0] !== 'ES' || !/^\d{5}$/.test(c[1] ?? '') || !(c[2] ?? '').trim()) { malas.push(`línea ${i + 1}: ${linea.slice(0, 60)}`); continue }
  filas.push({ cp: c[1], ord: filas.length + 1, poblacion: c[2].trim(), comunidad: c[3]?.trim(), provincia: c[5]?.trim(), municipio: c[7]?.trim(), codMunicipio: c[8]?.trim() })
}
if (malas.length) throw new Error(`Filas que no son de un código postal español:\n${malas.slice(0, 10).join('\n')}`)

const sql = [
  '-- ============================================================================',
  '-- C00 · Respuesta 4, arreglo 3 · CÓDIGO POSTAL → POBLACIÓN (catálogo de serie)',
  '-- ----------------------------------------------------------------------------',
  '-- GENERADO por scripts/conta/codigos-postales.mjs desde el fichero de códigos',
  `-- postales de España de GeoNames (${registro.url}),`,
  `-- descargado por GitHub Actions el ${registro.fecha}, sha256 ${registro.sha256}.`,
  `-- Licencia: ${fuente?.licencia ?? 'CC BY 4.0'}. No se edita a mano.`,
  '--',
  '-- Para qué: con un código postal, el alta propone la población (marcada «IA»',
  '-- y confirmable). Un código puede tener varias poblaciones: van todas, en el',
  '-- orden del fichero (`ord`), y la pantalla elige y enseña las demás.',
  '--',
  '-- Catálogo global, sin account_id (excepción declarada, como country o',
  '-- iae_heading): se lee por código a propósito. Nadie lo escribe desde la app.',
  '-- SOLO AÑADE: una tabla nueva. No toca ninguna tabla existente ni el camino',
  '-- del pedido.',
  '-- ============================================================================',
  '',
  `insert into public.official_source (key, name, url, sha256, downloaded_at, note) values (${q(CLAVE)}, ${q(registro.nombre)}, ${q(registro.url)}, ${q(registro.sha256)}, ${q(registro.fecha)}, ${q(fuente?.licencia ?? null)}) on conflict (key) do nothing;`,
  '',
  'create table if not exists public.postal_code_place (',
  "  postal_code        text    not null check (postal_code ~ '^[0-9]{5}$'),",
  '  ord                integer not null,',
  '  place_name         text    not null,',
  '  community          text,',
  '  province           text,',
  '  municipality       text,',
  '  municipality_code  text,',
  `  source_key         text    not null default ${q(CLAVE)} references public.official_source(key),`,
  '  primary key (postal_code, ord)',
  ');',
  "comment on table public.postal_code_place is 'C00 R4. Código postal → población, de GeoNames (CC BY 4.0). Varias filas por código si tiene varias poblaciones; ord es el orden del fichero.';",
  'alter table public.postal_code_place enable row level security;',
  'drop policy if exists postal_code_place_select on public.postal_code_place;',
  'create policy postal_code_place_select on public.postal_code_place for select to authenticated using (true);',
  'grant select on table public.postal_code_place to authenticated;',
  '',
  `-- ${filas.length} filas, ${new Set(filas.map((f) => f.cp)).size} códigos postales.`,
]
const LOTE = 1000
for (let i = 0; i < filas.length; i += LOTE) {
  const lote = filas.slice(i, i + LOTE)
  sql.push('insert into public.postal_code_place (postal_code, ord, place_name, community, province, municipality, municipality_code) values')
  sql.push(lote.map((f) => `(${q(f.cp)}, ${f.ord}, ${q(f.poblacion)}, ${q(f.comunidad)}, ${q(f.provincia)}, ${q(f.municipio)}, ${q(f.codMunicipio)})`).join(',\n'))
  sql.push('on conflict (postal_code, ord) do nothing;')
}
const salida = sql.join('\n') + '\n'

if (modo === 'comprobar') {
  if (!existsSync(MIGRACION) || readFileSync(MIGRACION, 'utf8') !== salida) {
    console.error(`Difiere de lo que sale de la fuente: ${MIGRACION}`)
    process.exit(1)
  }
  console.log(`Idéntica: ${filas.length} filas.`)
} else {
  writeFileSync(MIGRACION, salida)
  console.log(`Escrita ${MIGRACION}: ${filas.length} filas, ${new Set(filas.map((f) => f.cp)).size} códigos postales.`)
}
