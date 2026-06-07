#!/usr/bin/env node
/**
 * import-platos.mjs  — MITAD 2 de la migración tspoon -> Folvy
 * -------------------------------------------------------------------------
 * Crea los PLATOS (recipe_item type='dish') para los menu_item de Folvy que
 * casan por PLU con el puente de tspoon, y deja el cableado listo para que
 * import-escandallos.mjs (mitad 3) cuelgue las líneas.
 *
 * Cadena de casado (determinista, por PLU):
 *   menu_item.external_id  ==  normPlu(puente.plu)  (quita prefijo 'o.')
 *
 * Por cada menu_item que casa:
 *   1. crea recipe_item type='dish' (name = nombre del menu_item, limpio;
 *      source='import', needs_review=true) — si no existe ya uno enlazado.
 *   2. rellena menu_item.recipe_item_id con el id del dish.
 *   3. crea/actualiza lastapp_product_map (organization_product_id = external_id,
 *      recipe_item_id = dish, lastapp_product_name = nombre). Esto es el puente
 *      que import-escandallos.mjs usa para colgar las líneas.
 *
 * Los menu_item que NO casan por PLU (combos, variantes/modificadores) NO se
 * crean: un combo no es un escandallo. Se listan en el informe.
 *
 * NO crea recipe_line (eso es la mitad 3). NO toca el coste.
 * Crear dish NO dispara triggers de recálculo (verificado): seguro sin
 * desactivar nada.
 *
 * Modos: --dry-run (def, no escribe) | --commit | --account=<uuid>
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Ficheros en el dir actual: tspoon_puente_todos.csv
 * Uso:
 *   node scripts/import-platos.mjs --dry-run
 *   node scripts/import-platos.mjs --commit --account=00000000-0000-0000-0000-000000000001
 * -------------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ---------- CLI ----------
const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const valOf = (n) => {
  const hit = args.find((a) => a.startsWith(`${n}=`))
  return hit ? hit.slice(n.length + 1) : null
}
const COMMIT = flag('--commit')
const ACCOUNT = valOf('--account') || '00000000-0000-0000-0000-000000000001'
const PUENTE = valOf('--puente') || 'tspoon_puente_todos.csv'

// ---------- Env ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// ---------- Helpers ----------
const normPlu = (p) => {
  const s = (p || '').toString().trim()
  return s.startsWith('o.') ? s.slice(2) : s
}

// CSV parser tolerante a comillas (el puente tiene comas en nombres entre comillas)
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { row.push(cell); cell = '' }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
      else if (c === '\r') { /* ignora */ }
      else cell += c
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// ---------- 1. Puente PLU -> info de tspoon ----------
function loadPuente(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const header = rows[0].map((h) => h.trim())
  const ix = (name) => header.indexOf(name)
  const iPlu = ix('plu'), iComp = ix('component'), iCust = ix('customer'),
        iCenter = ix('center'), iCost = ix('cost'), iCostC = ix('costComponent')
  const map = new Map()  // pluNorm -> {component, customer, center, cost, costComponent}
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length <= iPlu) continue
    const plu = normPlu(row[iPlu])
    if (!plu) continue
    if (!map.has(plu)) {
      map.set(plu, {
        component: (row[iComp] || '').trim(),
        customer: (row[iCust] || '').trim(),
        center: (row[iCenter] || '').trim(),
        cost: row[iCost], costComponent: row[iCostC],
      })
    }
  }
  return map
}

