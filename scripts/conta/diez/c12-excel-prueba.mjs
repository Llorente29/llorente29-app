#!/usr/bin/env node
// scripts/conta/diez/c12-excel-prueba.mjs
//
// C12 (24/10) · El Excel de PRUEBA para la importación de «Facturas emitidas»
// de Diez (Importaciones › Importación desde fichero › Facturas), solo para la
// C0009. Tres facturas inventadas con su PDF:
//   · PRB-C12-0001: normal, un tipo de IVA (10 %);
//   · PRB-C12-0002: dos tipos de IVA (10 % y 21 %), dos contrapartidas;
//   · PRB-C12-0003: rectificativa de la 0001 (por diferencias, en negativo).
//
// Las columnas A–Q son las de la configuración que Julio usa hoy
// (ConfiguracionExpedidas.XML, 24/10). Se añaden a la derecha, sin mover nada:
//   D NIF · K Url documento · R/S/T base/%/cuota del IVA 2 ·
//   U tipo de factura rectificativa · V tipo de rectificación ·
//   W nº de la factura rectificada · X su fecha.
//
// Sale en docs/conta/c12/prueba-excel/:
//   · prueba-c12-url.xlsx   → con la columna K (Url documento), para probar 1.º;
//   (el zip para «Ruta documento» se descartó el 24/10: con la URL, Diez trajo
//   los tres PDF y Julio se queda con la URL);
//   · ConfiguracionExpedidas-c12.XML → la de Julio más las columnas nuevas.
//
//   node scripts/conta/diez/c12-excel-prueba.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'

const SALIDA = 'docs/conta/c12/prueba-excel'
const CARPETA_WINDOWS = 'C:\\Sumied\\Traspasos\\prueba-c12\\'
// Para «Url documento» la prueba usa un PDF público cualquiera (lo que se
// prueba es si Diez descarga de una dirección y lo guarda). En el traspaso de
// verdad sería un enlace firmado de Sumied.
const URL_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'

export const CLIENTE = { subcuenta: '43000990', nombre: 'CLIENTE PRUEBA C12', nif: 'B00000000' }
export const FECHA = new Date(Date.UTC(2026, 9, 24))

/** Las tres facturas, con sus importes cuadrados al céntimo. */
export const FACTURAS = [
  {
    numero: 'PRB-C12-0001', concepto: 'Prueba C12 · factura normal',
    ingresos: [{ subcuenta: '70000002', importe: 100 }],
    iva: [{ base: 100, pct: 10, cuota: 10 }], total: 110,
  },
  {
    numero: 'PRB-C12-0002', concepto: 'Prueba C12 · dos tipos de IVA',
    ingresos: [{ subcuenta: '70000002', importe: 100 }, { subcuenta: '70500001', importe: 50 }],
    iva: [{ base: 100, pct: 10, cuota: 10 }, { base: 50, pct: 21, cuota: 10.5 }], total: 170.5,
  },
  {
    numero: 'PRB-C12-0003', concepto: 'Prueba C12 · rectificativa de PRB-C12-0001',
    ingresos: [{ subcuenta: '70000002', importe: -100 }],
    iva: [{ base: -100, pct: 10, cuota: -10 }], total: -110,
    rectifica: { tipoFactura: 'R4', tipoRectificacion: 'I', numero: 'PRB-C12-0001', fecha: FECHA },
  },
]

/** Los títulos de cada columna, solo para leer este fichero: el Excel va SIN fila de títulos. */
export const CABECERA = [
  'Subcuenta cliente', 'Concepto asiento', 'Nombre', 'NIF', 'Subcuenta ingresos 1', 'Nº factura',
  'Importe ingresos 1', 'Subcuenta ingresos 2', 'Importe ingresos 2', 'Ruta documento', 'Url documento', '',
  'Base IVA 1', '% IVA 1', 'Cuota IVA 1', 'Total factura', 'Fecha', 'Base IVA 2', '% IVA 2', 'Cuota IVA 2',
  'Tipo factura rectificativa', 'Tipo rectificación', 'Nº factura rectificada', 'Fecha factura rectificada',
]

