// tests/unit/modules/conta/v02/lectoresLiquidaciones.test.ts
//
// V02 · Entrega 2 · Los lectores de liquidaciones, contra los documentos de
// verdad que pasó Julio el 25/10 (regla 31: población real), sin datos
// personales (fuera el correo y la cuenta del banco):
//   · el informe «Detalles del pago» de Uber Eats Manager (CSV, 8 tiendas);
//   · la liquidación de Glovo I170326000540680 (su Excel y su PDF);
//   · el correo de Just Eat con la factura 4126424.
// Cada uno cuadra al céntimo con lo que dice el propio documento.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { leerInformeUber, esInformeUber, paraRegistrarInforme, NoEsInformeUber } from '@/modules/conta/lib/lectorUberPagos'
import { esExcelGlovo, leerExcelGlovo, leerPdfGlovo, paraRegistrarGlovo, quincenaDe, NoEsLiquidacionGlovo } from '@/modules/conta/lib/lectorGlovo'
import { esLiquidacionJustEat, leerLiquidacionJustEat, paraRegistrarJustEat, NoEsLiquidacionJustEat } from '../../../../../supabase/functions/_shared/liquidacionJustEat'
import { trozos } from '../../../../../supabase/functions/_shared/liquidacionUber'
import { textoDePaginas, type PiezaPdf } from '@/modules/conta/lib/textoPdf'

const F = 'tests/unit/modules/conta/v02/fixtures/liquidaciones/'
const leer = (f: string) => readFileSync(F + f, 'utf8')
const cent = (x: number) => Math.round(x * 100)

describe('Uber · el informe «Detalles del pago»', () => {
  const csv = leer('uber-detalles-pago-20261024.csv')
  const filas = leerInformeUber(csv)

  it('lo reconoce por sus columnas, y no confunde otro CSV', () => {
    expect(esInformeUber(csv)).toBe(true)
    expect(esInformeUber('numero;local;fecha;venta_neta\n1;Alcalá;01/10/2026;10,00')).toBe(false)
    expect(() => leerInformeUber('a,b\n1,2')).toThrow(NoEsInformeUber)
  })

  it('una fila por tienda, con su UUID de Uber (la identidad, nunca el nombre) y su periodo', () => {
    expect(filas).toHaveLength(8)
    expect(new Set(filas.map((f) => f.tiendaId)).size).toBe(8)
    expect(filas.every((f) => /^[0-9a-f-]{36}$/.test(f.tiendaId) && f.desde === '2026-10-24' && f.hasta === '2026-10-24')).toBe(true)
  })

  it('cada tienda cuadra al céntimo: ventas − comisión + otros = pago total', () => {
    for (const f of filas) expect(cent(f.ventas.total) - cent(f.comision) + cent(f.otros), f.tienda).toBe(cent(f.neto))
  })

  it('Lovers Burger: 16 pedidos, 883,30 vendidos, 155,09 de tasas y canje, 285,27 pagados', () => {
    const f = filas.find((x) => x.tiendaId === '487708d0-1568-5b5a-980e-437a986ef0a1')!
    expect([f.tienda, f.pedidos, f.ventas.total, f.ventas.base, f.ventas.iva, f.comision, f.neto]).toEqual(['Lovers Burger', 16, 883.3, 802.99, 80.31, 155.09, 285.27])
  })

  it('las tiendas sin pedidos también salen, con lo que les cobran (−0,30 de Bendito Burrito)', () => {
    const f = filas.find((x) => x.tiendaId === '8790bfde-bcb2-51eb-aa93-d43f0378150c')!
    expect([f.pedidos, f.ventas.total, f.neto]).toEqual([0, 0, -0.3])
  })

  it('a la base: origen «informe», con el ID de la tienda', () => {
    const d = paraRegistrarInforme(filas[0])
    expect([d.proveedor, d.origen, d.tienda_id, d.tienda]).toEqual(['uber', 'informe', '04a4a861-2470-5869-86d3-befc33880227', 'Milanesa House (Calle de Camichi 4)'])
  })
})

