// Compras (10/10), §2.5, §4.5 y aceptación 5 · la liquidación mensual desde
// sus documentos. Las celdas tienen la forma de los cinco documentos reales de
// septiembre de Foodint (misma colocación, mismas cifras); los nombres, el
// NIF del socio y las marcas son inventados (el repositorio es público). Los
// documentos reales se pasaron por el mismo lector fuera del repositorio:
// 122 productos, 3.587,15 / −1.738,68, compras 11.393,44 (informe de la T5).

import { describe, expect, it } from 'vitest'
import { filasDe, leerLiquidacion, reconocer, type DocumentoLiquidacion } from '@/modules/conta/lib/lectorLiquidacionMensual'
import { cuotasQueCuadran, liquidacionMensual, type CuentasLiquidacionMensual } from '@/modules/conta/lib/asientosPropuestos'
import { cuadre } from '@/modules/conta/lib/libro'
import type { Celda, PaginaPdf } from '@/modules/conta/lib/lectorDiez'

const EMPRESA = 'B56496938'
const SOCIO = 'B00000088'

/** Una fila de celdas: [x, palabra] separadas como las da celdasPdf (una celda por palabra). */
function fila(y: number, ...trozos: [number, string][]): Celda[] {
  return trozos.flatMap(([x, t]) => t.split(' ').map((p, i) => ({ x: x + i * 12, y, texto: p })))
}
const pagina = (...filas: Celda[][]): PaginaPdf => ({ celdas: filas.flat() })

function factura(titulo: string, numero: string, desde: [string, string], a: [string, string], lineas: [string, string, string, string][], total: string): DocumentoLiquidacion {
  return {
    nombre: `${titulo}.pdf`,
    paginas: [pagina(
      fila(746, [271, titulo]),
      fila(729, [271, 'Fecha: domingo, 4 de octubre de 2026']),
      fila(710, [271, `Nº de ${titulo === 'AUTOFACTURA' ? 'Autofactura' : 'Factura'}:`], [364, `${numero.split('-')[0]}-`], [381, numero.split('-')[1]]),
      fila(659, [95, 'Facturar desde:'], [314, 'Facturar a:']),
      fila(642, [95, desde[0]], [314, a[0]]),
      fila(625, [95, 'Calle de Prueba 1,'], [314, 'Avenida Inventada 2,']),
      fila(593, [95, desde[1]], [314, a[1]]),
      fila(519, [80, 'Periodo: Desde 01/09/2026 Hasta 30/09/2026']),
      fila(485, [82, 'Concepto']),
      fila(483, [321, 'Base'], [377, 'IVA'], [441, 'Total']),
      ...lineas.map(([c, b, t, tot], i) => fila(459 - i * 24, [82, c], [296, b], [339, '€'], [357, t], [387, '%'], [418, tot], [462, '€'])),
      fila(459 - lineas.length * 24, [366, 'Total:'], [414, total], [461, '€']),
    )],
  }
}

