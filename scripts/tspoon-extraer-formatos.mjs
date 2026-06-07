#!/usr/bin/env node
/**
 * tspoon-extraer-formatos.mjs  —  SOLO LEE la API de tspoon + la BBDD de Folvy.
 * =============================================================================
 * Extrae el MODELO DE FORMATOS bien estructurado desde la API de tspoon (no
 * desde los Excel, que venían ambiguos) y lo cruza con los raws ya migrados en
 * Folvy Interno. Genera:
 *   - tspoon_formatos_plan.json  : plan de re-migración (formatos + proveedores
 *                                  + conversiones de uso) por artículo de Folvy.
 *   - tspoon_formatos_informe.txt: INFORME DE INCOHERENCIAS detectadas en la
 *                                  configuración de tspoon (lo que Folvy corrige).
 *
 * NO escribe nada en Folvy. Eso lo hará el SQL de re-migración (paso siguiente),
 * revisable antes de ejecutar.
 *
 * Modelo tspoon (confirmado por sondeo): el formato vive en
 *   /ingredient/{id}.listVendor[].listFormat[]  con:
 *     quantityFormat, unitFormat       (envase grande: "Caja", 12)
 *     quantityFormatAux, unitFormatAux (sub-envase: "Bote", 0.2)  -- opcional
 *     unit/idUnit                      (unidad de COSTE: Kg/Lt/Uni)
 *     costFormat                       (€ por envase grande)
 *     cost                             (€ por unidad de coste)
 *     codi                             (código de proveedor)
 *   y las conversiones de uso amigables en /ingredient/{id}.listUnitEquality[]
 *     fromQuantity, fromUnit / toQuantity, toUnit / inverted / cost
 *
 * REGLA DE CONVERSIÓN A BASE (la base de Folvy: g/ml/ud):
 *   div(Kg)=1000, div(Lt)=1000, div(gr/g/ml/Uni)=1
 *   - simple:  qty_in_base = quantityFormat * div
 *   - anidado: hijo  = quantityFormatAux * div
 *              padre = quantityFormat * hijo   (qty_per_parent = quantityFormat)
 *
 * VALIDACIÓN (filosofía Folvy: IA propone, humano decide; cero falsos positivos):
 *   - formato con precio incoherente (costFormat/qty_in_base lejos de cost)  -> needs_review (entra marcado)
 *   - formato sin equivalencia a base segura (unidad rara)                    -> needs_review
 *   - conversión de uso físicamente absurda (ud que pesa kilos, etc.)         -> SE DESCARTA (solo informe)
 *
 * USO (PowerShell):
 *   cd C:\dev\llorente29-app
 *   $env:TSPOON_USER="..."; $env:TSPOON_PASS="..."
 *   $env:SUPABASE_URL="https://xzmpnchlguibclvxyynt.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."   # legacy service_role (Project Settings -> API)
 *   node scripts/tspoon-extraer-formatos.mjs
 * =============================================================================
 */
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ---------- credenciales ----------
const USER = process.env.TSPOON_USER, PASS = process.env.TSPOON_PASS
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!USER || !PASS) { console.error('Falta TSPOON_USER / TSPOON_PASS'); process.exit(1) }
if (!SB_URL || !SB_KEY) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const ACCOUNT = '00000000-0000-0000-0000-000000000001'  // Folvy Interno
const BASE = process.env.TSPOON_BASE || 'https://www.tspoonlab.com/recipes/api'
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

// ---------- helpers (idénticos a import-ingredientes.mjs) ----------
const normTxt = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim()
const stripParen = (s) => (s || '').toString().replace(/\s*\([^)]*\)\s*$/, '').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// factor de unidad de COSTE de tspoon -> unidad base de Folvy
function unitDiv(u) {
  const x = (u || '').toString().trim().toLowerCase()
  if (x === 'kg') return { base: 'g', div: 1000, ok: true }
  if (x === 'gr' || x === 'g') return { base: 'g', div: 1, ok: true }
  if (x === 'lt' || x === 'l') return { base: 'ml', div: 1000, ok: true }
  if (x === 'ml') return { base: 'ml', div: 1, ok: true }
  if (x === 'uni' || x === 'ud' || x === 'u') return { base: 'ud', div: 1, ok: true }
  return { base: null, div: null, ok: false }  // Cm, Rollo, Hoja... no mapeable a base con seguridad
}

// ---------- API tspoon ----------
async function login() {
  const body = new URLSearchParams({ username: USER, password: PASS }).toString()
  const res = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const text = await res.text()
  if (!res.ok) throw new Error(`Login ${res.status}: ${text.slice(0, 200)}`)
  return text.replace(/^["']|["']$/g, '').trim()
}
function H(token, order) { const h = { rememberme: token }; if (order) h.order = order; return h }
async function apiGet(path, token, order, params) {
  await sleep(120)
  const url = new URL(`${BASE}${path}`)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: H(token, order) })
  const text = await res.text()
  if (!res.ok) return { __error: `HTTP ${res.status}` }
  try { return JSON.parse(text) } catch { return { __error: 'no-json' } }
}
const arrOf = (d) => Array.isArray(d) ? d : (d?.rows || d?.content || d?.data || [])

