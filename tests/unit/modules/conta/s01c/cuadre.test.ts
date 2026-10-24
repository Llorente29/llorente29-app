// tests/unit/modules/conta/s01c/cuadre.test.ts
//
// S01c · El pie del asiento a mano no se contradice: un solo estado
// (cuadre().estado) del que sale el texto. Antes, con todo a cero, decía
// «No cuadra» a la izquierda y «Cuadra · 0,00 €» en ámbar a la derecha.

import { describe, expect, it } from 'vitest'
import { cuadre } from '@/modules/conta/lib/libro'
import { cuadreMano, problemasMano, type LineaMano } from '@/modules/conta/lib/diario'

const l = (p: Partial<LineaMano>): LineaMano => ({ cuenta: '', debe: '', haber: '', localId: null, comun: true, concepto: '', ...p })

describe('cuadre: vacío, descuadre o cuadra', () => {
  it('todo a cero o sin importes: «Faltan importes», no cuadra', () => {
    expect(cuadre([{ debe: 0, haber: 0 }, { debe: 0, haber: 0 }])).toMatchObject({ estado: 'vacio', cuadra: false, texto: 'Faltan importes', debe: 0, haber: 0 })
    expect(cuadre([])).toMatchObject({ estado: 'vacio', cuadra: false, texto: 'Faltan importes' })
    expect(cuadreMano([l({}), l({})])).toMatchObject({ estado: 'vacio', texto: 'Faltan importes' })
    expect(cuadreMano([l({ debe: '0' }), l({ haber: '0,00' })])).toMatchObject({ estado: 'vacio', texto: 'Faltan importes' })
  })
  it('descuadrado: cuánto falta y en qué lado, una sola frase', () => {
    expect(cuadre([{ debe: 100, haber: 0 }, { debe: 0, haber: 90 }])).toMatchObject({ estado: 'descuadre', cuadra: false, texto: 'No cuadra: faltan 10,00 € en el Haber' })
    expect(cuadre([{ debe: 0, haber: 50 }])).toMatchObject({ estado: 'descuadre', texto: 'No cuadra: faltan 50,00 € en el Debe' })
    expect(cuadreMano([l({ debe: '121' }), l({})])).toMatchObject({ estado: 'descuadre', texto: 'No cuadra: faltan 121,00 € en el Haber' })
  })
  it('cuadrado y con importe: «Cuadra · N €»', () => {
    expect(cuadre([{ debe: 121, haber: 0 }, { debe: 0, haber: 121 }])).toMatchObject({ estado: 'cuadra', cuadra: true, texto: 'Cuadra · 121,00 €', diferencia: 0 })
    expect(cuadreMano([l({ debe: '1.200,50' }), l({ haber: '1200,5' })])).toMatchObject({ estado: 'cuadra', cuadra: true, texto: 'Cuadra · 1.200,50 €' })
  })
  it('el estado y «cuadra» nunca se contradicen', () => {
    for (const ls of [[], [{ debe: 0, haber: 0 }], [{ debe: 5, haber: 0 }], [{ debe: 5, haber: 5 }], [{ debe: 0.1, haber: 0 }, { debe: 0.2, haber: 0 }, { debe: 0, haber: 0.3 }]]) {
      const c = cuadre(ls)
      expect(c.cuadra).toBe(c.estado === 'cuadra')
      expect(c.texto.startsWith('Cuadra')).toBe(c.estado === 'cuadra')
    }
  })
  it('a mano, con dos apuntes con cuenta y sin importes, lo que falta son los importes', () => {
    const r = problemasMano('Alquiler', '2026-10-05', [l({ cuenta: '62100000' }), l({ cuenta: '57200001' })], new Set(['62100000', '57200001']))
    expect(r).toContain('Faltan importes')
    expect(r.some((x) => x.startsWith('Cuadra'))).toBe(false)
  })
})
