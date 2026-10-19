// tests/conta/fixtures/justificantes/pdfJustificante.mjs
//
// I01c · P1 · Justificantes de presentación de la AEAT INVENTADOS, con la forma
// de los de verdad: una primera página con la presentación («Modelo NNN»,
// «Presentación realizada el: …», CSV, número de justificante y el NIF del
// PRESENTADOR, que no es el del declarante: la trampa que el lector no puede
// coger) y una segunda con el impreso: identificación (NIF, nombre, ejercicio,
// período) y cada casilla como su número y, a la derecha, su importe; las
// vacías, solo con el número. Las posiciones del 303 siguen la página 2 de un
// 303 presentado (la del 19/10, que no está en el repositorio).
//
// Ningún dato real: la empresa es la A de staging (Taberna de Prueba Norte,
// B28000016), los CSV empiezan por PRUEBA y los justificantes por 999.
//
// Se usa desde las pruebas unitarias, desde generar.mjs (que deja los PDF en
// esta carpeta) y desde la e2e.

import { jsPDF } from 'jspdf'

const es = (n) => {
  const [e, d] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`
}

/** Las filas del impreso de cada modelo: [rótulo, [casilla, casilla, …]] (null = celda gris, sin casilla). */
const FILAS = {
  '303': [
    ['IVA devengado · Régimen general', ['150', '151', '152']],
    ['', ['165', '166', '167']],
    ['', ['01', '02', '03']],
    ['', ['153', '154', '155']],
    ['', ['04', '05', '06']],
    ['', ['07', '08', '09']],
    ['Adquisiciones intracomunitarias de bienes y servicios', ['10', null, '11']],
    ['Otras operaciones con inversión del sujeto pasivo', ['12', null, '13']],
    ['Modificación bases y cuotas', ['14', null, '15']],
    ['Total cuota devengada', [null, null, '27']],
    ['IVA deducible · Operaciones interiores corrientes', ['28', null, '29']],
    ['Operaciones interiores con bienes de inversión', ['30', null, '31']],
    ['Importaciones de bienes corrientes', ['32', null, '33']],
    ['Adquisiciones intracomunitarias corrientes', ['36', null, '37']],
    ['Rectificación de deducciones', ['40', null, '41']],
    ['Total a deducir', [null, null, '45']],
    ['Resultado régimen general', [null, null, '46']],
    ['Suma de resultados', [null, null, '64']],
    ['Atribuible a la Administración del Estado', [null, '65', '66']],
    ['Cuotas a compensar pendientes de periodos anteriores', [null, null, '110']],
    ['Cuotas a compensar aplicadas en este periodo', [null, null, '78']],
    ['Cuotas pendientes de compensación a final del periodo', [null, null, '87']],
    ['Resultado', [null, null, '69']],
    ['Resultado de la liquidación', [null, null, '71']],
  ],
  '111': [
    ['Rendimientos del trabajo · dinerarios', ['01', '02', '03']],
    ['Rendimientos del trabajo · en especie', ['04', '05', '06']],
    ['Actividades económicas · dinerarios', ['07', '08', '09']],
    ['Actividades económicas · en especie', ['10', '11', '12']],
    ['Suma de retenciones', [null, null, '28']],
    ['A deducir (complementaria)', [null, null, '29']],
    ['Resultado a ingresar', [null, null, '30']],
  ],
  '115': [
    ['Retenciones e ingresos a cuenta', ['01', '02', '03']],
    ['A deducir (complementaria)', [null, null, '04']],
    ['Resultado a ingresar', [null, null, '05']],
  ],
  '202': [
    ['Base del pago fraccionado', [null, null, '01']],
    ['Porcentaje', [null, null, '02']],
    ['Resultado de la liquidación', [null, null, '03']],
    ['Pagos fraccionados anteriores', [null, null, '04']],
    ['A ingresar', [null, null, '05']],
  ],
}

const TITULOS = {
  '303': 'Impuesto sobre el Valor Añadido · Autoliquidación',
  '111': 'Retenciones e ingresos a cuenta · Rendimientos del trabajo y actividades económicas',
  '115': 'Retenciones e ingresos a cuenta · Arrendamiento de inmuebles urbanos',
  '202': 'Impuesto sobre Sociedades · Pago fraccionado',
}

/**
 * Un justificante inventado.
 * j = { modelo, ejercicio, periodo, nif, nombre, presentada: 'dd-mm-aaaa hh:mm:ss', csv, justificante, casillas: { '27': 1234.5, … } }
 * opciones.sinImpreso: solo la primera página (para «no se leen las casillas»).
 */
export function justificantePdf(j, opciones = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const [fecha, hora] = j.presentada.split(' ')
  // ── Página 1: la presentación ──
  doc.setFontSize(16)
  doc.text('Agencia Tributaria', 60, 70)
  doc.setFontSize(12)
  doc.text('Justificante de presentación', 60, 100)
  doc.setFontSize(11)
  doc.text(`Modelo ${j.modelo}`, 60, 140)
  doc.text(`Presentación realizada el: ${fecha} a las ${hora}`, 60, 165)
  doc.text(`Expediente/Referencia (nº registro asignado): 2026PRUEBA${j.modelo}${j.periodo}`, 60, 190)
  doc.text(`Código Seguro de Verificación: ${j.csv}`, 60, 215)
  doc.text(`Número de justificante: ${j.justificante}`, 60, 240)
  // El presentador (la gestoría): otro NIF, que el lector no puede tomar por el de la empresa.
  doc.text('Presentador: 00000000T GESTORIA INVENTADA DE PRUEBA', 60, 265)
  doc.text(`Declarante: ${j.nombre}`, 60, 290)
  if (opciones.sinImpreso) return doc.output('arraybuffer')

  // ── Página 2: el impreso ──
  doc.addPage()
  doc.setFontSize(14)
  doc.text(`Modelo ${j.modelo}`, 470, 60)
  doc.setFontSize(9)
  doc.text(TITULOS[j.modelo] ?? '', 140, 60)
  doc.text('Identificación (1)', 40, 105)
  doc.text('Devengo (2)', 360, 120)
  doc.text('Ejercicio', 420, 120)
  doc.text(String(j.ejercicio), 460, 120)
  doc.text('Período', 510, 120)
  doc.text(j.periodo, 545, 120)
  doc.text('NIF', 40, 140)
  doc.text('Apellidos y nombre o Razón social', 150, 140)
  doc.text(j.nif, 40, 155)
  doc.text(j.nombre, 150, 155)
  doc.text(`Número justificante: ${j.justificante}`, 380, 178)
  doc.text('Liquidación (3)', 40, 215)
  doc.text('Base imponible', 320, 232)
  doc.text('Tipo %', 425, 232)
  doc.text('Cuota', 520, 232)
  let y = 250
  for (const [rotulo, cajas] of FILAS[j.modelo] ?? []) {
    if (rotulo) doc.text(rotulo, 40, y)
    // Tres columnas, como el impreso: casilla a la izquierda de su celda, importe pegado a la derecha.
    const cols = [[300, 395], [400, 460], [465, 560]]
    cajas.forEach((caja, i) => {
      if (!caja) return
      doc.text(caja, cols[i][0], y)
      const v = j.casillas[caja]
      if (v !== undefined && v !== null) doc.text(es(v), cols[i][1], y, { align: 'right' })
    })
    y += 18
  }
  doc.setFontSize(7)
  doc.text(`La autenticidad de este documento puede ser comprobada mediante el Código Seguro`, 150, 800)
  doc.text(`de Verificación ${j.csv} en https://sede.agenciatributaria.gob.es`, 150, 810)
  doc.text('2', 560, 815)
  return doc.output('arraybuffer')
}

