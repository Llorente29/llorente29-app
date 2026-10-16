// tests/unit/modules/conta/promocionesEnvios.test.ts
//
// C06b (16/10) · Las promociones y los envíos en el asiento de ventas del día
// (diseño aprobado por Julio): el espejo del front (ventasDelDia), el PDF del
// resumen y la factura de Diez, con el MISMO ejemplo que la prueba de staging
// de la base (supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql):
// un pedido de carta 30,00 con 10,00 de promoción y 3,50 de envío que
// repartimos nosotros (paga 23,50) y otro de 20,00 sin nada. Importes inventados.
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { cuadre } from '@/modules/conta/lib/libro'
import { ventasDelDia, type EntradaVentasDia, type PedidoDia } from '@/modules/conta/lib/asientosPropuestos'
import { resumenDeAsiento, LINEA_ENVIOS, LINEA_PROMOCIONES, type ResumenBD } from '../../../../supabase/functions/_shared/resumenDeAsiento'
import { comprobarResumen, resumenVentasPdf } from '../../../../supabase/functions/_shared/resumenVentasPdf'
import { facturaDeVentas } from '../../../../supabase/functions/_shared/diezFactura'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../../supabase/functions/_shared/diezAnalitica'

const GLOVO = 'canal-glovo'
const LOLA = 'marca-lola'
const pedido = (p: Partial<PedidoDia> & Pick<PedidoDia, 'id' | 'total'>): PedidoDia => ({
  codigo: p.id.toUpperCase(), canalId: GLOVO, marcaId: LOLA, marcaPropia: true, estado: 'closed', base: null, cuota: null, tiposEnLineas: [], ...p,
})
const PR1 = pedido({ id: 'pr-1', total: 23.5, descuento: 10, envio: 3.5, claseEnvio: 'cobrado' })
const PR2 = pedido({ id: 'pr-2', total: 20, descuento: 0, envio: 0, claseEnvio: 'ninguno' })
const PR3 = pedido({ id: 'pr-3', total: 12, descuento: 0, envio: 2, claseEnvio: 'por_aclarar', porQueEnvio: 'repartió la plataforma' })
const CUENTAS = {
  cobroPorCanal: { [GLOVO]: '43000001' }, ventas: '70000000', devoluciones: '70800000', ivaRepercutido: '47700010',
  ventasPorMarca: { [LOLA]: '70000001' }, devolucionesPorMarca: { [LOLA]: '70800001' },
  promocionesPorCanal: { [GLOVO]: '70009002' }, enviosPorCanal: { [GLOVO]: '70500001' },
}
const entrada = (pedidos: PedidoDia[], cuentas: EntradaVentasDia['cuentas'] = CUENTAS): EntradaVentasDia => ({
  fecha: '2026-10-21', localId: 'loc', tipo: { id: 'iva10', porcentaje: 10 }, pedidos, devoluciones: [], cuentas, porMarca: true,
  nombreCanal: () => 'Glovo', nombreMarca: () => 'Casa Lola', nombreLocal: 'Local de prueba', unidad: { canalId: GLOVO, marcaId: null, clave: GLOVO },
})
const lineas = (p: ReturnType<typeof ventasDelDia>) => p.propuesta!.lineas.map((l) => [l.cuenta, l.debe, l.haber])

