#!/usr/bin/env node
// scripts/conta/serie.mjs
//
// GENERA los valores de serie del módulo de contabilidad (C00 §4.4) desde las
// fuentes oficiales descargadas (docs/conta/fuentes/), nunca de memoria:
//
//   · docs/conta/referencia/serie-manual.json — las filas que hay que elegir a
//     mano (qué impuestos, qué retenciones…), CADA UNA con las pruebas: el
//     trozo literal del texto oficial que la respalda (fuente, artículo).
//   · Los catálogos grandes salen enteros de su fuente: IAE y CNAE-2025
//     (ISTAC), países y monedas (Oficina de Publicaciones de la UE), formas
//     jurídicas (Orden EHA/451/2008, art. 3) y títulos de las cuentas del PGC
//     (RD 1514/2007, cuadro de cuentas).
//
// Antes de escribir nada comprueba cada literal en la versión VIGENTE de su
// artículo (o en cualquier versión si la fila lo pide, para un tramo ya
// cerrado). Si uno no está, no genera: falla y dice cuál.
//
// Escribe:
//   · docs/conta/referencia/serie.json — cada valor con su fuente, URL, fecha
//     de descarga y huella del texto (el «fichero de referencia» del encargo).
//   · supabase/migrations/20261003T0130_c00_valores_de_serie.sql
//
//   node scripts/conta/serie.mjs             → genera
//   node scripts/conta/serie.mjs comprobar   → regenera en memoria y falla si
//                                              los ficheros no son idénticos

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FUENTES = 'docs/conta/fuentes'
const REF = 'docs/conta/referencia'
const MIGRACION = 'supabase/migrations/20261003T0130_c00_valores_de_serie.sql'
const modo = process.argv[2] ?? 'generar'

const registro = JSON.parse(readFileSync(join(FUENTES, 'registro.json'), 'utf8'))
const manual = JSON.parse(readFileSync(join(REF, 'serie-manual.json'), 'utf8'))
const fallos = []

function fuente(clave) {
  const f = registro.fuentes[clave]
  if (!f || !f.fichero) throw new Error(`La fuente «${clave}» no está descargada: no se puede cargar nada que dependa de ella.`)
  return f
}
const texto = (clave) => readFileSync(join(FUENTES, fuente(clave).fichero), 'utf8')

function bloque(clave, id) {
  const t = texto(clave)
  const i = t.indexOf(`## [${id}]`)
  if (i < 0) throw new Error(`No está el bloque ${id} en ${clave}`)
  const j = t.indexOf('\n## [', i + 4)
  return t.slice(i, j < 0 ? undefined : j)
}
function vigente(clave, id) {
  const b = bloque(clave, id)
  const v = b.lastIndexOf('\n### versión')
  return v >= 0 ? b.slice(v) : b
}

