#!/usr/bin/env node
/**
 * regenerar-formatos.mjs — genera regenerar_formatos.sql (NO ejecuta nada).
 * =============================================================================
 * Lee tspoon_formatos_plan.json (extraído de la API) + los proveedores que ya
 * existen en Folvy, y produce un SQL transaccional revisable que:
 *   1. DISABLE trigger trg_article_supplier_recompute_cost (evita SECURITY DEFINER sin sesión)
 *   2. Borra los formatos / article_supplier / conversiones VIEJOS de los
 *      artículos del plan (los mal migrados desde Excel).
 *   3. Crea los proveedores que falten (todos los del plan; Llorente29 depura luego).
 *   4. Inserta formatos correctos (anidados caja⊃bote), article_supplier
 *      multi-proveedor (is_preferred = defecte de tspoon), conversiones de uso.
 *   5. ENABLE trigger.
 *   6. ROLLBACK al final (red de seguridad). Revisar -> cambiar a COMMIT -> reejecutar.
 *
 * NO toca recipe_item (fichas) ni fixed_cost: el coste de escandallos queda intacto.
 *
 * USO:
 *   $env:SUPABASE_URL=...; $env:SUPABASE_SERVICE_ROLE_KEY=...
 *   node scripts/regenerar-formatos.mjs
 *   (genera regenerar_formatos.sql + regenerar_formatos_informe.txt)
 * =============================================================================
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const ACCOUNT = '00000000-0000-0000-0000-000000000001'
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

const normTxt = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
const q = (s) => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`
const n = (v) => v == null ? 'NULL' : Number(v)

// abreviatura base -> id de kitchen_unit (globales, confirmados)
const UNIT_ID = {
  g: '8fc3baae-04cc-4b2c-83cc-7fa0181e74e4',
  ml: '953c626f-146b-484f-b3f5-47c42eeacc0e',
  ud: '869711c3-eabd-4e95-92f2-555efaaba6b0',
}

async function main() {
  const planRaw = JSON.parse(readFileSync('tspoon_formatos_plan.json', 'utf8'))
  // dedup por folvyItemId: tspoon puede tener el mismo artículo 2 veces en su maestro
  // (p.ej. "Huevos", "Sobrasada"). Nos quedamos con la primera aparición (más completa).
  const seenItem = new Set()
  const plan = []
  let dupDescartados = 0
  for (const a of planRaw) {
    if (seenItem.has(a.folvyItemId)) { dupDescartados++; continue }
    seenItem.add(a.folvyItemId); plan.push(a)
  }

  // proveedores existentes
  const { data: sups, error } = await sb.from('supplier').select('id,name').eq('account_id', ACCOUNT)
  if (error) throw error
  const supByNorm = new Map(sups.map((s) => [normTxt(s.name), s.id]))

  // detectar proveedores a crear (los del plan que no casan por nombre normalizado)
  const toCreate = new Map() // norm -> {name, id}
  for (const a of plan) for (const v of a.vendors) {
    const norm = normTxt(v.vendorName)
    if (!supByNorm.has(norm) && !toCreate.has(norm)) {
      toCreate.set(norm, { name: v.vendorName, id: randomUUID() })
    }
  }

  const L = []  // líneas SQL
  const inf = []
  L.push('-- Regeneración de formatos de compra desde la API de tspoon (modelo limpio).')
  L.push('-- Revisar con ROLLBACK; cambiar a COMMIT al final cuando cuadre.')
  L.push('BEGIN;')
  L.push('')
  L.push('ALTER TABLE article_supplier DISABLE TRIGGER trg_article_supplier_recompute_cost;')
  L.push('')

  // ids de los artículos del plan (para el borrado acotado)
  const itemIds = plan.map((a) => `'${a.folvyItemId}'`).join(',')
  L.push('-- 1. Borrar formatos / article_supplier / conversiones viejos SOLO de los artículos del plan')
  L.push(`DELETE FROM article_supplier WHERE account_id='${ACCOUNT}' AND recipe_item_id IN (${itemIds});`)
  L.push(`DELETE FROM recipe_item_purchase_format WHERE account_id='${ACCOUNT}' AND item_id IN (${itemIds});`)
  L.push(`DELETE FROM recipe_item_unit_conversion WHERE account_id='${ACCOUNT}' AND item_id IN (${itemIds});`)
  L.push('')

  // 2. crear proveedores faltantes
  if (toCreate.size) {
    L.push(`-- 2. Crear ${toCreate.size} proveedores nuevos (Llorente29 depurará lo que sobre)`)
    for (const { name, id } of toCreate.values()) {
      L.push(`INSERT INTO supplier (id, account_id, name) VALUES ('${id}', '${ACCOUNT}', ${q(name)});`)
    }
    L.push('')
  }
  const supId = (name) => supByNorm.get(normTxt(name)) || toCreate.get(normTxt(name))?.id

  // 3. insertar formatos + article_supplier + conversiones
  let nFmt = 0, nAS = 0, nConv = 0
  for (const a of plan) {
    const baseId = UNIT_ID[a.baseAbbr]
    if (!baseId) { inf.push(`[${a.folvyName}] base '${a.baseAbbr}' sin id de unidad -> SALTADO`); continue }
    L.push(`-- ${a.folvyName} (${a.baseAbbr})`)
    // agrupar entradas de listVendor por proveedor (un proveedor puede traer varios formatos)
    const byVendor = new Map()  // sid -> { vendorName, supplierItemName, entries:[...] }
    for (const v of a.vendors) {
      const sid = supId(v.vendorName)
      if (!sid) { inf.push(`[${a.folvyName}] proveedor '${v.vendorName}' sin id -> saltado`); continue }
      if (!byVendor.has(sid)) byVendor.set(sid, { vendorName: v.vendorName, supplierItemName: v.supplierItemName, isPreferred: false, entries: [] })
      const g = byVendor.get(sid)
      if (v.isPreferred) { g.isPreferred = true; g.supplierItemName = v.supplierItemName ?? g.supplierItemName }
      g.entries.push(v)
    }

    for (const [sid, g] of byVendor) {
      // crear TODOS los formatos de este proveedor; recordar cuál es el preferente (el de la entrada defecte, o el 1º)
      let prefFormatId = null, prefPrice = null, prefCode = null
      const allFormats = []  // {id, isFromPreferredEntry, price, code}
      for (const v of g.entries) {
        for (const f of v.formats) {
          const envase = f.nested || f.simple
          if (!envase || envase.qtyInBase == null || !(envase.qtyInBase > 0)) {
            inf.push(`[${a.folvyName}/${g.vendorName}] formato sin qty_in_base válido -> saltado`)
            continue
          }
          let thisFormatId
          if (f.nested) {
            const childId = randomUUID(), parentId = randomUUID()
            const ch = f.simple
            L.push(`INSERT INTO recipe_item_purchase_format (id, account_id, item_id, name, qty_in_base, source, needs_review) VALUES ('${childId}','${ACCOUNT}','${a.folvyItemId}',${q(ch.name)},${n(ch.qtyInBase)},'import',${f.needsReview?'true':'false'});`)
            L.push(`INSERT INTO recipe_item_purchase_format (id, account_id, item_id, name, qty_in_base, parent_format_id, qty_per_parent, source, needs_review) VALUES ('${parentId}','${ACCOUNT}','${a.folvyItemId}',${q(f.nested.name)},${n(f.nested.qtyInBase)},'${childId}',${n(f.nested.qtyPerParent)},'import',${f.needsReview?'true':'false'});`)
            nFmt += 2
            thisFormatId = parentId
          } else {
            const fid = randomUUID()
            L.push(`INSERT INTO recipe_item_purchase_format (id, account_id, item_id, name, qty_in_base, source, needs_review) VALUES ('${fid}','${ACCOUNT}','${a.folvyItemId}',${q(f.simple.name)},${n(f.simple.qtyInBase)},'import',${f.needsReview?'true':'false'});`)
            nFmt++
            thisFormatId = fid
          }
          const env = f.nested || f.simple
          // el formato preferente del proveedor = el de la entrada marcada defecte; si no, el primero
          if (prefFormatId == null || v.isPreferred) {
            if (v.isPreferred || prefFormatId == null) { prefFormatId = thisFormatId; prefPrice = env.price ?? null; prefCode = env.code ?? null }
          }
        }
      }
      // un único article_supplier por (artículo, proveedor), apuntando al formato preferente
      L.push(`INSERT INTO article_supplier (id, account_id, recipe_item_id, supplier_id, supplier_code, supplier_item_name, last_price, purchase_format_id, is_preferred, is_active) VALUES ('${randomUUID()}','${ACCOUNT}','${a.folvyItemId}','${sid}',${q(prefCode)},${q(g.supplierItemName)},${n(prefPrice)},${prefFormatId?`'${prefFormatId}'`:'NULL'},${g.isPreferred?'true':'false'},true);`)
      nAS++
    }
    // conversiones de uso amigables
    for (const c of a.conversions) {
      // recipe_item_unit_conversion necesita from_unit_id; pero la etiqueta de uso ("Racion Pita") NO es una kitchen_unit.
      // DECISIÓN: estas conversiones de USO van con etiqueta libre -> requieren la columna de etiqueta (frente unidades amigables).
      // De momento las dejamos FUERA del INSERT directo y las listamos para el frente dedicado.
      inf.push(`[${a.folvyName}] conversión de uso "1 ${c.label} = ${c.qtyInBase}${a.baseAbbr}" -> pendiente frente unidades amigables (etiqueta libre)`)
      nConv++
    }
    L.push('')
  }

  L.push('ALTER TABLE article_supplier ENABLE TRIGGER trg_article_supplier_recompute_cost;')
  L.push('')
  L.push('-- Verificación rápida (revisar antes de COMMIT):')
  L.push(`SELECT (SELECT count(*) FROM recipe_item_purchase_format WHERE account_id='${ACCOUNT}') AS formatos,`)
  L.push(`       (SELECT count(*) FROM recipe_item_purchase_format WHERE account_id='${ACCOUNT}' AND parent_format_id IS NOT NULL) AS anidados,`)
  L.push(`       (SELECT count(*) FROM article_supplier WHERE account_id='${ACCOUNT}') AS article_supplier;`)
  L.push('')
  L.push('ROLLBACK;  -- <<< cambiar a COMMIT cuando cuadre')

  writeFileSync('regenerar_formatos.sql', L.join('\n'), 'utf8')
  writeFileSync('regenerar_formatos_informe.txt',
    `Proveedores nuevos a crear: ${toCreate.size}\n` +
    [...toCreate.values()].map((s) => '  + ' + s.name).join('\n') +
    `\n\nFormatos a insertar: ${nFmt} | article_supplier: ${nAS} | conversiones de uso (pendientes): ${nConv}\n\n` +
    'INCIDENCIAS:\n' + (inf.join('\n') || '(ninguna)'), 'utf8')

  console.log(`✓ regenerar_formatos.sql (${L.length} líneas)`)
  console.log(`✓ artículos: ${plan.length} (duplicados descartados: ${dupDescartados})`)
  console.log(`✓ proveedores nuevos: ${toCreate.size} | formatos: ${nFmt} | article_supplier: ${nAS}`)
  console.log(`  conversiones de uso: ${nConv} (pendientes del frente unidades amigables)`)
  console.log(`  incidencias: ${inf.length} (ver informe)`)
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
