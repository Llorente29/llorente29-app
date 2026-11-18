// tests/unit/modules/conta/erp10/comparar.test.ts
//
// X06 · «Comprueba que queda igual» (src/modules/conta/erp10/comparar.ts). Con la forma
// que devuelve conta_erp10_comprobar en la prueba de staging del X06 y las cifras de la
// maqueta aprobada (maqueta_salida_paso3.png): la A-1402 de 82,10 (67,85 de base y
// 14,25 de IVA) salió y no está en ERP10. Cada explicación, y lo que Sumied no sabe.
// Datos inventados y que se ven inventados (T11).

import { describe, expect, it } from 'vitest'
import { comparar, conDiferencia, explicar, fechaDelSumas, papel, type AsientoSumied, type Comprobar, type LoQueNoHaSalido } from '@/modules/conta/erp10/comparar'
import { aComprobar } from '@/modules/conta/services/erp10Service'
import type { FilaSumas } from '@/modules/conta/lib/traer'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const LOTE = id(900)
const as = (n: number, o: Partial<AsientoSumied> & { lineas: [string, number][] }): AsientoSumied => ({
  entryId: id(n), serie: 2, numero: n, fecha: '2026-11-03', concepto: `Inventado X06 ${n}`, origen: 'supplier_invoice', estado: 'validado',
  deshace: null, factura: null, tercero: null, salida: null, aMano: null, ...o, lineas: o.lineas.map(([cuenta, importe]) => ({ cuenta, importe })),
})
const salida = { lote: LOTE, mes: '2026-11-01', salioEn: '2026-11-30T10:00:00Z', clase: 'recibida' }
/** Una fila del sumas y saldos de ERP10, en céntimos, con su saldo deudor (+) o acreedor (−). */
const fila = (subcuenta: string, saldo: number, nombre = ''): FilaSumas =>
  ({ subcuenta, nombre, debe: 0, haber: 0, deudor: saldo > 0 ? Math.round(saldo * 100) : 0, acreedor: saldo < 0 ? Math.round(-saldo * 100) : 0 })
const base = (saldos: [string, number, string][], asientos: AsientoSumied[]): Comprobar => aComprobar({
  fecha: '2026-11-30', ejercicio: { desde: '2026-01-01', hasta: '2026-12-31' }, desde: '2026-11-01', codigo: '0007', largo: 8,
  saldos: saldos.map(([codigo, saldo, nombre]) => ({ codigo, plantilla: codigo.slice(0, 3), nombre, saldo, erp: codigo })),
  asientos, lotes: [{ id: LOTE, mes: '2026-11-01', creadoEn: '2026-11-30T10:00:00Z', quien: 'Persona Inventada' }], igualado: null,
})
const NADA: LoQueNoHaSalido = { porSacar: new Set(), noPueden: new Map() }

// La maqueta: la A-1402 salió (con otra B-1 que sí está en ERP10) y a ERP10 le falta.
const A1402 = as(1, { factura: 'A-1402', salida, lineas: [['41000012', -82.10], ['47200000', 14.25], ['62900000', 67.85]] })
const B1 = as(2, { factura: 'B-1', salida, lineas: [['41000012', -164.20], ['47200000', 2296.30], ['62900000', 1132.15], ['57200001', -3264.25]] })
const SALDOS: [string, number, string][] = [
  ['41000012', -246.30, 'Suministros Ejemplo, S.A.'], ['47200000', 2310.55, 'Hacienda Pública, IVA soportado'], ['62900000', 1200.00, 'Otros servicios'],
  ['57200001', 12480.15, 'Banco principal'], ['40000007', -1602.54, 'Distribuciones Ejemplo, S.L.'],
]
const ERP = [fila('41000012', -164.20), fila('47200000', 2296.30), fila('62900000', 1132.15), fila('57200001', 12480.15), fila('40000007', -1602.54)]