// ---------- MAIN ----------
async function main() {
  console.log(`\n=== IMPORTADOR DE PLATOS tspoon -> Folvy (mitad 2) ===`)
  console.log(`Cuenta destino: ${ACCOUNT}`)
  console.log(`Modo: ${COMMIT ? 'COMMIT (escribe)' : 'DRY-RUN (no escribe)'}\n`)

  const puente = loadPuente(PUENTE)
  console.log(`Puente tspoon: ${puente.size} PLU únicos (normalizados)`)

  // menu_item de la cuenta con external_id
  const { data: menu, error: e1 } = await sb
    .from('menu_item')
    .select('id, name, external_id, recipe_item_id')
    .eq('account_id', ACCOUNT)
    .not('external_id', 'is', null)
  if (e1) throw e1
  console.log(`menu_item con external_id: ${menu.length}`)

  const matched = [], unmatched = []
  for (const m of menu) {
    const p = puente.get((m.external_id || '').trim())
    if (p) matched.push({ ...m, tspoon: p })
    else unmatched.push(m)
  }
  const yaEnlazados = matched.filter((m) => m.recipe_item_id).length

  console.log(`\nCASAN por PLU (tendrán dish): ${matched.length}`)
  console.log(`  · ya tienen recipe_item_id (se respeta): ${yaEnlazados}`)
  console.log(`  · a crear dish: ${matched.length - yaEnlazados}`)
  console.log(`NO casan (combos/variantes, NO se crean): ${unmatched.length}`)

  console.log(`\n--- Muestra de los que CASAN (menu_item -> component tspoon | marca):`)
  for (const m of matched.slice(0, 15)) {
    console.log(`  ${m.name.slice(0, 30).padEnd(30)} -> ${m.tspoon.component.slice(0, 28).padEnd(28)} | ${m.tspoon.customer.slice(0, 18)}`)
  }
  console.log(`\n--- NO casan (${unmatched.length}):`)
  unmatched.forEach((m) => console.log(`  • ${m.name}`))

  if (!COMMIT) {
    console.log(`\n[DRY-RUN] No se ha escrito nada.`)
    console.log(`Para escribir: node scripts/import-platos.mjs --commit --account=${ACCOUNT}\n`)
    return
  }

  console.log(`\nEscribiendo platos...`)
  let creados = 0, enlazados = 0, mapas = 0, fail = 0
  for (const m of matched) {
    try {
      let dishId = m.recipe_item_id
      // 1. crear dish si no hay uno enlazado
      if (!dishId) {
        const { data, error } = await sb.from('recipe_item').insert({
          account_id: ACCOUNT,
          type: 'dish',
          name: m.name,
          base_unit_id: '869711c3-eabd-4e95-92f2-555efaaba6b0', // Unidad (ud) — un plato es 1 ud
          cost_strategy: 'fixed',
          source: 'import',
          needs_review: true,
        }).select('id').single()
        if (error) throw new Error(`dish: ${error.message}`)
        dishId = data.id
        creados++
        // 2. enlazar menu_item -> dish
        const { error: e2 } = await sb.from('menu_item').update({ recipe_item_id: dishId }).eq('id', m.id)
        if (e2) throw new Error(`link menu_item: ${e2.message}`)
        enlazados++
      }
      // 3. puente lastapp_product_map (PLU -> dish). Upsert manual por (account, plu).
      const plu = (m.external_id || '').trim()
      const { data: existing } = await sb.from('lastapp_product_map')
        .select('id').eq('account_id', ACCOUNT).eq('organization_product_id', plu).maybeSingle()
      if (existing) {
        const { error } = await sb.from('lastapp_product_map')
          .update({ recipe_item_id: dishId, lastapp_product_name: m.name, needs_review: false })
          .eq('id', existing.id)
        if (error) throw new Error(`update map: ${error.message}`)
      } else {
        const { error } = await sb.from('lastapp_product_map').insert({
          account_id: ACCOUNT, organization_product_id: plu,
          recipe_item_id: dishId, lastapp_product_name: m.name, needs_review: false,
        })
        if (error) throw new Error(`insert map: ${error.message}`)
      }
      mapas++
    } catch (e) {
      fail++
      console.error(`  ✗ ${m.name}: ${e.message}`)
    }
  }
  console.log(`\n✓ Hecho.`)
  console.log(`  dishes creados: ${creados}`)
  console.log(`  menu_item enlazados: ${enlazados}`)
  console.log(`  filas lastapp_product_map: ${mapas}`)
  console.log(`  fallos: ${fail}`)
  console.log(`\nSiguiente: import-escandallos.mjs colgará las recipe_line sobre estos dishes.\n`)
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
