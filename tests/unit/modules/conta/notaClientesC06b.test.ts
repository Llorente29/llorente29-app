// C06b · El balance según la norma (respuesta 6 de Julio, tarea 1): los
// clientes, deudores, proveedores y acreedores van por el signo de su saldo y
// no se compensan (PGC, primera parte, principio 5; tercera parte, norma 6.ª.2).
//
// Contra la población REAL (regla 31): los modelos y el mapeo de serie que salen
// del BOE (supabase/conta/pgc/cuentas-anuales.json, con las filas de la 0600) y
// el cuadro de cuentas entero del C02 (supabase/conta/pgc/serie.json). Y con la
// FORMA de Foodint al 30/09 —siete subcuentas de cliente, cinco acreedoras y
// dos deudoras—, con importes inventados: nada real en el repositorio.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcularEstado, cuadreBalance, mapeoEfectivo, type FilaMapeo, type LineaModelo, type Modelo, type SaldoCuenta } from '@/modules/conta/lib/cuentasAnuales'
import { NOTA_CLIENTES_PASIVO, esLineaClientes, notaClientes } from '@/modules/conta/lib/notaClientes'

type Ref = {
  lineas: { model: Modelo; statement: string; code: string; parent_code: string | null; text: string; level: number; sort_order: number; side: 'activo' | 'pn_pasivo' | null; is_total: boolean; to_create: boolean; legal_ref: string }[]
  mapeo: { model: Modelo; statement: string; line_code: string; account_prefix: string; sign: 'suma' | 'resta'; by_balance: 'deudor' | 'acreedor' | null; origin: FilaMapeo['origin']; note: string | null }[]
}
const ref = JSON.parse(readFileSync('supabase/conta/pgc/cuentas-anuales.json', 'utf8')) as Ref
const cuadro = (JSON.parse(readFileSync('supabase/conta/pgc/serie.json', 'utf8')) as { cuentas: { plan: string; code: string; is_leaf: boolean }[] }).cuentas
const lineasDe = (m: Modelo): LineaModelo[] => ref.lineas.filter((l) => l.model === m && l.statement === 'balance').map((l) => ({
  code: l.code, parentCode: l.parent_code, text: l.text, level: l.level, sortOrder: l.sort_order, side: l.side, isTotal: l.is_total, toCreate: l.to_create, legalRef: l.legal_ref,
}))
const mapeoDe = (m: Modelo) => mapeoEfectivo(ref.mapeo.filter((x) => x.model === m && x.statement === 'balance').map((x) => ({
  lineCode: x.line_code, prefix: x.account_prefix, sign: x.sign, byBalance: x.by_balance, origin: x.origin, note: x.note,
})), [])
// Saldo deudor (debe − haber) de cada subcuenta, en euros inventados.
const s = (code: string, deudor: number, plantilla = code.slice(0, 4)): SaldoCuenta => ({ code, name: code, templateCode: plantilla, debe: Math.max(deudor, 0), haber: Math.max(-deudor, 0) })
// eslint-disable-next-line no-restricted-syntax -- cálculo local de la prueba, nunca null
const euros = (n: number) => `${n.toFixed(2)} €`
const conCaja = (xs: SaldoCuenta[]) => [...xs, s('57200001', -xs.reduce((a, x) => a + x.debe - x.haber, 0), '572')]

const forma = conCaja([
  s('43000001', -300), s('43000002', 5000), s('43000003', 20), s('43000004', -1300),
  s('43000005', -200), s('43000006', -1200), s('43000101', -90),
  s('40000001', 150), s('40000002', -800), s('41000034', 60), s('41000035', -45),
  s('47200000', -2100), s('47000000', 500), s('10000000', -3000, '100'),
])

