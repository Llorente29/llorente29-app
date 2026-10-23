import { describe, expect, it } from 'vitest'
import { avisoSinConfirmar } from '@/modules/conta/lib/sinConfirmar'

describe('C11b · aviso del cerrado sin confirmar que la liquidación no cobra', () => {
  it('dice qué pedido, de qué día y canal, y qué liquidación no lo trae', () => {
    const a = avisoSinConfirmar({ codigo: '234', dia: '2026-10-06', total: 20.4, canal: 'Glovo', liquidacion: 'GLV-41', fechaLiquidacion: '2026-10-15' })
    expect(a.que.replace(/\u00a0/g, ' ')).toBe('Pedido 234 de Glovo del 06/10/2026 (20,40 €), cerrado sin confirmar')
    expect(a.porque).toContain('la liquidación GLV-41 del 15/10/2026 no lo trae cobrado')
    expect(a.porque).toContain('Haz el ajuste')
  })
  it('sin código ni referencia de liquidación, lo dice igual', () => {
    const a = avisoSinConfirmar({ codigo: null, dia: '2026-10-20', total: 15.5, canal: 'Uber Eats', liquidacion: null, fechaLiquidacion: null })
    expect(a.que).toMatch(/^Pedido sin código de Uber Eats del 20\/10\/2026/)
    expect(a.porque).toContain('su liquidación no lo trae cobrado')
  })
})
