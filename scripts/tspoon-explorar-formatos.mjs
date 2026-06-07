#!/usr/bin/env node
/**
 * tspoon-explorar-formatos.mjs  —  SOLO LEE, no escribe nada.
 * -------------------------------------------------------------------------
 * Objetivo: descubrir cómo expone la API de tspoon el MODELO DE FORMATOS de
 * los artículos de COMPRA (ingredientes/materiales): unidad base, conversiones
 * propias ("1 Garrafa = 25 Lt"), formatos por proveedor (caja⊃bote⊃unidad),
 * pedido mínimo, etc. — lo que se ve en la pantalla "Formatos" de tspoon.
 *
 * La doc de la API es de hace ~3 años, así que el script PRUEBA varios endpoints
 * candidatos y vuelca lo que devuelva (estructura completa del primer artículo
 * que traiga formatos). No asume nada: imprime las claves reales del JSON.
 *
 * USO (PowerShell):
 *   $env:TSPOON_USER="..."; $env:TSPOON_PASS="..."
 *   node scripts/tspoon-explorar-formatos.mjs
 *
 * Si un endpoint no existe, lo dice y prueba el siguiente. Pega TODA la salida.
 * -------------------------------------------------------------------------
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
  if (!res.ok) return { __error: `HTTP ${res.status}`, body: text.slice(0, 200) }
  try { return JSON.parse(text) } catch { return { __error: 'no-json', body: text.slice(0, 200) } }
}
const arrOf = (d) => Array.isArray(d) ? d : (d?.rows || d?.content || d?.data || [])
const keys = (o) => o && typeof o === 'object' ? Object.keys(o) : []

async function main() {
  console.log('== login =='); const token = await login(); console.log('✓ token', token.length)

  // centros
  const centers = arrOf(await apiGet('/listOrderCenters', token))
  const center = centers[0]; const order = center?.idOrderCenter || center?.id
  console.log(`\n== centro: ${center?.descr || '?'} (order=${order}) ==`)

  // PROBAR endpoints candidatos de ARTÍCULOS DE COMPRA (ingredientes/materiales/productos)
  const candidatos = [
    '/listIngredientsPaged', '/ingredients/paged', '/listProductsPaged', '/products/paged',
    '/listMaterialsPaged', '/materials/paged', '/listSuppliesPaged', '/supplies/paged',
    '/listArticlesPaged', '/articles/paged', '/listRawMaterialsPaged',
    '/inventory/items/paged', '/listInventoryItemsPaged', '/stock/items/paged',
  ]
  console.log('\n== probando endpoints de artículos de compra ==')
  let found = null, foundPath = null
  for (const path of candidatos) {
    const d = await apiGet(path, token, order, { start: 0, rows: 5 })
    if (d?.__error) { console.log(`  ✗ ${path}: ${d.__error}`); continue }
    const rows = arrOf(d)
    if (rows.length) {
      console.log(`  ✓ ${path}: ${rows.length} filas | claves: ${keys(rows[0]).join(', ')}`)
      if (!found) { found = rows; foundPath = path }
    } else {
      console.log(`  · ${path}: vacío | claves resp: ${keys(d).join(', ')}`)
    }
  }

  if (!found) {
    console.log('\nNingún endpoint de lista funcionó. Pega arriba lo que salió y ajusto.')
    return
  }

  // Buscar un artículo CON formatos para ver su estructura completa
  console.log(`\n== estructura de un artículo (de ${foundPath}) ==`)
  const sample = found[0]
  console.log(JSON.stringify(sample, null, 2).slice(0, 2000))

  // Si el artículo tiene un id, probar endpoint de DETALLE/FORMATOS
  const aid = sample?.id || sample?.idComponent || sample?.idIngredient || sample?.idProduct
  if (aid) {
    console.log(`\n== probando detalle/formatos del artículo id=${aid} ==`)
    const detCands = [
      `/ingredient/${aid}`, `/ingredient/${aid}/formats`, `/ingredient/${aid}/suppliers`,
      `/product/${aid}`, `/product/${aid}/formats`, `/article/${aid}`, `/article/${aid}/formats`,
      `/material/${aid}`, `/material/${aid}/formats`, `/item/${aid}/formats`,
    ]
    for (const path of detCands) {
      const d = await apiGet(path, token, order)
      if (d?.__error) { console.log(`  ✗ ${path}: ${d.__error}`); continue }
      console.log(`  ✓ ${path}:`)
      console.log(JSON.stringify(d, null, 2).slice(0, 1500))
      console.log('  ---')
    }
  }

  // volcar el listado completo a fichero para análisis
  writeFileSync('tspoon_articulos_raw.json', JSON.stringify(found, null, 2), 'utf8')
  console.log('\n✓ Volcado tspoon_articulos_raw.json (muestra de 5)')
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