/** Un PDF que no es un justificante: una factura cualquiera. */
export function otroDocumentoPdf() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text('FACTURA F-2026-0001', 60, 80)
  doc.setFontSize(10)
  doc.text('Suministros Inventados, S.L. · B00000000', 60, 110)
  doc.text('Base imponible 100,00 · IVA 21 % 21,00 · Total 121,00', 60, 140)
  return doc.output('arraybuffer')
}

/** Un PDF sin texto (como un escaneado): solo un rectángulo. */
export function sinTextoPdf() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.rect(60, 60, 300, 200)
  return doc.output('arraybuffer')
}

const EMPRESA_A = { nif: 'B28000016', nombre: 'TABERNA DE PRUEBA NORTE, S.L.' }

/**
 * Los justificantes de la e2e y de las pruebas: los del 2025 de la empresa A
 * (inventados). La cartera del 303 cuadra como la de una empresa real: el 3T
 * sale a compensar, el 4T aplica una parte.
 */
export const JUSTIFICANTES_A = {
  '303-3T-2025': { ...EMPRESA_A, modelo: '303', ejercicio: 2025, periodo: '3T', presentada: '20-10-2025 11:02:41', csv: 'PRUEBA3T2025AAAA', justificante: '9993030000003',
    casillas: { '04': 52100.4, '05': 10, '06': 5210.04, '07': 8000, '08': 21, '09': 1680, '27': 6890.04, '28': 41200, '29': 8652, '45': 8652, '46': -1761.96, '64': -1761.96, '65': 100, '66': -1761.96, '110': 300, '78': 0, '87': 300, '69': -1761.96, '71': -1761.96 } },
  '303-4T-2025': { ...EMPRESA_A, modelo: '303', ejercicio: 2025, periodo: '4T', presentada: '30-01-2026 09:15:07', csv: 'PRUEBA4T2025BBBB', justificante: '9993030000004',
    casillas: { '04': 61000, '05': 10, '06': 6100, '10': 150, '11': 31.5, '27': 6131.5, '28': 27000, '29': 5670, '36': 150, '37': 31.5, '45': 5701.5, '46': 430, '64': 430, '65': 100, '66': 430, '110': 2061.96, '78': 430, '87': 1631.96, '69': 0, '71': 0 } },
  '111-3T-2025': { ...EMPRESA_A, modelo: '111', ejercicio: 2025, periodo: '3T', presentada: '20-10-2025 11:05:12', csv: 'PRUEBA111T3CCCCC', justificante: '9991110000003',
    casillas: { '01': 3, '02': 14250, '03': 1567.5, '07': 1, '08': 900, '09': 135, '28': 1702.5, '30': 1702.5 } },
  '115-3T-2025': { ...EMPRESA_A, modelo: '115', ejercicio: 2025, periodo: '3T', presentada: '20-10-2025 11:06:30', csv: 'PRUEBA115T3DDDDD', justificante: '9991150000003',
    casillas: { '01': 1, '02': 4500, '03': 855, '05': 855 } },
  '202-3P-2025': { ...EMPRESA_A, modelo: '202', ejercicio: 2025, periodo: '3P', presentada: '19-12-2025 10:40:00', csv: 'PRUEBA2023PEEEEE', justificante: '9992020000003',
    casillas: { '01': 12000, '02': 18, '03': 2160, '04': 1200, '05': 960 } },
}