// ---------- conversión de un listFormat -> formato(s) Folvy ----------
function buildFormat(f, informeArt) {
  const cu = unitDiv(f.unit)   // unidad de coste del formato
  if (!cu.ok) {
    informeArt.push(`formato "${f.descr}" usa unidad '${f.unit}' no convertible a base -> needs_review`)
    return { skip: false, baseUnit: null, needsReview: true, simple: { name: f.unitFormat || 'Formato', qtyInBase: null, code: f.codi, price: f.costFormat }, nested: null }
  }
  const qF = Number(f.quantityFormat) || 0
  const qAux = f.quantityFormatAux != null ? Number(f.quantityFormatAux) : null
  const hasAux = f.unitFormatAux && qAux != null && qAux > 0

  let nested = null, simple
  if (hasAux) {
    // sub-envase (hijo): tamaño en base = qAux * div
    const childBase = qAux * cu.div
    // padre: qF sub-envases
    const parentBase = qF * childBase
    nested = { name: f.unitFormat, qtyInBase: parentBase, qtyPerParent: qF }      // Caja
    simple = { name: f.unitFormatAux, qtyInBase: childBase, code: f.codi, price: null } // Bote (lleva el código/precio del formato? no: el precio es del envase grande)
    // el precio (costFormat) es del envase GRANDE -> va al padre
    nested.price = f.costFormat
    nested.code = f.codi
  } else {
    simple = { name: f.unitFormat, qtyInBase: qF * cu.div, code: f.codi, price: f.costFormat }
  }

  // validación de coherencia de precio: costFormat / qty_in_base ~= cost (€/base * div ... ojo)
  // cost es €/unidad-de-coste. €/base = cost / div. precio_envase/qty_in_base deberia ~ cost/div.
  let needsReview = false
  const envase = nested || simple
  if (envase.qtyInBase && f.costFormat != null && f.cost != null) {
    const eurPorBaseDeclarado = f.cost / cu.div          // lo que tspoon dice que cuesta la base
    const eurPorBaseFormato = f.costFormat / envase.qtyInBase
    if (eurPorBaseDeclarado > 0) {
      const ratio = eurPorBaseFormato / eurPorBaseDeclarado
      if (ratio < 0.8 || ratio > 1.25) {  // >25% de desvío = configuración sospechosa en tspoon
        needsReview = true
        informeArt.push(`formato "${f.descr}": precio €/base por formato (${eurPorBaseFormato.toFixed(5)}) no cuadra con coste declarado (${eurPorBaseDeclarado.toFixed(5)}), ratio ${ratio.toFixed(2)} -> needs_review`)
      }
    }
  }
  return { skip: false, baseUnit: cu.base, needsReview, simple, nested }
}

// ---------- conversión de uso amigable -> recipe_item_unit_conversion ----------
function buildUseConversion(e, baseUnitFolvy, informeArt) {
  // queremos: 1 [fromUnit] = X [base de Folvy].
  // tspoon: fromQuantity fromUnit = toQuantity toUnit, con flag inverted.
  // Si inverted=true, la relación real es: toQuantity fromUnit = fromQuantity toUnit
  //   (ej Falafel "1 Uni = 30 Kg, inverted" => 30 Uni = 1 Kg => 1 Uni = 1/30 Kg)
  const cuTo = unitDiv(e.toUnit)
  if (!cuTo.ok) { informeArt.push(`conversión de uso "${e.fromUnit}": unidad destino '${e.toUnit}' no convertible -> descartada`); return null }
  // tamaño de 1 fromUnit en unidad de coste destino:
  let perFromInToCostUnit
  if (e.inverted) {
    // toQuantity fromUnit = fromQuantity toUnit  -> 1 fromUnit = fromQuantity/toQuantity toUnit
    if (!e.toQuantity) return null
    perFromInToCostUnit = e.fromQuantity / e.toQuantity
  } else {
    // fromQuantity fromUnit = toQuantity toUnit -> 1 fromUnit = toQuantity/fromQuantity toUnit
    if (!e.fromQuantity) return null
    perFromInToCostUnit = e.toQuantity / e.fromQuantity
  }
  const qtyInBase = perFromInToCostUnit * cuTo.div   // en base de Folvy (g/ml/ud)
  // validación física: nada de "1 unidad = 5000 g" (sobre 5kg por gesto = absurdo para una porción)
  if (!(qtyInBase > 0)) { informeArt.push(`conversión "${e.fromUnit}": cantidad no positiva -> descartada`); return null }
  if (qtyInBase > 5000) {  // umbral de sensatez: un gesto de cocina raramente supera 5kg/5L
    informeArt.push(`conversión "${e.fromUnit}" = ${qtyInBase.toFixed(1)} ${baseUnitFolvy} (físicamente improbable) -> DESCARTADA`)
    return null
  }
  return { label: e.fromUnit, qtyInBase }
}

