#!/usr/bin/env node
// scripts/pr/novedades-escribir.mjs
//
// NV1 · Lo que corre novedades-al-fusionar.yml: con la descripción del PR
// fusionado (PR_CUERPO), su número (PR) y cuándo se fusionó (FECHA), escribe
// novedades/pr-<n>.json, un fichero por PR (como los tiempos de la e2e, T12):
// dos PR no tocan nunca el mismo fichero. Si el PR no trae novedades (todo
// «ninguna»), no escribe nada y lo dice.
import { writeFileSync, mkdirSync } from 'node:fs'
import { ficheroDeNovedades } from './novedades.mjs'

const pr = Number(process.env.PR)
const fecha = process.env.FECHA || new Date().toISOString()
if (!Number.isInteger(pr) || pr <= 0) { console.error('novedades-escribir: falta PR (el número del PR).'); process.exit(1) }
const lista = ficheroDeNovedades({ pr, fecha, cuerpo: process.env.PR_CUERPO ?? '' })
if (!lista) { console.log(`#${pr} no trae novedades: no se escribe nada.`); process.exit(0) }
mkdirSync('novedades', { recursive: true })
writeFileSync(`novedades/pr-${pr}.json`, JSON.stringify(lista, null, 1) + '\n', 'utf8')
console.log(`novedades/pr-${pr}.json: ${lista.length} ${lista.length === 1 ? 'novedad' : 'novedades'} (${lista.map((x) => `${x.producto} · ${x.apartado}`).join('; ')}).`)