const AF = factura('AUTOFACTURA', 'AF-02927', ['Taberna de Prueba Norte, S.L.', EMPRESA], ['Marcas de Prueba, SL', `CIF ${SOCIO}`], [
  ['Servicio por Ventas Multimarcas', '6.746,87', '10,00', '7.421,56'],
  ['Servicio por Ventas con Reparto Propio', '153,71', '10,00', '169,08'],
  ['Mercaderías Aportadas por el Partner', '1.738,74', '10,00', '1.912,61'],
  ['Delivery fee Ventas con Reparto Propio', '27,63', '10,00', '30,39'],
], '9.533,65')
const FV = factura('FACTURA', 'FV-02927', ['Marcas de Prueba, SL', `CIF ${SOCIO}`], ['Taberna de Prueba Norte, S.L.', EMPRESA], [
  ['Mercaderías en Stock', '777,69', '4,00', '808,80'],
  ['Mercaderías en Stock', '2.003,91', '10,00', '2.204,30'],
  ['Mercaderías en Stock', '805,55', '21,00', '974,72'],
], '3.987,81')
function transaccion(extra = '0,00'): DocumentoLiquidacion {
  return {
    nombre: 'transaccion.pdf',
    paginas: [pagina(
      fila(746, [271, 'DETALLE DE TRANSACCION']),
      fila(729, [271, 'Fecha: domingo, 4 de octubre de 2026']),
      fila(517, [80, 'Periodo: Desde 01/09/2026 Hasta 30/09/2026']),
      fila(483, [82, 'Concepto']), fila(481, [411, 'Total']),
      fila(457, [82, 'Auto Factura AF-'], [164, '02927'], [397, '9.533,65']),
      fila(433, [82, 'Factura Stock FV-'], [167, '02927'], [393, '-'], [397, '3.987,81']),
      fila(409, [82, 'Ventas Anticipadas en Efectivo'], [417, extra]),
      fila(385, [82, 'Saldo a Ingresar'], [384, '5.545,84'], [431, '€']),
      fila(293, [82, 'Términos y condiciones:']),
    )],
  }
}
const VENTAS: DocumentoLiquidacion = {
  nombre: 'ventas.pdf',
  paginas: [pagina(
    fila(746, [271, 'Detalle de Ventas']),
    fila(729, [271, 'Fecha: domingo, 4 de octubre de 2026']),
    fila(712, [271, 'Ref: AF-'], [292, '02927']),
    fila(600, [80, 'Periodo: Desde 01/09/2026 Hasta 30/09/2026']),
    fila(560, [221, 'Uber Detalle de Ventas']),
    fila(524, [82, 'Marca Uno'], [278, '615,42'], [313, '€'], [387, '24,60'], [416, '€'], [477, '590,82'], [512, '€']),
    fila(507, [82, 'Marca Dos'], [270, '7.666,68'], [313, '€'], [387, '205,00'], [416, '€'], [469, '7.461,68'], [512, '€']),
    fila(404, [174, 'Totales:'], [266, '8.282,10'], [313, '€'], [378, '229,60'], [415, '€'], [465, '8.052,50'], [512, '€']),
    fila(377, [82, 'Desagregación de Ventas'], [398, 'Base'], [483, 'Monto']),
    fila(360, [82, 'Reparto Propio (2)'], [387, '34,25'], [416, '€'], [483, '11,99'], [512, '€']),
    fila(343, [82, 'Reparto Agregador (1)'], [372, '8.018,25'], [416, '€'], [469, '2.004,56'], [512, '€']),
    fila(326, [279, 'Totales:']),
    fila(325, [368, '8.052,50'], [415, '€'], [465, '2.016,55'], [512, '€']),
  )],
}
const INVENTARIO: DocumentoLiquidacion = {
  nombre: 'inventario.pdf',
  paginas: [
    pagina(
      fila(746, [271, 'Relación Compras y Ventas']),
      fila(729, [271, 'Fecha: domingo, 4 de octubre de 2026']),
      fila(702, [271, 'Ref: AF-'], [292, '02927']),
      fila(600, [80, 'Periodo: Desde 01/09/2026 Hasta 30/09/2026']),
      fila(558, [217, 'Movimientos de Inventario']),
      fila(521, [82, 'Aceite de Prueba'], [283, '6,67'], [298, '€'], [324, '12,00'], [342, 'Kg'], [375, '-'], [378, '9,28'], [392, 'Kg'], [428, '2,72'], [443, 'Kg'], [505, '18,14']),
      fila(483, [82, 'Salsa de Prueba'], [283, '5,35'], [298, '€'], [330, '0,00'], [345, 'Lt'], [377, '-'], [380, '0,43'], [395, 'Lt'], [427, '-'], [430, '0,43'], [445, 'Lt'], [506, '-'], [509, '2,30']),
    ),
    // La segunda página repite la última fila de la primera (como el documento real, 2 veces).
    pagina(
      fila(763, [82, 'Salsa de Prueba'], [283, '5,35'], [298, '€'], [330, '0,00'], [345, 'Lt'], [377, '-'], [380, '0,43'], [395, 'Lt'], [427, '-'], [430, '0,43'], [445, 'Lt'], [506, '-'], [509, '2,30']),
      fila(744, [82, 'Caja de Prueba'], [283, '0,16'], [298, '€'], [318, '450,00'], [340, 'Uni'], [369, '-'], [372, '38,00'], [390, 'Uni'], [418, '412,00'], [440, 'Uni'], [505, '65,84']),
      fila(301, [425, 'Totales:'], [493, '79,68']),
    ),
  ],
}

