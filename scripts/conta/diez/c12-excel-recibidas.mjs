#!/usr/bin/env node
// scripts/conta/diez/c12-excel-recibidas.mjs
//
// C12 · El Excel de PRUEBA para la importación de «Facturas recibidas» de Diez,
// solo para la C0009, con el PDF por «Url documento» (lo que funcionó en
// emitidas). Tres recibidas inventadas:
//   · PRB-C12-R001: normal, IVA 21 %;
//   · PRB-C12-R002: dos tipos de IVA (10 % y 21 %), dos cuentas de gasto;
//   · PRB-C12-R003: un profesional con retención de IRPF (15 %, tipo PRO).
//
// Segunda versión (24/10, respuesta 4). La primera fallaba en dos cosas:
//   · la C llevaba una fecha y en la configuración de Julio es el N.I.F.
//     (Campo003): salía «24102026» como N.I.F.;
//   · la retención no tenía columna de tipo, y la R003 entró sin ella y con
//     el asiento descuadrado en 30 €.
// Por eso ahora cada dato va a la columna que dice el XML de Julio, LEÍDA del
// XML, no puesta a mano: el XML es la única fuente. Y antes de escribir nada,
// el generador vuelve a leer el Excel ya hecho, por esas mismas columnas, y
// comprueba que cada asiento cuadra.
//
// Tercera versión (24/10, respuesta 5). En la segunda, Diez leyó la fila de
// títulos como una factura más, y la línea de los 30 € de la retención salió
// sin subcuenta. Ahora:
//   · sin fila de títulos: la fila 1 es la primera factura;
//   · la subcuenta de la retención va en la X (Campo038), y es la que Sumied
//     tiene enlazada a ese tipo de retención (company_account_link). Si un
//     tipo no la tiene, el generador para;
//   · también para si alguna línea del asiento va sin cuenta.
//
// Sale en docs/conta/c12/prueba-excel/:
//   · prueba-c12-recibidas-url.xlsx
//   · ConfiguracionRecibidas-c12.XML (el de Julio, tal cual)
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
/** El valor de «tipo de retención» que Julio asoció a profesionales (Campo034 · Valor01). */
export const TIPO_RETENCION = 'PRO'

/**
 * Cada tipo de retención de Sumied (withholding_rate.code): su valor en la
 * configuración de Diez y la subcuenta que Sumied tiene enlazada a ese tipo
 * (company_account_link, entity = 'withholding_rate'). Medido en producción,
 * solo leyendo, en la cuenta de Foodint (24/10): «Profesionales» (15 %) →
 * 47510015, traída de su Diez (source = migrated); «Alquiler de local» →
 * 47510019. Julio lo fijó así el 24/10 (respuesta 6). En el traspaso de
 * verdad se lee de la base, empresa a empresa.
 */
export const RETENCIONES = {
  profesional: { tipoDiez: TIPO_RETENCION, subcuenta: '47510015' },
  // Julio, 24/10: alquileres a la 47510019 (respuesta 6) con el valor ALQ
  // (respuesta 7), ya en su configuración definitiva.
  alquiler: { tipoDiez: 'ALQ', subcuenta: '47510019' },
}

/** Los valores de tipo de retención que conoce la configuración (Configuracion2 › Campo034 › ValorNN). */
export function tiposRetencionDelXml(xml) {
  const b = xml.match(/<Configuracion2>[\s\S]*?<Campo034>([\s\S]*?)<\/Campo034>/)?.[1] ?? ''
  return [...b.matchAll(/<Valor\d+>([^<]+)<\/Valor\d+>/g)].map((m) => m[1])
}

/**
 * La subcuenta y el valor de Diez de un tipo de retención, o para:
 *   · sin subcuenta, Diez deja la línea sin cuenta (2.ª prueba);
 *   · con un valor que la configuración no conoce, Diez deja fuera la
 *     retención y el asiento descuadra (1.ª prueba, los 30 €).
 */
export function subcuentaRetencion(codigo, tabla = RETENCIONES, xml = XML) {
  const r = tabla[codigo]
  if (!r?.subcuenta) throw new Error(`El tipo de retención «${codigo}» no tiene subcuenta en Sumied: el asiento saldría con una línea sin cuenta.`)
  if (!r.tipoDiez) throw new Error(`El tipo de retención «${codigo}» no tiene su valor en la configuración de Diez.`)
  if (!tiposRetencionDelXml(xml).includes(r.tipoDiez)) throw new Error(`La configuración de recibidas no conoce el valor «${r.tipoDiez}» (${codigo}): Diez dejaría fuera la retención y el asiento descuadraría.`)
  return r
}

/** Las tres recibidas. */
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
    iva: [{ base: 200, pct: 21, cuota: 42 }], retencion: { codigo: 'profesional', base: 200, pct: 15, cuota: 30 }, total: 212,
  },
]