describe('Una factura que falta entera en ERP10', () => {
  const r = comparar(ERP, base(SALDOS, [A1402, B1]), NADA)
  it('las tres cuentas de la factura no quedan igual, con las cifras de la maqueta; las demás, sí', () => {
    expect(r.noIgual.map((x) => [x.cuenta, x.sumied, x.erp10, x.diferencia])).toEqual([
      ['41000012', 24630, 16420, -8210], ['47200000', 231055, 229630, -1425], ['62900000', 120000, 113215, -6785],
    ])
    expect(r.igual.map((x) => x.cuenta)).toEqual(['40000007', '57200001'])
    expect(conDiferencia(r.noIgual.length)).toBe('3 cuentas con diferencia')
    expect(r.igualable).toBe(false)
  })
  it('el aviso dice qué factura falta, de cuánto y en qué tanda, con sus dos salidas', () => {
    const x = r.noIgual[0]
    const { avisos, notas } = explicar(x, r.cuentas, LOTE)
    expect(avisos).toEqual([{
      titulo: 'En ERP10 falta una factura.', texto: 'La A-1402 del 03/11, de 82,10, salió de Sumied en esta tanda y no está en el saldo de ERP10.',
      acciones: ['volver', 'a_mano'], entryId: id(1), tono: 'ambar',
    }])
    expect(notas).toEqual([
      { titulo: 'Las otras dos diferencias son de la misma factura:', texto: 'su IVA (14,25) en la 47200000 y su base (67,85) en la 62900000.' },
      { titulo: 'Sumied no sabe por qué ERP10 no la cogió.', texto: 'Solo ve que falta. El motivo lo dice ERP10 al importar.' },
    ])
  })
  it('desde la cuenta de gasto, las otras son el total y el IVA; de otra tanda, con su fecha', () => {
    const { avisos, notas } = explicar(r.noIgual[2], r.cuentas, id(999))
    expect(avisos[0].texto).toBe('La A-1402 del 03/11, de 82,10, salió de Sumied en la tanda del 30/11 y no está en el saldo de ERP10.')
    expect(notas[0].texto).toBe('su total (82,10) en la 41000012 y su IVA (14,25) en la 47200000.')
  })
  it('los totales de las tres columnas', () => {
    expect(r.totales).toEqual({ sumied: 24630 + 231055 + 120000 + 1248015 + 160254, erp10: 16420 + 229630 + 113215 + 1248015 + 160254, diferencia: -8210 - 1425 - 6785 })
  })
})

describe('«Ya la he metido a mano»', () => {
  it('la factura metida a mano explica la diferencia y deja darlo por igualado', () => {
    const conMano = { ...A1402, aMano: { quien: 'Persona Inventada', cuando: '2026-12-01T09:00:00Z' } }
    const r = comparar(ERP, base(SALDOS, [conMano, B1]), NADA)
    expect(r.noIgual.map((x) => [x.cuenta, x.partidas.map((p) => p.clase), x.bloquea])).toEqual([
      ['41000012', ['a_mano'], false], ['47200000', ['a_mano'], false], ['62900000', ['a_mano'], false],
    ])
    expect(r.igualable).toBe(true)
    expect(explicar(r.noIgual[0], r.cuentas, LOTE).avisos[0]).toMatchObject({
      titulo: 'Metida a mano en ERP10.', texto: 'La A-1402 del 03/11, de 82,10: lo apuntó Persona Inventada el 01/12. Ya no cuenta como diferencia.', acciones: [],
    })
  })
})