describe('lector · cada documento por su título, cada factura por su NIF', () => {
  it('reconoce los cinco', () => {
    expect([AF, FV, transaccion(), VENTAS, INVENTARIO].map((d) => reconocer(filasDe(d.paginas)))).toEqual(['factura', 'factura', 'transaccion', 'ventas', 'inventario'])
  })
  it('la que emite tu empresa es la que le haces; la que va a tu nombre, la suya (no por el título)', () => {
    const r = leerLiquidacion([FV, AF, transaccion(), VENTAS, INVENTARIO], EMPRESA)
    expect(r.emitida?.numero).toBe('AF-02927')
    expect(r.recibida?.numero).toBe('FV-02927')
    expect(r.emitida?.lineas.map((l) => l.base)).toEqual([6746.87, 153.71, 1738.74, 27.63])
    expect(r.recibida?.lineas.map((l) => [l.base, l.tipo])).toEqual([[777.69, 4], [2003.91, 10], [805.55, 21]])
    expect([r.emitida?.total, r.recibida?.total, r.transaccion?.saldo?.importe]).toEqual([9533.65, 3987.81, 5545.84])
    expect(r.periodo).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(r.bloqueos).toEqual([])
  })
  it('los céntimos que el documento redondea en su total se dicen, no se tapan', () => {
    const r = leerLiquidacion([AF, FV, transaccion()], EMPRESA)
    expect(r.avisos).toContain('La factura que le haces suma 9.533,64 € por líneas y dice 9.533,65 €: 1 céntimo de redondeo del IVA. Manda el total.')
    expect(r.avisos).toContain('Su factura suma 3.987,82 € por líneas y dice 3.987,81 €: 1 céntimo de redondeo del IVA. Manda el total.')
  })
  it('una línea de la transacción que no se sabe qué es y trae importe, PARA (§2.5)', () => {
    expect(leerLiquidacion([AF, FV, transaccion()], EMPRESA).avisos).toContain('«Ventas Anticipadas en Efectivo» viene a cero.')
    const r = leerLiquidacion([AF, FV, transaccion('12,00')], EMPRESA)
    expect(r.bloqueos).toContain('«Ventas Anticipadas en Efectivo» trae 12,00 € y Folvy no sabe qué es: dímelo antes de proponer nada.')
  })
  it('una factura que ni emite ni recibe tu empresa no se toma por ninguna de las dos', () => {
    const r = leerLiquidacion([AF, FV], 'B00000011')
    expect(r.emitida).toBeNull()
    expect(r.recibida).toBeNull()
    expect(r.bloqueos.filter((b) => b.includes('ni la emite ni va a nombre de tu empresa'))).toHaveLength(2)
  })
  it('las ventas por plataforma, con su reparto', () => {
    const v = leerLiquidacion([AF, FV, VENTAS], EMPRESA).ventas!
    expect(v.plataformas.map((p) => [p.plataforma, p.marcas.length, p.totales?.total])).toEqual([['Uber', 2, 8052.5]])
    expect(v.plataformas[0].reparto).toEqual([{ tipo: 'Reparto Propio', base: 34.25, monto: 11.99 }, { tipo: 'Reparto Agregador', base: 8018.25, monto: 2004.56 }])
  })
  it('el inventario: negativos con su signo, y la fila repetida al saltar de página una sola vez', () => {
    const r = leerLiquidacion([AF, FV, INVENTARIO], EMPRESA)
    const inv = r.inventario!
    expect(inv.productos.map((p) => [p.nombre, p.consumo, p.saldo, p.total])).toEqual([
      ['Aceite de Prueba', -9.28, 2.72, 18.14], ['Salsa de Prueba', -0.43, -0.43, -2.3], ['Caja de Prueba', -38, 412, 65.84],
    ])
    expect(inv.repetidas).toBe(1)
    expect(r.avisos).toContain('El inventario repite 1 fila(s) idéntica(s): se cuentan una vez.')
    expect(r.avisos).toContain('El inventario dice 79,68 € de total; producto a producto, sin repetir, suman 81,68 €.')
  })
})

