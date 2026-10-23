// tests/unit/modules/conta/inicioC06.test.ts
//
// C06 · El Inicio del producto vendido solo: lo que se decide sin base.

import {
  barras, cambio, diaDeHoy, dudas, frasePago, lineasIva, textoIva, mesYAnio, mesesHasta, primerNombre, puntoDeMes, resumenDudas, saldoDe, saludo, trimestreDe,
} from '@/modules/conta/lib/inicio'
import { ayerEnMadrid } from '@/modules/conta/services/inicioService'
import { diaMes, euros, eurosExactos } from '@/modules/conta/lib/formato'

describe('la cabecera', () => {
  it('saluda según la hora de Madrid', () => {
    expect(saludo(9)).toBe('Buenos días')
    expect(saludo(14)).toBe('Buenas tardes')
    expect(saludo(21)).toBe('Buenas noches')
    expect(saludo(3)).toBe('Buenas noches')
  })
  it('el primer nombre, o nada', () => {
    expect(primerNombre('Marta Inventada')).toBe('Marta')
    expect(primerNombre('  ')).toBeNull()
    expect(primerNombre(null)).toBeNull()
  })
  it('el día y el mes como la maqueta', () => {
    expect(diaDeHoy('2026-10-02')).toBe('Viernes 2 de octubre')
    expect(diaDeHoy('2026-10-13')).toBe('Martes 13 de octubre')
    expect(mesYAnio('2026-10-01')).toBe('Octubre 2026')
  })
  it('ayer a las 00:00 de Madrid, en invierno y en verano', () => {
    expect(ayerEnMadrid('2026-10-13')).toBe('2026-10-12T00:00:00+02:00')
    expect(ayerEnMadrid('2026-12-02')).toBe('2026-12-01T00:00:00+01:00')
    expect(ayerEnMadrid('2027-01-01')).toBe('2026-12-31T00:00:00+01:00')
  })
})

describe('los meses', () => {
  it('seis meses hasta uno, cruzando el año', () => {
    expect(mesesHasta('2026-02-01', 6)).toEqual(['2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01'])
  })
  it('el trimestre natural', () => {
    expect(trimestreDe('2026-10-01')).toEqual({ desde: '2026-10-01', hasta: '2026-12-31', nombre: '4.º trimestre' })
    expect(trimestreDe('2026-08-01')).toEqual({ desde: '2026-07-01', hasta: '2026-09-30', nombre: '3.er trimestre' })
    expect(trimestreDe('2026-02-01').hasta).toBe('2026-03-31')
  })
})

describe('las tarjetas salen del libro', () => {
  // Cuentas del PGC con su lado natural y alguna al revés (anticipos), como las
  // que trae un plan de verdad: 4300 clientes, 4380 anticipos de clientes
  // (acreedora), 4400 deudores, 4000 proveedores, 4070 anticipos a
  // proveedores (deudora), 4100 acreedores, 5720 bancos.
  const saldos = [
    { code: '57200001', templateCode: '5720', debe: 48230, haber: 0 },
    { code: '57200002', templateCode: '5720', debe: 1000, haber: 1500 },
    { code: '43000001', templateCode: '4300', debe: 12480, haber: 0 },
    { code: '43800001', templateCode: '4380', debe: 0, haber: 480 },
    { code: '44000001', templateCode: '4400', debe: 200, haber: 0 },
    { code: '40000001', templateCode: '4000', debe: 0, haber: 9615 },
    { code: '40700001', templateCode: '4070', debe: 300, haber: 0 },
    { code: '41000001', templateCode: '4100', debe: 0, haber: 700 },
    { code: '47700000', templateCode: '4770', debe: 0, haber: 900 },
  ]
  it('cada grupo con su lado', () => {
    expect(saldoDe(saldos, ['572'], 'deudor')).toBe(47730)
    expect(saldoDe(saldos, ['43', '44'], 'deudor')).toBe(12200)
    expect(saldoDe(saldos, ['40', '41'], 'acreedor')).toBe(10015)
  })
  it('manda el código de la plantilla, no el de la subcuenta', () => {
    expect(saldoDe([{ code: '99999999', templateCode: '5720', debe: 5, haber: 0 }], ['572'], 'deudor')).toBe(5)
  })
  it('un punto del mes', () => {
    // S02 · PR 3: subcuenta a subcuenta y con su lado. «Te deben» ya no resta el anticipo de
    // cliente (4380, 480 acreedor: 12480 + 200 = 12680) y «Debes» ya no resta la 407 (anticipo a
    // proveedor, activo: 9615 + 700 = 10315). Antes: 12200 y 10015, dos netos contables.
    expect(puntoDeMes('2026-09-01', saldos)).toEqual({ mes: '2026-09-01', banco: 47730, teDeben: 12680, debes: 10315 })
  })
})

