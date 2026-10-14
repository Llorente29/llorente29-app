#!/usr/bin/env node
// scripts/conta/d01/generar-facturas.mjs
//
// D01 · R2 punto 2 · Dibuja las facturas inventadas de facturasInventadas.mjs
// en tests/conta/d01/facturas-inventadas/:
//   · 'pdf'       → PDF con texto (como lo imprime un programa de facturación);
//   · 'torcida'   → JPEG de una foto con la hoja girada y en perspectiva;
//   · 'borrosa'   → JPEG de una foto desenfocada;
//   · 'escaneada' → PDF que es SOLO una imagen (sin texto que copiar).
// Con Chromium de Playwright. Se vuelve a correr si cambia la especificación:
//
//   node scripts/conta/d01/generar-facturas.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { jsPDF } from 'jspdf'
import { FACTURAS, html } from './facturasInventadas.mjs'

const DIR = 'tests/conta/d01/facturas-inventadas'
mkdirSync(DIR, { recursive: true })
const navegador = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const pagina = await navegador.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 })
const hechas = []
for (const f of FACTURAS) {
  await pagina.setContent(html(f), { waitUntil: 'load' })
  if (f.papel === 'pdf') {
    writeFileSync(`${DIR}/${f.id}.pdf`, await pagina.pdf({ format: f.ticket ? undefined : 'A4', width: f.ticket ? '90mm' : undefined, height: f.ticket ? '160mm' : undefined, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } }))
    hechas.push(`${f.id}.pdf`)
  } else if (f.papel === 'escaneada') {
    await pagina.setViewportSize({ width: 794, height: 1123 })
    const png = await pagina.screenshot({ type: 'jpeg', quality: 70, fullPage: false })
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    doc.addImage(new Uint8Array(png), 'JPEG', 0, 0, 595.28, 841.89)
    writeFileSync(`${DIR}/${f.id}.pdf`, Buffer.from(doc.output('arraybuffer')))
    await pagina.setViewportSize({ width: 900, height: 1200 })
    hechas.push(`${f.id}.pdf`)
  } else if (f.papel === 'escaneada-chromium') {
    // La misma hoja fotografiada y vuelta a imprimir como una página que solo es la imagen.
    await pagina.setViewportSize({ width: 794, height: 1123 })
    const jpg = await pagina.screenshot({ type: 'jpeg', quality: 70, fullPage: false })
    await pagina.setContent(`<!doctype html><html><body style="margin:0"><img style="width:210mm;height:297mm;display:block" src="data:image/jpeg;base64,${jpg.toString('base64')}"></body></html>`, { waitUntil: 'load' })
    writeFileSync(`${DIR}/${f.id}.pdf`, await pagina.pdf({ format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }))
    await pagina.setViewportSize({ width: 900, height: 1200 })
    hechas.push(`${f.id}.pdf`)
  } else {
    writeFileSync(`${DIR}/${f.id}.jpg`, await pagina.screenshot({ type: 'jpeg', quality: 72, fullPage: true }))
    hechas.push(`${f.id}.jpg`)
  }
}
await navegador.close()
console.log(hechas.join('\n'))
