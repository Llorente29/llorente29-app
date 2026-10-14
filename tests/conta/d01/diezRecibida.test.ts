// D01 · Tarea 5 · De la propuesta de Folvy (facturaProveedor) a la factura de la
// serie 2 de Diez, con la forma medida en la C0009. Importes inventados.
import { describe, expect, it } from 'vitest'
import { facturaProveedor, type EntradaFactura } from '../../../src/modules/conta/lib/asientosPropuestos'
import { facturaRecibida, type AsientoRecibida } from '../../../supabase/functions/_shared/diezRecibida'

const cuentas = {
  proveedor: '40000012',
  ivaSoportado: (p: number) => ({ cuenta: `472000${String(p).padStart(2, '0')}`, tipoId: `t${p}` }),
  retencion: '47510019',
}
const entrada = (o: Partial<EntradaFactura> = {}): EntradaFactura => ({
  id: 'f1', numero: 'PD01/77', fecha: '2026-10-11', proveedor: 'Mayorista Inventado', terceroId: 'p1', esSocio: false, tieneNif: true, localId: 'l1',
  lineas: [{ base: 100, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }, { base: 50, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62900000' }],
  total: 170.5, retencion: null, ...o,
})
/** La propuesta de Folvy, como la leería el envío del asiento validado. */
function asiento(e: EntradaFactura, extra: Partial<AsientoRecibida> = {}): AsientoRecibida {
  const p = facturaProveedor(e, cuentas).propuesta!
  return {
    fecha: p.fecha, fechaFactura: e.fecha, numero: e.numero ?? '', proveedor: { nombre: 'MAYORISTA INVENTADO, S.L.', nif: 'B00000011' },
    lineas: p.lineas.map((l) => ({ cuenta: l.cuenta, debe: l.debe, haber: l.haber, tipoIva: l.iva?.tipo ?? null, baseIva: l.iva?.base ?? null })),
    ...extra,
  }
}

describe('la propuesta de Folvy → la factura de la serie 2', () => {
  it('dos tipos y dos gastos: la forma medida (serie 2, TipoAsiento 2, TipoFactura 1, Apuntes = bases)', () => {
    const r = facturaRecibida(asiento(entrada()), { hoy: '2026-10-13' })
    expect(r.factura).toMatchObject({
      Ejercicio: '2026', Serie: '2', TipoAsiento: 2, TipoFactura: 1, Fecha: 20261011, FechaFactura: 20261011, FechaIntroduccionFactura: 20261013,
      CuentaCliente: '40000012', CifCliente: 'B00000011', NombreCliente: 'MAYORISTA INVENTADO, S.L.', NumeroFactura: 'PD01/77',
      Descripcion: 'PD01/77-MAYORISTA INVENTADO, S.L.',
      BaseImponible1: 50, PorcentajeIVA1: 21, CuotaIVA1: 10.5, BaseImponible2: 100, PorcentajeIVA2: 10, CuotaIVA2: 10,
      TotalFactura: 170.5, TotalGastosIngresos: 150,
    })
    expect(r.factura.Apuntes).toEqual([
      { Linea: 1, Cuenta: '60000000', Concepto: 'PD01/77-MAYORISTA INVENTADO, S.L.', Fecha: 20261011, Importe: 100 },
      { Linea: 2, Cuenta: '62900000', Concepto: 'PD01/77-MAYORISTA INVENTADO, S.L.', Fecha: 20261011, Importe: 50 },
    ])
    // La 472 no se manda: la pone Diez.
    expect(JSON.stringify(r.factura)).not.toContain('472')
  })
  it('el asiento después de la factura: Fecha del asiento, FechaFactura la suya', () => {
    const r = facturaRecibida(asiento(entrada(), { fecha: '2026-10-20' }), { hoy: '2026-10-20' })
    expect([r.factura.Fecha, r.factura.FechaFactura]).toEqual([20261020, 20261011])
  })
  it('lo no medido no se manda, y dice por qué', () => {
    const hoy = { hoy: '2026-10-13' }
    expect(() => facturaRecibida(asiento(entrada({ retencion: { tipoId: 'r', porcentaje: 15, base: 150, importe: 22.5, modelo: '111' }, total: 148 })), hoy)).toThrow(/retención/)
    expect(() => facturaRecibida(asiento(entrada(), { numero: ' ' }), hoy)).toThrow(/número/)
    const a = asiento(entrada())
    expect(() => facturaRecibida({ ...a, lineas: [...a.lineas, { cuenta: '76900000', debe: 0, haber: 0.01 }] }, hoy)).toThrow(/no lleva: 76900000/)
    expect(() => facturaRecibida({ ...a, lineas: a.lineas.map((l) => (l.cuenta.startsWith('400') ? { ...l, haber: 170.49 } : l)) }, hoy)).toThrow(/no cuadra/)
    expect(() => facturaRecibida({ ...a, lineas: a.lineas.map((l) => (l.cuenta.startsWith('400') ? { ...l, haber: 0, debe: 170.5 } : l)) }, hoy)).toThrow(/abono/)
    expect(() => facturaRecibida({ ...a, fecha: '2026-10-01' }, hoy)).toThrow(/posterior/)
  })
  it('cuatro tipos no caben (Diez guarda hasta tres en las medidas)', () => {
    const e = entrada({
      lineas: [4, 10, 21, 5].map((p) => ({ base: 10, tipo: { id: `t${p}`, porcentaje: p }, cuentaGasto: '60000000' })),
      total: 10 * 4 + 0.4 + 1 + 2.1 + 0.5,
    })
    expect(() => facturaRecibida(asiento(e), { hoy: '2026-10-13' })).toThrow(/4 tipos/)
  })
})