describe('barritas, cambios y pagos', () => {
  it('de 13 a 40, la última marcada; sin dato, sin barra', () => {
    expect(barras([10, null, 20, 30])).toEqual([{ alto: 13, ultima: false }, { alto: 27, ultima: false }, { alto: 40, ultima: true }])
    expect(barras([5, 5])).toEqual([{ alto: 26, ultima: false }, { alto: 26, ultima: true }])
    expect(barras([null, null])).toEqual([])
  })
  it('el cambio del mes', () => {
    expect(cambio(45110, 48230, euros)).toBe('+3.120 € este mes')
    expect(cambio(48230, 47430.5, euros)).toBe('−799,50 € este mes')
    expect(cambio(1, 1, euros)).toBe('igual que el mes pasado')
    expect(cambio(null, 1, euros)).toBeNull()
  })
  it('el próximo pago, o lo vencido', () => {
    expect(frasePago('2026-10-24', '2026-10-13', diaMes)).toBe('Próximo pago el 24 oct')
    expect(frasePago('2026-10-01', '2026-10-13', diaMes)).toBe('Vencido desde el 1 oct')
    expect(frasePago(null, '2026-10-13', diaMes)).toBeNull()
  })
})

describe('lo que tiene que decir la persona', () => {
  it('las sugerencias, los papeles de compras y los asientos por revisar', () => {
    const d = dudas([{ id: 's1', title: 'Presentas el 111', why: 'Tienes nóminas' }], { compras: 2, libros: 1 })
    expect(d.map((x) => [x.tipo, x.titulo])).toEqual([
      ['sugerencia', 'Presentas el 111'], ['compras', '2 cosas de compras por mirar'], ['revisar', '1 asiento propuesto para revisar'],
    ])
    expect(dudas([], {})).toEqual([])
  })
  it('cuánto hay pendiente (S02 · PR 3: la suma, el número de la barra de Inicio; no las filas)', () => {
    expect(resumenDudas(3)).toBe('3 cosas pendientes')
    expect(resumenDudas(1)).toBe('1 cosa pendiente')
    expect(resumenDudas(100, 2)).toBe('100 cosas pendientes · 2 preguntas mías')
    expect(resumenDudas(0, 1)).toBe('1 pregunta mía')
    expect(resumenDudas(0)).toBe('nada pendiente')
    expect(resumenDudas(null)).toBe('no he podido contarlo todo')
  })
})

describe('M01 · el IVA del trimestre, en tres líneas cortas', () => {
  const lineas = (r: number, s: number) => lineasIva(r, s, eurosExactos).map((l) => `${l.etiqueta} ${l.importe}${l.nota ? ` ${l.nota}` : ''}`)
  it('soportado en negativo (el caso de staging): con su signo y su porqué, y lo que sale', () => {
    expect(lineas(8.99, -5)).toEqual(['IVA de tus ventas 8,99 €', 'IVA de tus compras −5,00 € (más abonos que facturas)', 'A pagar 13,99 €'])
  })
  it('soportado normal: las mismas tres líneas, sin nota', () => {
    expect(lineas(8.99, 5)).toEqual(['IVA de tus ventas 8,99 €', 'IVA de tus compras 5,00 €', 'A pagar 3,99 €'])
    expect(lineas(1200, 450.5)).toEqual(['IVA de tus ventas 1.200,00 €', 'IVA de tus compras 450,50 €', 'A pagar 749,50 €'])
  })
  it('si sale negativo, «A devolver», sin signo', () => {
    expect(lineas(100, 250)).toEqual(['IVA de tus ventas 100,00 €', 'IVA de tus compras 250,00 €', 'A devolver 150,00 €'])
  })
  it('para el lector, una frase con las tres', () => {
    expect(textoIva('4.º trimestre', lineasIva(8.99, -5, eurosExactos))).toBe('4.º trimestre: IVA de tus ventas 8,99 €. IVA de tus compras −5,00 € (más abonos que facturas). A pagar 13,99 €.')
  })
})