describe('Una que cambió después de salir', () => {
  it('salió, se anuló en Sumied y ERP10 tiene la de antes: el contraasiento lo explica, y se dice qué hacer', () => {
    const orig = as(3, { factura: 'C-7', salida, estado: 'anulado', lineas: [['41000012', -121], ['62900000', 121]] })
    const contra = as(4, { origen: 'reversal', deshace: id(3), fecha: '2026-11-20', lineas: [['41000012', 121], ['62900000', -121]] })
    const r = comparar([fila('41000012', -121), fila('62900000', 121)], base([['41000012', 0, 'Proveedor'], ['62900000', 0, 'Gasto']], [orig, contra]), NADA)
    expect(r.noIgual.map((x) => [x.cuenta, x.diferencia, x.partidas.map((p) => p.clase), x.bloquea])).toEqual([
      ['41000012', 12100, ['cambiada'], true], ['62900000', 12100, ['cambiada'], true],
    ])
    expect(explicar(r.noIgual[0], r.cuentas, LOTE).avisos[0]).toEqual({
      titulo: 'Cambió después de salir.', texto: 'Salió a ERP10 y después se anuló en Sumied (el 20/11, 121,00). ERP10 tiene la de antes: corrígela a mano en ERP10.',
      acciones: ['a_mano'], entryId: id(4), tono: 'ambar',
    })
  })
})

describe('Lo que todavía no sale por aquí', () => {
  // El banco lleva una recibida que salió (pagada) y una nómina que no sale.
  const pago = as(5, { factura: 'D-1', salida, lineas: [['41000012', 100], ['57200001', -100]] })
  const nomina = as(6, { origen: 'payroll', serie: 4, lineas: [['64000000', 1500], ['57200001', -1500]] })
  const saldos: [string, number, string][] = [['41000012', 100, 'Proveedor'], ['57200001', -1600, 'Banco'], ['64000000', 1500, 'Sueldos']]

  it('una cuenta cuya diferencia es solo eso va al grupo de en medio y no impide igualar', () => {
    const r = comparar([fila('41000012', 100), fila('57200001', -100)], base(saldos, [pago, nomina]), NADA)
    expect(r.noSale.map((x) => [x.cuenta, x.diferencia, x.partidas.map((p) => p.clase)])).toEqual([
      ['57200001', -150000, ['no_sale_aqui']], ['64000000', -150000, ['no_sale_aqui']],
    ])
    expect(r.noIgual).toEqual([])
    expect(r.igualable).toBe(true)
    expect(explicar(r.noSale[0], r.cuentas, LOTE).avisos).toEqual([{
      titulo: 'Todavía no sale por aquí.',
      texto: 'Un asiento de 1.500,00 que hoy no sale a ERP10 (nóminas, bancos, días del TPV o facturas que hay que meter a mano). No es un fallo: se meten en ERP10 como hasta ahora.',
      acciones: [], entryId: null, tono: 'gris',
    }])
  })
  it('una mezclada con un fallo de verdad sale en «no quedan igual», con las dos cosas separadas', () => {
    const r = comparar([fila('41000012', 100), fila('57200001', -50)], base(saldos, [pago, nomina]), NADA)
    const banco = r.cuentas.find((x) => x.cuenta === '57200001')!
    expect([banco.grupo, banco.partidas.map((p) => [p.clase, p.importe]), banco.bloquea]).toEqual(['no_igual', [['desconocida', -5000], ['no_sale_aqui', -150000]], true])
  })
  it('una emitida que hay que meter a mano (su porqué lo dice) cuenta como «no sale por aquí»', () => {
    const rect = as(7, { factura: 'R-1', lineas: [['43000001', -24.2], ['70000000', 20], ['47700021', 4.2]] })
    const nh = { porSacar: new Set<string>(), noPueden: new Map([[id(7), 'Es una rectificativa, y ERP10 no la admite al importar. Métela a mano en ERP10.']]) }
    const r = comparar([], base([['43000001', -24.2, 'Cliente'], ['70000000', 20, 'Ventas'], ['47700021', 4.2, 'IVA']], [rect]), nh)
    expect(r.noSale).toHaveLength(3)
    expect(r.igualable).toBe(true)
  })
})

