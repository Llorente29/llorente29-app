// tests/unit/conta/diezExcel.test.ts · B01r26 · las filas de los dos Excel del traspaso.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { columnas, emitidaDeVentas, fecha, filaEmitida, filaRecibida, ingresosAgrupados, claveDelCuadre, recibidaDeAsiento, type Emitida, type Recibida } from '../../../supabase/functions/_shared/diezExcel.ts'
import { XML_EMITIDAS, XML_RECIBIDAS } from '../../../supabase/functions/_shared/diezExcelConfig.ts'
// @ts-expect-error módulo .mjs sin tipos
import * as C12 from '../../../scripts/conta/diez/c12-excel-recibidas.mjs'

const URL = 'https://ejemplo.invalid/functions/v1/conta-pdf/0123456789abcdef0123456789abcdef'
const lf = (s: string) => s.replace(/\r\n/g, '\n')
const norm = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : x)

describe('las configuraciones de Julio, tal cual', () => {
  it('son las de la C0009 del 13/11 (docs/conta/diez/configuracion), byte a byte (salvo los finales de línea)', () => {
    expect(XML_EMITIDAS).toBe(lf(readFileSync('docs/conta/diez/configuracion/ConfiguracionExpedidas-b01r26.XML', 'utf8')))
    expect(XML_RECIBIDAS).toBe(lf(readFileSync('docs/conta/diez/configuracion/ConfiguracionRecibidas-b01r26.XML', 'utf8')))
  })
  it('lo que dijo Julio: emitidas Y/Z ingresos 3, AA local, AB plataforma; recibidas B fecha factura, Y fecha contable y fiscal', () => {
    const e = columnas(XML_EMITIDAS)
    expect([e['095'], e['097'], e['059'], e['061']]).toEqual([25, 26, 27, 28])
    const r = columnas(XML_RECIBIDAS)
    expect([r['002'], r['001'], r['118']]).toEqual([2, 25, 25])
  })
  it('lo de antes no se ha movido: las columnas del 24/10 siguen donde estaban', () => {
    const viejo = (f: string) => columnas(lf(readFileSync(`docs/conta/c12/prueba-excel/${f}`, 'utf8')))
    const e = columnas(XML_EMITIDAS)
    for (const [k, v] of Object.entries(viejo('ConfiguracionExpedidas-c12.XML'))) expect([k, e[k]]).toEqual([k, v])
    const r = columnas(XML_RECIBIDAS)
    for (const [k, v] of Object.entries(viejo('ConfiguracionRecibidas-c12.XML'))) if (k !== '001') expect([k, r[k]]).toEqual([k, v])
  })
})

type RecC12 = { numero: string; concepto: string; gastos: { subcuenta: string; importe: number }[]; iva: { base: number; pct: number; cuota: number }[]; retencion: { codigo: string; base: number; pct: number; cuota: number } | null; total: number }