/** Las versiones de un artículo: [{fecha, norma, texto}], en orden de fecha. */
function versiones(clave, id) {
  const partes = bloque(clave, id).split('\n### versión · vigente desde ').slice(1)
  return partes.map((p) => {
    const m = p.match(/^(\S+) · (\S+)/)
    return { fecha: m?.[1] ?? '', norma: m?.[2] ?? '', texto: p }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/**
 * Desde cuándo vale lo que dice `literal`: la fecha de la REDACCIÓN VIGENTE
 * del artículo, que tiene que contenerlo. No se afirma que el porcentaje viniera
 * de antes: hubo subidas temporales hechas fuera del artículo (2012–2014) que
 * el texto del artículo no refleja, así que una continuidad «por el texto»
 * podría ser falsa.
 */
function inicioDelTramoVigente(clave, id, literal) {
  const vs = versiones(clave, id)
  const ultima = vs[vs.length - 1]
  if (!ultima || !ultima.texto.includes(literal)) return null
  return { fecha: ultima.fecha, norma: ultima.norma }
}

/** Comprueba las pruebas de una fila; devuelve la fuente principal (la primera). */
function comprobar(fila, donde) {
  if (!Array.isArray(fila.pruebas) || fila.pruebas.length === 0) {
    fallos.push(`${donde}: no trae pruebas`)
    return null
  }
  for (const p of fila.pruebas) {
    try {
      const t = p.bloque === '*' ? texto(p.fuente) : p.cualquierVersion ? bloque(p.fuente, p.bloque) : vigente(p.fuente, p.bloque)
      if (!t.includes(p.literal)) fallos.push(`${donde}: «${p.literal}» NO está en ${p.fuente} [${p.bloque}]${p.cualquierVersion ? '' : ' (versión vigente)'}`)
    } catch (e) { fallos.push(`${donde}: ${e.message}`) }
  }
  return fila.pruebas[0].fuente
}

const dia = (iso) => (iso ?? '').slice(0, 10)
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const n = (v) => (v === null || v === undefined ? 'null' : String(v))
const arr = (a) => `array[${a.map(q).join(', ')}]::text[]`
const arrInt = (a, tipo) => `array[${a.join(', ')}]::${tipo}[]`

// ── Catálogos que salen enteros de su fuente ────────────────────────────────
function paises() {
  const lineas = texto('eu-paises').trim().split('\n').slice(1)
  const por = new Map()
  for (const l of lineas) {
    const m = l.match(/^"([A-Z]{2})","([A-Z]{3})","(.*)"$/)
    if (m && !por.has(m[1])) por.set(m[1], { alpha2: m[1], alpha3: m[2], name_es: m[3] })
  }
  return [...por.values()].sort((a, b) => a.alpha2.localeCompare(b.alpha2))
}
function monedas() {
  const lineas = texto('eu-monedas').trim().split('\n').slice(1)
  const por = new Map()
  for (const l of lineas) {
    const m = l.match(/^"([A-Z]{3})","(.*)"$/)
    if (m && !por.has(m[1])) por.set(m[1], { code: m[1], name_es: m[2] })
  }
  return [...por.values()].sort((a, b) => a.code.localeCompare(b.code))
}
const nombreEs = (c) => ((c.name?.text ?? []).find((t) => t.lang === 'es')?.value ?? '').trim()
function iae() {
  const j = JSON.parse(texto('istac-iae'))
  const ids = new Set(j.code.map((c) => c.id))
  const NIVEL = ['seccion', 'division', 'agrupacion', 'grupo', 'epigrafe']
  return j.code.map((c) => {
    const [seccion, num = ''] = c.id.split('_')
    let padre = null
    for (let k = num.length - 1; k >= 0 && !padre; k--) {
      const cand = k === 0 ? seccion : `${seccion}_${num.slice(0, k)}`
      if (ids.has(cand)) padre = cand
    }
    return { code: c.id, section: seccion, level: NIVEL[Math.min(num.length, 4)], title: nombreEs(c), parent_code: num.length === 0 ? null : padre }
  }).filter((c) => ['1', '2', '3'].includes(c.section) && c.title)
}
function cnae() {
  const j = JSON.parse(texto('istac-cnae-2025'))
  const ids = new Set(j.code.map((c) => c.id))
  return j.code.map((c) => {
    const letra = /^[A-Z]$/.test(c.id)
    const padre = letra || c.id.length <= 2 ? null : (ids.has(c.id.slice(0, -1)) ? c.id.slice(0, -1) : null)
    return { version: '2025', code: c.id, level: letra ? 1 : c.id.length, title: nombreEs(c), parent_code: padre }
  }).filter((c) => c.title)
}
function formasJuridicas() {
  const t = vigente('orden-eha-451-2008', 'a3')
  const out = []
  for (const l of t.split('\n')) {
    const m = l.match(/^([A-Z])\. (.+)\.$/)
    if (m) out.push({ code: `nif_${m[1].toLowerCase()}`, name: m[2], nif_letter: m[1], literal: l })
  }
  return out
}
function tituloPgc(cuenta) {
  const t = texto('rd-1514-2007')
  const una = t.match(new RegExp(`\\n${cuenta}\\. ([^\\n]+?)\\.?\\n`))
  const dos = t.match(new RegExp(`\\n${cuenta}\\.\\n([^\\n]+)\\n`))
  const titulo = (dos?.[1] ?? una?.[1] ?? '').trim()
  if (!titulo) fallos.push(`PGC: no encuentro el título de la cuenta ${cuenta} en rd-1514-2007`)
  return titulo
}

// ── Construir ───────────────────────────────────────────────────────────────
const usadas = new Set()
const usar = (k) => { usadas.add(k); return k }
const ref = { generado_desde: registro.descargado, tablas: {} }
const sql = []
const fecha = (k) => dia(fuente(k).fecha)

sql.push(`-- ============================================================================
-- C00 · El cimiento — 4/4 · VALORES DE SERIE (GENERADO, no editar a mano)
-- ----------------------------------------------------------------------------
-- Generado por scripts/conta/serie.mjs desde docs/conta/fuentes/ (textos
-- oficiales descargados por GitHub Actions) y docs/conta/referencia/
-- serie-manual.json. Cada valor lleva su referencia legal, la fecha en que se
-- comprobó contra la fuente y la fuente (official_source). El fichero de
-- referencia completo, con URL y huella, es docs/conta/referencia/serie.json.
--
-- SOLO AÑADE filas de serie (y pone título oficial y referencia a los 12 tipos
-- de gasto del C01). No toca vat_rate ni vat_rate_for. No está en el camino
-- del pedido.
-- ============================================================================
`)

// Países y monedas
const ps = paises(); const ms = monedas(); usar('eu-paises'); usar('eu-monedas')
ref.tablas.country = { fuente: 'eu-paises', filas: ps.length }
ref.tablas.currency = { fuente: 'eu-monedas', filas: ms.length }
if (ps.length < 200 || !ps.find((p) => p.alpha2 === 'ES')) fallos.push(`Países: solo ${ps.length}, o falta España`)
if (!ms.find((m) => m.code === 'EUR')) fallos.push('Monedas: falta el euro')

// IAE y CNAE
const iaes = iae(); const cnaes = cnae(); usar('istac-iae'); usar('istac-cnae-2025')
ref.tablas.iae_heading = { fuente: 'istac-iae', filas: iaes.length }
ref.tablas.cnae_code = { fuente: 'istac-cnae-2025', filas: cnaes.length }

// Formas jurídicas
const formas = formasJuridicas(); usar('orden-eha-451-2008')
if (formas.length < 10) fallos.push(`Formas jurídicas: solo ${formas.length} letras en la Orden EHA/451/2008`)

// Filas manuales: comprobar pruebas
const TABLAS_MANUALES = ['vat_scheme', 'tax_form', 'legal_form', 'tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text']
const cargadas = {}
const apartadas = []
for (const t of TABLAS_MANUALES) {
  cargadas[t] = []
  for (const [i, fila] of (manual[t] ?? []).entries()) {
    const donde = `${t}[${i}] ${fila.code}`
    if (fila.pendiente) { apartadas.push({ tabla: t, code: fila.code, por: fila.pendiente }); continue }
    let principal = null
    try { principal = comprobar(fila, donde) } catch (e) { fallos.push(`${donde}: ${e.message}`) }
    if (!principal) continue
    for (const p of fila.pruebas) usar(p.fuente)
    if (fila.desdeAuto) {
      try {
        const d = inicioDelTramoVigente(fila.desdeAuto.fuente, fila.desdeAuto.bloque, fila.desdeAuto.literal)
        if (!d) { fallos.push(`${donde}: «${fila.desdeAuto.literal}» no está en la versión vigente de ${fila.desdeAuto.fuente} [${fila.desdeAuto.bloque}]`); continue }
        fila.valid_from = d.fecha
        fila.desde_por = `${fila.desdeAuto.fuente} [${fila.desdeAuto.bloque}]: redacción vigente desde ${d.fecha} (${d.norma})`
      } catch (e) { fallos.push(`${donde}: ${e.message}`); continue }
    }
    const extra = t === 'tax_form' && fila.fuenteOrden ? { legal_ref: fuente(fila.fuenteOrden).titulo.replace(/\.$/, '') } : {}
    cargadas[t].push({ ...fila, ...extra, source_key: principal, verified_at: fecha(principal) })
  }
  ref.tablas[t] = { filas: cargadas[t].map(({ pruebas, ...r }) => ({ ...r, pruebas })) }
}
ref.apartadas = apartadas

// Tipos de gasto: título oficial del PGC
usar('rd-1514-2007')
const gastos = (manual.expense_category ?? []).map((g) => ({ ...g, name: tituloPgc(g.pgc), verified_at: fecha('rd-1514-2007') }))
ref.tablas.expense_category = { fuente: 'rd-1514-2007', filas: gastos }

// Puente de Cocina
const puente = manual.vat_category_tax ?? []
for (const b of puente) {
  if (!cargadas.tax_rate.find((t) => t.code === b.tax_code)) fallos.push(`Puente: ${b.category_code} → ${b.tax_code}, pero ese impuesto no se carga`)
}
ref.tablas.vat_category_tax = { filas: puente }

if (fallos.length) {
  console.error(`NO SE GENERA. ${fallos.length} problema(s):\n- ${fallos.join('\n- ')}`)
  process.exit(1)
}

// ── SQL ─────────────────────────────────────────────────────────────────────
sql.push('-- ── Fuentes ─────────────────────────────────────────────────────────────────')
for (const k of [...usadas].sort()) {
  const f = fuente(k)
  sql.push(`insert into public.official_source (key, name, url, sha256, downloaded_at) values (${q(k)}, ${q(f.nombre)}, ${q(f.url)}, ${q(f.sha256)}, ${q(f.fecha)}) on conflict (key) do nothing;`)
}
sql.push('', '-- ── Países y monedas ────────────────────────────────────────────────────────')
sql.push(`insert into public.country (alpha2, alpha3, name_es, source_key) values\n${ps.map((p) => `  (${q(p.alpha2)}, ${q(p.alpha3)}, ${q(p.name_es)}, 'eu-paises')`).join(',\n')}\non conflict (alpha2) do nothing;`)
sql.push(`insert into public.currency (code, name_es, source_key) values\n${ms.map((m) => `  (${q(m.code)}, ${q(m.name_es)}, 'eu-monedas')`).join(',\n')}\non conflict (code) do nothing;`)

sql.push('', '-- ── IAE (padres antes que hijos) y CNAE-2025 ───────────────────────────────')
const ordenIae = [...iaes].sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))
sql.push(`insert into public.iae_heading (code, section, level, title, parent_code, source_key) values\n${ordenIae.map((c) => `  (${q(c.code)}, ${q(c.section)}, ${q(c.level)}, ${q(c.title)}, ${q(c.parent_code)}, 'istac-iae')`).join(',\n')}\non conflict (code) do nothing;`)
sql.push(`insert into public.cnae_code (version, code, level, title, parent_code, source_key) values\n${cnaes.map((c) => `  ('2025', ${q(c.code)}, ${c.level}, ${q(c.title)}, ${q(c.parent_code)}, 'istac-cnae-2025')`).join(',\n')}\non conflict (version, code) do nothing;`)

sql.push('', '-- ── Formas jurídicas ─────────────────────────────────────────────────────────')
const fechaOrden = fecha('orden-eha-451-2008')
const filasFormas = [
  ...formas.map((f, i) => `  (${q(f.code)}, ${q(f.name)}, ${q(['A', 'B', 'C', 'D', 'F', 'U'].includes(f.nif_letter) ? 'company' : 'other')}, ${q(f.nif_letter)}, 'Orden EHA/451/2008, art. 3', ${q(fechaOrden)}, 'orden-eha-451-2008', ${(i + 1) * 10})`),
  ...cargadas.legal_form.map((f) => `  (${q(f.code)}, ${q(f.name)}, ${q(f.entity_kind)}, null, ${q(f.legal_ref)}, ${q(f.verified_at)}, ${q(f.source_key)}, ${n(f.sort_order)})`),
]
ref.tablas.legal_form = { fuente: 'orden-eha-451-2008', filas: [...formas, ...cargadas.legal_form] }
sql.push(`insert into public.legal_form (code, name, entity_kind, nif_letter, legal_ref, verified_at, source_key, sort_order) values\n${filasFormas.join(',\n')}\non conflict (code) do nothing;`)

sql.push('', '-- ── Regímenes de IVA y modelos ───────────────────────────────────────────────')
if (cargadas.vat_scheme.length) sql.push(`insert into public.vat_scheme (code, name, description, legal_ref, verified_at, source_key, sort_order) values\n${cargadas.vat_scheme.map((r) => `  (${q(r.code)}, ${q(r.name)}, ${q(r.description)}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)}, ${n(r.sort_order)})`).join(',\n')}\non conflict (code) do nothing;`)
if (cargadas.tax_form.length) sql.push(`insert into public.tax_form (code, name, description, legal_ref, verified_at, source_key) values\n${cargadas.tax_form.map((r) => `  (${q(r.code)}, ${q(r.name)}, ${q(r.description)}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)})`).join(',\n')}\non conflict (code) do nothing;`)

