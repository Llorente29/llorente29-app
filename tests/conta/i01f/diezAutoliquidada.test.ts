// tests/conta/i01f/diezAutoliquidada.test.ts
//
// I01f · Una recibida AUTOLIQUIDADA de Folvy → su factura de la serie 2 de
// Diez, con la forma medida en la C0009 solo leyendo el 20/10 (run 140 de
// diez-prueba-c0009, las 16 autoliquidadas de nueve meses):
//   · TipoFactura 7 la intracomunitaria (6 de 6) y 6 la inversión del sujeto
//     pasivo de fuera de la UE (10 de 10); ninguna de las 2.836 normales;
//   · un solo tipo de IVA (16 de 16): el 21 % en 15 y el 23 % en una (la de
//     enero de Portugal, que se autoliquidó con el tipo de allí);
//   · TotalFactura = la base (16 de 16), TotalGastosIngresos también, y los
//     Apuntes, el gasto (629… en 15, 623… en una), que suman la base;
//   · FechaOperacion = FechaFactura (15 de 16).
// Las cuentas y la forma del asiento de Folvy son las de la propuesta del
// I01d: gasto, 472 con su tipo, 477 por la misma cuota y la base al
// proveedor. Proveedores e importes inventados.

import { describe, expect, it } from 'vitest'
import { facturaRecibida, facturaRecibidaQueAnula, type AsientoRecibida } from '../../../supabase/functions/_shared/diezRecibida'

const hoy = { hoy: '2026-10-21' }
/** Una autoliquidada como la de una francesa del 3T: 35 € de base, 7,35 € de cuota. */
const intra = (o: Partial<AsientoRecibida> = {}): AsientoRecibida => ({
  fecha: '2026-10-20', fechaFactura: '2026-10-20', numero: '2026/00001', proveedor: { nombre: 'FRANCESA INVENTADA SAS', nif: 'FR00123456789', pais: 'FR' },
  lineas: [
    { cuenta: '62900005', debe: 35, haber: 0 },
    { cuenta: '47200000', debe: 7.35, haber: 0, tipoIva: 21, baseIva: 35, tratamiento: 'intra_eu' },
    { cuenta: '47700000', debe: 0, haber: 7.35 },
    { cuenta: '41000099', debe: 0, haber: 35 },
  ],
  ...o,
})
const isp = (o: Partial<AsientoRecibida> = {}): AsientoRecibida => intra({
  numero: 'INV-0001', proveedor: { nombre: 'AMERICANA INVENTADA INC.', nif: 'US-00000001', pais: 'US' },
  lineas: [
    { cuenta: '62900005', debe: 18.5, haber: 0 },
    { cuenta: '47200000', debe: 3.89, haber: 0, tipoIva: 21, baseIva: 18.5, tratamiento: 'reverse_charge' },
    { cuenta: '47700000', debe: 0, haber: 3.89 },
    { cuenta: '41000098', debe: 0, haber: 18.5 },
  ],
  ...o,
})

describe('la forma medida en Diez', () => {
  it('intracomunitaria: TipoFactura 7, el total es la base, un tipo, la fecha de la operación y los Apuntes con el gasto', () => {
    const { factura: f, esperado } = facturaRecibida(intra(), hoy)
    expect(f).toMatchObject({
      Serie: '2', TipoAsiento: 2, TipoFactura: 7, CuentaCliente: '41000099', CifCliente: 'FR00123456789',
      BaseImponible1: 35, PorcentajeIVA1: 21, CuotaIVA1: 7.35, TotalFactura: 35, TotalGastosIngresos: 35,
      FechaFactura: 20261020, FechaOperacion: 20261020, Descripcion: '2026/00001-FRANCESA INVENTADA SAS',
    })
    expect(f.BaseImponible2).toBeUndefined()
    // La 472 y la 477 las pone Diez en el detalle: en los Apuntes, solo el gasto, que suma la base.
    expect((f.Apuntes as { Cuenta: string; Importe: number }[]).map((a) => [a.Cuenta, a.Importe])).toEqual([['62900005', 35]])
    expect(esperado).toEqual({ total: 35, bases: 35, cuotas: 7.35, tipos: [21] })
  })
  it('de fuera de la UE: TipoFactura 6', () => {
    const { factura: f } = facturaRecibida(isp(), hoy)
    expect([f.TipoFactura, f.TotalFactura, f.CuotaIVA1, f.FechaOperacion]).toEqual([6, 18.5, 3.89, 20261020])
  })
  it('una recibida normal no cambia: TipoFactura 1, sin fecha de operación, el total con la cuota', () => {
    const { factura: f } = facturaRecibida(intra({
      lineas: [
        { cuenta: '62900005', debe: 35, haber: 0 },
        { cuenta: '47200021', debe: 7.35, haber: 0, tipoIva: 21, baseIva: 35, tratamiento: 'taxed' },
        { cuenta: '41000099', debe: 0, haber: 42.35 },
      ],
    }), hoy)
    expect([f.TipoFactura, f.TotalFactura, 'FechaOperacion' in f]).toEqual([1, 42.35, false])
  })
  it('sin tratamiento (una línea de antes de la 0320) es una normal, como siempre', () => {
    const { factura: f } = facturaRecibida(intra({
      lineas: [{ cuenta: '62900005', debe: 35, haber: 0 }, { cuenta: '47200021', debe: 7.35, haber: 0, tipoIva: 21, baseIva: 35 }, { cuenta: '41000099', debe: 0, haber: 42.35 }],
    }), hoy)
    expect(f.TipoFactura).toBe(1)
  })
})