describe('recibidas', () => {
  // Las tres de la prueba del C12 (entraron en la C0009 con su PDF el 24/10): la misma fila.
  const deC12 = (f: RecC12): Recibida => ({
    numero: f.numero, fechaFactura: '2026-10-24', fechaOperacion: '2026-10-24', concepto: f.concepto,
    proveedor: { subcuenta: C12.PROVEEDOR.subcuenta, nombre: C12.PROVEEDOR.nombre, nif: C12.PROVEEDOR.nif },
    gastos: f.gastos.map((g) => ({ cuenta: g.subcuenta, importe: g.importe })),
    iva: f.iva, total: f.total, url: URL,
    retencion: f.retencion ? { tipoDiez: C12.RETENCIONES[f.retencion.codigo].tipoDiez, subcuenta: C12.RETENCIONES[f.retencion.codigo].subcuenta, base: f.retencion.base, pct: f.retencion.pct, cuota: f.retencion.cuota } : null,
  })
  it('salen igual que en la prueba del C12 que entró en la C0009 (A–X), más la fecha del asiento en la Y', () => {
    const esperadas = C12.filas(URL) as unknown[][]
    ;(C12.RECIBIDAS as RecC12[]).forEach((f, i) => {
      const fila = filaRecibida(deC12(f), XML_RECIBIDAS)
      expect('porLaApi' in fila).toBe(false)
      const r = fila as unknown[]
      expect(r.slice(0, esperadas[i].length).map(norm)).toEqual(esperadas[i].map(norm))
      expect(norm(r[columnas(XML_RECIBIDAS)['001'] - 1])).toBe('2026-10-24')
    })
  })
  const base: Recibida = {
    numero: 'F-1', fechaFactura: '2026-09-30', fechaOperacion: '2026-10-02', concepto: 'Compra', url: URL,
    proveedor: { subcuenta: '40000001', nombre: 'PROVEEDOR', nif: 'B00000000' },
    gastos: [{ cuenta: '60000000', importe: 100 }], iva: [{ base: 100, pct: 10, cuota: 10 }], retencion: null, total: 110,
  }
  it('la fecha de la factura en la B y la del asiento (contable y fiscal) en la Y (meses distintos)', () => {
    const r = filaRecibida(base, XML_RECIBIDAS) as unknown[]
    expect(norm(r[1])).toBe('2026-09-30')
    expect(norm(r[24])).toBe('2026-10-02')
  })
  it('3 tipos de IVA, 3 gastos, sin NIF o sin enlace: por la API, con el porqué', () => {
    expect(filaRecibida({ ...base, iva: [{ base: 50, pct: 10, cuota: 5 }, { base: 30, pct: 21, cuota: 6.3 }, { base: 20, pct: 4, cuota: 0.8 }], total: 112.1 }, XML_RECIBIDAS)).toMatchObject({ porLaApi: expect.stringContaining('3 tipos de IVA') })
    expect(filaRecibida({ ...base, gastos: [{ cuenta: '60000000', importe: 50 }, { cuenta: '62900000', importe: 30 }, { cuenta: '62800000', importe: 20 }] }, XML_RECIBIDAS)).toMatchObject({ porLaApi: expect.stringContaining('3 cuentas de gasto') })
    expect(filaRecibida({ ...base, proveedor: { ...base.proveedor, nif: null } }, XML_RECIBIDAS)).toMatchObject({ porLaApi: expect.stringContaining('NIF') })
    expect(filaRecibida({ ...base, url: '' }, XML_RECIBIDAS)).toMatchObject({ porLaApi: expect.stringContaining('PDF') })
  })
  it('la exenta: una línea de IVA al 0 % con la base de los gastos', () => {
    const r = filaRecibida({ ...base, iva: [], total: 100 }, XML_RECIBIDAS) as unknown[]
    const col = columnas(XML_RECIBIDAS)
    expect([r[col['010'] - 1], r[col['011'] - 1], r[col['012'] - 1], r[col['045'] - 1]]).toEqual([100, 0, 0, 100])
  })
  it('una retención con un tipo que la configuración no conoce, o un asiento que no cuadra: por la API', () => {
    expect(filaRecibida({ ...base, retencion: { tipoDiez: 'XXX', subcuenta: '47510015', base: 100, pct: 15, cuota: 15 }, total: 95 }, XML_RECIBIDAS)).toMatchObject({ porLaApi: expect.stringContaining('XXX') })
    expect(filaRecibida({ ...base, total: 111 }, XML_RECIBIDAS)).toMatchObject({ porLaApi: expect.stringContaining('cuadraría') })
  })
})

describe('emitidas', () => {
  const base: Emitida = {
    numero: 'UBR-FLO-20261001', fecha: '2026-10-01', concepto: 'Ventas Uber Eats · Foodint Alcalá · 01/10/2026', url: URL,
    cliente: { subcuenta: '43000002', nombre: 'UBER EATS' },
    ingresos: [{ cuenta: '70000001', importe: 100 }, { cuenta: '70000002', importe: 50.5 }, { cuenta: '70000005', importe: 20 }, { cuenta: '70500001', importe: 10 }, { cuenta: '70009001', importe: -15.5 }],
    iva: [{ base: 165, pct: 10, cuota: 16.5 }], total: 181.5, grupo: 'FLO', nivel3: 'UBR',
  }
  it('las ventas por marca, sumadas a la 70000000; envíos y promociones aparte: 3 líneas', () => {
    expect(ingresosAgrupados(base.ingresos)).toEqual([{ cuenta: '70000000', importe: 170.5 }, { cuenta: '70500001', importe: 10 }, { cuenta: '70009001', importe: -15.5 }])
  })
  it('la fila: las líneas 1, 2 y 3 y la analítica, cada una en su columna del XML (Y–AB las nuevas)', () => {
    const r = filaEmitida(base, XML_EMITIDAS) as unknown[]
    const col = columnas(XML_EMITIDAS)
    expect([r[col['041'] - 1], r[col['043'] - 1], r[col['092'] - 1], r[col['094'] - 1]]).toEqual(['70000000', 170.5, '70500001', 10])
    expect([r[24], r[25], r[26], r[27]]).toEqual(['70009001', -15.5, 'FLO', 'UBR'])
    expect(r[col['006'] - 1]).toBe('UBR-FLO-20261001')
    expect(r[col['056'] - 1]).toBe(URL)
    expect(r[col['045'] - 1]).toBe(181.5)
  })
  it('lo común (sin local) va sin Grupo', () => {
    const r = filaEmitida({ ...base, grupo: null }, XML_EMITIDAS) as unknown[]
    expect(r[columnas(XML_EMITIDAS)['059'] - 1]).toBe('')
  })
  it('lo que no cabe va por la API: otra cuenta, 4 líneas o que no cuadra', () => {
    expect(filaEmitida({ ...base, ingresos: [...base.ingresos, { cuenta: '70800001', importe: 0.01 }] }, XML_EMITIDAS)).toMatchObject({ porLaApi: expect.stringContaining('70800001') })
    expect(ingresosAgrupados([{ cuenta: '70000001', importe: 1 }, { cuenta: '70500001', importe: 1 }, { cuenta: '70500002', importe: 1 }, { cuenta: '70009001', importe: 1 }])).toMatchObject({ porLaApi: expect.stringContaining('4 líneas') })
    expect(filaEmitida({ ...base, total: 181.49 }, XML_EMITIDAS)).toMatchObject({ porLaApi: expect.stringContaining('total') })
  })
})

