#!/usr/bin/env node
// scripts/conta/agente-libro.mjs
//
// Agente de cumplimiento «Libro diario» (C04 §8). Corre cada noche a las 03:40
// de Madrid con los demás (cumplimiento-nocturno-conta.yml en staging,
// cumplimiento-produccion-conta.yml en producción, los dos en solo lectura):
//
//   psql … -f scripts/conta/agente-libro.sql > libro.json
//   psql … -f scripts/conta/agente-libros.sql > libros.json   (C05; solo si existe vat_book_entry)
//   node scripts/conta/agente-libro.mjs libro.json informe.md staging-conta [libros.json]
//
// No cambia nada: si algo está en rojo, sale con código 1 y el workflow abre
// un aviso. La revisión vive en lib/libro.mjs (pura), con sus pruebas en
// tests/conta/cumplimiento/libro.test.ts; que el SQL ve lo que tiene que ver
// lo prueba supabase/staging/sql/20261011_c04_prueba_agente.sql.

import { readFileSync, writeFileSync } from 'node:fs'
import { informeLibro, revisarLibro } from './lib/libro.mjs'
import { informeLibros, revisarLibros } from './lib/libros.mjs'

const [, , rutaBd, rutaInforme = 'informe-libro.md', donde = 'staging-conta', rutaLibros] = process.argv
if (!rutaBd) { console.error('Uso: node scripts/conta/agente-libro.mjs <volcado.json> [informe.md] [dónde]'); process.exit(2) }

const bd = JSON.parse(readFileSync(rutaBd, 'utf8'))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const libros = rutaLibros ? JSON.parse(readFileSync(rutaLibros, 'utf8')) : null
const hallazgosLibros = revisarLibros(libros)
const hallazgos = [...revisarLibro(bd), ...hallazgosLibros]
const texto = informeLibro(revisarLibro(bd), { donde, hoy, contado: bd.contado })
  + (libros ? informeLibros(hallazgosLibros, libros.contado) : '\n_Libros y balances (C05): esta base aún no los tiene._\n')
writeFileSync(rutaInforme, texto)
console.log(texto)
process.exitCode = hallazgos.some((h) => h.nivel === 'rojo') ? 1 : 0
