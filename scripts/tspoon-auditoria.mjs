// tspoon-auditoria.mjs — Auditoría completa de la API de tspoon (Fase 0, plan de goleada).
//
// Barrido exploratorio: prueba TODAS las entidades conocidas y candidatas de la API,
// registra cuáles responden, cuántos registros tienen y la ESTRUCTURA de un ejemplo
// (las claves de cada objeto). Objetivo: mapa "qué hace tspoon" capacidad por capacidad,
// con foco en las áreas donde compite fuerte (producción/cocina central, trazabilidad,
// expediciones, traspasos, lotes, controles, inventario, informes).
//
// SOLO LEE tspoon. No toca Folvy ni escribe nada en tspoon.
//
// Uso:
//   $env:TSPOON_USER="..."; $env:TSPOON_PASS="..."; node .\scripts\tspoon-auditoria.mjs
//
// Salida: tspoon_auditoria.json (datos crudos) + tspoon_auditoria_informe.txt (legible).

import { writeFileSync } from 'node:fs'

const USER = process.env.TSPOON_USER
const PASS = process.env.TSPOON_PASS
const BASE = process.env.TSPOON_BASE || 'https://www.tspoonlab.com/recipes/api'
const SLEEP_MS = 200
const PAGE_ROWS = 50   // pocas filas: solo queremos estructura y conteo, no todo el dato

