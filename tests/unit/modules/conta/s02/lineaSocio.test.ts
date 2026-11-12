// S01p·18 · punto 1 · la línea de la transacción del socio que no es ninguna de
// las dos facturas se pregunta, no bloquea. Las cifras son las de octubre de
// Alcalá de Foodint (AF 11.408,42, FV 5.998,37, «Financiación inventario
// pendiente por pagar» 770,00, saldo 6.180,05, el cobro del 06/11); la forma
// de las celdas, la de los documentos reales; los nombres y el NIF del socio,
// inventados (el repositorio es público).

import { describe, expect, it } from 'vitest'
import {
  claveLinea, contestar, leerLiquidacion, puedeSer, sinContestar, type DocumentoLiquidacion,
} from '@/modules/conta/lib/lectorLiquidacionMensual'
import type { Celda, PaginaPdf } from '@/modules/conta/lib/lectorDiez'

const EMPRESA = 'B56496938'
const SOCIO = 'B00000088'

function fila(y: number, ...trozos: [number, string][]): Celda[] {
  return trozos.flatMap(([x, t]) => t.split(' ').map((p, i) => ({ x: x + i * 12, y, texto: p })))
}
const pagina = (...filas: Celda[][]): PaginaPdf => ({ celdas: filas.flat() })

function factura(titulo: string, numero: string, desde: [string, string], a: [string, string], lineas: [string, string, string, string][], total: string): DocumentoLiquidacion {
  return {
    nombre: `${titulo}.pdf`,
    paginas: [pagina(
      fila(746, [271, titulo]),
      fila(729, [271, 'Fecha: martes, 3 de noviembre de 2026']),
      fila(710, [271, `Nº de ${titulo === 'AUTOFACTURA' ? 'Autofactura' : 'Factura'}:`], [364, `${numero.split('-')[0]}-`], [381, numero.split('-')[1]]),
      fila(659, [95, 'Facturar desde:'], [314, 'Facturar a:']),
      fila(642, [95, desde[0]], [314, a[0]]),
      fila(625, [95, 'Calle de Prueba 1,'], [314, 'Avenida Inventada 2,']),
      fila(593, [95, desde[1]], [314, a[1]]),
      fila(519, [80, 'Periodo: Desde 01/10/2026 Hasta 31/10/2026']),
      fila(485, [82, 'Concepto']),
      fila(483, [321, 'Base'], [377, 'IVA'], [441, 'Total']),
      ...lineas.map(([c, b, t, tot], i) => fila(459 - i * 24, [82, c], [296, b], [339, '€'], [357, t], [387, '%'], [418, tot], [462, '€'])),
      fila(459 - lineas.length * 24, [366, 'Total:'], [414, total], [461, '€']),
    )],
  }
}

const AF = factura('AUTOFACTURA', 'AF-02979', ['Taberna de Prueba Norte, S.L.', EMPRESA], ['Marcas de Prueba, SL', `CIF ${SOCIO}`], [
  ['Servicio por Ventas Multimarcas', '8.134,96', '10,00', '8.948,46'],
  ['Servicio por Ventas con Reparto Propio', '188,80', '10,00', '207,68'],
  ['Mercaderías Aportadas por el Partner', '1.999,07', '10,00', '2.198,98'],
  ['Delivery fee Ventas con Reparto Propio', '48,46', '10,00', '53,31'],
], '11.408,42')
const FV = factura('FACTURA', 'FV-02979', ['Marcas de Prueba, SL', `CIF ${SOCIO}`], ['Taberna de Prueba Norte, S.L.', EMPRESA], [
  ['Mercaderías en Stock', '664,18', '4,00', '690,75'],
  ['Mercaderías en Stock', '4.147,25', '10,00', '4.561,98'],
  ['Mercaderías en Stock', '616,24', '21,00', '745,65'],
], '5.998,37')

/** La transacción: las dos facturas, y si hay, la línea de la financiación (con su signo) y el saldo. */
function transaccion(financiacion: string | null, saldo: string, negativo = false): DocumentoLiquidacion {
  return {
    nombre: 'Resumen-de-Transaccion-oct.pdf',
    paginas: [pagina(
      fila(746, [271, 'DETALLE DE TRANSACCION']),
      fila(729, [271, 'Fecha: martes, 3 de noviembre de 2026']),
      fila(517, [80, 'Periodo: Desde 01/10/2026 Hasta 31/10/2026']),
      fila(483, [82, 'Concepto']), fila(481, [411, 'Total']),
      fila(457, [82, 'Auto Factura AF-'], [164, '02979'], [393, '11.408,42']),
      fila(433, [82, 'Factura Stock FV-'], [167, '02979'], [393, '-'], [397, '5.998,37']),
      ...(financiacion ? [fila(409, [82, 'Financiación inventario pendiente por pagar'], ...(negativo ? [[393, '-'] as [number, string]] : []), [397, financiacion])] : []),
      fila(385, [82, 'Saldo a Ingresar'], [384, saldo], [431, '€']),
      fila(293, [82, 'Términos y condiciones:']),
    )],
  }
}

