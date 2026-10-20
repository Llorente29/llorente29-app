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

/** Un NRC inventado (22 caracteres): el lector no lo lee, y la prueba comprueba que no sale en nada de lo leído. */
export const NRC_INVENTADO = 'PRUEBA0NRC0000000000ZZ'

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
 * opciones.impresoImagen: la segunda página sin texto, como un 202 real.
 * opciones.declaranteEnPrimera: la primera página con NIF, ejercicio y periodo.
 * opciones.sinNrc: sin la línea «NRC: … IMPORTE:» (sale a cero o a devolver).
 * opciones.nrcImporte: otro importe en la línea del NRC (para que no case con la casilla).
 * opciones.reimpreso: como lo deja «Microsoft Print to PDF» (I01c, 19/10): los
 *   rótulos y el impreso, dibujo (aquí, rayas); como texto, solo los valores,
 *   sin «Modelo», «Ejercicio», «Período» ni números de casilla. El CSV se
 *   conserva: en la primera página y al pie de la segunda.
 * opciones.sede: el ORIGINAL que da Hacienda por su CSV del 111, el 115 y el
 *   202, con la estructura medida el 19/10 (run 39296209103: rótulos, orden y
 *   posiciones, sin un valor; ver sedePdf).
 * La línea del NRC va cuando hay algo que ingresar, con un NRC INVENTADO.
 */
export function justificantePdf(j, opciones = {}) {
  if (opciones.reimpreso) return reimpresoPdf(j)
  if (opciones.sede) return sedePdf(j)
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
  doc.text(`Declarante: ${opciones.declaranteEnPrimera ? `${j.nif} ` : ''}${j.nombre}`, 60, 290)
  if (opciones.declaranteEnPrimera) doc.text(`Ejercicio: ${j.ejercicio}   Periodo: ${j.periodo}`, 60, 315)
  const resultado = opciones.nrcImporte ?? j.casillas[{ '303': '71', '111': '30', '115': '05', '202': '05' }[j.modelo]]
  if (!opciones.sinNrc && resultado > 0) doc.text(`NRC: ${NRC_INVENTADO}   IMPORTE: ${es(resultado)}`, 60, 340)
  if (opciones.sinImpreso) return doc.output('arraybuffer')
  if (opciones.impresoImagen) {
    doc.addPage()
    doc.rect(40, 40, 515, 760)
    return doc.output('arraybuffer')
  }

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

/** El reimpreso: solo valores como texto (ver justificantePdf, opciones.reimpreso). */
function reimpresoPdf(j) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const [fecha, hora] = j.presentada.split(' ')
  const dibujo = (y) => { doc.setDrawColor(180); doc.line(60, y + 3, 250, y + 3) }
  doc.setFontSize(11)
  ;[[fecha + ' ' + hora, 165], ['2026PRUEBA' + j.modelo + j.periodo, 190], [j.csv, 215], [j.justificante, 240], ['00000000T GESTORIA INVENTADA DE PRUEBA', 265]]
    .forEach(([v, y]) => { dibujo(y); doc.text(v, 260, y) })
  doc.addPage()
  doc.rect(40, 40, 515, 760)
  doc.setFontSize(9)
  doc.text(String(j.ejercicio), 460, 120)
  doc.text(j.periodo, 545, 120)
  doc.text(j.nif, 40, 155)
  let y = 250
  for (const [, cajas] of FILAS[j.modelo] ?? []) {
    cajas.forEach((caja, i) => {
      const v = caja ? j.casillas[caja] : undefined
      if (v !== undefined && v !== null) doc.text(es(v), [395, 460, 560][i], y, { align: 'right' })
    })
    y += 18
  }
  doc.setFontSize(7)
  doc.text(j.csv, 300, 810)
  return doc.output('arraybuffer')
}

/**
 * El original de Hacienda del 111, el 115 y el 202, como lo da la consulta por
 * CSV. La estructura es la medida el 19/10 (run 39296209103): de cada línea, la
 * clase de cada palabra y su posición, nunca su valor. Las posiciones de aquí
 * son esas (x e y del PDF, con el origen abajo); los valores, los inventados de
 * la empresa A. Lo que el lector tiene que coger:
 *   · página 1: la presentación (igual en los tres) y, en el 202, la línea
 *     «NRC: … IMPORTE: …», lo ingresado;
 *   · 111: «Ejercicio · Período ·» en una línea y «2025 3T» 4 puntos más abajo;
 *     cada fila, «01 3 02 14.250,00 03 1.567,50»; el total, «03 + 06 + … = 28
 *     importe»; el resultado, «( 28 - 29 ) 30 importe»;
 *   · 115: «Ejercicio · 2025» en la misma línea; las casillas, con UNA cifra
 *     («1»…«5») en una columna y su importe en otra, a veces 3 puntos más abajo;
 *   · 202: «Ejercicio · 2025» en la misma línea y «01 importe» por fila.
 * Y las trampas de verdad: encima de la cabecera, una tira de cifras sueltas
 * («10 1 2 3…»); el nombre del presentador, en la línea de debajo de su NIF.
 */
