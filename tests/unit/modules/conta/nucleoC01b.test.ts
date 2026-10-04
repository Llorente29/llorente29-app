// C01b · Núcleo: factura repetida, «lo que he aprendido» y plazo > 60 días.
//
// La regla de «repetida» se prueba contra la POBLACIÓN REAL (regla 31): los 179
// números de albarán de Foodint (datos/numeros-albaran-foodint-20261004.json),
// con sus «0», «sn», números cortos y repeticiones de verdad. Lo que aún no
// tiene población real (no hay ninguna confirmación de factura en producción:
// el aprendizaje nace con este encargo) se prueba con casos escritos, y va
// dicho aquí.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { claveNumero, detectarRepetidas, EXPLICACION_REPETIDA, type FacturaParaRepetida } from '@/modules/conta/lib/repetidas'
import { aprender, propuestaParaFactura, VECES_PARA_APRENDER, type Confirmacion } from '@/modules/conta/lib/aprendizaje'
import { avisoPlazo, AVISO_PLAZO_MOROSIDAD } from '@/modules/conta/lib/morosidad'

const real = JSON.parse(readFileSync('tests/unit/modules/conta/datos/numeros-albaran-foodint-20261004.json', 'utf8')) as {
  total: number; por_proveedor: Record<string, string[]>
}

const factura = (id: string, number: string | null, total: number | null, createdAt: string, extra: Partial<FacturaParaRepetida> = {}): FacturaParaRepetida =>
  ({ id, number, total, status: 'aprobada', createdAt, ...extra })

describe('repetida · contra los 179 números de albarán reales de Foodint', () => {
  it('la población es la que se leyó (179, 10 proveedores)', () => {
    expect(real.total).toBe(179)
    expect(Object.keys(real.por_proveedor)).toHaveLength(10)
  })

  it('normalizar nunca junta dos números DISTINTOS de un mismo proveedor', () => {
    for (const nums of Object.values(real.por_proveedor)) {
      const distintos = [...new Set(nums)]
      const claves = distintos.map(claveNumero).filter((c): c is string => c !== null)
      expect(new Set(claves).size).toBe(claves.length)
    }
  })

  it('«0» y «sn» no son números: nunca casan', () => {
    expect(claveNumero('0')).toBeNull()
    expect(claveNumero('sn')).toBeNull()
    expect(claveNumero('S/N')).toBeNull()
    expect(claveNumero('  ')).toBeNull()
    expect(claveNumero('01')).toBe('01')
  })

  it('con importes DISTINTOS, ninguno sale repetido (ni los números que se repiten de verdad)', () => {
    for (const [p, nums] of Object.entries(real.por_proveedor)) {
      const fs = nums.map((n, i) => factura(`${p}-${i}`, n, 100 + i, `2026-09-01T00:00:${String(i).padStart(2, '0')}`))
      expect(detectarRepetidas(fs).size).toBe(0)
    }
  })

  it('con el MISMO importe, salen exactamente los que se repiten con número de verdad', () => {
    const repetidas: string[] = []
    for (const [p, nums] of Object.entries(real.por_proveedor)) {
      // Mismo importe para el mismo número: el peor caso.
      const fs = nums.map((n, i) => factura(`${p}-${i}`, n, 100, `2026-09-01T00:00:${String(i).padStart(3, '0')}`))
      for (const id of detectarRepetidas(fs).keys()) repetidas.push(nums[Number(id.split('-')[1])])
    }
    // «0» dos veces (proveedor 2) no cuenta: no es un número. «01» sí.
    expect(repetidas.sort()).toEqual(['01', 'AV260559511', 'T2826/1092'])
  })
})

