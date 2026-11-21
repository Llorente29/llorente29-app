// tests/unit/modules/conta/x21b/noEsta.test.ts — X21b · «No está» mira el plan entero (regla 30), y la línea del
// asiento cuando la cuenta del pago no es un banco ni la caja. Con subcuentas inventadas (T11): la 43000004 hace
// el papel de la cuenta de cliente que Julio escribió en «Cómo se paga».

import { describe, expect, it } from 'vitest'
import { textoYaEnElPlan, yaEnElPlan } from '@/modules/conta/lib/subcuentaRapida'
import { queHaceElPago, textoAsientoDelPago } from '@/modules/conta/nucleo/recibida/pago'

const PLAN = [
  { code: '43000001', name: 'Cliente inventado 1' },
  { code: '43000004', name: 'Cliente inventado cuatro' },
  { code: '57200001', name: 'Banco inventado' },
  { code: '57000000', name: 'Caja, euros' },
  { code: '62900009', name: 'Otros servicios inventados', status: 'cerrada' },
  { code: '4300', name: 'Clientes (euros)' },
]

describe('X21b · yaEnElPlan: lo escrito, contra todas las subcuentas', () => {
  it('el código entero, corto o con punto, como en la ficha', () => {
    expect(yaEnElPlan('43000004', PLAN, 8)).toEqual({ code: '43000004', name: 'Cliente inventado cuatro', cerrada: false, mas: 0 })
    expect(yaEnElPlan('4304', PLAN, 8)?.code).toBe('43000004')
    expect(yaEnElPlan('430.4', PLAN, 8)?.code).toBe('43000004')
  })
  it('lo que no está, no está; y la raíz sola no cuenta (con ella se crea la siguiente libre)', () => {
    expect(yaEnElPlan('43000009', PLAN, 8)).toBeNull()
    expect(yaEnElPlan('430', PLAN, 8)).toBeNull()
    expect(yaEnElPlan('', PLAN, 8)).toBeNull()
  })
  it('un nombre, con las mismas palabras que el buscador (sin acentos ni mayúsculas)', () => {
    expect(yaEnElPlan('cuatro', PLAN, 8)?.code).toBe('43000004')
    expect(yaEnElPlan('cliente inventado', PLAN, 8)).toEqual({ code: '43000001', name: 'Cliente inventado 1', cerrada: false, mas: 1 })
    expect(yaEnElPlan('nadie', PLAN, 8)).toBeNull()
  })
  it('las cuentas de grupo (de menos cifras) no son subcuentas', () => {
    expect(yaEnElPlan('Clientes (euros)', PLAN, 8)).toBeNull()
  })
  it('la frase dice cuál es y por qué no sale ahí; la cerrada, que está cerrada', () => {
    expect(textoYaEnElPlan(yaEnElPlan('43000004', PLAN, 8)!, 'solo van cuentas de gasto (6)'))
      .toBe('La 43000004 · Cliente inventado cuatro existe, pero aquí solo van cuentas de gasto (6).')
    expect(textoYaEnElPlan(yaEnElPlan('62900009', PLAN, 8)!, 'solo van cuentas de gasto (6)'))
      .toBe('La 62900009 · Otros servicios inventados existe, pero está cerrada: ábrela en Plan contable para usarla.')
    expect(textoYaEnElPlan(yaEnElPlan('cliente inventado', PLAN, 8)!, null))
      .toBe('La 43000001 · Cliente inventado 1 (y 1 más con ese nombre) existe, pero aquí no sale en esta lista.')
  })
})

describe('X21b · la cuenta del pago que no es un banco ni la caja: la línea del asiento, sin bloquear', () => {
  const base = { fecha: '2026-11-20', hoy: '2026-11-21', importe: 121, tesorerias: new Map([['57200001', 't-1']]), plataforma: null, cuentaProveedor: '40000002' }
  const nombre = (c: string) => PLAN.find((x) => x.code === c)?.name ?? ''
  it('una 430 cualquiera: el asiento del pago, con la del proveedor al debe y la elegida al haber', () => {
    const q = queHaceElPago({ ...base, cuenta: '43000004' })
    expect(q).toEqual({ que: 'otra', cuenta: '43000004', fecha: '2026-11-20', importe: 121 })
    expect(textoAsientoDelPago(q, { nombre, cuentaProveedor: '40000002', importe: '121,00 €' }))
      .toBe('No es un banco ni la caja: al validar, un asiento del pago con la 40000002 del proveedor al debe y la 43000004 · Cliente inventado cuatro al haber, por 121,00 €, y la factura queda pagada.')
  })
  it('el banco, pendiente o la 430 de la plataforma: no hay línea', () => {
    expect(textoAsientoDelPago(queHaceElPago({ ...base, cuenta: '57200001' }), { nombre, cuentaProveedor: '40000002', importe: '121,00 €' })).toBeNull()
    expect(textoAsientoDelPago(queHaceElPago({ ...base, cuenta: '' }), { nombre, cuentaProveedor: '40000002', importe: '121,00 €' })).toBeNull()
    expect(textoAsientoDelPago(queHaceElPago({ ...base, cuenta: '43000001', plataforma: { cuenta430: '43000001', hayLiquidacion: true } }),
      { nombre, cuentaProveedor: '40000002', importe: '121,00 €' })).toBeNull()
  })
})
