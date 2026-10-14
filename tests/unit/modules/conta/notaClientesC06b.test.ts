// C06b, punto 1 · La barra de la IA dice la cifra de la LÍNEA OFICIAL de
// clientes, no la suma suelta de las 430 en negativo. Con el modelo y el mapeo
// de serie reales (supabase/conta/pgc/cuentas-anuales.json, regla 31) y la
// FORMA de Foodint a 30/09: siete subcuentas de cliente, cinco acreedoras y dos
// deudoras, la línea en positivo; una 472 acreedora en «Otros deudores».
// Los importes son inventados: nada real en el repositorio.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcularEstado, mapeoEfectivo, type FilaMapeo, type LineaModelo, type Modelo, type SaldoCuenta } from '@/modules/conta/lib/cuentasAnuales'
import { notaClientes } from '@/modules/conta/lib/notaClientes'

type Ref = {
  lineas: { model: Modelo; statement: string; code: string; parent_code: string | null; text: string; level: number; sort_order: number; side: 'activo' | 'pn_pasivo' | null; is_total: boolean; to_create: boolean; legal_ref: string }[]
  mapeo: { model: Modelo; statement: string; line_code: string; account_prefix: string; sign: 'suma' | 'resta'; by_balance: 'deudor' | 'acreedor' | null; origin: FilaMapeo['origin']; note: string | null }[]
}
const ref = JSON.parse(readFileSync('supabase/conta/pgc/cuentas-anuales.json', 'utf8')) as Ref
const lineas: LineaModelo[] = ref.lineas.filter((l) => l.model === 'abreviado' && l.statement === 'balance').map((l) => ({
  code: l.code, parentCode: l.parent_code, text: l.text, level: l.level, sortOrder: l.sort_order, side: l.side, isTotal: l.is_total, toCreate: l.to_create, legalRef: l.legal_ref,
}))
const mapeo = mapeoEfectivo(ref.mapeo.filter((x) => x.model === 'abreviado' && x.statement === 'balance').map((x) => ({
  lineCode: x.line_code, prefix: x.account_prefix, sign: x.sign, byBalance: x.by_balance, origin: x.origin, note: x.note,
})), [])
// Saldo deudor (debe − haber) de cada subcuenta, en euros inventados.
const s = (code: string, deudor: number): SaldoCuenta => ({ code, name: code, templateCode: code.slice(0, 4), debe: Math.max(deudor, 0), haber: Math.max(-deudor, 0) })
// eslint-disable-next-line no-restricted-syntax -- cálculo local de la prueba, nunca null
const euros = (n: number) => `${n.toFixed(2)} €`

const forma = [
  s('43000001', -300), s('43000002', 5000), s('43000003', 20), s('43000004', -1300),
  s('43000005', -200), s('43000006', -1200), s('43000101', -90), s('47200000', -2100), s('47000000', 500),
]

describe('la nota de clientes, con la forma de Foodint', () => {
  const bal = calcularEstado('balance', lineas, mapeo, forma)
  const clientes = bal.lineas.find((l) => l.code === 'ACT.B.III.1')!

  it('la línea oficial compensa: suma las siete 430, deudoras y acreedoras', () => {
    expect(clientes.text).toMatch(/^1\. Clientes por ventas y prestaciones de servicios/)
    expect(clientes.cuentas.map((c) => c.code).sort()).toEqual(['43000001', '43000002', '43000003', '43000004', '43000005', '43000006', '43000101'])
    expect(clientes.importe).toBe(1930)
  })

  it('el título lleva la cifra de la línea, no la suma de las cinco en negativo', () => {
    const n = notaClientes(bal, euros)!
    expect(n.titulo).toBe('«Clientes por ventas y prestaciones de servicios»: 1930.00 €, con 5 clientes con saldo acreedor dentro.')
    expect(n.titulo).not.toContain('-3090.00') // la suma suelta de antes
    expect(n.cuenta).toBe('43000004') // el peor, para el enlace al Mayor
  })

  it('si la línea entera queda en negativo, lo dice con su cifra', () => {
    const neg = calcularEstado('balance', lineas, mapeo, forma.map((x) => (x.code === '43000002' ? s('43000002', 1000) : x)))
    const n = notaClientes(neg, euros)!
    expect(n.titulo).toBe('Clientes en negativo: «Clientes por ventas y prestaciones de servicios» suma -2070.00 €.')
    expect(n.texto).toMatch(/^Dentro hay 5 clientes con saldo acreedor\./)
  })

  it('la 472 acreedora no es un cliente: va a «Otros deudores» y no entra en la nota', () => {
    const otros = bal.lineas.find((l) => l.code === 'ACT.B.III.3')!
    expect(otros.cuentas.map((c) => c.code).sort()).toEqual(['47000000', '47200000'])
    expect(notaClientes(calcularEstado('balance', lineas, mapeo, forma.filter((x) => !x.code.startsWith('43') || x.code === '43000002')), euros)).toBeNull()
  })
})