// ---------- main ----------
async function main() {
  console.log('== login tspoon =='); const token = await login()
  const centers = arrOf(await apiGet('/listOrderCenters', token))
  const order = centers[0]?.idOrderCenter || centers[0]?.id
  console.log('centro order =', order)

  // 1) raws de Folvy (con su unidad base real) — la verdad sobre la que construimos
  const { data: raws, error } = await sb.from('recipe_item')
    .select('id, name, code, base_unit_id, kitchen_unit:base_unit_id(abbreviation)')
    .eq('account_id', ACCOUNT).eq('type', 'raw')
  if (error) throw error
  const byName = new Map(), byCode = new Map()
  for (const r of raws) {
    r.baseAbbr = r.kitchen_unit?.abbreviation ?? null
    byName.set(normTxt(r.name), r); byName.set(normTxt(stripParen(r.name)), r)
    if (r.code) byCode.set(String(r.code).trim(), r)
  }
  console.log(`raws en Folvy: ${raws.length}`)

  // 2) recorrer ingredientes de tspoon, casar con Folvy, extraer formatos
  const plan = []           // { folvyItemId, baseAbbr, vendors:[...], conversions:[...] }
  const informe = []        // líneas del informe de incoherencias
  let totalTs = 0, casados = 0, sinCasar = []

  for (let start = 0; start < 5000; start += 50) {
    const rows = arrOf(await apiGet('/listIngredientsPaged', token, order, { start, rows: 50 }))
    if (!rows.length) break
    for (const ing of rows) {
      totalTs++
      const folvy = byName.get(normTxt(ing.descr)) || byName.get(normTxt(stripParen(ing.descr)))
        || (ing.codi && byCode.get(String(ing.codi).trim()))
      if (!folvy) { sinCasar.push(ing.descr); continue }
      casados++
      const det = await apiGet(`/ingredient/${ing.id}`, token, order)
      if (det.__error) { informe.push(`[${ing.descr}] no se pudo leer detalle (${det.__error})`); continue }

      const informeArt = []
      const vendors = []
      for (const v of (det.listVendor || [])) {
        const formats = []
        for (const f of (v.listFormat || [])) formats.push(buildFormat(f, informeArt))
        vendors.push({
          vendorName: v.vendor, vendorNif: v.nif || null, codiVendor: v.codiVendor || null,
          isPreferred: v.defecte === true, supplierItemName: v.descr || null,
          iva: v.iva ?? null, formats,
        })
      }
      const conversions = []
      for (const e of (det.listUnitEquality || [])) {
        const c = buildUseConversion(e, folvy.baseAbbr, informeArt)
        if (c) conversions.push(c)
      }
      plan.push({
        folvyItemId: folvy.id, folvyName: folvy.name, baseAbbr: folvy.baseAbbr,
        tspoonDescr: ing.descr, vendors, conversions,
      })
      if (informeArt.length) informe.push(`[${folvy.name}]\n  - ` + informeArt.join('\n  - '))
    }
  }

  writeFileSync('tspoon_formatos_plan.json', JSON.stringify(plan, null, 2), 'utf8')
  const head = [
    'INFORME DE INCOHERENCIAS DE FORMATOS — tspoon (config Llorente29)',
    `Generado: ${new Date().toISOString()}`,
    `Ingredientes tspoon recorridos: ${totalTs} | casados con Folvy: ${casados} | sin casar: ${sinCasar.length}`,
    `Artículos con incidencias: ${informe.length}`,
    '─'.repeat(70), '',
  ].join('\n')
  writeFileSync('tspoon_formatos_informe.txt', head + (informe.join('\n\n') || '(sin incidencias)') +
    '\n\n── SIN CASAR (no estaban en Folvy) ──\n' + (sinCasar.join('\n') || '(ninguno)'), 'utf8')

  console.log(`\n✓ Plan: ${plan.length} artículos -> tspoon_formatos_plan.json`)
  console.log(`✓ Informe: ${informe.length} con incidencias -> tspoon_formatos_informe.txt`)
  console.log(`  casados ${casados}/${totalTs}, sin casar ${sinCasar.length}`)
  // resumen rápido en consola
  let nFmt = 0, nNested = 0, nConv = 0, nReview = 0
  for (const p of plan) for (const v of p.vendors) for (const f of v.formats) {
    nFmt++; if (f.nested) nNested++; if (f.needsReview) nReview++
  }
  for (const p of plan) nConv += p.conversions.length
  console.log(`  formatos ${nFmt} (anidados ${nNested}, a revisar ${nReview}) · conversiones de uso ${nConv}`)
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
