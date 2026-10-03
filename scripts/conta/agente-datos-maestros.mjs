#!/usr/bin/env node
// scripts/conta/agente-datos-maestros.mjs
//
// Agente de cumplimiento «Datos maestros e impuestos» (C00 §9.2). Corre cada
// noche en GitHub Actions contra staging-conta (workflow
// cumplimiento-nocturno-conta.yml):
//
//   psql "$STAGING_CONTA_DB_URL" -At -f scripts/conta/agente-datos-maestros.sql > bd.json
//   node scripts/conta/agente-datos-maestros.mjs bd.json informe.md
//
// Lee el volcado de la base y docs/conta/referencia/serie.json, y escribe el
// informe en lenguaje normal. No cambia nada: si algo no cuadra, sale con
// código 1 y el workflow abre un aviso. La revisión vive en
// lib/datosMaestros.mjs (pura) y tiene sus pruebas fijas en
// tests/conta/cumplimiento/datosMaestros.test.ts.

import { readFileSync, writeFileSync } from 'node:fs'
import { revisar, informe, TABLAS_FILA_A_FILA } from './lib/datosMaestros.mjs'

const [, , rutaBd, rutaInforme = 'informe-datos-maestros.md', donde = 'staging-conta'] = process.argv
if (!rutaBd) { console.error('Uso: node scripts/conta/agente-datos-maestros.mjs <volcado.json> [informe.md] [dónde]'); process.exit(2) }

const bd = JSON.parse(readFileSync(rutaBd, 'utf8'))
const ref = JSON.parse(readFileSync('docs/conta/referencia/serie.json', 'utf8'))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const filasMiradas = Object.keys(TABLAS_FILA_A_FILA).reduce((n, t) => n + (bd.tablas[t]?.length ?? 0), 0)
  + Object.values(bd.recuentos ?? {}).reduce((n, v) => n + Number(v || 0), 0)

const hallazgos = revisar(bd, ref, hoy)
const texto = informe(hallazgos, { donde, hoy, referencia: String(ref.generado_desde).slice(0, 10), filasMiradas })
writeFileSync(rutaInforme, texto)
console.log(texto)
process.exitCode = hallazgos.length ? 1 : 0
