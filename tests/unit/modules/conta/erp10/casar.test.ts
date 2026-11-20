// tests/unit/modules/conta/erp10/casar.test.ts — X10c · El paso 3 casa factura a factura con el
// número que dio ERP10 (src/modules/conta/erp10/casar.ts). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { casarFacturas, frasesCasadas } from '@/modules/conta/erp10/casar'
import type { Comprobar } from '@/modules/conta/erp10/comparar'

const asiento = (n: number, lineas: [string, number][]) => ({
  entryId: `a-${n}`, serie: 2, numero: n, fecha: '2026-10-05', concepto: 'Inventado', origen: 'manual', estado: 'validado', deshace: null,
  factura: `F-${n}`, tercero: 'Proveedor Inventado', salida: null, aMano: null, lineas: lineas.map(([cuenta, importe]) => ({ cuenta, importe })),
})
const BASE: Comprobar = {
  fecha: '2026-10-31', ejercicio: { desde: '2026-01-01', hasta: '2026-12-31' }, desde: '2026-10-01', codigo: '0007', largo: 8,
  saldos: [
    { codigo: '4000001', plantilla: '400', nombre: 'Proveedor', saldo: 0, erp: '40000001' },
    { codigo: '6290001', plantilla: '629', nombre: 'Gasto', saldo: 0, erp: '62900001' },
    { codigo: '47200021', plantilla: '472', nombre: 'IVA 21', saldo: 0, erp: '47200021' },
  ],
  asientos: [1, 2, 3, 4].map((n) => asiento(n, [['6290001', 100], ['47200021', 21], ['4000001', -121]])),
  lotes: [], igualado: null,
}
const doc = (documento: number, lineas: [string, number][]) => ({ serie: '2', documento, lineas: lineas.map(([cuenta, importe]) => ({ cuenta, importe })) })
const ENVIOS = [1, 2, 3, 4, 5].map((n) => ({ entryId: `a-${n}`, clase: 'recibida', serie: '2', documento: 100 + n }))

describe('casar factura a factura', () => {
  it('igual, en otras cuentas (la 472 de ERP10), con otro total y ya no está; la de fuera de la comparación no sale', () => {
    const r = casarFacturas(ENVIOS, [
      doc(101, [['62900001', 10000], ['47200021', 2100], ['40000001', -12100]]),
      doc(102, [['62900001', 10000], ['47200000', 2100], ['40000001', -12100]]),
      doc(103, [['62900001', 9000], ['47200021', 2100], ['40000001', -11100]]),
    ], BASE)
    expect(r.map((x) => [x.numero, x.estado])).toEqual([['F-1', 'igual'], ['F-2', 'otras_cuentas'], ['F-3', 'distinta'], ['F-4', 'no_esta']])
    expect(r[1].detalle).toBe('Está en ERP10 como 2/102 por el mismo total, pero en otras cuentas: 47200000 (0,00 en Sumied, 21,00 en ERP10), 47200021 (21,00 en Sumied, 0,00 en ERP10).')
    expect(r[2].detalle).toBe('En ERP10 la 2/103 suma 111,00 y en Sumied 121,00.')
    expect(r[3].detalle).toBe('Salió como 2/104 y ERP10 ya no tiene ese número: la han borrado o cambiado allí.')
  })
  it('la línea de arriba: todas iguales, o cuántas no', () => {
    const iguales = casarFacturas(ENVIOS.slice(0, 1), [doc(101, [['62900001', 10000], ['47200021', 2100], ['40000001', -12100]])], BASE)
    expect(frasesCasadas(iguales)).toMatchObject({ bien: true, resumen: 'Factura a factura: la que salió por la conexión está en ERP10 con su número, igual.' })
    const r = casarFacturas(ENVIOS.slice(0, 2), [doc(101, [['62900001', 10000], ['47200021', 2100], ['40000001', -12100]])], BASE)
    expect(frasesCasadas(r)).toMatchObject({ bien: false, resumen: 'Factura a factura: 1 de 2 están en ERP10 igual; 1 no.' })
  })
  it('X10d · los asientos: con su número de Sumied, y «asiento a asiento»', () => {
    const r = casarFacturas([{ entryId: 'a-1', clase: 'asiento', serie: '1', documento: 5000 }], [{ serie: '1', documento: 5000, lineas: [{ cuenta: '62900001', importe: 10000 }, { cuenta: '47200021', importe: 2100 }, { cuenta: '40000001', importe: -12100 }] }], BASE)
    expect(r).toMatchObject([{ numero: '2/1', estado: 'igual', clase: 'asiento' }])
    expect(frasesCasadas(r).resumen).toBe('Asiento a asiento: el que salió por la conexión está en ERP10 con su número, igual.')
    const no = casarFacturas([{ entryId: 'a-1', clase: 'asiento', serie: '1', documento: 5001 }], [], BASE)
    expect(no[0].detalle).toBe('Salió como 1/5001 y ERP10 ya no tiene ese número: lo han borrado o cambiado allí.')
  })
})