describe('repetida · la regla', () => {
  it('la segunda que entra es la repetida, con su explicación; la primera es la buena', () => {
    const r = detectarRepetidas([
      factura('b', 'F-2026-0915', 1283.15, '2026-10-02T10:00:00Z'),
      factura('a', 'f-2026-0915 ', 1283.15, '2026-09-24T10:00:00Z'),
    ])
    expect([...r.keys()]).toEqual(['b'])
    expect(r.get('b')).toEqual({ deId: 'a', explicacion: EXPLICACION_REPETIDA })
  })
  it('mismo número e importe distinto en un céntimo: no es repetida', () => {
    expect(detectarRepetidas([factura('a', 'F-1', 10, '1'), factura('b', 'F-1', 10.01, '2')]).size).toBe(0)
  })
  it('una anulada no cuenta, ni como original ni como repetida', () => {
    expect(detectarRepetidas([factura('a', 'F-1', 10, '1', { status: 'anulada' }), factura('b', 'F-1', 10, '2')]).size).toBe(0)
  })
  it('si la persona dijo «no es repetida», no se vuelve a marcar', () => {
    expect(detectarRepetidas([factura('a', 'F-1', 10, '1'), factura('b', 'F-1', 10, '2', { noRepetidaConfirmada: true })]).size).toBe(0)
  })
  it('sin número o sin importe no se puede decir: no se marca', () => {
    expect(detectarRepetidas([factura('a', null, 10, '1'), factura('b', null, 10, '2')]).size).toBe(0)
    expect(detectarRepetidas([factura('a', 'F-1', null, '1'), factura('b', 'F-1', null, '2')]).size).toBe(0)
  })
})

const conf = (campo: Confirmacion['campo'], valor: string, at: string, origen: Confirmacion['origen'] = 'persona'): Confirmacion =>
  ({ campo, valor, etiqueta: valor, at, origen })

describe('lo que he aprendido', () => {
  it(`se aprende con ${VECES_PARA_APRENDER} confirmaciones seguidas iguales, y no con menos`, () => {
    expect(aprender([conf('expense_category', '600', '1'), conf('expense_category', '600', '2')])).toEqual([])
    const a = aprender([conf('expense_category', '600', '1'), conf('expense_category', '600', '2'), conf('expense_category', '600', '3')])
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ campo: 'expense_category', valor: '600', veces: 3, porque: 'Lo confirmaste tú 3 veces', desde: '1', hasta: '3' })
  })
  it('si la última cambia, se desaprende: manda lo último que hizo la persona', () => {
    const cs = ['1', '2', '3'].map((t) => conf('payment', 'transfer|30', t))
    expect(aprender([...cs, conf('payment', 'direct_debit|0', '4')])).toEqual([])
  })
  it('«Así vienen todas sus facturas» solo si todas lo traían y nadie lo cambió', () => {
    const cs = ['1', '2', '3', '4'].map((t) => conf('tax_rates', '10,21', t, 'factura'))
    expect(aprender(cs)[0].porque).toBe('Así vienen todas sus facturas')
    const conCambio = [conf('tax_rates', '21', '0', 'factura'), ...cs]
    expect(aprender(conCambio)[0].porque).toBe('Así vienen sus últimas 4 facturas')
  })
  it('lo fijado a mano con «Cambiar» gana y lo dice', () => {
    const cs = ['1', '2', '3'].map((t) => conf('expense_category', '600', t))
    const a = aprender(cs, [{ campo: 'expense_category', valor: '621', etiqueta: '621', at: '9', porNombre: 'Julio' }])
    expect(a[0]).toMatchObject({ valor: '621', aMano: true, porque: 'Lo fijó Julio a mano' })
  })
  it('nunca aplica: todo lo que propone necesita confirmación', () => {
    const cs = ['1', '2', '3'].map((t) => conf('iban', 'ES91…1332', t))
    expect(propuestaParaFactura(aprender(cs)).every((p) => p.necesitaConfirmacion === true)).toBe(true)
  })
})

describe('plazo de pago > 60 días (Ley 3/2004, art. 4.3)', () => {
  it('se guarda, pero avisa', () => {
    expect(avisoPlazo([60])).toBeNull()
    expect(avisoPlazo([61])).toBe(AVISO_PLAZO_MOROSIDAD)
    expect(avisoPlazo([30, 90])).toBe(AVISO_PLAZO_MOROSIDAD)
  })
})
