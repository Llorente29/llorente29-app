// tests/conta/x14/retencionesConSigno.test.ts
//
// X14 · 2 · Las retenciones (111/115 en pantalla, librosService.retenciones) con su signo: una retención en negativo resta.
// La 4751 (la que retenemos) va al haber; la 4730 (la que nos retienen), al debe. La base, simulada. Datos inventados (T11).

import { describe, expect, it, vi } from 'vitest'

const { filas } = vi.hoisted(() => ({ filas: [] as Record<string, unknown>[] }))
vi.mock('@/modules/conta/services/bd', () => {
  const cadena: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'gte', 'lte']) cadena[m] = () => cadena
  cadena.order = async () => ({ data: filas, error: null })
  return { tabla: () => cadena, mensaje: (x: string) => x, rpc: vi.fn(), hayBase: () => undefined }
})
vi.mock('@/lib/supabase', () => ({ supabase: null }))

import { retenciones } from '@/modules/conta/services/librosService'

const fila = (cuenta: string, debit: number, credit: number) => ({
  entry_id: 'e', entry_date: '2026-11-12', withholding_model: '111', withholding_base: 100, debit, credit, account_code: cuenta, concept: 'Inventado', party_id: null,
})

describe('X14 · 2 · retenciones con su signo', () => {
  it('la 4751 al haber suma y en negativo resta; la 4730 al debe suma', async () => {
    filas.splice(0, filas.length, fila('47510000', 0, 15), fila('47510000', 0, -15), fila('47300000', 19, 0))
    expect((await retenciones('a', 'c', '2026-10-01', '2026-12-31')).map((r) => r.importe)).toEqual([15, -15, 19])
  })
})
