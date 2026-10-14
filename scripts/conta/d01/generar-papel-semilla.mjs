#!/usr/bin/env node
// scripts/conta/d01/generar-papel-semilla.mjs
//
// D01 · El papel de la factura de la semilla de staging (seed_d01_staging.sql:
// Mayorista Prueba Alfa, F-2026-1022, 11/10/2026, tres líneas al 10 %), para
// que N23 enseñe a la izquierda el papel de esa factura y no otro. Inventado
// entero, con las mismas cifras que la semilla. Lo sube la e2e de D01 a su
// ruta fija y lo enlaza a la factura de la semilla.
//
//   node scripts/conta/d01/generar-papel-semilla.mjs

import { writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'

const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
doc.setProperties({ title: 'F-2026-1022', creator: 'Folvy · prueba e2e D01', subject: 'Factura inventada' })
const x = 56
doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('MAYORISTA PRUEBA ALFA, S.A.', x, 80)
doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
doc.text('FACTURA F-2026-1022', 540, 80, { align: 'right' })
doc.text('NIF A00000018 · Calle Inventada 1, Madrid', x, 100)
doc.text('Cliente: Taberna de Prueba Norte, S.L. · Fecha 11/10/2026', x, 116)
doc.line(x, 130, 540, 130)
const lineas = [['Aceite de oliva 5 L', '4', '98,00'], ['Harina 25 kg', '6', '132,60'], ['Género variado', '', '1.052,55']]
let y = 152
doc.setFont('helvetica', 'bold'); doc.text('Concepto', x, y); doc.text('Cantidad', 380, y, { align: 'right' }); doc.text('Importe', 540, y, { align: 'right' })
doc.setFont('helvetica', 'normal')
for (const [c, q, i] of lineas) { y += 18; doc.text(c, x, y); doc.text(q, 380, y, { align: 'right' }); doc.text(i, 540, y, { align: 'right' }) }
y += 16; doc.line(x, y, 540, y)
y += 20; doc.text('Base imponible al 10 %', 400, y, { align: 'right' }); doc.text('1.283,15', 540, y, { align: 'right' })
y += 16; doc.text('IVA 10 %', 400, y, { align: 'right' }); doc.text('128,32', 540, y, { align: 'right' })
y += 20; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('TOTAL 1.411,47 €', 540, y, { align: 'right' })
doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
doc.text('Vencimiento: 10/11/2026 · transferencia. Factura inventada para las pruebas: no es de nadie.', x, y + 40)
const salida = 'tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'
writeFileSync(salida, Buffer.from(doc.output('arraybuffer')))
console.log(`${salida}`)
