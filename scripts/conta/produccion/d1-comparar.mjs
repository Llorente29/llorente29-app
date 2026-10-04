#!/usr/bin/env node
// scripts/conta/produccion/d1-comparar.mjs antes.csv despues.csv
//
// Compara dos fotos de D1 (scripts/conta/produccion/d1.sql, en CSV de psql:
// code,dia,rate,equivalence_surcharge). Los números se comparan como NÚMEROS
// (4 = 4.00) y «sin tipo» cuenta como valor.
//
// Una sola diferencia está DECIDIDA y no cuenta (respuesta 2 de Julio): del
// 01/10/2024 al 31/12/2024 los alimentos básicos pasan de «sin tipo» al 2 %
// con recargo 0,26 (vat_rate solo lo tenía para el aceite). Cualquier otra,
// sí. Sale con 1 si hay alguna, o si las dos fotos no tienen los mismos pares.

import { readFileSync } from 'node:fs'

const leer = (f) => new Map(readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
  const [code, dia, rate, rec] = l.split(',')
  const n = (x) => (x === undefined || x === '' ? null : Number(x))
  return [`${code}|${dia}`, { rate: n(rate), rec: n(rec) }]
}))
const [fa, fd] = process.argv.slice(2)
const a = leer(fa); const d = leer(fd)
const decidida = (k, x, y) => {
  const [code, dia] = k.split('|')
  return code === 'alimento_basico' && dia >= '2024-10-01' && dia <= '2024-12-31'
    && x.rate === null && y.rate === 2 && y.rec === 0.26
}
const difs = []
let decididas = 0
for (const [k, x] of a) {
  const y = d.get(k)
  if (!y) { difs.push(`${k}: falta después`); continue }
  if (x.rate === y.rate && x.rec === y.rec) continue
  if (decidida(k, x, y)) { decididas++; continue }
  difs.push(`${k}: ${x.rate ?? 'sin tipo'}/${x.rec ?? '-'} → ${y.rate ?? 'sin tipo'}/${y.rec ?? '-'}`)
}
for (const k of d.keys()) if (!a.has(k)) difs.push(`${k}: no estaba antes`)
console.log(`D1 · ${a.size} pares antes, ${d.size} después · diferencias: ${difs.length} · decididas (2 % de 4T2024): ${decididas}`)
for (const x of difs.slice(0, 20)) console.log(`  ${x}`)
process.exitCode = difs.length ? 1 : 0