describe('C06b · el asiento del día con su promoción y su envío (ventasDelDia, el espejo de la base)', () => {
  it('el ejemplo del diseño: 430 43,50 · 70009002 9,09 al debe · venta 45,45 · 70500001 3,18 · 477 3,96 (base 39,54), y cuadra', () => {
    const r = ventasDelDia(entrada([PR1, PR2]))
    expect(lineas(r)).toEqual([['43000001', 43.5, 0], ['70009002', 9.09, 0], ['70000001', 0, 45.45], ['70500001', 0, 3.18], ['47700010', 0, 3.96]])
    expect(r.propuesta!.lineas.find((l) => l.cuenta === '47700010')!.iva).toMatchObject({ base: 39.54, facturas: 2 })
    expect(cuadre(r.propuesta!.lineas)).toMatchObject({ debe: 52.59, haber: 52.59, cuadra: true })
    expect(r.propuesta!.lineas.find((l) => l.cuenta === '70009002')!.concepto).toBe('Promociones Glovo · 1 pedido')
    expect(r.propuesta!.lineas.find((l) => l.cuenta === '70500001')).toMatchObject({ concepto: 'Envíos cobrados · 1 pedido', localId: 'loc' })
    expect(r.propuesta!.razones).toEqual(expect.arrayContaining([
      { decision: 'Promociones: 1 pedido, 10,00 € con el IVA dentro', porque: 'la venta va a precio de carta en su marca y la promoción, en su subcuenta (70009002), resta; el IVA va sobre lo que paga el cliente', cita: 'Ley 37/1992, art. 78.Tres.2.º' },
      { decision: 'Envíos cobrados: 1 pedido, 3,50 € con el IVA dentro', porque: 'lo repartimos nosotros: el envío es del restaurante y va a su subcuenta (70500001), con su local; forma parte de la base, al tipo de la venta', cita: 'Ley 37/1992, art. 78.Dos.1.º' },
    ]))
    expect(r.propuesta!.confianza).toBe('probable')
    expect(r.resumen.total).toBe(43.5)
  })
  it('un envío que repartió la plataforma: «Por aclarar», en duda, y el envío dentro de la venta (como la base)', () => {
    const r = ventasDelDia(entrada([PR1, PR2, PR3]))
    expect(r.propuesta!.confianza).toBe('duda')
    expect(r.propuesta!.avisos).toContain('Por aclarar: 1 pedido con envío y sin saber si es del restaurante (PR-3 · Casa Lola · envío 2,00 € · repartió la plataforma). Se resuelve con la liquidación de esa semana: si la plataforma lo paga, va a Envíos cobrados; si no, sale de la venta y del cobro. Hasta entonces no se valida.')
    expect(lineas(r)[0]).toEqual(['43000001', 55.5, 0])
    expect(lineas(r).find((l) => l[0] === '70500001')).toEqual(['70500001', 0, 3.18])
  })
  it('aclarado «no lo paga»: sale de la venta y del cobro, y lo dice', () => {
    const r = ventasDelDia(entrada([PR1, PR2, { ...PR3, claseEnvio: 'fuera', porQueEnvio: null }]))
    expect(lineas(r)[0]).toEqual(['43000001', 53.5, 0])
    expect(r.propuesta!.razones).toEqual(expect.arrayContaining([expect.objectContaining({ decision: 'Fuera: el envío de 1 pedido (2,00 €)' })]))
    expect(r.propuesta!.confianza).not.toBe('duda')
    expect(cuadre(r.propuesta!.lineas).cuadra).toBe(true)
  })
  it('sin sus subcuentas: la promoción se queda restada y el envío dentro (21,36), en duda y avisando', () => {
    const r = ventasDelDia(entrada([PR1], { ...CUENTAS, promocionesPorCanal: {}, enviosPorCanal: {} }))
    expect(lineas(r)).toEqual([['43000001', 23.5, 0], ['70000001', 0, 21.36], ['47700010', 0, 2.14]])
    expect(r.propuesta!.confianza).toBe('duda')
    expect(r.propuesta!.avisos).toEqual(expect.arrayContaining([
      '1 pedido lleva promoción y Glovo no tiene su subcuenta de promociones: queda restada de la venta. Enlázala antes de validar.',
      '1 pedido lleva envío cobrado y Glovo no tiene su subcuenta de envíos: queda dentro de la venta. Enlázala antes de validar.']))
  })
  it('sin lo que dice el pedido (la base de antes, o el front antes que la base): como hasta hoy', () => {
    const viejo = pedido({ id: 'pr-1', total: 23.5 })
    expect(lineas(ventasDelDia(entrada([viejo])))).toEqual([['43000001', 23.5, 0], ['70000001', 0, 21.36], ['47700010', 0, 2.14]])
  })
})

// El asiento validado del ejemplo, como lo devuelve conta_resumen_ventas.
const validado = (o: Partial<ResumenBD> = {}): ResumenBD => ({
  id: 'e1', account_id: 'a', company_id: 'c', estado: 'validado', serie: 1, numero: 2001, fecha: '2026-10-21',
  empresa: { nombre: 'Empresa de Prueba, S.L.', nif: 'B00000000' }, local: { id: 'l', nombre: 'Foodint Alcalá' }, canal: { id: GLOVO, slug: 'glovo', nombre: 'Glovo' },
  pedidos: [
    { hora: '13:00', codigo: 'PR-1', marca: 'Casa Lola', total: 23.5, base: null, cuota: null, descuento: 10, envio: 3.5, clase: 'cobrado' },
    { hora: '14:00', codigo: 'PR-2', marca: 'Casa Lola', total: 20, base: null, cuota: null, descuento: 0, envio: 0, clase: 'ninguno' },
  ],
  lineas: [
    { cuenta: '43000001', debe: 43.5, haber: 0, marca: null, tipoIva: null, documento: null, papel: null },
    { cuenta: '70009002', debe: 9.09, haber: 0, marca: null, tipoIva: null, documento: null, papel: 'promociones' },
    { cuenta: '70000001', debe: 0, haber: 45.45, marca: 'Casa Lola', tipoIva: null, documento: null, papel: null },
    { cuenta: '70500001', debe: 0, haber: 3.18, marca: null, tipoIva: null, documento: null, papel: 'envios' },
    { cuenta: '47700010', debe: 0, haber: 3.96, marca: null, tipoIva: 10, documento: null, papel: null },
  ],
  documento: null, ...o,
})

