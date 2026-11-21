// tests/conta/fixtures/socio/pdfLiquidacionSocio.mjs
//
// S01p·18 · Los documentos del cierre de un socio de marca, INVENTADOS, con la
// forma de los de verdad (la colocación de los cinco PDF de octubre de Alcalá,
// que no están en el repositorio): la autofactura, su factura y el «Detalle de
// transacción». Las cifras son las de octubre de Alcalá; la empresa es la A de
// staging (Taberna de Prueba Norte, B28000016) y el socio, «Marcas de Prueba»
// con un NIF inventado (T11).
//
// Se usa desde las unitarias (que los pasan por pdfjs y el lector de verdad) y
// desde la e2e.

import { jsPDF } from 'jspdf'

export const EMPRESA_A = 'B28000016'
export const SOCIO_NIF = 'B00000088'
const ALTO = 842

function documento(filas) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  for (const [y, ...trozos] of filas) for (const [x, t] of trozos) doc.text(t, x, ALTO - y)
  return Buffer.from(doc.output('arraybuffer'))
}

function factura(titulo, numero, desde, a, lineas, total) {
  const [serie, num] = numero.split('-')
  return documento([
    [746, [271, titulo]],
    [729, [271, 'Fecha: martes, 3 de noviembre de 2026']],
    [710, [271, `Nº de ${titulo === 'AUTOFACTURA' ? 'Autofactura' : 'Factura'}:`], [364, `${serie}-`], [381, num]],
    [659, [95, 'Facturar desde:'], [314, 'Facturar a:']],
    [642, [95, desde[0]], [314, a[0]]],
    [625, [95, 'Calle de Prueba 1,'], [314, 'Avenida Inventada 2,']],
    [593, [95, desde[1]], [314, a[1]]],
    [519, [80, 'Periodo: Desde 01/10/2026 Hasta 31/10/2026']],
    [485, [82, 'Concepto']],
    [483, [321, 'Base'], [377, 'IVA'], [441, 'Total']],
    ...lineas.map(([c, b, t, tot], i) => [459 - i * 24, [82, c], [296, b], [339, '€'], [357, t], [387, '%'], [418, tot], [462, '€']]),
    [459 - lineas.length * 24, [366, 'Total:'], [414, total], [461, '€']],
  ])
}

export const autofactura = () => factura('AUTOFACTURA', 'AF-02979', ['Taberna de Prueba Norte, S.L.', EMPRESA_A], ['Marcas de Prueba, SL', `CIF ${SOCIO_NIF}`], [
  ['Servicio por Ventas Multimarcas', '8.134,96', '10,00', '8.948,46'],
  ['Servicio por Ventas con Reparto Propio', '188,80', '10,00', '207,68'],
  ['Mercaderías Aportadas por el Partner', '1.999,07', '10,00', '2.198,98'],
  ['Delivery fee Ventas con Reparto Propio', '48,46', '10,00', '53,31'],
], '11.408,42')

export const suFactura = () => factura('FACTURA', 'FV-02979', ['Marcas de Prueba, SL', `CIF ${SOCIO_NIF}`], ['Taberna de Prueba Norte, S.L.', EMPRESA_A], [
  ['Mercaderías en Stock', '664,18', '4,00', '690,75'],
  ['Mercaderías en Stock', '4.147,25', '10,00', '4.561,98'],
  ['Mercaderías en Stock', '616,24', '21,00', '745,65'],
], '5.998,37')

/** El detalle de la transacción, con la línea de la financiación (770,00) y el saldo de octubre (6.180,05). */
export const transaccion = () => documento([
  [746, [271, 'DETALLE DE TRANSACCION']],
  [729, [271, 'Fecha: martes, 3 de noviembre de 2026']],
  [517, [80, 'Periodo: Desde 01/10/2026 Hasta 31/10/2026']],
  [483, [82, 'Concepto']], [481, [411, 'Total']],
  [457, [82, 'Auto Factura AF-'], [164, '02979'], [393, '11.408,42']],
  [433, [82, 'Factura Stock FV-'], [167, '02979'], [393, '-'], [397, '5.998,37']],
  [409, [82, 'Ventas Anticipadas en Efectivo'], [417, '0,00']],
  [385, [82, 'Financiación inventario pendiente por pagar'], [403, '770,00']],
  [361, [82, 'Saldo a Ingresar'], [384, '6.180,05'], [431, '€']],
  [293, [82, 'Términos y condiciones:']],
])