// La configuración DEFINITIVA de Julio (ConfiguracionRecibidas.XML, 24/10: con la X, PRO y ALQ), TAL CUAL.
export const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
    <Campo034>23</Campo034>
    <Campo038>24</Campo038>
    <Campo035>20</Campo035>
    <Campo036>21</Campo036>
    <Campo037>22</Campo037>
    <Campo041>12</Campo041>
    <Campo043>13</Campo043>
    <Campo092>18</Campo092>
    <Campo094>19</Campo094>
    <Campo056>11</Campo056>
    <Campo057>14</Campo057>
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
      <Valor01>PRO</Valor01>
      <Valor02>ALQ</Valor02>
      <Situacion01>0</Situacion01>
      <Situacion02>0</Situacion02>
      <Situacion03>PRO</Situacion03>
      <Situacion04>ALQ</Situacion04>
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

/** Qué es cada código de la configuración, con lo que pone Julio en su pantalla. */
export const CAMPOS = {
  '006': 'Nº factura', '001': 'Fecha expedición', '002': 'Fecha operación', '003': 'N.I.F.', '005': 'Nombre',
  '011': '% IVA 1', '012': 'Cuota IVA 1', '004': 'Subcuenta proveedor', '007': 'Concepto asiento',
  '010': 'Base IVA 1', '045': 'Total factura', '056': 'Url documento', '041': 'Subcuenta gasto 1',
  '043': 'Importe gasto 1', '057': 'Ruta documento', '013': 'Base IVA 2', '014': '% IVA 2', '015': 'Cuota IVA 2',
  '092': 'Subcuenta gasto 2', '094': 'Importe gasto 2', '035': 'Base retención', '036': '% retención',
  '037': 'Cuota retención', '034': 'Tipo retención', '038': 'Subcuenta retención',
}

/** Código → columna (1 = A), leído del bloque <Configuracion> del XML. */
export function columnas(xml = XML) {
  const bloque = xml.match(/<Configuracion>([\s\S]*?)<\/Configuracion>/)?.[1]
  if (!bloque) throw new Error('El XML no trae <Configuracion>')
  const m = {}
  for (const [, cod, col] of bloque.matchAll(/<Campo(\d{3})>(\d+)<\/Campo\1>/g)) m[cod] = Number(col)
  return m
}

/** Lo que va en cada código, para una recibida. Vacío = no lleva. */
export function valores(f, url = URL_PDF) {
  const ret = f.retencion ? subcuentaRetencion(f.retencion.codigo) : null
  return {
    '006': f.numero, '001': FECHA, '002': FECHA, '003': PROVEEDOR.nif, '005': PROVEEDOR.nombre,
    '011': f.iva[0].pct, '012': f.iva[0].cuota, '004': PROVEEDOR.subcuenta, '007': f.concepto,
    '010': f.iva[0].base, '045': f.total, '056': url,
    '041': f.gastos[0].subcuenta, '043': f.gastos[0].importe, '057': '',
    '013': f.iva[1]?.base ?? '', '014': f.iva[1]?.pct ?? '', '015': f.iva[1]?.cuota ?? '',
    '092': f.gastos[1]?.subcuenta ?? '', '094': f.gastos[1]?.importe ?? '',
    '035': f.retencion?.base ?? '', '036': f.retencion?.pct ?? '', '037': f.retencion?.cuota ?? '',
    '034': ret?.tipoDiez ?? '', '038': ret?.subcuenta ?? '',
  }
}

const mismo = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)

/** Coloca un objeto código → valor en una fila, por las columnas del XML. Para si dos códigos chocan con valores distintos. */
function colocar(v, col) {
  const ancho = Math.max(...Object.values(col))
  const fila = Array(ancho).fill('')
  const quien = Array(ancho).fill(null)
  for (const [cod, x] of Object.entries(v)) {
    if (!(cod in col)) throw new Error(`El código ${cod} (${CAMPOS[cod]}) no tiene columna en el XML`)
    const i = col[cod] - 1
    if (quien[i] !== null && !mismo(fila[i], x)) throw new Error(`La columna ${i + 1} es de ${quien[i]} y de ${cod} con valores distintos`)
    fila[i] = x
    quien[i] = cod
  }
  return fila
}

/** Los títulos de cada columna, solo para leerlo aquí: el Excel va SIN fila de títulos (Diez la lee como una factura). */
export function cabecera(col = columnas()) {
  const c = Array(Math.max(...Object.values(col))).fill('')
  for (const [cod, i] of Object.entries(col)) c[i - 1] = c[i - 1] ? `${c[i - 1]} / ${CAMPOS[cod] ?? cod}` : (CAMPOS[cod] ?? cod)
  return c
}

export function filas(url = URL_PDF, col = columnas()) {
  return RECIBIDAS.map((f) => colocar(valores(f, url), col))
}

