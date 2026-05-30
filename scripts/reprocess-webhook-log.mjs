// scripts/reprocess-webhook-log.mjs
// ---------------------------------------------------------------------------
// Reprocesa los eventos tab:closed que quedaron SIN PROCESAR en
// lastapp_webhook_log (entraron mientras el webhook tenia el bug de
// map_source = 'webhook', que el CHECK rechazaba).
//
// COMO: reenvia cada payload guardado al webhook YA CORREGIDO. Las ventas son
// idempotentes (external_ref = bill.id) -> NO se duplican aunque el evento ya
// se hubiera insertado. Tras un reenvio OK marca la fila original como
// processed=true, y borra el log-artefacto que el propio reenvio crea
// (de forma SEGURA: solo borra filas nuevas cuyos bills coinciden EXACTAMENTE
// con los que acabamos de reprocesar; un pedido real que entre durante la
// corrida nunca se borra).
//
// USO (Node 20.6+), desde la raiz del repo:
//   node --env-file=.env scripts/reprocess-webhook-log.mjs
//
// Necesita estas variables (en .env o en el entorno):
//   SUPABASE_URL  (o VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  (service role: lee/actualiza el log saltando RLS)
//   LASTAPP_WEBHOOK_TOKEN  (el token que valida el webhook en `authorization`)
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const TOKEN = process.env.LASTAPP_WEBHOOK_TOKEN

const missing = []
if (!URL) missing.push('SUPABASE_URL (o VITE_SUPABASE_URL)')
if (!KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!TOKEN) missing.push('LASTAPP_WEBHOOK_TOKEN')
if (missing.length) {
  console.error('Faltan variables de entorno:\n  - ' + missing.join('\n  - '))
  console.error('\nEjemplo:\n  node --env-file=.env scripts/reprocess-webhook-log.mjs')
  process.exit(1)
}

const FN_URL = `${URL.replace(/\/$/, '')}/functions/v1/lastapp-webhook`
const sb = createClient(URL, KEY)
const runStart = new Date().toISOString()

function billIdsOf(payload) {
  const bills = payload?.data?.bills
  if (!Array.isArray(bills)) return []
  return bills.map((b) => b?.id).filter(Boolean)
}

console.log(`Webhook: ${FN_URL}`)
console.log(`Inicio:  ${runStart}\n`)

// 1) Snapshot de ids de log existentes (red de seguridad anti-borrado).
const { data: preRows, error: preErr } = await sb
  .from('lastapp_webhook_log')
  .select('id')
if (preErr) { console.error('Error leyendo ids previos:', preErr.message); process.exit(1) }
const preIds = new Set(preRows.map((r) => r.id))

// 2) tab:closed sin procesar (filtramos el tipo en JS para no depender de la
//    sintaxis de filtro JSON de PostgREST).
const { data: rows, error } = await sb
  .from('lastapp_webhook_log')
  .select('id, payload')
  .eq('processed', false)
  .order('received_at', { ascending: true })
if (error) { console.error('Error leyendo log:', error.message); process.exit(1) }

const pending = rows.filter((r) => r?.payload?.type === 'tab:closed')
console.log(`tab:closed sin procesar: ${pending.length}\n`)
if (pending.length === 0) { console.log('Nada que reprocesar.'); process.exit(0) }

// 3) Reenviar uno a uno.
const reprocessedBills = new Set()
let ok = 0, fail = 0
for (const row of pending) {
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: TOKEN },
      body: JSON.stringify(row.payload),
    })
    let out = {}
    try { out = await res.json() } catch { /* respuesta no-JSON */ }
    if (res.ok && out.processed === true && !out.error) {
      await sb.from('lastapp_webhook_log').update({ processed: true }).eq('id', row.id)
      for (const b of billIdsOf(row.payload)) reprocessedBills.add(b)
      ok++
      console.log(`OK    ${row.id}`)
    } else {
      fail++
      console.log(`FALLA ${row.id}: ${out.error ?? `HTTP ${res.status}`}`)
    }
  } catch (e) {
    fail++
    console.log(`FALLA ${row.id}: ${e.message}`)
  }
}

// 4) Limpieza SEGURA de artefactos: filas creadas en esta corrida cuyos bills
//    son EXACTAMENTE los que reprocesamos. Un pedido real nuevo (otro bill id)
//    no entra en este filtro y queda intacto.
const { data: fresh, error: freshErr } = await sb
  .from('lastapp_webhook_log')
  .select('id, payload')
  .gte('received_at', runStart)
if (freshErr) {
  console.log(`\nAviso: no se pudo listar artefactos para limpiar: ${freshErr.message}`)
} else {
  const toDelete = fresh
    .filter((r) => !preIds.has(r.id) && r?.payload?.type === 'tab:closed')
    .filter((r) => {
      const bids = billIdsOf(r.payload)
      return bids.length > 0 && bids.every((b) => reprocessedBills.has(b))
    })
    .map((r) => r.id)
  if (toDelete.length) {
    const { error: delErr } = await sb.from('lastapp_webhook_log').delete().in('id', toDelete)
    if (delErr) console.log(`\nAviso: no se pudieron borrar ${toDelete.length} artefactos: ${delErr.message}`)
    else console.log(`\nArtefactos de reenvio limpiados: ${toDelete.length}`)
  } else {
    console.log('\nSin artefactos que limpiar.')
  }
}

console.log(`\nRESUMEN: ${ok} reprocesados, ${fail} fallidos, de ${pending.length} pendientes.`)
process.exit(fail > 0 ? 1 : 0)
