#!/usr/bin/env node
// scripts/conta/banco/mirar-open-banking.mjs
//
// B01 · Cola 1b · QUÉ DEVUELVE open-banking.io, EN SOLO LECTURA.
// Se lanza a mano en el ordenador de quien tiene el credentials.json; el
// fichero no sale de ese ordenador y no se pega en ningún sitio.
//
//   mkdir mirar && cd mirar && npm init -y && npm i @open-banking-io/client@1.3.0
//   node <ruta>/scripts/conta/banco/mirar-open-banking.mjs <credentials.json> [desde] [hasta]
//
// (la librería se busca en la carpeta desde la que se lanza).
//
// Por defecto, del 2026-10-28 al 2026-11-02. No llama a sync ni a syncAll: solo
// lee lo que open-banking.io ya tiene guardado (getAccounts, getTransactions,
// getConnections). Lo que pinta NO lleva nombres, IBAN ni conceptos (T11):
//   · cada cuenta, por sus 4 últimas cifras, con sus saldos y su última sincronización;
//   · cada movimiento con fecha contable, valor y operación, su estado (BOOK, PDNG…),
//     el importe con signo, el código de operación del banco, el saldo que dejó y
//     si el concepto dice «traspaso» (sí/no);
//   · cuántos pendientes descarta hoy la lectura de cada noche (contabilizado()).
// Dos pasadas por cuenta: con from/to y sin ellos (las últimas 500), para ver si
// el filtro por fechas del servicio deja algo fuera.

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const desdeAqui = createRequire(join(process.cwd(), 'mirar.js'))
const { OpenBankingClient } = await import(pathToFileURL(desdeAqui.resolve('@open-banking-io/client')).href)

const [ruta, desde = '2026-10-28', hasta = '2026-11-02'] = process.argv.slice(2)
if (!ruta) {
  console.error('Uso: node mirar-open-banking.mjs <credentials.json> [desde] [hasta]')
  process.exit(2)
}

const c = OpenBankingClient.fromCredentials(ruta)
const contabilizado = (t) => !t.status || /^book/i.test(t.status)
const cuatro = (iban) => (iban ?? '').replace(/\s+/g, '').slice(-4) || '????'
const dia = (d) => (d ?? '').slice(0, 10) || '—'
const signo = (t) => {
  const n = String(t.amount ?? '').replace(/^[+-]/, '')
  const ind = String(t.creditDebitIndicator ?? '').toUpperCase()
  return ind === 'DBIT' ? `-${n}` : ind === 'CRDT' ? `+${n}` : String(t.amount)
}
const traspaso = (t) => /traspas|transfer.*propia|entre cuentas/i.test(`${t.remittanceInformation ?? ''} ${t.note ?? ''}`) ? 'sí' : 'no'
const enRango = (t) => {
  const f = dia(t.bookingDate ?? t.transactionDate ?? t.valueDate)
  return f >= desde && f <= hasta
}

async function todas(cuenta, q) {
  const out = []
  for (let i = 0; i < 20; i++) {
    const p = await c.getTransactions(cuenta, { ...q, limit: 200, offset: out.length })
    out.push(...(p.items ?? []))
    if (!p.items?.length || out.length >= p.total || (q.tope && out.length >= q.tope)) break
  }
  return out
}

const conexiones = await c.getConnections()
for (const x of conexiones) {
  console.log(`Conexión ${x.aspspName} · estado ${x.status} · viva ${x.isLive} · caduca ${dia(x.validUntil)} · última sincronización ${x.lastSyncedAt ?? '—'} · ${x.accountIds.length} cuentas`)
}

for (const a of await c.getAccounts()) {
  console.log(`\n=== ···${cuatro(a.iban)} · ${a.aspspName} · reconectar ${a.needsReconnect}`)
  for (const s of a.balances ?? []) console.log(`  saldo ${s.type}: ${s.amount} ${s.currency} (fecha ${s.referenceDate ?? '—'})`)
  const conFechas = await todas(a.id, { from: desde, to: hasta })
  const sinFechas = (await todas(a.id, { tope: 500 })).filter(enRango)
  const ids = new Set(conFechas.map((t) => t.id))
  const soloSin = sinFechas.filter((t) => !ids.has(t.id))
  console.log(`  con from/to: ${conFechas.length} · sin from/to y en el rango: ${sinFechas.length} · solo en la segunda: ${soloSin.length}`)
  const todos = [...conFechas, ...soloSin].sort((p, q) => dia(p.bookingDate ?? p.transactionDate).localeCompare(dia(q.bookingDate ?? q.transactionDate)))
  console.log('  contable   | valor      | operación  | estado | importe     | código                 | saldo después | traspaso | ¿lo lee la noche? | ¿con from/to?')
  for (const t of todos) {
    console.log(`  ${dia(t.bookingDate)} | ${dia(t.valueDate)} | ${dia(t.transactionDate)} | ${String(t.status ?? '—').padEnd(6)} | ${signo(t).padStart(11)} | ${String(t.bankTransactionCode ?? '—').slice(0, 22).padEnd(22)} | ${String(t.balanceAfterTransaction ?? '—').padStart(13)} | ${traspaso(t).padEnd(8)} | ${contabilizado(t) ? 'sí' : 'NO (pendiente)'} | ${ids.has(t.id) ? 'sí' : 'NO'}`)
  }
  const pendientes = todos.filter((t) => !contabilizado(t)).length
  console.log(`  pendientes que la lectura de cada noche descarta: ${pendientes}`)
}