export function libro(col = columnas()) {
  const ws = XLSX.utils.aoa_to_sheet(filas(URL_PDF, col), { cellDates: true })
  for (const k of Object.keys(ws)) if (ws[k]?.t === 'd') ws[k].z = 'dd/mm/yyyy'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Recibidas')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })
}

const ct = (x) => (x === '' || x === undefined || x === null ? 0 : Math.round(Number(x) * 100))

/**
 * Lee el Excel YA ESCRITO por las columnas del XML y monta el asiento como lo
 * monta Diez: al debe los gastos y las cuotas de IVA; al haber el proveedor por
 * el «Total factura» y la retención por su cuota. (Que el total va tal cual al
 * proveedor lo dijo la primera prueba: sin retención, la R003 descuadró en
 * 30 €, o sea 242 al debe contra 212 al haber.)
 * Devuelve un problema por frase; vacío = todo cuadra.
 */
export function revisar(buffer, col = columnas()) {
  const wb = XLSX.read(buffer, { cellDates: true })
  // Sin fila de títulos: todas las filas son facturas.
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
  const mal = []
  const lee = (r, cod) => r[col[cod] - 1]
  if (rs.length !== RECIBIDAS.length) mal.push(`hay ${rs.length} filas y se esperaban ${RECIBIDAS.length}`)
  for (const r of rs) {
    const n = lee(r, '006')
    const debe = ct(lee(r, '043')) + ct(lee(r, '094')) + ct(lee(r, '012')) + ct(lee(r, '015'))
    const haber = ct(lee(r, '045')) + ct(lee(r, '037'))
    if (debe !== haber) mal.push(`${n}: el asiento no cuadra (debe ${debe / 100}, haber ${haber / 100})`)
    // Cada línea del asiento con importe, con su cuenta. (Las de IVA las pone
    // Diez por el tipo de su configuración: el Excel no lleva su cuenta.)
    const lineas = [
      ['gasto 1', '043', '041'], ['gasto 2', '094', '092'], ['proveedor', '045', '004'], ['retención', '037', '038'],
    ]
    for (const [qué, imp, cta] of lineas) {
      if (ct(lee(r, imp)) !== 0 && !/^[0-9]{6,12}$/.test(String(lee(r, cta)))) mal.push(`${n}: la línea de ${qué} va sin cuenta (columna ${XLSX.utils.encode_col(col[cta] - 1)})`)
    }
    if (ct(lee(r, '043')) + ct(lee(r, '094')) !== ct(lee(r, '010')) + ct(lee(r, '013'))) mal.push(`${n}: los gastos no suman las bases`)
    if (ct(lee(r, '012')) !== Math.round(Number(lee(r, '010')) * Number(lee(r, '011')))) mal.push(`${n}: la cuota de IVA 1 no es base × %`)
    if (lee(r, '013') !== '' && ct(lee(r, '015')) !== Math.round(Number(lee(r, '013')) * Number(lee(r, '014')))) mal.push(`${n}: la cuota de IVA 2 no es base × %`)
    const conRet = lee(r, '037') !== ''
    if (conRet && ct(lee(r, '037')) !== Math.round(Number(lee(r, '035')) * Number(lee(r, '036')))) mal.push(`${n}: la cuota de retención no es base × %`)
    if (conRet !== (lee(r, '034') === TIPO_RETENCION)) mal.push(`${n}: retención sin su tipo ${TIPO_RETENCION}, o tipo sin retención`)
    if (typeof lee(r, '045') !== 'number') mal.push(`la fila «${n}» no es una factura (sin total numérico): ¿una fila de títulos? Diez la leería como una factura más`)
    if (!/^[A-Z0-9][0-9]{7}[A-Z0-9]$/.test(String(lee(r, '003')))) mal.push(`${n}: el N.I.F. (columna ${col['003']}) no parece un N.I.F.: «${lee(r, '003')}»`)
    if (!(lee(r, '001') instanceof Date)) mal.push(`${n}: la fecha (columna ${col['001']}) no es una fecha`)
    if (String(lee(r, '004')) !== PROVEEDOR.subcuenta) mal.push(`${n}: la subcuenta del proveedor no es la ${PROVEEDOR.subcuenta}`)
    if (!/^https:\/\//.test(String(lee(r, '056')))) mal.push(`${n}: sin «Url documento»`)
  }
  return mal
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const buf = libro()
  const mal = revisar(buf)
  if (mal.length) {
    for (const m of mal) console.error(`✗ ${m}`)
    process.exit(1)
  }
  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(join(SALIDA, 'prueba-c12-recibidas-url.xlsx'), buf)
  writeFileSync(join(SALIDA, 'ConfiguracionRecibidas-c12.XML'), XML.replace(/\n/g, '\r\n'))
  console.log(`Hecho: ${SALIDA}. Las ${RECIBIDAS.length} recibidas, leídas de vuelta por las columnas del XML de Julio: cuadran.`)
}