describe('S01p·18 · la línea que no es ninguna de las dos facturas', () => {
  it('octubre de Alcalá: «Financiación inventario…» 770,00 se PREGUNTA y no bloquea; el saldo 6.180,05 cuadra', () => {
    const r = leerLiquidacion([AF, FV, transaccion('770,00', '6.180,05')], EMPRESA)
    expect(r.bloqueos).toEqual([])
    expect(r.lineasSocio).toEqual([{ concepto: 'Financiación inventario pendiente por pagar', importe: 770, queEs: null }])
    expect(sinContestar(r)).toHaveLength(1)
    expect(r.transaccion?.saldo?.importe).toBe(6180.05)
  })
  it('contestar «Género que te cobrará el mes que viene» la deja lista para guardar', () => {
    const r = contestar(leerLiquidacion([AF, FV, transaccion('770,00', '6.180,05')], EMPRESA), 0, 'pendiente_facturar')
    expect(r.lineasSocio[0]).toMatchObject({ queEs: 'pendiente_facturar', porque: 'contestada' })
    expect(sinContestar(r)).toHaveLength(0)
    // «Cambiar lo que es»: vuelve a preguntar.
    expect(sinContestar(contestar(r, 0, null))).toHaveLength(1)
  })
  it('lo recordado para ese socio y ese concepto se aplica sin preguntar (mayúsculas y espacios aparte)', () => {
    const reglas = { [claveLinea('  FINANCIACIÓN  inventario pendiente por pagar')]: 'pendiente_facturar' as const }
    const r = leerLiquidacion([AF, FV, transaccion('770,00', '6.180,05')], EMPRESA, { reglas })
    expect(r.lineasSocio[0]).toMatchObject({ queEs: 'pendiente_facturar', porque: 'regla' })
  })
  it('noviembre, con 770,00 pendientes: la línea en negativo por lo pendiente se cancela sola', () => {
    const r = leerLiquidacion([AF, FV, transaccion('770,00', '4.640,05', true)], EMPRESA, { pendiente: 770 })
    expect(r.bloqueos).toEqual([])
    expect(r.lineasSocio).toEqual([{ concepto: 'Financiación inventario pendiente por pagar', importe: -770, queEs: 'cancela_pendiente', porque: 'solo' }])
  })
  it('noviembre, sin línea: si el saldo cuadra restando lo pendiente, ya te lo cobra', () => {
    const r = leerLiquidacion([AF, FV, transaccion(null, '4.640,05')], EMPRESA, { pendiente: 770 })
    expect(r.bloqueos).toEqual([])
    expect(r.lineasSocio).toEqual([{ concepto: 'Género del mes pasado que ya te cobra', importe: -770, queEs: 'cancela_pendiente', porque: 'solo', implicita: true }])
  })
  it('no se fuerza el cuadre: con otra cifra, se vuelve a preguntar o para', () => {
    // La línea en negativo, por más de lo pendiente: se pregunta, y «del mes pasado» no se puede elegir.
    const r = leerLiquidacion([AF, FV, transaccion('800,00', '4.610,05', true)], EMPRESA, { pendiente: 770, socio: 'Marcas de Prueba' })
    expect(r.lineasSocio[0].queEs).toBeNull()
    expect(puedeSer(r.lineasSocio[0], 'cancela_pendiente', 770, 'Marcas de Prueba')).toBe('Con Marcas de Prueba en este local solo quedan 770,00 € pendientes de facturar.')
    expect(puedeSer(r.lineasSocio[0], 'pendiente_facturar', 770)).toBe('Viene en negativo: no es género nuevo sin facturar.')
    expect(puedeSer(r.lineasSocio[0], 'a_mano', 770)).toBeNull()
    // Lo recordado que esta vez no vale: se pregunta, y se dice por qué.
    const c = leerLiquidacion([AF, FV, transaccion('800,00', '4.610,05', true)], EMPRESA,
      { pendiente: 770, socio: 'Marcas de Prueba', reglas: { [claveLinea('Financiación inventario pendiente por pagar')]: 'cancela_pendiente' } })
    expect(c.lineasSocio[0]).toMatchObject({ queEs: null })
    expect(c.lineasSocio[0].nota).toContain('Lo de otras veces no vale esta vez.')
    // Sin línea y un saldo que no cuadra ni restando lo pendiente: para, como antes.
    const s = leerLiquidacion([AF, FV, transaccion(null, '4.600,00')], EMPRESA, { pendiente: 770 })
    expect(s.bloqueos).toContain('La transacción dice 4.600,00 € de saldo y sus líneas suman 5.410,05 €.')
  })
})