/** Las filas del Excel (sin cabecera), con o sin la columna K (con `url`, esa en vez de la de prueba). */
export function filas({ conUrl, url = URL_PDF, facturas = FACTURAS }) {
  return facturas.map((f) => [
    CLIENTE.subcuenta, f.concepto, CLIENTE.nombre, CLIENTE.nif,
    f.ingresos[0].subcuenta, f.numero, f.ingresos[0].importe,
    f.ingresos[1]?.subcuenta ?? '', f.ingresos[1]?.importe ?? '',
    // Una prueba cada vez: con URL, J vacía; con ruta, K vacía.
    conUrl ? '' : `${CARPETA_WINDOWS}${f.numero}.pdf`, conUrl ? url : '', '',
    f.iva[0].base, f.iva[0].pct, f.iva[0].cuota, f.total, FECHA,
    f.iva[1]?.base ?? '', f.iva[1]?.pct ?? '', f.iva[1]?.cuota ?? '',
    f.rectifica?.tipoFactura ?? '', f.rectifica?.tipoRectificacion ?? '', f.rectifica?.numero ?? '', f.rectifica?.fecha ?? '',
  ])
}

export function libro(conUrl, o = {}) {
  // Sin fila de títulos (24/10, respuesta 5): Diez la lee como una factura más.
  const ws = XLSX.utils.aoa_to_sheet(filas({ conUrl, ...o }), { cellDates: true })
  for (const c of Object.keys(ws)) if (ws[c]?.t === 'd') ws[c].z = 'dd/mm/yyyy'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })
}

export function pdf(f) {
  const d = new jsPDF()
  d.setFontSize(14); d.text(`Factura ${f.numero} (PRUEBA C12, inventada)`, 15, 20)
  d.setFontSize(10)
  d.text(`Cliente: ${CLIENTE.nombre} · Fecha: 24/10/2026`, 15, 30)
  let y = 42
  for (const i of f.iva) { d.text(`Base ${i.base.toFixed(2)} € · IVA ${i.pct} % · cuota ${i.cuota.toFixed(2)} €`, 15, y); y += 7 }
  d.text(`Total: ${f.total.toFixed(2)} €`, 15, y + 3)
  if (f.rectifica) d.text(`Rectifica la ${f.rectifica.numero} (por diferencias).`, 15, y + 12)
  return new Uint8Array(d.output('arraybuffer'))
}

// La configuración de Julio, con las columnas nuevas. Los números de campo que
// Julio NO tenía asignados son una suposición por su orden en la pantalla
// (Ruta documento = Campo057, así que Url documento = Campo056; IVA 2 sigue al
// IVA 1, 010-012 → 013-015). Se comprueban en la pantalla (instrucciones).
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Configuracion_Excel_Expedidas xmlns="Configuracion_Excel_Expedidas">
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
    <Campo057>10</Campo057>
    <Campo056>11</Campo056>
    <Campo010>13</Campo010>
    <Campo011>14</Campo011>
    <Campo012>15</Campo012>
    <Campo013>18</Campo013>
    <Campo014>19</Campo014>
    <Campo015>20</Campo015>
  </Configuracion>
  <Configuracion2>
    <Campo009>
      <Emitidas/>
    </Campo009>
    <Campo034>
      <Retencion/>
    </Campo034>
    <Campo064>
      <TipoIdentificacion/>
    </Campo064>
    <Campo067>
      <Emitidas/>
    </Campo067>
    <Campo068>
      <TipoExencion/>
    </Campo068>
    <Campo072>
      <TipoFacturaRectificativa/>
    </Campo072>
    <Campo073>
      <TipoRectificacion/>
    </Campo073>
    <Campo116>
      <MedioCobPag/>
    </Campo116>
    <Campo120>
      <Emitidas/>
    </Campo120>
    <Campo121>
      <Emitidas/>
    </Campo121>
  </Configuracion2>
</Configuracion_Excel_Expedidas>
`

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(join(SALIDA, 'prueba-c12-url.xlsx'), libro(true))
  writeFileSync(join(SALIDA, 'ConfiguracionExpedidas-c12.XML'), XML.replace(/\n/g, '\r\n'))
  console.log(`Hecho: ${SALIDA} (3 facturas; Excel con URL; XML).`)
}
