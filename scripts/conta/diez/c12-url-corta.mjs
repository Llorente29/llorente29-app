#!/usr/bin/env node
// scripts/conta/diez/c12-url-corta.mjs
//
// C12 (24/10) · ¿Diez guarda una COPIA del PDF o solo el enlace? La prueba que
// pidió Julio: una factura inventada con una URL firmada que caduca a los 10
// minutos; Julio la importa en la C0009 dentro de esos 10 minutos y, pasada
// media hora, mira el PDF en Diez. Si se ve, Diez guardó copia y la URL puede
// ser corta; si no, tiene que ser permanente.
//
// El PDF se sube al bucket privado conta-documentos de STAGING (no de
// producción), en prueba-c12/u<run>/, con la clave de servicio de staging.
//
//   node scripts/conta/diez/c12-url-corta.mjs antes   → sube, firma, comprueba que
//        la URL contesta (200) y deja el Excel en $SALIDA/prueba-c12-url-corta.xlsx
//   node scripts/conta/diez/c12-url-corta.mjs despues → la misma URL, pasada su
//        caducidad, ya no contesta (lo que demuestra que lo que Diez enseñe es suyo)
//
// Entorno: SB_URL y SB_KEY (staging), RUN (número de la prueba), MINUTOS (10),
// SALIDA (carpeta) y, para «despues», URL_FIRMADA. Solo saca «@@ clave número».

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLIENTE, libro, pdf } from './c12-excel-prueba.mjs'

const sale = (k, v) => console.log(`@@ ${k} ${typeof v === 'boolean' ? (v ? 1 : 0) : v}`)
const modo = process.argv[2]
const { SB_URL, SB_KEY } = process.env
const RUN = String(process.env.RUN ?? '0').replace(/\D/g, '') || '0'
const MINUTOS = Math.max(1, Math.min(60, Number(process.env.MINUTOS ?? 10)))
const BUCKET = 'conta-documentos'

if (!/^https:\/\/oseymswjlzplqoxrfjzi\.supabase\.co$/.test(SB_URL ?? '')) { sale('no_es_staging', 1); process.exit(1) }

if (modo === 'antes') {
  if (!SB_KEY) { sale('sin_clave', 1); process.exit(1) }
  const numero = `PRB-C12-U${RUN}`
  const factura = {
    numero, concepto: `Prueba C12 · URL que caduca a los ${MINUTOS} min`,
    ingresos: [{ subcuenta: '70000002', importe: 100 }], iva: [{ base: 100, pct: 10, cuota: 10 }], total: 110,
  }
  const ruta = `prueba-c12/u${RUN}/${numero}.pdf`
  const h = { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY }
  const sub = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${ruta}`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf(factura),
  })
  sale('subido_http', sub.status)
  if (!sub.ok) process.exit(1)
  const fir = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${ruta}`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: MINUTOS * 60 }),
  })
  sale('firmada_http', fir.status)
  const j = await fir.json().catch(() => ({}))
  const rel = j.signedURL ?? j.signedUrl
  if (!fir.ok || !rel) process.exit(1)
  const url = rel.startsWith('http') ? rel : `${SB_URL}/storage/v1${rel}`
  const caduca = new Date(Date.now() + MINUTOS * 60_000)
  const prueba = await fetch(url)
  sale('url_contesta_http', prueba.status)
  sale('url_es_pdf', (prueba.headers.get('content-type') ?? '').includes('pdf'))
  sale('minutos', MINUTOS)
  sale('factura_prb_c12_u', RUN)
  // La hora de Madrid a la que caduca, como número HHMM (la puerta de salida solo deja números).
  const hhmm = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(caduca).replace(':', '')
  sale('caduca_hhmm_madrid', hhmm)
  const dir = process.env.SALIDA ?? 'prueba-url-corta'
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'prueba-c12-url-corta.xlsx'), libro(true, { url, facturas: [factura] }))
  writeFileSync(join(dir, 'url.txt'), url)
  sale('cliente_subcuenta', CLIENTE.subcuenta)
} else if (modo === 'despues') {
  const url = process.env.URL_FIRMADA ?? ''
  if (!url.startsWith(`${SB_URL}/storage/v1/object/sign/${BUCKET}/prueba-c12/`)) { sale('url_no_es_de_la_prueba', 1); process.exit(1) }
  const r = await fetch(url)
  sale('url_despues_http', r.status)
  sale('url_caducada', !r.ok)
} else {
  console.log('uso: c12-url-corta.mjs antes | despues')
  process.exit(1)
}
