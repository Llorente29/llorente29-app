// D01 · Liquidaciones por correo · T2 · El lector del «Resumen de pagos» de
// Uber Eats y la factura de comisión que sale de él. Correos INVENTADOS con la
// forma de los de verdad (uberInventado.ts).
import { describe, expect, it } from 'vitest'
import {
  centimos, facturaDeComision, fechaDiaria, leerResumenUber, NoEsResumenUber, paraRegistrar, periodoUber, trozos,
} from '../../../supabase/functions/_shared/liquidacionUber'
import { comoTexto, correoUber, TIENDA_INVENTADA } from './uberInventado'

const semana = correoUber({
  desde: '2026-09-21', hasta: '2026-09-27',
  dias: [{ fecha: '2026-09-24', pedidos: 2, ventas: 40.0, impuesto: 4.0 }],
  desglose: { ventas: 44.0, pedidosVentas: 2, tasas: -13.31, promociones: 0 },
})

describe('las piezas', () => {
  it('importes: miles con punto, decimales con coma, el signo menos de los dos tipos', () => {
    expect([centimos('1.074,37 €'), centimos('-17,35 €'), centimos('−2,47 €'), centimos('0,00 €'), centimos('7'), centimos('')]).toEqual([107437, -1735, -247, 0, null, null])
  })
  it('fechas: «Sep 21, 2026 - Sep 27, 2026» y la del resumen diario en mes/día/año', () => {
    expect(periodoUber('Sep 28, 2026 - Oct 04, 2026')).toEqual(['2026-09-28', '2026-10-04'])
    expect(periodoUber('Oct 04, 2026 - Sep 28, 2026')).toBeNull()
    expect([fechaDiaria('9/24/2026'), fechaDiaria('10/3/2026'), fechaDiaria('24/9/2026')]).toEqual(['2026-09-24', '2026-10-03', null])
  })
  it('del HTML salen trozos: cada bloque y cada celda, sin el estilo ni los saltos de línea dentro de una celda', () => {
    const t = trozos(semana)
    expect(t).toContain('Ventas (2 Pedidos)')
    expect(t).not.toContain('body{font-family:uber move text}')
    expect(t.slice(t.indexOf('Periodo de pago'), t.indexOf('Periodo de pago') + 4)).toEqual(['Periodo de pago', 'Sep 21, 2026 - Sep 27, 2026', 'ID de referencia del pago', 'Depósito iniciado'])
  })
})

describe('una semana normal', () => {
  const r = leerResumenUber(semana)
  it('la tienda del saludo, la marca del asunto, el periodo y lo que viene vacío, vacío', () => {
    expect([r.tienda, r.marca, r.desde, r.hasta, r.referencia, r.depositoIniciado]).toEqual([TIENDA_INVENTADA, 'Marca Inventada', '2026-09-21', '2026-09-27', null, null])
  })
  it('el desglose y el neto, y todo cuadra', () => {
    expect(r.ganancias).toEqual({ ventas: 44, pedidosVentas: 2, otras: 0, total: 44 })
    expect(r.uber).toEqual({ tasas: -13.31, otros: 0, total: -13.31 })
    expect(r.neto).toBe(30.69)
    expect(r.pedidos).toBe(2)
    expect(r.ventas).toEqual({ base: 40, iva: 4, total: 44, pedidos: 2 })
    expect(r.diario).toEqual([{ fecha: '2026-09-24', pedidos: 2, ventas: 40, impuesto: 4, total: 44 }])
    expect(r.avisos).toEqual([])
    expect(r.mensual).toBeNull()
  })
  it('la factura: solo comisión, base + IVA = total', () => {
    expect(facturaDeComision(r)).toEqual({
      comision: { total: 13.31, base: 11 }, publicidad: { total: 0, base: 0 }, base: 11, iva: 2.31, total: 13.31, tipoIva: 21,
      fuera: { promocionesEnArticulos: 0 }, avisos: [],
    })
  })
})

describe('cuatro semanas acumuladas, neto negativo y el resumen del mes pasado', () => {
  const c = correoUber({
    desde: '2026-09-14', hasta: '2026-10-11', deposito: '2026-10-12',
    dias: [
      { fecha: '2026-10-03', pedidos: 0, ventas: 0, impuesto: 0 },
      { fecha: '2026-10-05', pedidos: 3, ventas: 90.0, impuesto: 9.0 },
      { fecha: '2026-10-08', pedidos: 1, ventas: 30.0, impuesto: 3.0 },
    ],
    desglose: { ventas: 132.0, pedidosVentas: 4, otras: 8.5, tasas: -20.0, promociones: -60.0, otrosPromo: -10.0, anuncios: -55.0 },
    mesPasado: { titulo: 'September 2026', desglose: { ventas: 999.99, pedidosVentas: 50, tasas: -111.11, promociones: -22.22 } },
  })
  const r = leerResumenUber(c)
  it('lee el desglose del periodo, nunca el del mes pasado (que repite las etiquetas)', () => {
    expect(r.ganancias).toEqual({ ventas: 132, pedidosVentas: 4, otras: 8.5, total: 140.5 })
    expect(r.uber.tasas).toBe(-20)
    expect(r.marketing).toEqual({ promociones: -60, otrosPromo: -10, anuncios: -55, total: -125 })
    expect(r.neto).toBe(-4.5)
    expect(r.mensual).toEqual({ mes: '2026-09' })
    expect(r.depositoIniciado).toBe('2026-10-12')
    expect(r.avisos).toEqual([])
  })
  it('la factura: comisión y anuncios; «Promociones en artículos» fuera, aparte', () => {
    const f = facturaDeComision(r)!
    expect(f.comision.total).toBe(30)
    expect(f.publicidad.total).toBe(55)
    expect(f.total).toBe(85)
    expect(Math.round((f.base + f.iva) * 100)).toBe(8500)
    expect(f.fuera.promocionesEnArticulos).toBe(60)
  })
})