function sedePdf(j) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const t = (texto, x, y) => doc.text(String(texto), x, 842 - y)
  const [fecha, hora] = j.presentada.split(' ')
  const v = (caja) => (j.casillas[caja] === undefined ? null : es(j.casillas[caja]))
  const pie = () => {
    doc.setFontSize(7)
    t('La autenticidad de este documento puede ser comprobada mediante el Código Seguro', 163, 20)
    t(String(doc.getNumberOfPages()), 562, 16)
    t(`de Verificación ${j.csv} en https://sede.agenciatributaria.gob.es`, 176, 10)
  }
  // ── Página 1: la presentación ──
  doc.setFontSize(11)
  t('Justificante de la presentación de la declaración', 159, 771)
  t(`Modelo ${j.modelo}`, 304, 731)
  t('Registro', 42, 701)
  t('Presentación realizada el:', 62, 683); t(`${fecha} a las ${hora}`, 185, 683)
  t('Expediente/Referencia (nº registro asignado):', 62, 663); t(`2026PRUEBA${j.modelo}${j.periodo}`, 278, 663)
  t('Código Seguro de Verificación:', 62, 643); t(j.csv, 211, 643)
  t('Número de justificante:', 62, 623); t(j.justificante, 173, 623)
  t('Forma de', 62, 603); t('presentación por Internet', 134, 603)
  t('Presentador', 42, 571)
  t('NIF Presentador:', 62, 553); t('00000000T', 143, 553)
  t('Apellidos y nombre / Razón social:', 62, 533); t('GESTORIA INVENTADA DE PRUEBA', 229, 533)
  t('En calidad de:', 62, 513); t('Colaborador', 130, 513)
  if (j.modelo === '202') {
    t('Ingresar', 42, 488)
    t(`NRC: ${NRC_INVENTADO} IMPORTE: ${es(j.casillas['03'] ?? 0)}`, 42, 475)
  } else t('Domiciliación del importe a ingresar', 42, 488)
  pie()

  // ── Página 2: el impreso ──
  doc.addPage()
  doc.setFontSize(8)
  t(`Modelo ${j.modelo}`, j.modelo === '111' ? 532 : j.modelo === '115' ? 522 : 533, 786)
  t('Agencia Tributaria', 109, 795)
  // La trampa: la tira de cifras sueltas de la cabecera (una casilla «10» seguida de «1» no es nada).
  t('Código de barras', 28, 781); t('10', 73, 781); [1, 2, 3, 4, 5, 6, 7].forEach((n, i) => t(n, 106 + i * 4, 781))
  if (j.modelo === '111') {
    t('1', 363, 726); t('Ejercicio', 373, 726); t('.', 407, 726); t('Período .', 488, 726)
    t(j.ejercicio, 423, 722); t(j.periodo, 540, 722)
    t('Devengo', 353, 714)
    t('Declarante', 35, 660)
    t(`Número de justificante: ${j.justificante}`, 372, 657)
    t('NIF', 50, 637); t('Apellidos y nombre o razón social', 165, 637)
    t(j.nif, 67, 627); t(j.nombre, 169, 627)
    const filas = [['Rendimientos dinerarios .', ['01', '02', '03'], 581], ['Rendimientos en especie .', ['04', '05', '06'], 558],
      ['Actividades dinerarios .', ['07', '08', '09'], 522], ['Actividades en especie .', ['10', '11', '12'], 498],
      ['Premios dinerarios .', ['13', '14', '15'], 450], ['Premios en especie .', ['16', '17', '18'], 426],
      ['Ganancias dinerarias .', ['19', '20', '21'], 378], ['Ganancias en especie .', ['22', '23', '24'], 354],
      ['Contraprestaciones dinerarias o en especie .', ['25', '26', '27'], 307]]
    for (const [rotulo, [a, b, c], y] of filas) {
      t('Nº de perceptores / Importe de las percepciones / Importe de las retenciones', 280, y + 12)
      t(rotulo, 65, y)
      t(a, 264, y); if (j.casillas[a] !== undefined) t(j.casillas[a], 326, y)
      t(b, 347, y); if (v(b)) t(v(b), 405, y)
      t(c, 461, y); if (v(c)) t(v(c), 533, y)
    }
    t('Total liquidación:', 50, 276)
    t('Suma de retenciones e ingresos a cuenta :', 130, 271)
    t('03 + 06 + 09 + 12 + 15 + 18 + 21 + 24 + 27 = 28', 259, 271); if (v('28')) t(v('28'), 534, 271)
    t('A deducir (exclusivamente en caso de autoliquidación complementaria) :', 121, 259)
    t('Resultados a ingresar de anteriores autoliquidaciones por el mismo concepto, ejercicio y periodo :', 130, 247); t('29', 461, 247)
    t('Resultado a ingresar ( 28 - 29 ) :', 130, 223); t('30', 461, 223); if (v('30')) t(v('30'), 535, 223)
    t('Importe del ingreso ( I )', 63, 163); if (v('30')) t(v('30'), 259, 163)
    t('Casilla 30 :', 63, 154)
  } else if (j.modelo === '115') {
    t('Ejercicio .', 411, 668); t(j.ejercicio, 495, 668)
    t('Período .', 411, 641); t(j.periodo, 491, 641)
    t('Devengo 2', 384, 637)
    t(`Número justificante: ${j.justificante}`, 391, 590)
    t('Identificación (1) NIF', 34, 547); t('Apellidos y nombre o razón social', 177, 547)
    t(j.nif, 51, 533); t(j.nombre, 180, 533)
    t('Retenciones e ingresos a cuenta', 50, 445)
    t('Nº de perceptores .', 58, 425); t('1', 408, 425); if (j.casillas['01'] !== undefined) t(j.casillas['01'], 531, 425)
    t('2', 407, 398); if (v('02')) t(v('02'), 501, 398)
    t('Base de las retenciones e ingresos a cuenta .', 58, 395)
    t('Retenciones e ingresos a cuenta .', 58, 370); t('3', 408, 370)
    if (v('03')) t(v('03'), 501, 367)
    t('Liquidación 3 A deducir (exclusivamente en caso de declaración complementaria):', 36, 348)
    t('4', 406, 341)
    t('Resultados a ingresar de la anterior o anteriores declaraciones del mismo ejercicio y período', 58, 338)
    t('Resultado a ingresar ( 3 - 4 ) .', 58, 313); t('5', 407, 313); if (v('05')) t(v('05'), 501, 313)
    t('Importe: €', 322, 168); if (v('05')) t(v('05'), 502, 168)
  } else {
    t('Número justificante:', 348, 725); t(j.justificante, 420, 725)
    t('Identificación 1', 42, 712); t('Devengo 2', 359, 712)
    t('NIF', 34, 696); t('Apellidos y nombre o razón social', 141, 696); t('Ejercicio .', 361, 696); t(j.ejercicio, 488, 696)
    t(j.nif, 33, 684); t(j.nombre, 139, 684)
    t('Período .', 361, 679); t(j.periodo, 520, 679)
    t('Tipo: 1P, 2P y anual', 350, 668)
    t('Liquidación 3', 43, 322)
    t('Base del pago fraccionado .', 37, 266); t('01', 465, 266); if (v('01')) t(v('01'), 529, 266)
    t('Resultado de la declaración anterior (complementaria) .', 37, 254); t('02', 465, 254)
    t('A ingresar .', 37, 242); t('03', 465, 242); if (v('03')) t(v('03'), 537, 242)
  }
  pie()
  if (j.modelo === '202') {
    doc.addPage()
    doc.setFontSize(8)
    t('Bonificaciones del periodo total .', 35, 522); t('20', 464, 522)
    t('Retenciones e ingresos a cuenta del periodo total .', 35, 510); t('21', 464, 510)
    t('Pagos fraccionados anteriores del periodo en curso total .', 35, 487); t('22', 464, 487)
    pie()
  }
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

