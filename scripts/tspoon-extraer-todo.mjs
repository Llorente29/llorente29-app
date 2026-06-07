// tspoon-extraer-todo.mjs — Extracción EXHAUSTIVA de tspoon, por capas, con guardado incremental.
//
// "El máximo de tspoon": vuelca cada área a su propio fichero JSON según termina.
// Si algo falla a mitad, lo anterior queda guardado y se reanuda desde la capa que falló
// (cada capa comprueba si su fichero ya existe y, con SKIP_EXISTING=true, lo salta).
//
// Endpoints confirmados contra la documentación oficial (no adivinados).
// SOLO LEE tspoon. No escribe nada en tspoon.
//
// Uso (PowerShell):
//   $env:TSPOON_USER="..."; $env:TSPOON_PASS="..."
//   node .\scripts\tspoon-extraer-todo.mjs
//
// Salida: carpeta .\tspoon_dump\  con un .json por capa + _manifiesto.json
//
// Notas de la doc:
//  - BASE de la doc moderna: app.tspoonlab.com/recipes/api (la migración usó www.; ambas valen,
//    configurable por env TSPOON_BASE). Login: POST form-urlencoded -> token header "rememberme".
//  - Header "order" = idOrderCenter (centro de coste). Algunas llamadas lo exigen.
//  - listRecipesPaged / listDishesPaged aceptan withDetail=true & withTypes=true => escandallo COMPLETO.
//  - integration/* (compras, ventas, facturas) usa rango de fechas startDate/endDate.

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const USER = process.env.TSPOON_USER
const PASS = process.env.TSPOON_PASS
const BASE = process.env.TSPOON_BASE || 'https://app.tspoonlab.com/recipes/api'
const OUT_DIR = process.env.TSPOON_OUT || 'tspoon_dump'
const SKIP_EXISTING = (process.env.TSPOON_SKIP || 'true') === 'true' // reanudar: saltar capas ya hechas
const SLEEP_MS = 150
const PAGE_ROWS = 200

// Rango de fechas para las áreas transaccionales (compras/ventas/facturas). Ajustable por env.
const START_DATE = process.env.TSPOON_START || '2024-01-01'
const END_DATE = process.env.TSPOON_END || new Date().toISOString().slice(0, 10)

if (!USER || !PASS) {
  console.error('Faltan credenciales. Define TSPOON_USER y TSPOON_PASS.')
  process.exit(1)
}
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

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

// GET con reintentos. Devuelve data (objeto/array) o null si 404/no-JSON.
async function apiGet(path, token, order, params, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    await sleep(SLEEP_MS)
    try {
      const url = new URL(`${BASE}${path}`)
      if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
      const res = await fetch(url, { headers: headers(token, order) })
      if (res.status === 404) return { notFound: true }
      const text = await res.text()
      if (!res.ok) {
        if (attempt === tries) return { error: `HTTP ${res.status}`, note: text.slice(0, 200) }
        await sleep(SLEEP_MS * attempt * 2)
        continue
      }
      try { return { data: JSON.parse(text) } } catch { return { notJson: true, raw: text.slice(0, 200) } }
    } catch (e) {
      if (attempt === tries) return { error: String(e).slice(0, 200) }
      await sleep(SLEEP_MS * attempt * 2)
    }
  }
  return { error: 'agotados reintentos' }
}

// Extrae el array de una respuesta sea cual sea su envoltorio.
function asArray(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.rows)) return data.rows
  if (data && Array.isArray(data.list)) return data.list
  if (data && Array.isArray(data.data)) return data.data
  if (data && Array.isArray(data.content)) return data.content
  return null
}

// Recorre TODAS las páginas de un endpoint paginado (start/rows) y junta los resultados.
async function getAllPaged(path, token, order, extraParams = {}) {
  const all = []
  let start = 0
  for (let guard = 0; guard < 1000; guard++) {
    const r = await apiGet(path, token, order, { start, rows: PAGE_ROWS, filter: '', ...extraParams })
    if (r.notFound) return { notFound: true, items: all }
    if (r.error) return { error: r.error, items: all }
    const arr = asArray(r.data)
    if (!arr) return { items: all, raw: r.data }   // respuesta no-lista: la devolvemos cruda
    all.push(...arr)
    if (arr.length < PAGE_ROWS) break               // última página
    start += PAGE_ROWS
  }
  return { items: all }
}