describe('la regla del céntimo (comprobada contra las facturas de Diez)', () => {
  it('la base es la del total, la de anuncios la suya y la de comisión la diferencia', () => {
    // 10,00 + 10,00: por separado, 8,26 + 8,26 = 16,52; la base del total es 16,53.
    const f = facturaDeComision({ uber: { tasas: -10, otros: 0, total: -10 }, marketing: { promociones: 0, otrosPromo: 0, anuncios: -10, total: -10 } })!
    expect([f.base, f.publicidad.base, f.comision.base, f.iva, f.total]).toEqual([16.53, 8.26, 8.27, 3.47, 20])
  })
  it('nada que facturar: null; un cargo a tu favor se avisa', () => {
    expect(facturaDeComision({ uber: { tasas: 0, otros: 0, total: 0 }, marketing: { promociones: -5, otrosPromo: 0, anuncios: 0, total: -5 } })).toBeNull()
    expect(facturaDeComision({ uber: { tasas: 2, otros: 0, total: 2 }, marketing: { promociones: 0, otrosPromo: 0, anuncios: -10, total: -10 } })!.avisos)
      .toEqual(['Los cargos de Uber salen a tu favor: la factura puede ser rectificativa.'])
  })
})

describe('contracargos, ajustes y líneas que no salen', () => {
  const c = correoUber({
    desde: '2026-08-03', hasta: '2026-08-09',
    dias: [{ fecha: '2026-08-05', pedidos: 3, ventas: 60.0, impuesto: 6.0 }, { fecha: '2026-08-10', pedidos: 1, ventas: 10.0, impuesto: 1.0 }],
    desglose: { ventas: 77.0, pedidosVentas: 4, tasas: -23.1, otros: -1.0, contracargo: -12.5, pedidosContracargo: 1, ajustes: 3.0 },
    contracargos: [{ pedido: 'A1B2C', momento: '8/5/2026 21:14', venta: 25.0, contracargo: -12.5, tipo: 'Falta un artículo' }],
  })
  const r = leerResumenUber(c)
  it('lee el contracargo con su detalle y los ajustes; sin promociones ni anuncios, cero', () => {
    expect(r.modificaciones).toEqual({ contracargo: -12.5, pedidosContracargo: 1, ajustes: 3, total: -9.5 })
    expect(r.contracargos).toEqual([{ pedido: 'A1B2C', momento: '8/5/2026 21:14', venta: 25, contracargo: -12.5, tipo: 'Falta un artículo' }])
    expect(r.marketing).toEqual({ promociones: 0, otrosPromo: 0, anuncios: 0, total: 0 })
    expect(r.uber).toEqual({ tasas: -23.1, otros: -1, total: -24.1 })
  })
  it('un día con pedidos fuera del periodo se dice', () => {
    expect(r.avisos).toEqual(['1 día del resumen diario con pedidos fuera del periodo.'])
  })
  it('los otros cargos de Uber van en la comisión', () => {
    expect(facturaDeComision(r)!.comision.total).toBe(24.1)
  })
})

describe('lo que no cuadra o no es', () => {
  it('un neto que no es la suma del desglose queda dicho (y la liquidación, por revisar)', () => {
    const c = correoUber({ desde: '2026-09-21', hasta: '2026-09-27', dias: [{ fecha: '2026-09-22', pedidos: 1, ventas: 10, impuesto: 1 }],
      desglose: { ventas: 11, pedidosVentas: 1, tasas: -3 }, neto: 9 })
    expect(leerResumenUber(c).avisos).toEqual(['Pago neto: las líneas suman 8,00 € y el total dice 9,00 €.'])
  })
  it('otro correo no es un resumen; uno sin desglose tampoco', () => {
    expect(() => leerResumenUber({ subject: 'Tu pedido', html: '<p>Hola</p>' })).toThrow(NoEsResumenUber)
    expect(() => leerResumenUber({ subject: 'Resumen de pagos de Uber Eats correspondiente a X del Sep 21, 2026 - Sep 27, 2026', html: '<p>Hola X (Calle 1),</p>' }))
      .toThrow('desglose')
  })
  it('un reenvío en texto plano se lee igual', () => {
    const t = leerResumenUber({ subject: `Fwd: ${semana.subject}`, text: comoTexto(semana.html) })
    const h = leerResumenUber(semana)
    expect({ ...t, avisos: [] }).toEqual({ ...h, avisos: [] })
  })
})

describe('lo que va a la base', () => {
  it('el resumen, su factura y el correo del que sale', () => {
    const r = leerResumenUber(semana)
    const p = paraRegistrar(r, { emailId: 'correo-1' })
    expect(p).toMatchObject({ proveedor: 'uber', email_id: 'correo-1', tienda: TIENDA_INVENTADA, desde: '2026-09-21', hasta: '2026-09-27', neto: 30.69,
      factura: { base: 11, iva: 2.31, total: 13.31, tipo_iva: 21 } })
  })
})