if (!USER || !PASS) {
  console.error('Faltan credenciales. Define TSPOON_USER y TSPOON_PASS.')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login() {
  const body = new URLSearchParams({ username: USER, password: PASS }).toString()
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Login falló: HTTP ${res.status}\n${text.slice(0, 300)}`)
  let token = text.trim().replace(/^["']|["']$/g, '').trim()
  if (!token || token.length < 8) {
    const hdr = res.headers.get('set-cookie') || res.headers.get('authorization') || ''
    if (hdr) token = hdr
  }
  return token
}

function headers(token, order) {
  const h = { rememberme: token }
  if (order) h.order = order
  return h
}

// GET tolerante: devuelve {ok, status, data, isJson, sample}
async function probe(path, token, order, params) {
  await sleep(SLEEP_MS)
  try {
    const url = new URL(`${BASE}${path}`)
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    const res = await fetch(url, { headers: headers(token, order) })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, note: text.slice(0, 120) }
    let data = null
    try { data = JSON.parse(text) } catch { return { ok: true, status: res.status, isJson: false, note: text.slice(0, 120) } }
    return { ok: true, status: res.status, isJson: true, data }
  } catch (e) {
    return { ok: false, status: 0, note: String(e).slice(0, 120) }
  }
}

// Resume la forma de una respuesta: nº de registros + claves de un ejemplo.
function describe(data) {
  if (data == null) return { kind: 'null', count: 0, keys: [] }
  // muchas APIs devuelven {rows:[...], total} o {list:[...]} o directamente [...]
  let arr = null
  if (Array.isArray(data)) arr = data
  else if (Array.isArray(data.rows)) arr = data.rows
  else if (Array.isArray(data.list)) arr = data.list
  else if (Array.isArray(data.data)) arr = data.data
  else if (Array.isArray(data.content)) arr = data.content
  if (arr) {
    const sample = arr[0] ?? null
    return {
      kind: 'array',
      count: data.total ?? data.totalCount ?? arr.length,
      shownCount: arr.length,
      keys: sample && typeof sample === 'object' ? Object.keys(sample) : [],
      sample: sample,
    }
  }
  if (typeof data === 'object') {
    return { kind: 'object', count: 1, keys: Object.keys(data), sample: data }
  }
  return { kind: typeof data, count: 1, keys: [], sample: data }
}

// Batería de endpoints a sondear. Mezcla confirmados (migración) y candidatos por área.
// Para los paginados probamos con start/rows; para los de detalle no aplican aquí.
const ENDPOINTS = [
  // — núcleo ya conocido —
  ['ingredientes', '/listIngredientsPaged', { start: 0, rows: PAGE_ROWS }],
  ['materiales',   '/listMaterialsPaged',   { start: 0, rows: PAGE_ROWS }],
  ['proveedores',  '/listVendorsPaged',     { start: 0, rows: PAGE_ROWS }],
  ['unidades',     '/units',                null],
  ['unidades2',    '/listUnits',            null],
  ['clientes',     '/listCustomersPaged',   { start: 0, rows: PAGE_ROWS }],
  // — recetas / escandallos / fichas técnicas —
  ['recetas',          '/listRecipesPaged',          { start: 0, rows: PAGE_ROWS }],
  ['recetas2',         '/listRecipePaged',           { start: 0, rows: PAGE_ROWS }],
  ['platos',           '/listDishesPaged',           { start: 0, rows: PAGE_ROWS }],
  ['fichas',           '/listTechnicalSheetsPaged',  { start: 0, rows: PAGE_ROWS }],
  ['subrecetas',       '/listSubRecipesPaged',       { start: 0, rows: PAGE_ROWS }],
  ['familias',         '/listFamiliesPaged',         { start: 0, rows: PAGE_ROWS }],
  ['familias2',        '/listFamilies',              null],
  ['alergenos',        '/listAllergens',             null],
  // — producción / cocina central (FOCO) —
  ['prodTemplates',    '/listProductionTemplates',   { start: 0, rows: PAGE_ROWS }],
  ['prodTemplates2',   '/listProductionTemplatesPaged', { start: 0, rows: PAGE_ROWS }],
  ['producciones',     '/listProductionsPaged',      { start: 0, rows: PAGE_ROWS }],
  ['producciones2',    '/listProductionPaged',       { start: 0, rows: PAGE_ROWS }],
  ['ordenesProd',      '/listProductionOrdersPaged', { start: 0, rows: PAGE_ROWS }],
  ['planProd',         '/listProductionPlanPaged',   { start: 0, rows: PAGE_ROWS }],
  // — expediciones / traspasos / logística —
  ['expediciones',     '/listExpeditionsPaged',      { start: 0, rows: PAGE_ROWS }],
  ['expediciones2',    '/listExpeditions',           { start: 0, rows: PAGE_ROWS }],
  ['traspasos',        '/listTransferPaged',         { start: 0, rows: PAGE_ROWS }],
  ['traspasos2',       '/listTransfersPaged',        { start: 0, rows: PAGE_ROWS }],
  ['pedidos',          '/listOrdersPaged',           { start: 0, rows: PAGE_ROWS }],
  ['pedidosCompra',    '/listPurchaseOrdersPaged',   { start: 0, rows: PAGE_ROWS }],
  ['albaranes',        '/listDeliveryNotesPaged',    { start: 0, rows: PAGE_ROWS }],
  ['facturas',         '/listInvoicesPaged',         { start: 0, rows: PAGE_ROWS }],
  // — trazabilidad / lotes / APPCC —
  ['lotes',            '/listLotsPaged',             { start: 0, rows: PAGE_ROWS }],
  ['lotes2',           '/listLots',                  { start: 0, rows: PAGE_ROWS }],
  ['controles',        '/listControlsPaged',         { start: 0, rows: PAGE_ROWS }],
  ['controles2',       '/listControls',              { start: 0, rows: PAGE_ROWS }],
  ['trazabilidad',     '/listTraceabilityPaged',     { start: 0, rows: PAGE_ROWS }],
  // — inventario / mermas / stock —
  ['inventario',       '/listInventoriesPaged',      { start: 0, rows: PAGE_ROWS }],
  ['inventario2',      '/listInventoryPaged',        { start: 0, rows: PAGE_ROWS }],
  ['stock',            '/listStockPaged',            { start: 0, rows: PAGE_ROWS }],
  ['mermas',           '/listWastePaged',            { start: 0, rows: PAGE_ROWS }],
  // — menús / cartas / ventas —
  ['menus',            '/listMenusPaged',            { start: 0, rows: PAGE_ROWS }],
  ['cartas',           '/listMenuPaged',             { start: 0, rows: PAGE_ROWS }],
  ['ventas',           '/listSalesPaged',            { start: 0, rows: PAGE_ROWS }],
  // — centros / locales / usuarios —
  ['centros',          '/listOrderCenters',          null],
  ['centros2',         '/orderCenters',              null],
  ['almacenes',        '/listWarehousesPaged',       { start: 0, rows: PAGE_ROWS }],
  ['usuarios',         '/listUsersPaged',            { start: 0, rows: PAGE_ROWS }],
]

async function main() {
  console.log('== tspoon auditoría: login ==')
  const token = await login()
  console.log('✓ token (len', token.length, ')')

  // Centro de coste (order). Reutilizamos el conocido de la migración; si falla, sin order.
  const ORDER = process.env.TSPOON_ORDER || '310777912922279025999369297421710030284'

  const results = []
  console.log(`\n== sondeando ${ENDPOINTS.length} endpoints ==\n`)
  for (const [label, path, params] of ENDPOINTS) {
    const r = await probe(path, token, ORDER, params)
    if (r.ok && r.isJson) {
      const d = describe(r.data)
      results.push({ label, path, status: r.status, ...d })
      const flag = d.count > 0 ? '✓' : '·'
      console.log(`${flag} ${label.padEnd(16)} ${path.padEnd(34)} ${d.kind}  count=${d.count}  keys=${d.keys.length}`)
    } else if (r.ok && !r.isJson) {
      results.push({ label, path, status: r.status, kind: 'no-json', note: r.note })
      console.log(`? ${label.padEnd(16)} ${path.padEnd(34)} respuesta no-JSON`)
    } else {
      results.push({ label, path, status: r.status, kind: 'error', note: r.note })
      console.log(`✗ ${label.padEnd(16)} ${path.padEnd(34)} HTTP ${r.status}`)
    }
  }

  // Volcado crudo (con un ejemplo por entidad que respondió con datos).
  writeFileSync('tspoon_auditoria.json', JSON.stringify(results, null, 2), 'utf8')

  // Informe legible: por cada entidad con datos, sus claves (= su modelo de datos).
  const lines = []
  lines.push('AUDITORÍA API tspoon — mapa de entidades')
  lines.push('='.repeat(60))
  lines.push('')
  const conDatos = results.filter((r) => r.kind === 'array' || r.kind === 'object').filter((r) => (r.count ?? 0) > 0)
  const vacios = results.filter((r) => (r.kind === 'array' || r.kind === 'object') && (r.count ?? 0) === 0)
  const errores = results.filter((r) => r.kind === 'error' || r.kind === 'no-json')

  lines.push(`ENTIDADES CON DATOS (${conDatos.length}):`)
  lines.push('-'.repeat(60))
  for (const r of conDatos) {
    lines.push(`\n● ${r.label}  (${r.path})  — ${r.count} registros`)
    lines.push(`  campos: ${r.keys.join(', ')}`)
  }
  lines.push('')
  lines.push(`ENTIDADES QUE RESPONDEN PERO VACÍAS (${vacios.length}):`)
  lines.push('-'.repeat(60))
  for (const r of vacios) lines.push(`  ○ ${r.label}  (${r.path})  — 0 registros (existe el endpoint)`)
  lines.push('')
  lines.push(`ENDPOINTS QUE NO RESPONDEN (${errores.length}):`)
  lines.push('-'.repeat(60))
  for (const r of errores) lines.push(`  ✗ ${r.label}  (${r.path})  — ${r.kind} ${r.status} ${r.note ?? ''}`)

  writeFileSync('tspoon_auditoria_informe.txt', lines.join('\n'), 'utf8')

  console.log(`\n✓ tspoon_auditoria.json (${results.length} endpoints)`)
  console.log(`✓ tspoon_auditoria_informe.txt`)
  console.log(`  con datos: ${conDatos.length} | vacíos: ${vacios.length} | no responden: ${errores.length}`)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