describe('la serie va por el signo de cada tercero (abreviado, el de Foodint)', () => {
  const bal = calcularEstado('balance', lineasDe('abreviado'), mapeoDe('abreviado'), forma)
  const linea = (code: string) => bal.lineas.find((l) => l.code === code)!
  const codigos = (code: string) => linea(code).cuentas.map((c) => c.code).sort()

  it('«1. Clientes» solo suma los clientes que te deben', () => {
    expect(esLineaClientes(linea('ACT.B.III.1'))).toBe(true)
    expect(codigos('ACT.B.III.1')).toEqual(['43000002', '43000003'])
    expect(linea('ACT.B.III.1').importe).toBe(5020)
  })
  it('los clientes a los que debes van al pasivo, a «2. Otros acreedores», con su importe en positivo y sin ámbar', () => {
    const otros = linea('PNP.C.V.2')
    expect(otros.text).toBe('2. Otros acreedores.')
    expect(otros.cuentas.filter((c) => c.code.startsWith('43')).map((c) => [c.code, c.importe, c.anomalo])).toEqual([
      ['43000001', 300, false], ['43000004', 1300, false], ['43000005', 200, false], ['43000006', 1200, false], ['43000101', 90, false],
    ])
  })
  it('el proveedor y el acreedor que te deben van al activo, a «3. Otros deudores»; los que debes, al pasivo como siempre', () => {
    expect(codigos('ACT.B.III.3')).toEqual(['40000001', '41000034', '47000000', '47200000'])
    expect(codigos('PNP.C.V.1')).toEqual(['40000002'])
    expect(linea('PNP.C.V.2').cuentas.map((c) => c.code)).toContain('41000035')
  })
  it('el balance cuadra: activo = patrimonio neto + pasivo', () => {
    const c = cuadreBalance(bal)
    expect(bal.sinSitio).toEqual([])
    expect(c.cuadra).toBe(true)
  })
})

describe('el balance cuadra en los tres modelos con TODAS las hojas del cuadro, de un signo y del otro', () => {
  for (const [modelo, plan] of [['abreviado', 'general'], ['pymes', 'pymes'], ['normal', 'general']] as const) {
    it(`${modelo}: las hojas de ${plan}, alternando deudor y acreedor`, () => {
      const hojas = cuadro.filter((c) => c.plan === plan && c.is_leaf && /^[1-5]/.test(c.code) && !c.code.startsWith('572'))
      for (const signo of [1, -1]) {
        const saldos = conCaja(hojas.map((h, i) => s(h.code.padEnd(8, '0'), signo * (i % 2 ? 37.5 : -12.25), h.code)))
        const bal = calcularEstado('balance', lineasDe(modelo), mapeoDe(modelo), saldos)
        expect(bal.sinSitio.map((x) => x.code)).toEqual([])
        expect(cuadreBalance(bal).cuadra, `${modelo} con signo ${signo}`).toBe(true)
      }
      expect(hojas.length).toBeGreaterThan(300)
    })
  }
})

describe('lo que se dice', () => {
  const bal = calcularEstado('balance', lineasDe('abreviado'), mapeoDe('abreviado'), forma)
  it('la nota bajo «Clientes», palabra por palabra', () => {
    expect(NOTA_CLIENTES_PASIVO).toBe('Los clientes a los que debes dinero van al pasivo, como dice el Plan Contable. Por eso esta cifra puede no coincidir con la de tu programa anterior.')
  })
  it('la barra de la IA: la cifra nueva de la línea oficial, y cuántos clientes van al pasivo', () => {
    const n = notaClientes(bal, euros)!
    expect(n.titulo).toBe('«Clientes por ventas y prestaciones de servicios»: 5020.00 €. 5 clientes a los que debes 3090.00 €, en el pasivo.')
    expect(n.texto).toMatch(/^Van en «Otros acreedores», como dice el Plan Contable/)
    expect(n.cuenta).toBe('43000004') // el que más se le debe, para el enlace al Mayor
  })
  it('sin clientes a los que debas, la barra no dice nada de ellos', () => {
    const sinDeudas = conCaja([s('43000002', 5000), s('10000000', -3000, '100')])
    expect(notaClientes(calcularEstado('balance', lineasDe('abreviado'), mapeoDe('abreviado'), sinDeudas), euros)).toBeNull()
  })
})