describe('Glovo · la liquidación I170326000540680 (Excel y PDF)', () => {
  const filas = JSON.parse(leer('glovo-I170326000540680-excel.json')) as Record<string, unknown>[]
  const pdf = leerPdfGlovo(leer('glovo-I170326000540680-pdf.txt'))
  const [excel] = leerExcelGlovo(filas)

  it('el Excel: 11 pedidos de la tienda 655854, 218,00 de productos y 61,50 de entrega (49,50 + 12,00 de mínimo)', () => {
    expect(esExcelGlovo(filas)).toBe(true)
    expect([excel.numero, excel.tiendaId, excel.pedidos, excel.productos, excel.entrega, excel.comisionBase, excel.fechaFactura])
      .toEqual(['I170326000540680', '655854', 11, 218, 61.5, 35.73, '2026-10-15'])
  })

  it('el PDF: la factura (35,73 + 7,50 = 43,23) y la liquidación al pie (218 + 61,50 − 43,23 = 236,27), pagadera el 04/11', () => {
    expect([pdf.numero, pdf.desde, pdf.hasta, pdf.pagoEl, pdf.base, pdf.iva, pdf.total, pdf.productos, pdf.entrega, pdf.ingreso])
      .toEqual(['I170326000540680', '2026-10-01', '2026-10-15', '2026-11-04', 35.73, 7.5, 43.23, 218, 61.5, 236.27])
  })

  it('el Excel y el PDF dan la misma tienda («nombre (calle)»): la calle da el local', () => {
    const conExcel = paraRegistrarGlovo({ excel })
    const conPdf = paraRegistrarGlovo({ pdf })
    expect(conExcel.tienda).toBe("Mila's Sandwiches - MAD - C. de Florencio Llorente (Calle de Florencio Llorente 29)")
    expect(conPdf.tienda).toBe(conExcel.tienda)
  })

  it('con los dos: el PDF manda en los importes y el Excel pone el ID y los pedidos; sin avisos', () => {
    const d = paraRegistrarGlovo({ excel, pdf })
    expect([d.origen, d.tienda_id, d.pedidos, d.ventas.total, d.comision, d.otros, d.neto, d.desde, d.hasta, d.pago_el]).toEqual(['excel', '655854', 11, 218, 43.23, 61.5, 236.27, '2026-10-01', '2026-10-15', '2026-11-04'])
    expect(d.factura).toEqual({ numero: 'I170326000540680', base: 35.73, iva: 7.5, total: 43.23 })
    expect(d.intermediario?.nif).toBe('B67282871')
    expect(d.avisos).toEqual([])
  })

  it('solo con el Excel: la quincena por la fecha de la factura y el IVA sobre la base total (7,50, no 7,51), y el mismo neto', () => {
    const d = paraRegistrarGlovo({ excel })
    expect([d.desde, d.hasta, d.factura?.iva, d.factura?.total, d.neto]).toEqual(['2026-10-01', '2026-10-15', 7.5, 43.23, 236.27])
    expect(quincenaDe('2026-10-31')).toEqual(['2026-10-16', '2026-10-31'])
    expect(quincenaDe('2026-02-28')).toEqual(['2026-02-16', '2026-02-28'])
  })

  it('un pedido con una promoción a cargo del local se dice (aún no se ha visto ninguna)', () => {
    const conPromo = filas.map((f, i) => (i === 0 ? { ...f, 'Promoción producto asumida por partner': -2 } : f))
    expect(paraRegistrarGlovo({ excel: leerExcelGlovo(conPromo)[0] }).avisos[0]).toMatch(/promoción producto asumida por partner/)
  })

  it('el PDF leído en el navegador (las piezas de pdfjs, por líneas) da lo mismo que pdftotext', () => {
    const paginas = JSON.parse(leer('glovo-I170326000540680-pdfjs.json')) as PiezaPdf[][]
    expect(leerPdfGlovo(textoDePaginas(paginas))).toEqual(pdf)
  })

  it('no confunde otra cosa ni mezcla dos liquidaciones', () => {
    expect(() => leerExcelGlovo([{ a: 1 }])).toThrow(NoEsLiquidacionGlovo)
    expect(() => leerPdfGlovo('Factura de otro proveedor')).toThrow(NoEsLiquidacionGlovo)
    expect(() => paraRegistrarGlovo({ excel: { ...excel, numero: 'OTRA' }, pdf })).toThrow(/no son de la misma/)
  })
})

describe('Just Eat · el correo de la factura 4126424', () => {
  const html = leer('justeat-4126424.html')
  const correo = { from: 'Just Eat Takeaway <noreplyes@justeat-int.com>', subject: 'Just-eat invoice: 4126424', html }
  const l = leerLiquidacionJustEat(correo)

  it('lo reconoce por el remitente y su cuerpo', () => {
    expect(esLiquidacionJustEat(correo, trozos(correo))).toBe(true)
    expect(esLiquidacionJustEat({ from: 'otro@proveedor.es', subject: 'Factura' }, trozos(correo))).toBe(false)
    expect(() => leerLiquidacionJustEat({ from: 'noreplyes@justeat-int.com', subject: 'Hola', html: '<p>Hola</p>' })).toThrow(NoEsLiquidacionJustEat)
  })

  it('Milanesa House, del 1 al 15 de octubre: 4 pedidos, 144,02 vendidos, recibes 90,30 antes del 22/10', () => {
    expect([l.restaurante, l.calle, l.desde, l.hasta, l.pedidos, l.ventas, l.neto, l.pagoEl])
      .toEqual(['Milanesa House', 'Calle de Florencio Llorente 29', '2026-10-01', '2026-10-15', 4, 144.02, 90.3, '2026-10-22'])
  })

  it('su factura de comisión: 27,10 + 5,69 = 32,79, de Just Eat (B86008539), no del cliente', () => {
    expect(l.factura).toEqual({ numero: '4126424', base: 27.1, iva: 5.69, total: 32.79 })
    expect(l.nifJustEat).toBe('B86008539')
  })

  it('cuadra al céntimo: 144,02 − 32,79 − 20,93 (la campaña JET+) = 90,30', () => {
    expect(l.otros).toBe(-20.93)
    expect(cent(l.ventas) - cent(l.factura.total) + cent(l.otros)).toBe(cent(l.neto))
    expect(l.avisos).toEqual([])
  })

  it('a la base: sin ID de la tienda (Just Eat no lo manda), por «restaurante (calle)»', () => {
    const d = paraRegistrarJustEat(l, { emailId: 'e1' })
    expect([d.proveedor, d.origen, d.tienda, d.tienda_id, d.referencia, d.comision, d.neto]).toEqual(['justeat', 'correo', 'Milanesa House (Calle de Florencio Llorente 29)', null, '4126424', 32.79, 90.3])
  })
})