describe('C06b · el PDF del resumen y la factura de Diez salen iguales que el asiento', () => {
  it('el resumen: la marca a precio de carta, la promoción y el envío en sus líneas; cuadra y hay PDF', () => {
    const r = resumenDeAsiento(validado(), { correspondencia: null, generado: new Date('2026-10-22T08:00:00Z'), hoy: '2026-10-22' })
    expect([...r.datos.lineasFactura].sort((a, b) => a.cuenta.localeCompare(b.cuenta)).map((l) => [l.marca, l.cuenta, l.importe])).toEqual([['Casa Lola', '70000001', 45.45], [LINEA_PROMOCIONES, '70009002', -9.09], [LINEA_ENVIOS, '70500001', 3.18]])
    expect(r.datos.pedidos[0]).toMatchObject({ base: 21.36, cuota: 2.14, total: 23.5, promocion: 9.09, envio: 3.18 })
    expect(r.datos.factura).toEqual({ base: 39.54, cuota: 3.96, total: 43.5 })
    expect(comprobarResumen(r.datos)).toEqual([])
    expect(new TextDecoder().decode(resumenVentasPdf(jsPDF, r.datos).slice(0, 5))).toBe('%PDF-')
  })
  it('un asiento de antes (sin líneas de promociones ni envíos) sigue cuadrando aunque sus pedidos traigan descuento', () => {
    const viejo = validado({ lineas: [
      { cuenta: '43000001', debe: 43.5, haber: 0, marca: null, tipoIva: null, documento: null },
      { cuenta: '70000001', debe: 0, haber: 39.54, marca: 'Casa Lola', tipoIva: null, documento: null },
      { cuenta: '47700010', debe: 0, haber: 3.96, marca: null, tipoIva: 10, documento: null }] })
    const r = resumenDeAsiento(viejo, { correspondencia: null, generado: new Date('2026-10-22T08:00:00Z'), hoy: '2026-10-22' })
    expect(comprobarResumen(r.datos)).toEqual([])
    expect(r.datos.pedidos[0].promocion).toBeUndefined()
  })
  it('un envío «fuera» sale del total del pedido en el resumen, como en el asiento', () => {
    const v = validado()
    v.pedidos.push({ hora: '15:00', codigo: 'PR-3', marca: 'Casa Lola', total: 12, base: null, cuota: null, descuento: 0, envio: 2, clase: 'fuera' })
    v.lineas = [
      { cuenta: '43000001', debe: 53.5, haber: 0, marca: null, tipoIva: null, documento: null },
      { cuenta: '70009002', debe: 9.09, haber: 0, marca: null, tipoIva: null, documento: null, papel: 'promociones' },
      { cuenta: '70000001', debe: 0, haber: 54.54, marca: 'Casa Lola', tipoIva: null, documento: null },
      { cuenta: '70500001', debe: 0, haber: 3.18, marca: null, tipoIva: null, documento: null, papel: 'envios' },
      { cuenta: '47700010', debe: 0, haber: 4.87, marca: null, tipoIva: 10, documento: null }]
    const r = resumenDeAsiento(v, { correspondencia: null, generado: new Date('2026-10-22T08:00:00Z'), hoy: '2026-10-22' })
    expect(r.datos.pedidos[2]).toMatchObject({ total: 10, base: 9.09, cuota: 0.91 })
    expect(comprobarResumen(r.datos)).toEqual([])
  })
  it('la factura de Diez: la venta, la promoción en negativo y el envío, cada uno a su subcuenta; base 39,54, IVA 3,96, total 43,50', () => {
    const v = validado()
    const { factura: f, sinPoner } = facturaDeVentas({ fecha: v.fecha, local: v.local!.nombre, canal: 'glovo', lineas: v.lineas.map((l) => ({ cuenta: l.cuenta, debe: l.debe, haber: l.haber, marca: l.marca, tipoIva: l.tipoIva })) },
      { correspondencia: CORRESPONDENCIA_LLORENTE29, nombreCliente: 'GLOVO', hoy: '2026-10-22', conAnalitica: true })
    expect(f).toMatchObject({ BaseImponible1: 39.54, CuotaIVA1: 3.96, TotalFactura: 43.5, TotalGastosIngresos: 39.54, CuentaCliente: '43000001' })
    expect((f.Apuntes as { Cuenta: string; Importe: number }[]).map((a) => [a.Cuenta, a.Importe])).toEqual([['70000001', 45.45], ['70009002', -9.09], ['70500001', 3.18]])
    expect((f.Analitica as { Subcuenta: string; ImporteDebe: number; ImporteHaber: number }[]).map((a) => [a.Subcuenta, a.ImporteDebe, a.ImporteHaber]))
      .toEqual([['70000001', 0, 45.45], ['70009002', 9.09, 0], ['70500001', 0, 3.18]])
    expect(sinPoner.filter((x) => !x.startsWith('70000001'))).toEqual([])
  })
})
