#!/usr/bin/env node
// scripts/conta/produccion/medir-pdf-3174.mjs
//
// C06b · Lo usa .github/workflows/medir-pdf-3174.yml. Baja (solo GET) el PDF
// del asiento 3174 de conta-documentos y saca, en «@@ clave número|huella»
// para salida-segura.mjs, sus bytes, su sha256 y si sus 16 primeros caracteres
// son los del nombre. Ni el PDF ni nada de lo que dice.
// Entorno: SUPABASE_ACCESS_TOKEN (el del despliegue), RUTA y HUELLA_NOMBRE. La
// clave de servicio se pide aquí a la Management API y no se escribe nunca.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const { SUPABASE_ACCESS_TOKEN, RUTA, HUELLA_NOMBRE } = process.env
if (!SUPABASE_ACCESS_TOKEN || !RUTA || !HUELLA_NOMBRE) { console.error('Faltan SUPABASE_ACCESS_TOKEN, RUTA o HUELLA_NOMBRE.'); process.exit(1) }
const REF = (readFileSync('supabase/config.toml', 'utf8').match(/^\s*project_id\s*=\s*"?([a-z0-9]+)"?/m) ?? [])[1]
if (!REF) { console.error('No se pudo leer project_id de supabase/config.toml.'); process.exit(1) }
const k = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })
const KEY = k.ok ? ((await k.json()).find((x) => x.name === 'service_role')?.api_key ?? null) : null
if (!KEY) { console.error(`No se pudo obtener la clave de servicio (${k.status}).`); process.exit(1) }
const r = await fetch(`https://${REF}.supabase.co/storage/v1/object/conta-documentos/${RUTA}`, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } })
if (!r.ok) { console.error(`No se ha podido bajar el PDF (${r.status}).`); process.exit(1) }
const b = Buffer.from(await r.arrayBuffer())
const sha = createHash('sha256').update(b).digest('hex')
console.log(`@@ pdf_3174.bytes ${b.length}`)
console.log(`@@ pdf_3174.sha256 ${sha}`)
console.log(`@@ pdf_3174.coincide_nombre ${sha.slice(0, 16) === HUELLA_NOMBRE ? 1 : 0}`)
console.log(`@@ pdf_3174.empieza_por_pdf ${b.subarray(0, 5).toString('latin1') === '%PDF-' ? 1 : 0}`)
