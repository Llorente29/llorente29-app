// C04b · R13 · El asiento de ventas de Folvy → la factura emitida de Diez.
// Importes INVENTADOS: el repositorio es público. La forma es la medida en la
// C0009 el 13/10 (scripts/conta/diez/prueba-c0009-emitida-molde.ts).
import { describe, expect, it } from 'vitest'
import { facturaDeVentas, type AsientoVentas } from '../../../supabase/functions/_shared/diezFactura'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../supabase/functions/_shared/diezAnalitica'

const L = (cuenta: string, debe: number, haber: number, marca: string | null = null, tipoIva: number | null = null) => ({ cuenta, debe, haber, marca, tipoIva })
const uber = (lineas = [L('43000002', 33, 0), L('70000002', 0, 20, 'Meraki Pita'), L('70000001', 0, 10, 'Milanesa House'), L('47700010', 0, 3, null, 10)]): AsientoVentas =>
  ({ fecha: '2026-10-01', local: 'Foodint Alcalá', canal: 'uber', lineas })
const opciones = { correspondencia: CORRESPONDENCIA_LLORENTE29, nombreCliente: 'UBER EATS', hoy: '2026-10-13', conAnalitica: true }

describe('facturaDeVentas (R13): como las emitidas de Uber de Diez', () => {
  it('serie 1, número UBR-FLO-AAAAMMDD, descripción UBER EATS FLO dd/mm, una línea por marca y la base en TotalGastosIngresos', () => {
    const { factura: f, sinPoner, esperado } = facturaDeVentas(uber(), opciones)
    expect(f).toMatchObject({ Ejercicio: '2026', Serie: '1', TipoAsiento: 1, TipoFactura: 1, Fecha: 20261001, FechaFactura: 20261001, FechaIntroduccionFactura: 20261013,
      CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001', Descripcion: 'UBER EATS FLO 01/10',
      BaseImponible1: 30, PorcentajeIVA1: 10, CuotaIVA1: 3, TotalFactura: 33, TotalGastosIngresos: 30 })
    expect(f.CifCliente).toBeUndefined()
    expect(f.Apuntes).toEqual([
      { Linea: 1, Cuenta: '70000001', Concepto: 'UBER EATS FLO 01/10', Fecha: 20261001, Importe: 10 },
      { Linea: 2, Cuenta: '70000002', Concepto: 'UBER EATS FLO 01/10', Fecha: 20261001, Importe: 20 }])
    expect(f.Analitica).toEqual([
      { Subcuenta: '70000001', Grupo: 'FLO', Subgrupo: '1', Nivel3: 'UBR', Descripcion: 'UBER EATS FLO 01/10', Fecha: 20261001, ImporteDebe: 0, ImporteHaber: 10 },
      { Subcuenta: '70000002', Grupo: 'FLO', Subgrupo: '2', Nivel3: 'UBR', Descripcion: 'UBER EATS FLO 01/10', Fecha: 20261001, ImporteDebe: 0, ImporteHaber: 20 }])
    expect(sinPoner).toEqual([])
    expect(esperado).toEqual({ cobro: 33, base: 30, cuota: 3 })
  })
  it('el reembolso va en la misma factura, en negativo, a su 7080000x, y la base es ventas menos reembolso', () => {
    const { factura: f } = facturaDeVentas(uber([L('43000002', 33, 0), L('70000002', 0, 30, 'Meraki Pita'), L('47700010', 0, 3, null, 10),
      L('70800002', 5, 0, 'Meraki Pita'), L('47700010', 0.5, 0, null, 10), L('43000002', 0, 5.5)]), opciones)
    expect(f).toMatchObject({ BaseImponible1: 25, CuotaIVA1: 2.5, TotalFactura: 27.5, TotalGastosIngresos: 25 })
    expect((f.Apuntes as { Cuenta: string; Importe: number }[]).map((a) => [a.Cuenta, a.Importe])).toEqual([['70000002', 30], ['70800002', -5]])
    expect((f.Analitica as { Subcuenta: string; ImporteDebe: number; ImporteHaber: number }[]).map((a) => [a.Subcuenta, a.ImporteDebe, a.ImporteHaber])).toEqual([['70000002', 0, 30], ['70800002', 5, 0]])
  })
  it('Carabanchel va con CAM; sin analítica, Analitica vacía', () => {
    const { factura: f } = facturaDeVentas({ ...uber(), local: 'Foodint Carabanchel' }, { ...opciones, conAnalitica: false })
    expect(f.NumeroFactura).toBe('UBR-CAM-20261001')
    expect(f.Analitica).toEqual([])
  })
  it('lo que no se ha medido o no cuadra no sale: otra plataforma, otro tipo, otra 430, sin cuadrar, otras cuentas', () => {
    expect(() => facturaDeVentas({ ...uber(), canal: 'glovo' }, opciones)).toThrow(/patrón de factura medido/)
    expect(() => facturaDeVentas(uber([L('43000002', 32.1, 0), L('70000002', 0, 30, 'Meraki Pita'), L('47700021', 0, 2.1, null, 7)]), opciones)).toThrow(/otro tipo/)
    expect(() => facturaDeVentas(uber([L('43000001', 33, 0), L('70000002', 0, 30, 'Meraki Pita'), L('47700010', 0, 3, null, 10)]), opciones)).toThrow(/no es la de uber/)
    expect(() => facturaDeVentas(uber([L('43000002', 33.01, 0), L('70000002', 0, 30, 'Meraki Pita'), L('47700010', 0, 3, null, 10)]), opciones)).toThrow(/no cuadra/)
    expect(() => facturaDeVentas(uber([L('43000002', 33, 0), L('62300001', 0, 30), L('47700010', 0, 3, null, 10)]), opciones)).toThrow(/no lleva/)
  })
  it('una marca sin subgrupo sale sin él y se dice', () => {
    const { sinPoner } = facturaDeVentas(uber([L('43000002', 33, 0), L('70000009', 0, 30, 'Marca Nueva'), L('47700010', 0, 3, null, 10)]), opciones)
    expect(sinPoner).toEqual(['70000009: marca «Marca Nueva»: sin subgrupo en Diez'])
  })
})
