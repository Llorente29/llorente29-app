#!/usr/bin/env node
/**
 * tspoon-sondeo3.mjs — SOLO LEE. Tercer sondeo, dirigido:
 * Ya sabemos que el detalle /ingredient/{id} trae EMBEBIDOS:
 *   - listVendor      → proveedores del artículo (aquí están los formatos por proveedor)
 *   - listContainers  → envases/formatos
 *   - listUnitEquality→ conversiones de unidad propias ("1 Garrafa = 25 Lt")
 *   - listOrderTemplates, listStores, etc.
 * Este script busca varios artículos QUE SÍ tienen formato cargado (Tzatziki, Pan Pita,
 * Falafel, Rollitos) y vuelca SOLO esas ramas, completas, a fichero + consola.
 *
 * USO: $env:TSPOON_USER=...; $env:TSPOON_PASS=...; node scripts/tspoon-sondeo3.mjs
 * Pega la salida + sube tspoon_formatos_muestra.json
 */
import { writeFileSync } from 'node:fs'

const USER = process.env.TSPOON_USER, PASS = process.env.TSPOON_PASS
if (!USER || !PASS) { console.error('Define TSPOON_USER y TSPOON_PASS'); process.exit(1) }
const BASE = process.env.TSPOON_BASE || 'https://www.tspoonlab.com/recipes/api'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login() {
  const body = new URLSearchParams({ username: USER, password: PASS }).toString()
  const res = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const text = await res.text()
  if (!res.ok) throw new Error(`Login ${res.status}: ${text.slice(0, 300)}`)
  return text.replace(/^["']|["']$/g, '').trim()
}
function headers(token, order) { const h = { rememberme: token }; if (order) h.order = order; return h }
async function apiGet(path, token, order, params) {
  await sleep(150)
  const url = new URL(`${BASE}${path}`)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: headers(token, order) })
  const text = await res.text()
  if (!res.ok) return { __error: `HTTP ${res.status}` }
  try { return JSON.parse(text) } catch { return { __error: 'no-json' } }
}
const arrOf = (d) => Array.isArray(d) ? d : (d?.rows || d?.content || d?.data || [])

async function main() {
  const token = await login(); console.log('✓ login')
  const centers = arrOf(await apiGet('/listOrderCenters', token))
  const order = centers[0]?.idOrderCenter || centers[0]?.id

  // catálogo de unidades (para traducir idUnit → nombre)
  const units = arrOf(await apiGet('/units', token, order))
  console.log(`\n== ${units.length} unidades ==`)
  for (const u of units) console.log(`  ${u.id} = ${u.descr}${u.defecteFormat ? ' [defFormato]' : ''}`)

  // localizar artículos con formato conocido
  const wanted = ['tzatziki 200g', 'pan de pita 21', 'falafel', 'rollitos de queso feta', 'aceite alto oleico']
  const found = []
  for (let start = 0; start < 3000 && found.length < wanted.length; start += 50) {
    const rows = arrOf(await apiGet('/listIngredientsPaged', token, order, { start, rows: 50 }))
    if (!rows.length) break
    for (const r of rows) {
      const d = String(r.descr || '').toLowerCase()
      if (wanted.some((w) => d.includes(w)) && !found.find((f) => f.id === r.id)) found.push(r)
    }
  }
  console.log(`\n== ${found.length} artículos localizados ==`)

  const out = []
  for (const a of found) {
    const det = await apiGet(`/ingredient/${a.id}`, token, order)
    const slim = {
      descr: det.descr, idUnit: det.idUnit, unit: det.unit, quantity: det.quantity, cost: det.cost, iva: det.iva,
      listVendor: det.listVendor, listContainers: det.listContainers, listUnitEquality: det.listUnitEquality,
      listOrderTemplates: det.listOrderTemplates,
    }
    out.push(slim)
    console.log(`\n──────── ${det.descr} (unidad base: ${det.unit}) ────────`)
    console.log('listVendor:', JSON.stringify(det.listVendor, null, 2))
    console.log('listContainers:', JSON.stringify(det.listContainers, null, 2))
    console.log('listUnitEquality:', JSON.stringify(det.listUnitEquality, null, 2))
  }
  writeFileSync('tspoon_formatos_muestra.json', JSON.stringify({ units, articulos: out }, null, 2), 'utf8')
  console.log('\n✓ tspoon_formatos_muestra.json (SÚBELO)')
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
