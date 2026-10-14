#!/usr/bin/env node
// scripts/conta/agente-conciliacion.mjs
//
// Agente «Conciliación» (B01), la parte de cada noche, con los demás
// (cumplimiento-nocturno-conta.yml en staging, cumplimiento-produccion-conta.yml
// en producción, los dos en solo lectura):
//
//   psql … -f scripts/conta/agente-conciliacion.sql > conciliacion.json
//   node scripts/conta/agente-conciliacion.mjs conciliacion.json informe.md staging-conta
//
// No cambia nada: si algo está en rojo, sale con código 1 y el workflow abre
// un aviso. La revisión vive en lib/conciliacion.mjs (pura), con sus pruebas
// en tests/conta/cumplimiento/conciliacion.test.ts.

import { readFileSync, writeFileSync } from 'node:fs'
import { informeConciliacion, revisarConciliacion } from './lib/conciliacion.mjs'

const [, , rutaBd, rutaInforme = 'informe-conciliacion.md', donde = 'staging-conta'] = process.argv
if (!rutaBd) { console.error('Uso: node scripts/conta/agente-conciliacion.mjs <volcado.json> [informe.md] [dónde]'); process.exit(2) }

const bd = JSON.parse(readFileSync(rutaBd, 'utf8'))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const hallazgos = revisarConciliacion(bd)
const texto = informeConciliacion(hallazgos, { donde, hoy, contado: bd.contado })
writeFileSync(rutaInforme, texto)
console.log(texto)
process.exitCode = hallazgos.some((h) => h.nivel === 'rojo') ? 1 : 0
