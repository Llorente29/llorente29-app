// tests/conta/e05-bancos/textos.test.ts
//
// E05 · Lo que dice «Confirmar los N» al acabar (respuesta E05 · 1, punto 1) y lo
// que pide a la base «Escribir uno a mano» (conta_banco_a_mano, 2248). Datos inventados.
import { describe, expect, it, vi } from 'vitest'

const bd = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/modules/conta/services/bd', () => ({ rpc: bd.rpc }))
vi.mock('@/modules/conta/services/bancosService', () => ({ bancos: {} }))

import { escribirAMano, textoConfirmados } from '@/modules/conta/nucleo/bancos/conciliar'

describe('E05 · «Confirmar los N» dice lo que ha hecho, con contenido', () => {
  it('cuántos y cuánto, como pidió Julio', () => {
    expect(textoConfirmados({ bien: 6, de: 6, importeCent: 312_040, mal: [], recalculado: false })).toBe('Confirmados 6 movimientos, 3.120,40 €.')
    expect(textoConfirmados({ bien: 1, de: 1, importeCent: 1_250, mal: [], recalculado: false })).toBe('Confirmado 1 movimiento, 12,50 €.')
  })
  it('lo que no ha podido, uno a uno', () => {
    expect(textoConfirmados({ bien: 2, de: 3, importeCent: 10_000, mal: ['31/07 · Ejemplo: la factura está anulada'], recalculado: false }))
      .toBe('Confirmados 2 movimientos, 100,00 €. Uno no: 31/07 · Ejemplo: la factura está anulada')
  })
  it('si eran de otra versión, que no ha confirmado nada', () => {
    expect(textoConfirmados({ bien: 0, de: 4, importeCent: 0, mal: [], recalculado: true })).toMatch(/^No he confirmado nada/)
  })
})

describe('E05 · «Escribir uno a mano» llama a la base con el importe con signo', () => {
  it('un pago va en negativo y un ingreso en positivo', async () => {
    bd.rpc.mockResolvedValue({ asiento_id: 'e1', numero: '7', serie: '3', texto: 'Apuntado y validado: asiento 7…' })
    await escribirAMano({ bancoId: 'b1', fecha: '2026-10-21', cuenta: '62600000', concepto: 'Comisión', ingreso: null, pago: 12.5 })
    expect(bd.rpc).toHaveBeenLastCalledWith('conta_banco_a_mano', { p_banco: 'b1', p_fecha: '2026-10-21', p_cuenta: '62600000', p_concepto: 'Comisión', p_importe: -12.5, p_quien_nombre: null })
    const r = await escribirAMano({ bancoId: 'b1', fecha: '2026-10-22', cuenta: '57000000', concepto: 'Ingreso de caja', ingreso: 300, pago: null })
    expect(bd.rpc).toHaveBeenLastCalledWith('conta_banco_a_mano', expect.objectContaining({ p_importe: 300 }))
    expect(r.numero).toBe('7')
  })
})
