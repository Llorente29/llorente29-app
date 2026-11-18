// tests/conta/n06a/paraLaBase.test.ts
//
// N06a · Lo leído, en la forma que recibe la base para traerlo en prueba (paraLaBase), contra el
// ejemplo inventado de ERP10 (tests/conta/fixtures/importar/erp10) y las cifras de su LEEME. Y que
// el ejemplo que lleva la prueba de staging (supabase/staging/sql/20261117_n06a_carga_prueba.sql)
// es EXACTAMENTE lo que sale de aquí: la prueba de la base y la de la pantalla miden lo mismo.

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { abrirExcel, leerCarga, paraLaBase, type FicheroExcel } from '@/modules/conta/lib/traer'

const D = 'tests/conta/fixtures/importar/erp10'
const EJEMPLO: readonly FicheroExcel[] = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort().map((f) => abrirExcel(f, readFileSync(`${D}/${f}`)))
const datos = paraLaBase(leerCarga(EJEMPLO))
const asiento = (serie: string, documento: string) => datos.asientos.find((a) => a.serie === serie && a.documento === documento)!
const factura = (numero: string) => datos.facturas.find((f) => f.numero === numero)!

describe('N06a · paraLaBase con el ejemplo de ERP10 (LEEME)', () => {
  it('el diario: 10 asientos, 26 apuntes leídos, 11.499,00 al debe y al haber (en céntimos)', () => {
    expect(datos.asientos).toHaveLength(10)
    expect(datos.asientos.reduce((s, a) => s + a.apuntesLeidos, 0)).toBe(26)
    const debe = datos.asientos.flatMap((a) => a.apuntes).reduce((s, x) => s + x.debe, 0)
    const haber = datos.asientos.flatMap((a) => a.apuntes).reduce((s, x) => s + x.haber, 0)
    expect([debe, haber]).toEqual([1149900, 1149900])
    for (const a of datos.asientos) {
      expect(a.apuntes.reduce((s, x) => s + x.debe - x.haber, 0)).toBe(0)
    }
  })

  it('la B-7: su 472 de 41,00 se parte en 21,00 al 21 % (base 100,00) y 20,00 al 10 % (base 200,00)', () => {
    const iva = asiento('2', '2').apuntes.filter((x) => x.cuenta === '47200000')
    expect(iva.map((x) => [x.debe, x.iva])).toEqual([
      [2100, { tipo: 21, base: 10000, libro: 'received' }],
      [2000, { tipo: 10, base: 20000, libro: 'received' }],
    ])
    expect(asiento('2', '2').apuntesLeidos).toBe(3)
    expect(asiento('2', '2').apuntes).toHaveLength(4)
  })

  it('la ALQ-3: la retención del 19 % con la base de la factura; las emitidas, su 477 con su tipo', () => {
    expect(asiento('2', '3').apuntes.find((x) => x.cuenta === '47510000')).toMatchObject({ haber: 19000, retencion: { tipo: 19, base: 100000 } })
    expect(asiento('1', '1').apuntes.find((x) => x.cuenta === '47700000')).toMatchObject({ haber: 10000, iva: { tipo: 10, base: 100000, libro: 'issued' } })
    expect(datos.asientos.flatMap((a) => a.apuntes).filter((x) => x.sinTipo)).toEqual([])
  })

  it('las facturas: 5, casadas con su asiento; pendiente por el saldo (F-2, B-7 y ALQ-3) y pagadas (F-1 y A-10)', () => {
    expect(datos.facturas.map((f) => [f.numero, f.libro, f.asiento, f.pendiente])).toEqual([
      ['A-10', 'recibidas', '2.1|2026-01-20', 0],
      ['B-7', 'recibidas', '2.2|2026-02-05', 34100],
      ['ALQ-3', 'recibidas', '2.3|2026-03-01', 102000],
      ['F-1', 'expedidas', '1.1|2026-01-15', 0],
      ['F-2', 'expedidas', '1.2|2026-02-10', 55000],
    ])
    expect([factura('F-2').serie, factura('F-2').numeroSolo]).toEqual(['F', '2'])
    expect([factura('B-7').serie, factura('B-7').numeroSolo]).toEqual([null, null])
  })

  it('el plan, los terceros y lo aprendido: 16 cuentas de 8 cifras, 5 terceros y 3 proveedores con su IVA', () => {
    expect(datos.largos).toEqual([8])
    expect(datos.cuentas).toHaveLength(16)
    expect(datos.terceros.map((t) => `${t.clase} ${t.codigo}`)).toEqual([
      'proveedor 40000000', 'proveedor 40000001', 'proveedor 40000002', 'proveedor 41000001', 'cliente 43000001',
    ])
    expect(datos.aprendido.map((a) => [a.codigo, a.tiposIva, a.retencion])).toEqual([
      ['40000001', [21], null], ['40000002', [10, 21], null], ['41000001', [21], 19],
    ])
    expect(datos.pendientesNoExactos).toEqual([])
    expect(datos.inmovilizado?.elementos).toHaveLength(1)
  })

  it('la prueba de staging lleva exactamente esto', () => {
    const sql = readFileSync('supabase/staging/sql/20261117_n06a_carga_prueba.sql', 'utf8')
    const m = /'n06a\.datos', \$carga\$(.*?)\$carga\$/s.exec(sql)
    expect(m).not.toBeNull()
    // N06b añadió el sumas y saldos (sumas), que el ejemplo de la prueba del N06a no llevaba.
    expect(JSON.parse(m![1])).toEqual({ ...datos, sumas: undefined })
  })
})
