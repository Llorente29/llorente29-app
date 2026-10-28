// tests/unit/modules/supply/autoconteoHoraMadrid.test.ts
//
// EL AUTOCONTEO Y LA HORA (punto 6 de C en abierto.md, 28/10). getMyDailyQueue
// buscaba el conteo de «hoy» con `created_at >= '<día>T00:00:00'`, sin zona, y
// la base lo lee en UTC: entre las 00:00 y la 01:00 de Madrid (las 02:00 en
// verano) el conteo del día no salía. Y «hoy» salía del reloj del navegador
// (toISODate), que en un servidor en UTC es todavía ayer.
//
// Aquí se fija el reloj a esas horas, se llama al servicio de verdad con un
// cliente que guarda el filtro que recibe, y se compara ese filtro con el
// instante del conteo como lo compararía la base. Igual con su vecino de
// inventario, listFormatReview (los últimos 30 días de conteos).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const filtros: { columna: string; valor: string }[] = []
function consulta() {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'order', 'in', 'is']) q[m] = () => q
  q.gte = (columna: string, valor: string) => { filtros.push({ columna, valor }); return q }
  q.limit = async () => ({ data: [], error: null })
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
  return q
}
vi.mock('@/lib/supabase', () => ({
  isSupabaseEnabled: true,
  supabase: { from: () => consulta(), rpc: async () => ({ data: null, error: null }) },
}))

import { inicioDelDiaUtc } from '@/lib/fechas'
import { getMyDailyQueue } from '@/modules/supply/services/autoinventoryService'
import { listFormatReview } from '@/modules/supply/services/countFormatService'

/** ¿Entra un created_at en el filtro «>=», leído como lo lee la base (sin zona = UTC)? */
const entra = (createdAt: string, filtro: string) =>
  Date.parse(createdAt) >= Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(filtro) ? filtro : `${filtro}Z`)

beforeEach(() => { filtros.length = 0; vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())

describe('el inicio del día de Madrid, en UTC', () => {
  it('invierno (+1) y verano (+2)', () => {
    expect(inicioDelDiaUtc('2026-01-15')).toBe('2026-01-14T23:00:00.000Z')
    expect(inicioDelDiaUtc('2026-07-15')).toBe('2026-07-14T22:00:00.000Z')
  })
  it('las dos noches del cambio de hora: la medianoche es todavía la de antes del cambio', () => {
    expect(inicioDelDiaUtc('2026-03-29')).toBe('2026-03-28T23:00:00.000Z')
    expect(inicioDelDiaUtc('2026-10-25')).toBe('2026-10-24T22:00:00.000Z')
    expect(inicioDelDiaUtc('2026-10-26')).toBe('2026-10-25T23:00:00.000Z')
  })
})

describe('getMyDailyQueue: el conteo de hoy sale también de madrugada', () => {
  for (const caso of [
    { que: '00:30 de Madrid en invierno', ahora: '2026-01-14T23:30:00Z', dia: '2026-01-15', conteo: '2026-01-14T23:10:00Z' },
    { que: '01:30 de Madrid en verano', ahora: '2026-07-14T23:30:00Z', dia: '2026-07-15', conteo: '2026-07-14T23:10:00Z' },
  ]) {
    it(`${caso.que}: «hoy» es el día de Madrid y el conteo de las 00:10 entra`, async () => {
      vi.setSystemTime(new Date(caso.ahora))
      await getMyDailyQueue('loc', 'emp')
      const f = filtros.find((x) => x.columna === 'created_at')!
      expect(f.valor).toBe(inicioDelDiaUtc(caso.dia))
      expect(entra(caso.conteo, f.valor)).toBe(true)
      // Lo de antes: '<día>T00:00:00' sin zona lo dejaba fuera.
      expect(entra(caso.conteo, `${caso.dia}T00:00:00`)).toBe(false)
      // Y el conteo de ayer por la tarde sigue fuera.
      expect(entra(new Date(Date.parse(caso.conteo) - 6 * 3600_000).toISOString(), f.valor)).toBe(false)
    })
  }
  it('con un día pedido, filtra desde su medianoche de Madrid', async () => {
    await getMyDailyQueue('loc', 'emp', '2026-10-25')
    expect(filtros.find((x) => x.columna === 'created_at')!.valor).toBe('2026-10-24T22:00:00.000Z')
  })
})

describe('listFormatReview (vecino de inventario): los 30 días, desde la medianoche de Madrid', () => {
  it('con «desde» pedido, en UTC; sin él, el día de Madrid de hace 30 días', async () => {
    await listFormatReview('cuenta', { desde: '2026-07-15' })
    expect(filtros.find((x) => x.columna === 'inventory_count.created_at')!.valor).toBe('2026-07-14T22:00:00.000Z')
    filtros.length = 0
    vi.setSystemTime(new Date('2026-08-13T23:30:00Z')) // 14/08 01:30 en Madrid
    await listFormatReview('cuenta')
    expect(filtros.find((x) => x.columna === 'inventory_count.created_at')!.valor).toBe(inicioDelDiaUtc('2026-07-15'))
  })
})
