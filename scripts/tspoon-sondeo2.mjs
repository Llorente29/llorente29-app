#!/usr/bin/env node
/**
 * tspoon-sondeo2.mjs — SOLO LEE. Segundo sondeo, afinado con lo aprendido:
 *  - /listIngredientsPaged y /ingredient/{id} funcionan; /formats y /suppliers dan 404.
 *  - Hipótesis: formatos+proveedores vienen EMBEBIDOS en el detalle (estaban truncados),
 *    o cuelgan de otro endpoint. Este script:
 *    1) vuelca el detalle COMPLETO (sin truncar) del Aceite Alto Oleico (sabemos que
 *       tiene "Garrafa = 25 Lt") a fichero, e imprime TODAS sus claves de primer nivel.
 *    2) prueba una nueva batería de endpoints de formatos/proveedores/unidades/familias.
 *
 * USO: $env:TSPOON_USER=...; $env:TSPOON_PASS=...; node scripts/tspoon-sondeo2.mjs
 * Pega toda la salida + sube el fichero tspoon_aceite_detalle.json que genera.
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
  await sleep(200)
  const url = new URL(`${BASE}${path}`)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: headers(token, order) })
  const text = await res.text()
  if (!res.ok) return { __error: `HTTP ${res.status}`, body: text.slice(0, 150) }
  try { return JSON.parse(text) } catch { return { __error: 'no-json', body: text.slice(0, 150) } }
}
const arrOf = (d) => Array.isArray(d) ? d : (d?.rows || d?.content || d?.data || [])
const keys = (o) => o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : (Array.isArray(o) ? `[array ${o.length}]` : typeof o)

async function main() {
  const token = await login(); console.log('✓ login')
  const centers = arrOf(await apiGet('/listOrderCenters', token))
  const order = centers[0]?.idOrderCenter || centers[0]?.id
  console.log('centro order=', order, '\n')

  // 1) Encontrar el Aceite Alto Oleico (sabemos que tiene formato Garrafa=25Lt)
  let target = null
  for (let start = 0; start < 2000 && !target; start += 50) {
    const rows = arrOf(await apiGet('/listIngredientsPaged', token, order, { start, rows: 50 }))
    if (!rows.length) break
    target = rows.find((r) => String(r.descr || '').toLowerCase().includes('aceite alto oleico'))
  }
  if (!target) { console.log('No encontré Aceite Alto Oleico; uso el primero'); target = arrOf(await apiGet('/listIngredientsPaged', token, order, { start: 0, rows: 1 }))[0] }
  const id = target.id
  console.log('artículo objetivo:', target.descr, '| id', id, '\n')

  // 2) Detalle COMPLETO sin truncar → fichero + claves
  const det = await apiGet(`/ingredient/${id}`, token, order)
  writeFileSync('tspoon_aceite_detalle.json', JSON.stringify(det, null, 2), 'utf8')
  console.log('== claves de primer nivel del detalle (mira si hay formats/vendors/conversions/units) ==')
  for (const k of Object.keys(det)) {
    const v = det[k]
    console.log(`  ${k}: ${keys(v)}`)
  }
  console.log('\n✓ detalle completo en tspoon_aceite_detalle.json (SÚBELO)\n')

  // 3) Más endpoints candidatos (formatos/proveedores/unidades/familias/recetas)
  const cands = [
    `/ingredient/${id}/vendors`, `/ingredient/${id}/vendor`, `/ingredient/${id}/packaging`,
    `/ingredient/${id}/packagings`, `/ingredient/${id}/units`, `/ingredient/${id}/conversions`,
    `/ingredient/${id}/cost`, `/ingredient/${id}/data`, `/ingredient/${id}/properties`,
    `/listVendorsPaged`, `/listSuppliersPaged`, `/vendors`, `/listUnits`, `/units`,
    `/listUnitsPaged`, `/listComponentTypes`, `/listTags`, `/listAllergens`, `/allergens`,
    `/listFamiliesPaged`, `/families`,
  ]
  console.log('== probando endpoints adicionales ==')
  for (const path of cands) {
    const d = await apiGet(path, token, order, path.includes('Paged') ? { start: 0, rows: 3 } : undefined)
    if (d?.__error) { console.log(`  ✗ ${path}: ${d.__error}`); continue }
    const rows = arrOf(d)
    if (Array.isArray(d) || rows.length) console.log(`  ✓ ${path}: ${rows.length} filas | claves: ${keys(rows[0])}`)
    else console.log(`  ✓ ${path}: obj | claves: ${Object.keys(d).join(', ')}`)
  }
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
