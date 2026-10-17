#!/usr/bin/env node
// scripts/e2e/inflacion.mjs <informe.json> [--tiempos]
//
// W02 (paso 1c): ¿aguanta staging (Micro) cuatro navegadores a la vez? Si no,
// lo primero que se nota es que las MISMAS pruebas tardan más. Esto compara lo
// que ha tardado cada fichero en este run (el informe JSON de Playwright, los
// trozos juntos) con lo que tardó en la entera en serie del 16/10
// (tests/e2e/tiempos.json), con la misma vara: la suma de las duraciones de
// sus pruebas, los dos tamaños.
//
// Con --tiempos escribe, en vez de la tabla, un tiempos.json nuevo con lo de
// este run (para cuando la suite cambie mucho).

import { readFileSync } from 'node:fs'
import { tiemposDelRepo } from './trozos.mjs'

export function porFichero(informe) {
  const t = {}
  const andar = (s, fichero) => {
    const f = s.file ?? fichero
    for (const spec of s.specs ?? []) {
      const ff = (spec.file ?? f ?? '').replace(/^tests\/e2e\//, '')
      for (const test of spec.tests ?? []) for (const r of test.results ?? []) t[ff] = (t[ff] ?? 0) + (r.duration ?? 0) / 1000
    }
    for (const h of s.suites ?? []) andar(h, f)
  }
  for (const s of informe.suites ?? []) andar(s, s.file)
  return t
}

export function comparar(ahora, antes) {
  const filas = Object.keys(ahora).filter((f) => typeof antes[f] === 'number' && antes[f] > 0)
    .map((f) => ({ f, antes: antes[f], ahora: ahora[f], x: ahora[f] / antes[f] }))
    .sort((a, b) => b.antes - a.antes)
  const sa = filas.reduce((s, r) => s + r.antes, 0), sn = filas.reduce((s, r) => s + r.ahora, 0)
  return { filas, antes: sa, ahora: sn, x: sa ? sn / sa : null }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const informe = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const ahora = porFichero(informe)
  if (process.argv.includes('--tiempos')) {
    const o = { _: tiemposDelRepo()._ }
    for (const k of Object.keys(ahora).sort()) o[k] = Math.round(ahora[k] * 10) / 10
    console.log(JSON.stringify(o, null, 1))
  } else {
    const c = comparar(ahora, tiemposDelRepo())
    const m = (s) => (s / 60).toFixed(1)
    console.log(`### ¿Aguanta staging? Las mismas pruebas, en serie (16/10) y ahora\n`)
    console.log(`En los ${c.filas.length} ficheros que estaban en la entera en serie: **${m(c.antes)} min** entonces, **${m(c.ahora)} min** ahora sumando los trozos (× ${c.x?.toFixed(2)}).\n`)
    console.log('| fichero | 16/10, en serie (s) | ahora (s) | × |'); console.log('|---|---:|---:|---:|')
    for (const r of c.filas.slice(0, 12)) console.log(`| ${r.f} | ${r.antes.toFixed(0)} | ${r.ahora.toFixed(0)} | ${r.x.toFixed(2)} |`)
  }
}