function save(name, payload) {
  const file = join(OUT_DIR, `${name}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  return file
}
function alreadyDone(name) {
  return SKIP_EXISTING && existsSync(join(OUT_DIR, `${name}.json`))
}

const manifest = []
function record(name, info) {
  manifest.push({ name, ...info, ts: new Date().toISOString() })
  save('_manifiesto', manifest)
}

async function main() {
  console.log('== tspoon EXTRACCIÓN EXHAUSTIVA ==')
  console.log(`BASE=${BASE}  OUT=${OUT_DIR}  fechas=${START_DATE}..${END_DATE}  skipExisting=${SKIP_EXISTING}`)
  const token = await login()
  console.log('✓ login OK (token len', token.length, ')\n')

  // Centro de coste (order). El de la migración; si hay varios, los recorremos para algunas capas.
  const KNOWN_ORDER = process.env.TSPOON_ORDER || '310777912922279025999369297421710030284'

  // CAPA 0 — centros de coste (para saber con qué "order" trabajar y volcar su config completa)
  let centers = []
  if (!alreadyDone('00_centros')) {
    const r = await apiGet('/orderCenters', token) // 63 campos de config por centro
    centers = asArray(r.data) || []
    save('00_centros', centers)
    record('00_centros', { count: centers.length })
    console.log(`✓ 00_centros: ${centers.length}`)
  } else {
    centers = JSON.parse(readFileSync(join(OUT_DIR, '00_centros.json'), 'utf8'))
    console.log('· 00_centros (ya estaba)')
  }
  const ORDER = (centers[0] && (centers[0].idOrderCenter || centers[0].id)) || KNOWN_ORDER

  // Capas "maestro" que NO dependen de fechas. [nombre, path, extraParams]
  const masterLayers = [
    ['01_unidades',        '/units', {}],
    ['02_familias_ingred', '/listTypesPagedEx', { type: 0 }],
    ['03_familias_recetas','/listTypesPagedEx', { type: 1 }],
    ['04_familias_materl', '/listTypesPagedEx', { type: 2 }],
    ['05_familias_platos', '/listTypesPagedEx', { type: 3 }],
    ['06_familias_almacen','/listTypesPagedEx', { type: 5 }],
    ['07_familias_produc', '/listTypesPagedEx', { type: 8 }],
    // Productos base CON todo: unidades, familias, coste, proveedor
    ['10_ingredientes',    '/listIngredientsPaged', { withUnits: true, withTypes: true, withCost: true }],
    ['11_materiales',      '/listMaterialsPaged',   { withUnits: true, withTypes: true, withCost: true }],
    // Elaboradas CON DETALLE COMPLETO (escandallo entero) y familias
    ['12_recetas_detalle', '/listRecipesPaged', { withDetail: true, withTypes: true }],
    ['13_platos_detalle',  '/listDishesPaged',  { withDetail: true, withTypes: true }],
    // Proveedores y clientes (cabeceras; el detalle por proveedor se hace en capa aparte)
    ['20_proveedores',     '/listVendorsPaged', {}],
    ['21_tipos_proveedor', '/listVendorTypesPaged', {}],
    ['22_clientes',        '/listCustomersPaged', {}],
    // Almacenes / inventarios
    ['30_almacenes',       '/listStoresPaged', {}],
    ['31_inventarios',     '/listInventoriesPaged', {}],
    // Mermas
    ['40_mermas',          '/listThrownPaged', {}],
    ['41_tipos_merma',     '/listThrownTypesPaged', {}],
    // Producción (partidas se maneja aparte, abajo) / traspasos / pedidos / controles / menús
    ['51_traspasos',       '/listTransferPaged', {}],
    ['52_pedidos',         '/listOrdersPagedExt', {}],
    ['53_controles_appcc', '/listControlsPaged', {}],
    ['54_menus',           '/listMenusPaged', {}],
  ]

  for (const [name, path, extra] of masterLayers) {
    if (alreadyDone(name)) { console.log(`· ${name} (ya estaba)`); continue }
    const r = await getAllPaged(path, token, ORDER, extra)
    if (r.notFound) {
      save(name, { notFound: true, path })
      record(name, { count: 0, notFound: true, path })
      console.log(`✗ ${name}: 404 (endpoint distinto, revisar)`)
      continue
    }
    const items = r.items || []
    save(name, items.length ? items : (r.raw ?? items))
    record(name, { count: items.length, path, error: r.error })
    console.log(`${items.length ? '✓' : '·'} ${name}: ${items.length}${r.error ? ' (con error: ' + r.error + ')' : ''}`)
  }

  // CAPA 50 — PARTIDAS (producción). El nombre exacto del endpoint no está confirmado:
  // probamos variantes y nos quedamos con la primera que devuelva datos. Si TODAS responden
  // vacío o 404, es dato real (Llorente29 no usa "partidas") y lo dejamos documentado.
  if (!alreadyDone('50_partidas')) {
    const candidates = [
      '/listPartidasPaged',
      '/listPartidesPaged',
      '/listPartidas',
      '/listPartides',
      '/production/partidas',
      '/listProductionPartsPaged',
    ]
    let chosen = null
    let items = []
    const tried = []
    for (const path of candidates) {
      const r = await getAllPaged(path, token, ORDER)
      const n = (r.items && r.items.length) || 0
      tried.push({ path, count: n, notFound: !!r.notFound, error: r.error })
      console.log(`  …50_partidas probando ${path} -> ${r.notFound ? '404' : n}`)
      if (!r.notFound && n > 0) { chosen = path; items = r.items; break }
    }
    save('50_partidas', items.length ? items : { empty: true, tried })
    record('50_partidas', { count: items.length, path: chosen, tried })
    console.log(`${items.length ? '✓' : '·'} 50_partidas: ${items.length}${chosen ? ' (' + chosen + ')' : ' (todas vacías/404 — dato real)'}`)
  } else console.log('· 50_partidas (ya estaba)')

  // CAPA 60 — DETALLE POR PROVEEDOR (catálogo completo: artículos, formatos, últimas compras)
  if (!alreadyDone('60_proveedores_detalle')) {
    const provs = existsSync(join(OUT_DIR, '20_proveedores.json'))
      ? JSON.parse(readFileSync(join(OUT_DIR, '20_proveedores.json'), 'utf8'))
      : []
    const detalle = []
    let i = 0
    for (const p of asArray(provs) || provs) {
      i++
      const id = p.id
      if (!id) continue
      const r = await apiGet(`/vendor/${id}`, token, ORDER)
      if (r.data) detalle.push(r.data)
      if (i % 5 === 0) { save('60_proveedores_detalle', detalle); console.log(`  …proveedores ${i}`) }
    }
    save('60_proveedores_detalle', detalle)
    record('60_proveedores_detalle', { count: detalle.length })
    console.log(`✓ 60_proveedores_detalle: ${detalle.length}`)
  } else console.log('· 60_proveedores_detalle (ya estaba)')

  // CAPA 70 — INTEGRACIÓN: COMPRAS (pedidos, albaranes, facturas) por rango de fechas, TODO
  const integrationLayers = [
    ['70_compras_pedidos',   '/integration/purchases/orders/pending', {}], // pendientes (no hay "all" de pedidos)
    ['71_compras_albaranes', '/integration/purchases/deliveries/all', { onlyValidated: false }],
    ['72_compras_facturas',  '/integration/purchases/invoices/all',   { onlyValidated: false }],
    ['73_ventas_albaranes',  '/integration/sales/deliveries/all',     {}],
    ['74_ventas_facturas',   '/integration/sales/invoices/all',       { onlyValidated: false }], // 'all' como compras (antes 'pending'=0)
  ]
  for (const [name, path, extra] of integrationLayers) {
    if (alreadyDone(name)) { console.log(`· ${name} (ya estaba)`); continue }
    const r = await apiGet(path, token, ORDER, {
      startDate: START_DATE, endDate: END_DATE, includeInternal: true, ...extra,
    })
    if (r.notFound) { save(name, { notFound: true, path }); record(name, { count: 0, notFound: true, path }); console.log(`✗ ${name}: 404`); continue }
    const arr = asArray(r.data) || (r.data ? [r.data] : [])
    save(name, arr.length ? arr : (r.data ?? []))
    record(name, { count: arr.length, path, error: r.error })
    console.log(`${arr.length ? '✓' : '·'} ${name}: ${arr.length}${r.error ? ' (' + r.error + ')' : ''}`)
  }

  // CAPA 80 — PRODUCCIÓN POR DÍA (cocina central). Recorremos un rango de días reciente.
  // La doc: POST production/day/{y}/{m}/{d} -> id ; luego productionComponentList?id=
  if (!alreadyDone('80_produccion_dias')) {
    const prod = []
    const today = new Date()
    const DAYS_BACK = Number(process.env.TSPOON_PROD_DAYS || 120) // últimos N días
    for (let d = 0; d < DAYS_BACK; d++) {
      const day = new Date(today.getTime() - d * 86400000)
      const y = day.getFullYear(), m = day.getMonth() + 1, dd = day.getDate()
      // obtener/crear id del día (POST). Usamos fetch directo para método POST.
      await sleep(SLEEP_MS)
      let idDay = null
      try {
        const res = await fetch(`${BASE}/production/day/${y}/${m}/${dd}`, { method: 'POST', headers: headers(token, ORDER) })
        if (res.ok) { const j = await res.json().catch(() => null); idDay = j && j.id }
      } catch { /* ignore */ }
      if (!idDay) continue
      const r = await apiGet('/productionComponentList', token, ORDER, { id: idDay })
      const pd = r.data
      if (pd && pd.listComponents && pd.listComponents.length) {
        prod.push({ date: `${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`, id: idDay, ...pd })
      }
      if (d % 20 === 0) { save('80_produccion_dias', prod); console.log(`  …producción día -${d}`) }
    }
    save('80_produccion_dias', prod)
    record('80_produccion_dias', { count: prod.length, daysScanned: DAYS_BACK })
    console.log(`✓ 80_produccion_dias: ${prod.length} días con producción`)
  } else console.log('· 80_produccion_dias (ya estaba)')

  // CAPA 90 — DETALLE DE INVENTARIOS (valor + componentes de cada inventario)
  if (!alreadyDone('90_inventarios_detalle')) {
    const invs = existsSync(join(OUT_DIR, '31_inventarios.json'))
      ? JSON.parse(readFileSync(join(OUT_DIR, '31_inventarios.json'), 'utf8'))
      : []
    const detalle = []
    let i = 0
    for (const inv of asArray(invs) || invs) {
      i++
      const id = inv.id
      if (!id) continue
      const total = await apiGet(`/inventory/${id}/total`, token, ORDER)
      const comps = await getAllPaged(`/inventory/${id}/components/paged`, token, ORDER)
      detalle.push({ id, descr: inv.descr, total: total.data, components: comps.items })
      if (i % 5 === 0) { save('90_inventarios_detalle', detalle); console.log(`  …inventario ${i}`) }
    }
    save('90_inventarios_detalle', detalle)
    record('90_inventarios_detalle', { count: detalle.length })
    console.log(`✓ 90_inventarios_detalle: ${detalle.length}`)
  } else console.log('· 90_inventarios_detalle (ya estaba)')

  console.log('\n=== EXTRACCIÓN COMPLETA ===')
  console.log(`Carpeta: ${OUT_DIR}/  (ver _manifiesto.json para el resumen)`)
}

main().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1) })
