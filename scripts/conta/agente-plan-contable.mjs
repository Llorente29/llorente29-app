#!/usr/bin/env node
// scripts/conta/agente-plan-contable.mjs
//
// Agente de cumplimiento «Plan contable» (C02 §4). Corre cada noche con los
// demás (workflow cumplimiento-nocturno-conta.yml), después de volver a bajar
// el PGC del BOE (FUENTES_SOLO=rd-1514-2007,rd-1515-2007,rd-1-2021):
//
//   psql … -f scripts/conta/agente-plan-contable.sql > bd.json
//   node scripts/conta/agente-plan-contable.mjs bd.json informe.md staging-conta
//
// No cambia nada: si algo no cuadra, sale con código 1 y el workflow abre un
// aviso. La revisión vive en lib/agentePlan.mjs (pura) y tiene sus pruebas en
// tests/conta/cumplimiento/agentePlan.test.ts.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLANES } from './lib/planContable.mjs'
import { informePlan, revisarEmpresas, revisarImportaciones, revisarSerieEnBase, revisarSerieEnTexto } from './lib/agentePlan.mjs'
import { anonimizar, informeAnonimo } from './lib/anonimo.mjs'

const [, , rutaBd, rutaInforme = 'informe-plan-contable.md', donde = 'staging-conta'] = process.argv
if (!rutaBd) { console.error('Uso: node scripts/conta/agente-plan-contable.mjs <volcado.json> [informe.md] [dónde]'); process.exit(2) }

const bd = JSON.parse(readFileSync(rutaBd, 'utf8'))
const serie = JSON.parse(readFileSync('supabase/conta/pgc/serie.json', 'utf8'))
const correcciones = JSON.parse(readFileSync('supabase/conta/pgc/correcciones.json', 'utf8'))
const registro = JSON.parse(readFileSync('docs/conta/fuentes/registro.json', 'utf8'))
const textos = Object.fromEntries(Object.entries(PLANES).map(([plan, p]) => {
  const f = registro.fuentes[p.fuente]
  return [plan, f?.fichero ? readFileSync(join('docs/conta/fuentes', f.fichero), 'utf8') : null]
}))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

const hallazgos = [...revisarSerieEnTexto(textos, correcciones), ...revisarSerieEnBase(bd.pgc_account ?? [], serie), ...revisarEmpresas(bd, serie), ...revisarImportaciones(bd)]
// En producción (CONTA_ANONIMO=1, lo pone su workflow): sin nombres ni conceptos.
const texto = process.env.CONTA_ANONIMO === '1'
  ? informeAnonimo('Agente «Plan contable»', anonimizar('plan contable', hallazgos), { donde, hoy, mirado: `Filas leídas de pgc_account: ${(bd.pgc_account ?? []).length}.` })
  : informePlan(hallazgos, { donde, hoy, filas: (bd.pgc_account ?? []).length, resumen: serie.resumen })
writeFileSync(rutaInforme, texto)
console.log(texto)
process.exitCode = hallazgos.some((h) => h.nivel === 'rojo') ? 1 : 0