sql.push('', '-- ── Impuestos ────────────────────────────────────────────────────────────────')
for (const r of cargadas.tax_rate) {
  sql.push(`insert into public.tax_rate (is_system, code, name, example, tax_system, territory, treatment, rate, surcharge_rate, valid_from, valid_to, pgc_input_hint, pgc_output_hint, declared_in, legal_ref, verified_at, source_key, sort_order)
select true, ${q(r.code)}, ${q(r.name)}, ${q(r.example)}, ${q(r.tax_system)}, ${q(r.territory)}, ${q(r.treatment)}, ${n(r.rate)}, ${n(r.surcharge_rate)}, ${q(r.valid_from)}, ${q(r.valid_to)}, ${q(r.pgc_input_hint)}, ${q(r.pgc_output_hint)}, ${arr(r.declared_in ?? [])}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)}, ${n(r.sort_order)}
where not exists (select 1 from public.tax_rate where is_system and code = ${q(r.code)} and valid_from = ${q(r.valid_from)});`)
}
sql.push('', '-- ── Retenciones ──────────────────────────────────────────────────────────────')
for (const r of cargadas.withholding_rate) {
  sql.push(`insert into public.withholding_rate (is_system, code, name, example, rate, model_190_key, model_190_subkey, filed_in, valid_from, valid_to, pgc_hint, legal_ref, verified_at, source_key, sort_order)
select true, ${q(r.code)}, ${q(r.name)}, ${q(r.example)}, ${n(r.rate)}, ${q(r.model_190_key)}, ${q(r.model_190_subkey)}, ${q(r.filed_in)}, ${q(r.valid_from)}, ${q(r.valid_to)}, ${q(r.pgc_hint)}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)}, ${n(r.sort_order)}
where not exists (select 1 from public.withholding_rate where is_system and code = ${q(r.code)} and valid_from = ${q(r.valid_from)});`)
}
sql.push('', '-- ── Formas y plazos de pago, textos de los apuntes ─────────────────────────')
for (const r of cargadas.payment_method) {
  sql.push(`insert into public.payment_method (is_system, code, name, example, kind, legal_ref, verified_at, source_key, sort_order)
select true, ${q(r.code)}, ${q(r.name)}, ${q(r.example)}, ${q(r.kind)}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)}, ${n(r.sort_order)}
where not exists (select 1 from public.payment_method where is_system and code = ${q(r.code)});`)
}
for (const r of cargadas.payment_term) {
  sql.push(`insert into public.payment_term (is_system, code, name, example, days, fixed_days, legal_ref, verified_at, source_key, sort_order)
select true, ${q(r.code)}, ${q(r.name)}, ${q(r.example)}, ${arrInt(r.days, 'integer')}, ${arrInt(r.fixed_days ?? [], 'smallint')}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)}, ${n(r.sort_order)}
where not exists (select 1 from public.payment_term where is_system and code = ${q(r.code)});`)
}
for (const r of cargadas.entry_text) {
  sql.push(`insert into public.entry_text (is_system, code, text, purpose, legal_ref, verified_at, source_key, sort_order)
select true, ${q(r.code)}, ${q(r.text)}, ${q(r.purpose)}, ${q(r.legal_ref)}, ${q(r.verified_at)}, ${q(r.source_key)}, ${n(r.sort_order)}
where not exists (select 1 from public.entry_text where is_system and code = ${q(r.code)});`)
}