describe('el cuadre agrupado', () => {
  it('las 700xxxxx cuentan como «700», las 472 como «472» y las 477 como «477»; el resto, cada una', () => {
    expect(['70000000', '70000007', '70009001', '70500001', '47700010', '47700021', '47200000', '47200010', '47510015', '7000000'].map(claveDelCuadre))
      .toEqual(['700', '700', '700', '70500001', '477', '477', '472', '472', '47510015', '7000000'])
  })
})

describe('de lo que lee el traspaso', () => {
  it('una recibida con retención, de su asiento: gasto, IVA, proveedor y la retención PRO', () => {
    const r = recibidaDeAsiento({
      fecha: '2026-10-05', factura: { numero: 'A-7', fecha: '2026-10-03' }, proveedor: { nombre: 'PROFESIONAL', nif: '00000000T' },
      lineas: [
        { cuenta: '62300000', debe: 200, haber: 0, tipoIva: null, baseIva: null },
        { cuenta: '47200021', debe: 42, haber: 0, tipoIva: 21, baseIva: 200 },
        { cuenta: '41000001', debe: 0, haber: 212, tipoIva: null, baseIva: null },
        { cuenta: '47510015', debe: 0, haber: 30, tipoIva: null, baseIva: null },
      ],
    }, URL) as Recibida
    expect(r.retencion).toEqual({ tipoDiez: 'PRO', subcuenta: '47510015', base: 200, pct: 15, cuota: 30 })
    expect(r.iva).toEqual([{ base: 200, pct: 21, cuota: 42 }])
    expect(r.total).toBe(212)
    expect('porLaApi' in filaRecibida(r, XML_RECIBIDAS)).toBe(false)
  })
  it('una autoliquidada (con 477) no va por el Excel', () => {
    expect(recibidaDeAsiento({
      fecha: '2026-10-05', factura: { numero: 'X', fecha: '2026-10-05' }, proveedor: { nombre: 'P', nif: null },
      lineas: [{ cuenta: '62900000', debe: 100, haber: 0, tipoIva: null, baseIva: null }, { cuenta: '47200021', debe: 21, haber: 0, tipoIva: 21, baseIva: 100 },
        { cuenta: '47700021', debe: 0, haber: 21, tipoIva: 21, baseIva: 100 }, { cuenta: '41000001', debe: 0, haber: 100, tipoIva: null, baseIva: null }],
    }, URL)).toMatchObject({ porLaApi: expect.stringContaining('47700021') })
  })
  it('una emitida de la factura de ventas de Sumied, con su local y su plataforma', () => {
    const f = emitidaDeVentas({
      factura: { NumeroFactura: 'UBR-FLO-20261001', CuentaCliente: '43000002', Descripcion: 'Ventas', BaseImponible1: 165, PorcentajeIVA1: 10, CuotaIVA1: 16.5, TotalFactura: 181.5,
        Apuntes: [{ Cuenta: '70000001', Importe: 170.5 }, { Cuenta: '70009001', Importe: -5.5 }] },
      fecha: '2026-10-01', nombreCliente: 'UBER', url: URL, local: 'Foodint Alcalá', canal: 'uber',
      correspondencia: { localAlEnviar: { 'Foodint Alcalá': 'FLO' }, canalAlEnviar: { uber: 'UBR' } },
    })
    expect([f.grupo, f.nivel3]).toEqual(['FLO', 'UBR'])
    expect('porLaApi' in filaEmitida(f, XML_EMITIDAS)).toBe(false)
  })
})