describe('Lo que no pudo salir o está por sacar', () => {
  it('no pudo salir: su porqué, y se puede apuntar que se metió a mano', () => {
    const mala = as(8, { factura: 'E-9', lineas: [['41000012', -50], ['62900000', 50]] })
    const nh = { porSacar: new Set<string>(), noPueden: new Map([[id(8), 'Usa la cuenta 4100012345, que no se puede pasar a ERP10: no sale.']]) }
    const r = comparar([], base([['41000012', -50, 'P'], ['62900000', 50, 'G']], [mala]), nh)
    expect(explicar(r.noIgual[0], r.cuentas, LOTE).avisos[0]).toEqual({
      titulo: 'No pudo salir.', texto: 'La E-9 del 03/11, de 50,00: Usa la cuenta 4100012345, que no se puede pasar a ERP10: no sale.',
      acciones: ['a_mano'], entryId: id(8), tono: 'ambar',
    })
    expect(r.igualable).toBe(false)
  })
  it('por sacar: se dice que vaya al paso 1', () => {
    const pend = as(9, { factura: 'F-3', lineas: [['41000012', -10], ['62900000', 10]] })
    const r = comparar([], base([['41000012', -10, 'P'], ['62900000', 10, 'G']], [pend]), { porSacar: new Set([id(9)]), noPueden: new Map() })
    expect(explicar(r.noIgual[0], r.cuentas, LOTE).avisos[0].texto).toBe('La F-3 del 03/11, de 10,00, está en lo que sale y no se ha descargado. Sácala en el paso 1.')
  })
})

describe('Lo que Sumied no sabe explicar', () => {
  it('una diferencia que no es de nada que salió ni de nada que no salió: lo dice, sin inventar una factura', () => {
    const r = comparar([fila('41000012', -246.30), fila('47200000', 2310.55), fila('62900000', 1200), fila('57200001', 12480.15), fila('40000007', -1600)],
      base(SALDOS, [A1402, B1]), NADA)
    const x = r.cuentas.find((c) => c.cuenta === '40000007')!
    expect([x.grupo, x.diferencia, x.partidas.map((p) => p.clase), x.bloquea]).toEqual(['no_igual', -254, ['desconocida'], true])
    expect(explicar(x, r.cuentas, LOTE)).toEqual({
      avisos: [{ titulo: 'Sumied no sabe explicar esta diferencia.', texto: 'Hay 2,54 que no son de nada de lo que salió ni de lo que se ha quedado sin salir. Mira el mayor de esta cuenta en los dos programas.',
        acciones: [], entryId: null, tono: 'ambar' }],
      notas: [],
    })
  })
  it('una cuenta que está en ERP10 y no en Sumied', () => {
    const r = comparar([fila('55500000', 30)], base([], []), NADA)
    expect(r.noIgual[0]).toMatchObject({ cuenta: '55500000', soloEnErp10: true, sumied: 0, erp10: 3000, diferencia: 3000 })
    expect(explicar(r.noIgual[0], r.cuentas, LOTE).avisos[0].texto).toBe('ERP10 tiene 30,00 en la 55500000 y en Sumied no hay nada que lo explique. Mira el mayor de esta cuenta en ERP10.')
  })
})

describe('Lo de alrededor', () => {
  it('el papel de cada cuenta en una factura', () => {
    expect(['62900000', '47200000', '47700021', '41000012', '43000001', '47510000', '57200001'].map(papel))
      .toEqual(['su base', 'su IVA', 'su IVA', 'su total', 'su total', 'su retención', 'su importe'])
  })
  it('la fecha del sumas y saldos: la de su cabecera, o el último día del mes', () => {
    expect(fechaDelSumas(['Balance de sumas y saldos', 'Hasta fecha: 30/11/2026'], '2026-11-01')).toBe('2026-11-30')
    expect(fechaDelSumas(['Balance de sumas y saldos'], '2026-11-01')).toBe('2026-11-30')
    expect(fechaDelSumas([], '2026-02-01')).toBe('2026-02-28')
  })
})
