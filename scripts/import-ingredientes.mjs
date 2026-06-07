#!/usr/bin/env node
/**
 * import-ingredientes.mjs
 * -------------------------------------------------------------------------
 * Importa los INGREDIENTES de tspoon (Ingredientes_*.xlsx + Materiales_*.xlsx)
 * a Folvy como recipe_item type='raw', con su proveedor (article_supplier) y
 * su formato de compra (recipe_item_purchase_format).
 *
 * FILTRO: solo se importan los ingredientes que aparecen DE VERDAD en los
 * escandallos (Platos.xlsx). El resto del master se descarta.
 *
 * Por cada ingrediente crea/actualiza (IDEMPOTENTE por código o nombre):
 *   - recipe_item: name (base, sin paréntesis), code (código tspoon),
 *     base_unit_id (g/ml/ud), fixed_cost (en unidad base), cost_strategy
 *     'average_weighted', family_id NULL + needs_review=true, source
 *     'tspoon_import', external_codes (códigos de barras/CN/id interno).
 *   - supplier: reusa por nombre normalizado, o lo crea.
 *   - article_supplier: supplier_code, supplier_item_name, last_price, preferido.
 *   - recipe_item_purchase_format: formato (Garrafa/Caja...) + qty_in_base;
 *     si hay Formato 2, se crea el envase padre y se enlaza (anidado).
 *
 * NO migra (deuda declarada, decisión B): familia (needs_review), alérgenos
 * (seguridad alimentaria → se confirman después), stock mín/máx (sin columna).
 *
 * Modos:
 *   --dry-run            : informe completo, NO escribe nada (por defecto)
 *   --commit             : escribe en la BBDD
 *   --account=<uuid>     : cuenta destino (def. Folvy Interno 0000...0001)
 *
 * Env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Ficheros esperados en el directorio actual (raíz del repo):
 *   Platos.xlsx  Ingredientes__3_.xlsx  Ingredientes__4_.xlsx
 *   Materiales__3_.xlsx  Materiales__4_.xlsx
 *
 * Uso:
 *   node scripts/import-ingredientes.mjs --dry-run
 *   node scripts/import-ingredientes.mjs --commit --account=0000...0001
 * -------------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

// ---------- CLI ----------
const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const valOf = (n) => {
  const pref = `${n}=`
  const hit = args.find((a) => a.startsWith(pref))
  return hit ? hit.slice(pref.length) : null
}
const COMMIT = flag('--commit')
const ACCOUNT = valOf('--account') || '00000000-0000-0000-0000-000000000001'

// ---------- Env ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// ---------- Unidades base (ids reales de kitchen_unit, globales) ----------
const UNIT = {
  g:  '8fc3baae-04cc-4b2c-83cc-7fa0181e74e4',
  ml: '953c626f-146b-484f-b3f5-47c42eeacc0e',
  ud: '869711c3-eabd-4e95-92f2-555efaaba6b0',
}

// ---------- Helpers ----------
const normTxt = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim()
const stripParen = (s) => (s || '').toString().replace(/\s*\([^)]*\)\s*$/, '').trim()
const toNum = (v) => {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// Mapea la unidad de tspoon a {base, div}: base = unidad base Folvy, div = factor
// para pasar de la unidad de tspoon a la base (Kg->g = x1000 -> div 1000 en coste).
function mapUnit(u) {
  const x = (u || '').toString().trim().toLowerCase()
  if (x === 'kg')                 return { base: 'g',  div: 1000, ok: true }
  if (x === 'gr' || x === 'g')    return { base: 'g',  div: 1,    ok: true }
  if (x === 'lt' || x === 'l')    return { base: 'ml', div: 1000, ok: true }
  if (x === 'ml')                 return { base: 'ml', div: 1,    ok: true }
  if (x === 'uni' || x === 'ud' || x === 'u') return { base: 'ud', div: 1, ok: true }
  // Cm u otra rara -> no se puede mapear con seguridad: ud + needs_review
  return { base: 'ud', div: 1, ok: false }
}

// ---------- 1. Set de ingredientes que aparecen en escandallos ----------
// Robusto a la indexación de la librería: localiza las columnas por el TEXTO
// de su cabecera, no por posición fija. El export tiene dos tipos de cabecera:
//   - cabecera de PLATO    : contiene 'Descripción' y 'Familia'
//   - cabecera de INGREDIENTE: contiene 'Descripción' y 'C. Unit.'
// La columna del nombre de ingrediente = índice de 'Descripción' en su cabecera.
function cellsHave(r, ...texts) {
  const vals = r.map((c) => (c == null ? '' : String(c).trim()))
  return texts.every((t) => vals.includes(t))
}
function indexOfCell(r, text) {
  return r.findIndex((c) => c != null && String(c).trim() === text)
}
function loadEscandalloIngredientes(path) {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const set = new Set()
  let mode = null
  let nameCol = -1
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    if (cellsHave(r, 'Descripción', 'Familia')) { mode = 'plato'; continue }     // cabecera de plato
    if (cellsHave(r, 'Descripción', 'C. Unit.')) {                                // cabecera de ingrediente
      mode = 'ing'; nameCol = indexOfCell(r, 'Descripción'); continue
    }
    if (mode === 'ing' && nameCol >= 0) {
      const v = r[nameCol]
      if (v != null && String(v).trim() !== '' && String(v).trim() !== 'Descripción') {
        const name = String(v).trim()
        set.add(normTxt(name))
        set.add(normTxt(stripParen(name)))
      }
    }
  }
  return set
}

// ---------- 2. Master de ingredientes/materiales ----------
// Robusto: localiza la fila de cabecera y la columna 'Producto'; el resto de
// columnas se leen por DESPLAZAMIENTO fijo respecto a 'Producto' (el orden del
// export tspoon es estable y contiguo). Evita el problema de que haya cabeceras
// repetidas ('Código', 'Coste', 'Unidad' aparecen dos veces).
const OFF = {
  name: 0, notes: 1, codeInt: 3, familia: 4, conservacion: 10,
  coste: 14, unidad: 15, proveedor: 16, codProv: 17, descProv: 18,
  formato: 19, cantidad: 20, formato2: 21, cantidad2: 22, costeFormato: 23,
  tipoIva: 28, eanProd: 31, eanProv: 32, codCN: 33, idInterno: 34, altName: 35,
}
function loadMaster(files) {
  const out = new Map()  // normName -> registro
  for (const f of files) {
    let wb
    try { wb = XLSX.readFile(f) } catch { console.warn(`(aviso) no se pudo leer ${f}, lo salto`); continue }
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
    // localizar fila de cabecera y columna de 'Producto'
    let hdr = -1, p = -1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (Array.isArray(r) && cellsHave(r, 'Producto', 'Descripción')) {
        hdr = i; p = indexOfCell(r, 'Producto'); break
      }
    }
    if (hdr < 0) { console.warn(`(aviso) ${f}: no encuentro cabecera 'Producto', lo salto`); continue }
    const at = (r, k) => r[p + OFF[k]]
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = rows[i]
      if (!Array.isArray(r)) continue
      const name = at(r, 'name')
      if (name == null || String(name).trim() === '') continue
      const key = normTxt(name)
      if (out.has(key)) continue  // primera aparición gana
      const S = (k) => { const v = at(r, k); return v != null && String(v).trim() !== '' ? String(v).trim() : null }
      out.set(key, {
        name: String(name).trim(),
        altName: S('altName'),
        notes: S('notes'),
        codeInt: S('codeInt'),
        familia: S('familia'),
        conservacion: S('conservacion'),
        coste: toNum(at(r, 'coste')),
        unidad: S('unidad'),
        proveedor: S('proveedor'),
        codProv: S('codProv'),
        descProv: S('descProv'),
        formato: S('formato'),
        cantidad: toNum(at(r, 'cantidad')),
        formato2: S('formato2'),
        cantidad2: toNum(at(r, 'cantidad2')),
        costeFormato: toNum(at(r, 'costeFormato')),
        tipoIva: S('tipoIva'),
        eanProd: S('eanProd'),
        eanProv: S('eanProv'),
        codCN: S('codCN'),
        idInterno: S('idInterno'),
      })
    }
  }
  return out
}

// ---------- 3. Estado actual en la BBDD (idempotencia) ----------
async function loadExisting() {
  const { data: items, error: e1 } = await sb
    .from('recipe_item').select('id,name,code')
    .eq('account_id', ACCOUNT).eq('type', 'raw')
  if (e1) throw e1
  const byCode = new Map(), byName = new Map()
  for (const it of items) {
    if (it.code) byCode.set(it.code.trim(), it)
    byName.set(normTxt(it.name), it)
  }
  const { data: sups, error: e2 } = await sb
    .from('supplier').select('id,name').eq('account_id', ACCOUNT)
  if (e2) throw e2
  const supByName = new Map(sups.map((s) => [normTxt(s.name), s]))
  return { byCode, byName, supByName }
}

// ---------- 4. Construir el plan por ingrediente ----------
function buildPlan(master, escSet) {
  const plan = []
  const skipped = []
  for (const [key, m] of master) {
    const inEsc = escSet.has(key) || escSet.has(normTxt(stripParen(m.name)))
    if (!inEsc) { skipped.push(m.name); continue }

    const um = mapUnit(m.unidad)
    const fixedCost = (m.coste != null && um.div) ? m.coste / um.div : null
    let needsReview = false
    const reasons = []
    if (!um.ok) { needsReview = true; reasons.push(`unidad '${m.unidad}' no mapeable -> ud`) }
    if (fixedCost == null) { needsReview = true; reasons.push('sin coste') }
    needsReview = true; reasons.push('familia/alérgenos a revisar') // siempre, decisión B

    // formato de compra (solo si hay cantidad > 0; la constraint exige qty_in_base > 0)
    let fmt = null
    if (m.formato && m.cantidad != null && m.cantidad > 0) {
      const fmtUnit = mapUnit(m.unidad)  // la cantidad del formato está en la unidad de coste
      const qtyInBase = m.cantidad * (fmtUnit.div || 1)
      if (qtyInBase > 0) {
        const nested = (m.formato2 && m.cantidad2 != null && m.cantidad2 > 0)
          ? { name: m.formato2, qtyPerParent: m.cantidad2 } : null
        fmt = { name: m.formato, qtyInBase, nested }
      }
    }

    plan.push({
      name: stripParen(m.name),          // ingrediente base
      altName: m.altName,
      notes: m.notes,
      code: m.codeInt,
      baseUnit: um.base,
      fixedCost,
      conservacion: m.conservacion,
      externalCodes: {
        ...(m.eanProd ? { ean_producto: m.eanProd } : {}),
        ...(m.eanProv ? { ean_proveedor: m.eanProv } : {}),
        ...(m.codCN ? { codigo_cn: m.codCN } : {}),
        ...(m.idInterno ? { tspoon_id: m.idInterno } : {}),
      },
      supplier: m.proveedor || null,
      supplierCode: m.codProv,
      supplierItemName: m.descProv,
      lastPrice: m.costeFormato,
      fmt,
      needsReview,
      reasons,
    })
  }
  return { plan, skipped }
}

// ---------- 5. Escribir (solo --commit) ----------
async function writeOne(p, existing) {
  // 5a. recipe_item (upsert por code o nombre)
  let item = (p.code && existing.byCode.get(p.code)) || existing.byName.get(normTxt(p.name))
  const itemPayload = {
    account_id: ACCOUNT,
    type: 'raw',
    name: p.name,
    alt_name: p.altName,
    code: p.code,
    base_unit_id: UNIT[p.baseUnit],
    cost_strategy: 'average_weighted',
    fixed_cost: p.fixedCost,
    conservation_type: null,   // tspoon trae texto libre que no casa con fridge/freezer/dry/hot → a revisión
    external_codes: p.externalCodes,
    family_id: null,
    needs_review: true,
    source: 'import',
  }
  if (item) {
    const { error } = await sb.from('recipe_item').update(itemPayload).eq('id', item.id)
    if (error) throw new Error(`update recipe_item ${p.name}: ${error.message}`)
  } else {
    const { data, error } = await sb.from('recipe_item').insert(itemPayload).select('id').single()
    if (error) throw new Error(`insert recipe_item ${p.name}: ${error.message}`)
    item = { id: data.id }
    existing.byName.set(normTxt(p.name), item)
    if (p.code) existing.byCode.set(p.code, item)
  }

  // 5b. supplier (reusa por nombre)
  let supplierId = null
  if (p.supplier) {
    const s = existing.supByName.get(normTxt(p.supplier))
    if (s) supplierId = s.id
    else {
      const { data, error } = await sb.from('supplier')
        .insert({ account_id: ACCOUNT, name: p.supplier }).select('id').single()
      if (error) throw new Error(`insert supplier ${p.supplier}: ${error.message}`)
      supplierId = data.id
      existing.supByName.set(normTxt(p.supplier), { id: supplierId, name: p.supplier })
    }
  }

  // 5c. formato(s) de compra
  let formatId = null
  if (p.fmt) {
    let parentId = null
    if (p.fmt.nested) {
      const { data: parent, error: ep } = await sb.from('recipe_item_purchase_format').insert({
        account_id: ACCOUNT, item_id: item.id, name: p.fmt.nested.name,
        qty_in_base: p.fmt.qtyInBase * (p.fmt.nested.qtyPerParent || 1),
        is_piece: true, is_weighted: false, source: 'import', needs_review: true,
      }).select('id').single()
      if (ep) throw new Error(`insert formato padre ${p.name}: ${ep.message}`)
      parentId = parent.id
    }
    const { data: f, error: ef } = await sb.from('recipe_item_purchase_format').insert({
      account_id: ACCOUNT, item_id: item.id, name: p.fmt.name,
      parent_format_id: parentId,
      qty_per_parent: p.fmt.nested ? p.fmt.nested.qtyPerParent : null,
      qty_in_base: p.fmt.qtyInBase,
      is_piece: p.baseUnit === 'ud', is_weighted: p.baseUnit !== 'ud',
      source: 'import', needs_review: true,
    }).select('id').single()
    if (ef) throw new Error(`insert formato ${p.name}: ${ef.message}`)
    formatId = f.id
  }

  // 5d. article_supplier (proveedor ↔ ingrediente)
  if (supplierId) {
    const { error } = await sb.from('article_supplier').insert({
      account_id: ACCOUNT, recipe_item_id: item.id, supplier_id: supplierId,
      supplier_code: p.supplierCode, supplier_item_name: p.supplierItemName,
      last_price: p.lastPrice, purchase_format_id: formatId, is_preferred: true,
    })
    if (error && !String(error.message).includes('duplicate')) {
      throw new Error(`insert article_supplier ${p.name}: ${error.message}`)
    }
  }
}

// ---------- MAIN ----------
async function main() {
  console.log(`\n=== IMPORTADOR DE INGREDIENTES tspoon -> Folvy ===`)
  console.log(`Cuenta destino: ${ACCOUNT}`)
  console.log(`Modo: ${COMMIT ? 'COMMIT (escribe)' : 'DRY-RUN (no escribe)'}\n`)

  const escSet = loadEscandalloIngredientes('Platos.xlsx')
  console.log(`Ingredientes en escandallos (formas norm.): ${escSet.size}`)

  const master = loadMaster([
    'Ingredientes (3).xlsx', 'Ingredientes (4).xlsx',
    'Materiales (3).xlsx', 'Materiales (4).xlsx',
  ])
  console.log(`Master de ingredientes/materiales (únicos): ${master.size}`)

  const { plan, skipped } = buildPlan(master, escSet)
  console.log(`\nA IMPORTAR (en escandallos y con ficha): ${plan.length}`)
  console.log(`Descartados (no aparecen en escandallos): ${skipped.length}`)

  // informe
  const conFormato = plan.filter((p) => p.fmt).length
  const conProveedor = plan.filter((p) => p.supplier).length
  const sinCoste = plan.filter((p) => p.fixedCost == null).length
  const unidadRara = plan.filter((p) => p.reasons.some((r) => r.includes('no mapeable'))).length
  console.log(`  · con proveedor: ${conProveedor}`)
  console.log(`  · con formato de compra: ${conFormato}`)
  console.log(`  · sin coste (needs_review): ${sinCoste}`)
  console.log(`  · unidad no mapeable -> ud (needs_review): ${unidadRara}`)

  console.log(`\n--- Muestra (primeros 12):`)
  for (const p of plan.slice(0, 12)) {
    const fc = p.fixedCost != null ? `${p.fixedCost.toFixed(5)} €/${p.baseUnit}` : '(sin coste)'
    const fm = p.fmt ? `${p.fmt.name} ${p.fmt.qtyInBase}${p.baseUnit}${p.fmt.nested ? ` ⊂ ${p.fmt.nested.name}` : ''}` : '(sin formato)'
    console.log(`  ${p.name.padEnd(34).slice(0, 34)} | ${fc.padEnd(18)} | prov: ${(p.supplier || '-').slice(0, 22).padEnd(22)} | ${fm}`)
  }
  if (unidadRara > 0) {
    console.log(`\n--- Unidad no mapeable (revisar):`)
    plan.filter((p) => p.reasons.some((r) => r.includes('no mapeable')))
      .forEach((p) => console.log(`  • ${p.name}`))
  }

  if (!COMMIT) {
    console.log(`\n[DRY-RUN] No se ha escrito nada. Revisa el informe.`)
    console.log(`Para escribir: node scripts/import-ingredientes.mjs --commit --account=${ACCOUNT}\n`)
    return
  }

  console.log(`\nEscribiendo ${plan.length} ingredientes...`)
  const existing = await loadExisting()
  let ok = 0, fail = 0
  for (const p of plan) {
    try { await writeOne(p, existing); ok++ }
    catch (e) { fail++; console.error(`  ✗ ${p.name}: ${e.message}`) }
  }
  console.log(`\n✓ Hecho. ${ok} ingredientes escritos, ${fail} fallos.`)
  console.log(`Los formatos y la familia quedan en needs_review para validar en la app.\n`)
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