describe('aceptación 5 · septiembre, al céntimo', () => {
  const lectura = leerLiquidacion([AF, FV, transaccion()], EMPRESA)
  const c: CuentasLiquidacionMensual = {
    cliente: '43000009', proveedor: '40000009', compras: '60000000', ingresoServicios: '70500000', ingresoMercaderias: '70000000',
    ivaRepercutido: (p) => (p === 10 ? { cuenta: '47700010', tipoId: 'r10' } : null),
    ivaSoportado: (p) => ({ 4: { cuenta: '47200004', tipoId: 's4' }, 10: { cuenta: '47200010', tipoId: 's10' }, 21: { cuenta: '47200021', tipoId: 's21' } } as Record<number, { cuenta: string; tipoId: string }>)[p] ?? null,
  }
  const e = {
    id: 'liq', facturaRecibidaId: 'fv', socio: 'Marcas de Prueba', terceroId: 'p', localId: 'local',
    emitida: { numero: lectura.emitida!.numero!, fecha: lectura.emitida!.fecha!, lineas: lectura.emitida!.lineas, total: lectura.emitida!.total! },
    recibida: { numero: lectura.recibida!.numero!, fecha: lectura.recibida!.fecha!, lineas: lectura.recibida!.lineas, total: lectura.recibida!.total! },
    saldo: lectura.transaccion!.saldo!.importe, bloqueos: lectura.bloqueos,
  }
  const r = liquidacionMensual(e, c)
  const [compra, ingreso, compensa] = r.propuestas
  const filas = (p: typeof compra) => p.lineas.map((l) => [l.cuenta, l.debe, l.haber])

  it('compra: 3.587,15 de base al 4, 10 y 21 %, total 3.987,81 a su 400', () => {
    expect(r.sinPropuesta).toBeNull()
    expect(filas(compra)).toEqual([['60000000', 3587.15, 0], ['47200004', 31.11, 0], ['47200010', 200.39, 0], ['47200021', 169.16, 0], ['40000009', 0, 3987.81]])
    expect(compra.lineas.filter((l) => l.iva).map((l) => [l.iva!.tipo, l.iva!.base, l.iva!.libro])).toEqual([[4, 777.69, 'received'], [10, 2003.91, 'received'], [21, 805.55, 'received']])
    expect(cuadre(compra.lineas).cuadra).toBe(true)
    expect(compra.origen).toEqual({ tipo: 'supplier_invoice', id: 'fv' })
    expect(compra.avisos[0]).toContain('el céntimo va al IVA')
  })
  it('ingreso: 8.666,95 de base + 866,70 de IVA = 9.533,65, al libro de expedidas con el nº AF-02927', () => {
    expect(filas(ingreso)).toEqual([['43000009', 9533.65, 0], ['70500000', 0, 6928.21], ['70000000', 0, 1738.74], ['47700010', 0, 866.7]])
    const iva = ingreso.lineas.find((l) => l.iva)!
    expect([iva.iva!.base, iva.iva!.libro, iva.documento]).toEqual([8666.95, 'issued', 'AF-02927'])
    expect(cuadre(ingreso.lineas).cuadra).toBe(true)
    expect(ingreso.origen).toEqual({ tipo: 'licensed_settlement', id: 'liq' })
  })
  it('compensación: su factura contra lo que te debe; te paga 5.545,84 €', () => {
    expect(filas(compensa)).toEqual([['40000009', 3987.81, 0], ['43000009', 0, 3987.81]])
    expect(compensa.porque).toContain('Te paga 5.545,84 €')
    // Lo que queda en su 430 tras los tres: el saldo, y su 400 a cero.
    const todas = [compra, ingreso, compensa].flatMap((p) => p.lineas)
    const saldo = (cta: string) => Math.round(todas.filter((l) => l.cuenta === cta).reduce((t, l) => t + (l.debe - l.haber) * 100, 0)) / 100
    expect([saldo('43000009'), saldo('40000009')]).toEqual([5545.84, 0])
  })
  it('lo que el lector no dio por bueno no se propone', () => {
    expect(liquidacionMensual({ ...e, bloqueos: ['algo'] }, c).sinPropuesta).toBe('algo')
    expect(liquidacionMensual({ ...e, saldo: 5000 }, c).sinPropuesta).toContain('La transacción dice 5.000,00 € de saldo')
  })
  it('una línea de la que le haces que no se sabe si es servicio o mercadería: lo pregunta', () => {
    const raro = { ...e, emitida: { ...e.emitida, lineas: [...e.emitida.lineas, { concepto: 'Ajuste trimestral', base: 0, tipo: 10 }] } }
    expect(liquidacionMensual(raro, c).sinPropuesta).toContain('«Ajuste trimestral»')
  })
  it('sin tipo de gasto en su ficha no cae a una cuenta genérica', () => {
    expect(liquidacionMensual(e, { ...c, compras: null }).sinPropuesta).toContain('le falta el tipo de gasto')
  })
})

describe('cuotasQueCuadran', () => {
  it('sin redondeo distinto, la cuota de cada tipo tal cual', () => {
    expect(cuotasQueCuadran([{ base: 8666.95, tipo: 10 }], 9533.65)).toEqual({ porTipo: [{ tipo: 10, base: 8666.95, cuota: 866.7 }], ajuste: 0 })
  })
  it('más de un céntimo por tipo no es redondeo', () => {
    expect(cuotasQueCuadran([{ base: 100, tipo: 21 }], 121.05)).toBeNull()
  })
})
