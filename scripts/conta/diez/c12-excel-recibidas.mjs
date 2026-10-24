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
// Las columnas son las de la configuración de recibidas de Julio (24/10), con
// «Url documento» en la K (libre en la suya) y la retención detrás (T/U/V). La
// retención NO va en el XML porque no sabemos su código: se asigna a mano.
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

// Las columnas de la configuración de Julio (ConfiguracionRecibidas.XML, 24/10),
// tal cual, más «Url documento» en la K (libre en la suya) y la retención detrás:
//   A nº factura (006) · B fecha (001, 002) · C fecha (003) · D nombre (005) ·
//   E % IVA 1 (011) · F cuota IVA 1 (012) · G subcuenta proveedor (004) ·
//   H concepto (007) · I base IVA 1 (010) · J total (045) · K Url documento (056) ·
//   L subcuenta gasto 1 (041) · M importe gasto 1 (043) · N Ruta documento (057, vacía) ·
//   O/P/Q base/%/cuota IVA 2 (013–015) · R subcuenta gasto 2 (092) · S importe gasto 2 (094) ·
//   T/U/V base/%/cuota de la retención (a mano: no sabemos su código).
export const CABECERA = [
  'Nº factura', 'Fecha', 'Fecha', 'Nombre', '% IVA 1', 'Cuota IVA 1', 'Subcuenta proveedor', 'Concepto asiento',
  'Base IVA 1', 'Total factura', 'Url documento', 'Subcuenta gasto 1', 'Importe gasto 1', 'Ruta documento',
  'Base IVA 2', '% IVA 2', 'Cuota IVA 2', 'Subcuenta gasto 2', 'Importe gasto 2',
  'Base retención', '% retención', 'Cuota retención',
]

export function filas(url = URL_PDF) {
  return RECIBIDAS.map((f) => [
    f.numero, FECHA, FECHA, PROVEEDOR.nombre, f.iva[0].pct, f.iva[0].cuota, PROVEEDOR.subcuenta, f.concepto,
    f.iva[0].base, f.total, url, f.gastos[0].subcuenta, f.gastos[0].importe, '',
    f.iva[1]?.base ?? '', f.iva[1]?.pct ?? '', f.iva[1]?.cuota ?? '', f.gastos[1]?.subcuenta ?? '', f.gastos[1]?.importe ?? '',
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

// La configuración de Julio (24/10), sin tocar nada, más Campo056 = 11 (Url documento
// en la K, el mismo código que funcionó en emitidas). La retención, a mano.
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Configuracion_Excel_Recibidas xmlns="Configuracion_Excel_Recibidas">
  <Configuracion>
    <Campo001>2</Campo001>
    <Campo002>2</Campo002>
    <Campo003>3</Campo003>
    <Campo005>4</Campo005>
    <Campo006>1</Campo006>
    <Campo007>8</Campo007>
    <Campo004>7</Campo004>
    <Campo045>10</Campo045>
    <Campo041>12</Campo041>
    <Campo043>13</Campo043>
    <Campo092>18</Campo092>
    <Campo094>19</Campo094>
    <Campo057>14</Campo057>
    <Campo056>11</Campo056>
    <Campo010>9</Campo010>
    <Campo011>5</Campo011>
    <Campo012>6</Campo012>
    <Campo013>15</Campo013>
    <Campo014>16</Campo014>
    <Campo015>17</Campo015>
  </Configuracion>
  <Configuracion2>
    <Campo009>
      <Recibidas/>
    </Campo009>
    <Campo034>
      <Retencion/>
    </Campo034>
    <Campo064>
      <TipoIdentificacion/>
    </Campo064>
    <Campo067>
      <Recibidas/>
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
      <Recibidas/>
    </Campo120>
    <Campo121>
      <Recibidas/>
    </Campo121>
  </Configuracion2>
</Configuracion_Excel_Recibidas>
`

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of RECIBIDAS) if (!cuadra(f)) throw new Error(`${f.numero} no cuadra`)
  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(join(SALIDA, 'prueba-c12-recibidas-url.xlsx'), libro())
  writeFileSync(join(SALIDA, 'ConfiguracionRecibidas-c12.XML'), XML.replace(/\n/g, '\r\n'))
  console.log(`Hecho: ${SALIDA} (3 recibidas con Url documento; XML sin la retención, que se asigna a mano).`)
}