describe('«Ya lo he importado»: la misma factura en Diez', async () => {
  const { esLaMisma, filasDeLosExcel } = await import('../../../supabase/functions/_shared/diezTraspasoExcel.ts')
  const x = { entry_id: 'e', excel: 'recibidas' as const, numero: 'FA 2026/0012', cuenta: '40000001', subcuentas: [] }
  it('por serie, número (sin espacios, barras ni guiones) y subcuenta', () => {
    expect(esLaMisma(x, { Serie: '2', NumeroFactura: 'fa-2026-0012', CuentaCliente: '40000001' })).toBe(true)
    expect(esLaMisma(x, { Serie: '1', NumeroFactura: 'FA 2026/0012', CuentaCliente: '40000001' })).toBe(false)
    expect(esLaMisma(x, { Serie: '2', NumeroFactura: 'FA 2026/0013', CuentaCliente: '40000001' })).toBe(false)
    expect(esLaMisma(x, { Serie: '2', NumeroFactura: 'FA 2026/0012', CuentaCliente: '40000002' })).toBe(false)
    expect(esLaMisma({ ...x, excel: 'emitidas', numero: 'UBR-FLO-20261001', cuenta: '43000002' }, { Serie: '1', NumeroFactura: 'UBR-FLO-20261001', CuentaCliente: 43000002 })).toBe(true)
  })
  it('las filas: lo que va por la API no entra; el cliente de la emitida, con su nombre de Diez', () => {
    const emitida: Emitida = {
      numero: 'UBR-FLO-20261001', fecha: '2026-10-01', concepto: 'Ventas', url: URL, cliente: { subcuenta: '43000002', nombre: '' },
      ingresos: [{ cuenta: '70000001', importe: 100 }], iva: [{ base: 100, pct: 10, cuota: 10 }], total: 110, grupo: 'FLO', nivel3: 'UBR',
    }
    const r = filasDeLosExcel([
      { entry_id: 'a', excel: 'emitidas', numero: emitida.numero, cuenta: '43000002', emitida, subcuentas: [] },
      { entry_id: 'b', excel: 'recibidas', numero: 'X', cuenta: '', porLaApi: '3 tipos de IVA', subcuentas: [] },
    ], (sc) => (sc === '43000002' ? 'UBER EATS EN DIEZ' : ''))
    expect(r.recibidas).toHaveLength(0)
    expect(r.emitidas).toHaveLength(1)
    expect(r.emitidas[0][columnas(XML_EMITIDAS)['005'] - 1]).toBe('UBER EATS EN DIEZ')
  })
})

describe('los abonos de proveedor (12 en octubre y noviembre)', () => {
  it('van en el Excel en negativo: gasto, IVA y total, y el asiento cuadra', () => {
    const r = recibidaDeAsiento({
      fecha: '2026-10-15', factura: { numero: 'AB-1', fecha: '2026-10-15' }, proveedor: { nombre: 'P', nif: 'B00000000' },
      lineas: [{ cuenta: '62300000', debe: 0, haber: 11.29, tipoIva: null, baseIva: null }, { cuenta: '47200021', debe: 0, haber: 2.37, tipoIva: 21, baseIva: 11.29 },
        { cuenta: '41000001', debe: 13.66, haber: 0, tipoIva: null, baseIva: null }],
    }, URL) as Recibida
    expect([r.total, r.gastos, r.iva]).toEqual([-13.66, [{ cuenta: '62300000', importe: -11.29 }], [{ base: -11.29, pct: 21, cuota: -2.37 }]])
    expect('porLaApi' in filaRecibida(r, XML_RECIBIDAS)).toBe(false)
  })
})

describe('el IVA no deducible (ensayo del 14/11: Orange y Anthropic)', () => {
  it('no va al Excel ni como exenta ni como deducible: fuera, con su porqué', () => {
    const r = recibidaDeAsiento({
      fecha: '2026-10-05', factura: { numero: 'S11/0177416578', fecha: '2026-10-05' }, proveedor: { nombre: 'P', nif: 'B00000000' },
      lineas: [{ cuenta: '62800000', debe: 28.89, haber: 0, tipoIva: null, baseIva: null }, { cuenta: '62800000', debe: 6.07, haber: 0, tipoIva: 21, baseIva: 28.89 },
        { cuenta: '41000043', debe: 0, haber: 34.96, tipoIva: null, baseIva: null }],
    }, URL)
    expect(r).toMatchObject({ porLaApi: expect.stringContaining('IVA no deducible') })
  })
})
