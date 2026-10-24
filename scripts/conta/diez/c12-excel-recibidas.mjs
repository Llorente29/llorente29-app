#!/usr/bin/env node
// scripts/conta/diez/c12-excel-recibidas.mjs
//
// C12 (24/10, respuesta 2) · El Excel de PRUEBA para la importación de
// «Facturas recibidas» de Diez, solo para la C0009, con el PDF por «Url
// documento» (lo que funcionó en emitidas). Tres recibidas inventadas:
//   · PRB-C12-R001: normal, IVA 21 %;
//   · PRB-C12-R002: dos tipos de IVA (10 % y 21 %), dos cuentas de gasto;
//   · PRB-C12-R003: un profesional con retención de IRPF (15 %).
//
// Las columnas siguen el mismo orden que el Excel de emitidas que entró bien
// (A–Q, K = Url documento, R/S/T = IVA 2), con la retención a la derecha
// (U base, V %, W cuota). El XML trae los mismos códigos de campo que el de
// emitidas (Campo057 = Ruta documento es el mismo en las dos, según la
// configuración de Julio); la retención NO va en el XML porque no sabemos su
// código: se asigna a mano en la pantalla (instrucciones).
//
// Sale en docs/conta/c12/prueba-excel/:
//   · prueba-c12-recibidas-url.xlsx
//   · ConfiguracionRecibidas-c12.XML
//
//   node scripts/conta/diez/c12-excel-recibidas.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'

const SALIDA = 'docs/conta/c12/prueba-excel'
// Como en emitidas: un PDF público cualquiera; en el traspaso de verdad, el enlace de Sumied.
const URL_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
export const PROVEEDOR = { subcuenta: '40000990', nombre: 'PROVEEDOR PRUEBA C12', nif: 'B00000001' }
export const FECHA = new Date(Date.UTC(2026, 9, 24))

/** Las tres recibidas, cuadradas al céntimo. */
export const RECIBIDAS = [
  {
    numero: 'PRB-C12-R001', concepto: 'Prueba C12 · recibida normal',
    gastos: [{ subcuenta: '60000000', importe: 100 }],
    iva: [{ base: 100, pct: 21, cuota: 21 }], retencion: null, total: 121,
  },
  {
    numero: 'PRB-C12-R002', concepto: 'Prueba C12 · recibida con dos tipos de IVA',
    gastos: [{ subcuenta: '60000000', importe: 100 }, { subcuenta: '62900000', importe: 50 }],
    iva: [{ base: 100, pct: 10, cuota: 10 }, { base: 50, pct: 21, cuota: 10.5 }], retencion: null, total: 170.5,
  },
  {
    numero: 'PRB-C12-R003', concepto: 'Prueba C12 · profesional con retención',
    gastos: [{ subcuenta: '62300000', importe: 200 }],
    iva: [{ base: 200, pct: 21, cuota: 42 }], retencion: { base: 200, pct: 15, cuota: 30 }, total: 212,
  },
]

export const CABECERA = [
  'Subcuenta proveedor', 'Concepto asiento', 'Nombre', 'NIF', 'Subcuenta gasto 1', 'Nº factura',
  'Importe gasto 1', 'Subcuenta gasto 2', 'Importe gasto 2', '', 'Url documento', '',
  'Base IVA 1', '% IVA 1', 'Cuota IVA 1', 'Total factura', 'Fecha', 'Base IVA 2', '% IVA 2', 'Cuota IVA 2',
  'Base retención', '% retención', 'Cuota retención',
]

export function filas(url = URL_PDF) {
  return RECIBIDAS.map((f) => [
    PROVEEDOR.subcuenta, f.concepto, PROVEEDOR.nombre, PROVEEDOR.nif,
    f.gastos[0].subcuenta, f.numero, f.gastos[0].importe,
    f.gastos[1]?.subcuenta ?? '', f.gastos[1]?.importe ?? '',
    '', url, '',
    f.iva[0].base, f.iva[0].pct, f.iva[0].cuota, f.total, FECHA,
    f.iva[1]?.base ?? '', f.iva[1]?.pct ?? '', f.iva[1]?.cuota ?? '',
    f.retencion?.base ?? '', f.retencion?.pct ?? '', f.retencion?.cuota ?? '',
  ])
}

/** Comprobación de que cada recibida cuadra: gastos = bases; total = bases + cuotas − retención. */
export function cuadra(f) {
  const c = (x) => Math.round(x * 100)
  const bases = f.iva.reduce((s, i) => s + c(i.base), 0)
  const cuotas = f.iva.reduce((s, i) => s + c(i.cuota), 0)
  const gastos = f.gastos.reduce((s, g) => s + c(g.importe), 0)
  const ret = f.retencion ? c(f.retencion.cuota) : 0
  return gastos === bases && c(f.total) === bases + cuotas - ret
    && f.iva.every((i) => c(i.cuota) === Math.round(i.base * i.pct)) && (!f.retencion || c(f.retencion.cuota) === Math.round(f.retencion.base * f.retencion.pct))
}

function libro() {
  const ws = XLSX.utils.aoa_to_sheet([CABECERA, ...filas()], { cellDates: true })
  for (const k of Object.keys(ws)) if (ws[k]?.t === 'd') ws[k].z = 'dd/mm/yyyy'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Recibidas')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })
}

// Los mismos códigos que el XML de emitidas que funcionó (Campo056 Url documento,
// 010-015 IVA 1 y 2). Sin Ruta documento (Campo057) y sin la retención: a mano.
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Configuracion_Excel_Recibidas xmlns="Configuracion_Excel_Recibidas">
  <Configuracion>
    <Campo001>17</Campo001>
    <Campo002>17</Campo002>
    <Campo005>3</Campo005>
    <Campo006>6</Campo006>
    <Campo007>2</Campo007>
    <Campo004>1</Campo004>
    <Campo045>16</Campo045>
    <Campo118>17</Campo118>
    <Campo041>5</Campo041>
    <Campo043>7</Campo043>
    <Campo092>8</Campo092>
    <Campo094>9</Campo094>
    <Campo056>11</Campo056>
    <Campo010>13</Campo010>
    <Campo011>14</Campo011>
    <Campo012>15</Campo012>
    <Campo013>18</Campo013>
    <Campo014>19</Campo014>
    <Campo015>20</Campo015>
  </Configuracion>
</Configuracion_Excel_Recibidas>
`

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of RECIBIDAS) if (!cuadra(f)) throw new Error(`${f.numero} no cuadra`)
  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(join(SALIDA, 'prueba-c12-recibidas-url.xlsx'), libro())
  writeFileSync(join(SALIDA, 'ConfiguracionRecibidas-c12.XML'), XML.replace(/\n/g, '\r\n'))
  console.log(`Hecho: ${SALIDA} (3 recibidas con Url documento; XML sin la retención, que se asigna a mano).`)
}