sql.push('', '-- ── Tipos de gasto: título oficial de la cuenta; lo coloquial pasa a example ─')
for (const g of gastos) {
  sql.push(`update public.expense_category set example = coalesce(example, name), name = ${q(g.name)}, legal_ref = ${q(`RD 1514/2007, cuadro de cuentas, ${g.pgc}`)}, verified_at = ${q(g.verified_at)}, source_key = 'rd-1514-2007'
 where is_system and code = ${q(g.code)} and pgc_account_hint = ${q(g.pgc)} and legal_ref is null;`)
}
sql.push(`alter table public.expense_category drop constraint if exists expense_category_serie;
alter table public.expense_category add constraint expense_category_serie check (public.conta_fila_serie_ok(is_system, account_id, company_id, legal_ref, verified_at, source_key));`)

sql.push('', '-- ── D1 · Puente de las categorías de IVA de Cocina hacia tax_rate ──────────')
for (const b of puente) {
  sql.push(`insert into public.vat_category_tax (vat_category_id, tax_code, valid_from, valid_to, note)
select c.id, ${q(b.tax_code)}, ${q(b.valid_from)}, ${q(b.valid_to)}, ${q(b.note)} from public.vat_category c where c.code = ${q(b.category_code)}
on conflict (vat_category_id, valid_from) do nothing;`)
}
sql.push('')
const salidaSql = sql.join('\n') + '\n'
const salidaRef = JSON.stringify(ref, null, 1) + '\n'

if (modo === 'comprobar') {
  const igual = (ruta, contenido) => existsSync(ruta) && readFileSync(ruta, 'utf8') === contenido
  const malos = [[MIGRACION, salidaSql], [join(REF, 'serie.json'), salidaRef]].filter(([r, c]) => !igual(r, c)).map(([r]) => r)
  if (malos.length) { console.error(`Difiere de lo que sale de las fuentes: ${malos.join(', ')}`); process.exit(1) }
  console.log('Valores de serie: idénticos a lo que sale de las fuentes.')
} else {
  writeFileSync(MIGRACION, salidaSql)
  writeFileSync(join(REF, 'serie.json'), salidaRef)
  console.log(`Generado: ${MIGRACION} y ${REF}/serie.json`)
  console.log(`  países ${ps.length} · monedas ${ms.length} · IAE ${iaes.length} · CNAE ${cnaes.length} · formas ${filasFormas.length}`)
  for (const t of TABLAS_MANUALES) console.log(`  ${t} ${cargadas[t].length}`)
  console.log(`  tipos de gasto ${gastos.length} · puente ${puente.length} · apartadas ${apartadas.length}`)
  for (const a of apartadas) console.log(`    apartada ${a.tabla} ${a.code}: ${a.por}`)
}