/**
 * Los originales de Hacienda inventados del 111, el 115 y el 202 (opciones.sede),
 * de la empresa A. El 202 con la numeración del original: [01] base, [03] a
 * ingresar (lo de la línea del NRC).
 */
export const JUSTIFICANTES_SEDE = {
  '111-1T-2026': { ...EMPRESA_A, modelo: '111', ejercicio: 2026, periodo: '1T', presentada: '20-04-2026 10:05:12', csv: 'PRUEBASEDE111AAA', justificante: '9991110000101',
    casillas: { '01': 3, '02': 14250, '03': 1567.5, '07': 1, '08': 900, '09': 135, '28': 1702.5, '30': 1702.5 } },
  '115-1T-2026': { ...EMPRESA_A, modelo: '115', ejercicio: 2026, periodo: '1T', presentada: '20-04-2026 10:06:30', csv: 'PRUEBASEDE115BBB', justificante: '9991150000101',
    casillas: { '01': 1, '02': 4500, '03': 855, '05': 855 } },
  '202-1P-2026': { ...EMPRESA_A, modelo: '202', ejercicio: 2026, periodo: '1P', presentada: '20-04-2026 10:40:00', csv: 'PRUEBASEDE202CCC', justificante: '9992020000101',
    casillas: { '01': 6000, '03': 1080 } },
}