describe('lo que no se manda, y dice por qué', () => {
  const sin = (a: AsientoRecibida, cuenta: string) => ({ ...a, lineas: a.lineas.filter((l) => !l.cuenta.startsWith(cuenta)) })
  it('sin la 477: falta la autorrepercusión', () => {
    const a = sin(intra(), '477')
    expect(() => facturaRecibida(a, hoy)).toThrow('falta la autorrepercusión')
  })
  it('la 477 por otra cuota', () => {
    const a = intra()
    a.lineas[2] = { cuenta: '47700000', debe: 0, haber: 7 }
    a.lineas[3] = { cuenta: '41000099', debe: 0, haber: 35 }
    expect(() => facturaRecibida(a, hoy)).toThrow('no es la misma cuota')
  })
  it('una 477 en una recibida normal', () => {
    const a = intra()
    a.lineas[1] = { ...a.lineas[1], tratamiento: 'taxed' }
    expect(() => facturaRecibida(a, hoy)).toThrow('una recibida normal no la lleva')
  })
  it('el proveedor facturando base + cuota en una autoliquidada', () => {
    const a = intra()
    a.lineas[0] = { cuenta: '62900005', debe: 35, haber: 0 }
    a.lineas[3] = { cuenta: '41000099', debe: 0, haber: 42.35 }
    a.lineas.push({ cuenta: '62900005', debe: 7.35, haber: 0 })
    expect(() => facturaRecibida(a, hoy)).toThrow()
  })
  it('la inversión del sujeto pasivo de un proveedor de España: Diez no tiene ninguna para medirla', () => {
    expect(() => facturaRecibida(isp({ proveedor: { nombre: 'OBRAS INVENTADAS, S.L.', nif: 'B00000000', pais: 'ES' } }), hoy)).toThrow('proveedor de España')
    expect(() => facturaRecibida(isp({ proveedor: { nombre: 'OBRAS INVENTADAS, S.L.', nif: 'B00000000' } }), hoy)).toThrow('proveedor de España')
  })
  it('dos tipos autoliquidados: las de Diez llevan uno', () => {
    const a = intra({
      lineas: [
        { cuenta: '62900005', debe: 135, haber: 0 },
        { cuenta: '47200000', debe: 7.35, haber: 0, tipoIva: 21, baseIva: 35, tratamiento: 'intra_eu' },
        { cuenta: '47200000', debe: 10, haber: 0, tipoIva: 10, baseIva: 100, tratamiento: 'intra_eu' },
        { cuenta: '47700000', debe: 0, haber: 17.35 },
        { cuenta: '41000099', debe: 0, haber: 135 },
      ],
    })
    expect(() => facturaRecibida(a, hoy)).toThrow('2 tipos de IVA')
  })
})

describe('anular una autoliquidada ya enviada', () => {
  // Medido en la C0009 (20/10, documentos 3176 y 3177): Diez acepta la «-ANUL»
  // de una autoliquidada pero solo le da la vuelta al proveedor, y descuadra.
  it('no se manda: Diez la descuadra (la intracomunitaria y la del sujeto pasivo)', () => {
    const original = facturaRecibida(intra(), hoy).factura
    expect(original.TipoFactura).toBe(7)
    expect(() => facturaRecibidaQueAnula(original, { fecha: '2026-11-03', hoy: '2026-11-03' })).toThrow(/autoliquidada.*descuadra/)
    expect(() => facturaRecibidaQueAnula({ ...original, TipoFactura: 6 }, { fecha: '2026-11-03', hoy: '2026-11-03' })).toThrow(/autoliquidada/)
  })
  it('la de una normal sigue sin fecha de operación', () => {
    const original = facturaRecibida(intra({
      lineas: [{ cuenta: '62900005', debe: 35, haber: 0 }, { cuenta: '47200021', debe: 7.35, haber: 0, tipoIva: 21, baseIva: 35, tratamiento: 'taxed' }, { cuenta: '41000099', debe: 0, haber: 42.35 }],
    }), hoy).factura
    expect('FechaOperacion' in facturaRecibidaQueAnula(original, { fecha: '2026-11-03', hoy: '2026-11-03' })).toBe(false)
  })
})
