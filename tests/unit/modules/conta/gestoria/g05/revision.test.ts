// G05 · Tarea 2 · «Revisar el cobro» y la confirmación de «Enviar el cobro»
// (supabase/functions/_shared/cobro/revision.ts). Clientes e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import { confirmacionDeEnvio, grupoDelRecibo, loQueFalta, revision, type ReciboEnRevision } from '../../../../../../supabase/functions/_shared/cobro/revision'
import type { Recibo } from '../../../../../../supabase/functions/_shared/cobro/recibo'

const r = (cliente: string, totalCent: number, o: Partial<Recibo> = {}, x: Partial<ReciboEnRevision> = {}): ReciboEnRevision => ({
  cliente, aprobado: false, mandato: { vale: true },
  recibo: { clave: `recibo:e:${cliente}:2026-12`, clienteId: cliente, empresaId: 'e', mes: '2026-12', lineas: [], totalCent, anteriorCent: totalCent,
    cambios: [], igualQueElMesPasado: true, pideClic: null, parado: [], ...o },
  ...x,
})
const conCambio = { igualQueElMesPasado: false, cambios: [{ tipo: 'alta' as const, asignacionId: 'a', texto: '+1 trabajador' }] }

describe('G05 · Revisar el cobro', () => {
  it('separa «igual que el mes pasado», «con cambios» y «parados»', () => {
    expect(grupoDelRecibo(r('a', 100))).toBe('igual')
    expect(grupoDelRecibo(r('b', 100, conCambio))).toBe('con_cambios')
    expect(grupoDelRecibo(r('c', 100, { pideClic: 'El total pasa…' }))).toBe('con_cambios')
    expect(grupoDelRecibo(r('d', 100, { parado: ['Una línea sin precio'] }))).toBe('parado')
    expect(grupoDelRecibo(r('e', 100, {}, { mandato: { vale: false, porque: 'Sin mandato SEPA' } }))).toBe('parado')
    expect(loQueFalta(r('f', 100, { parado: ['Una línea sin precio'] }, { mandato: { vale: false, porque: 'Sin mandato SEPA' } })))
      .toEqual(['Una línea sin precio', 'Sin mandato SEPA'])
  })
  it('la línea de arriba: «236 recibos · 22.849 € · 14 con cambios» (con miles y sin céntimos)', () => {
    const xs = [
      ...Array.from({ length: 222 }, (_, i) => r(`igual${i}`, 9680)),
      ...Array.from({ length: 14 }, (_, i) => r(`cambia${i}`, 9680, conCambio)),
    ]
    expect(revision(xs).titulo).toBe('236 recibos · 22.845 € · 14 con cambios')
    expect(revision([r('a', 9680), r('b', 100, { parado: ['x'] })]).titulo).toBe('2 recibos · 98 € · 0 con cambios · 1 parado')
  })
  it('solo sale lo aprobado y sin parar; lo que cambia, ordenado por importe, de más a menos', () => {
    const xs = [r('a', 100, {}, { aprobado: true }), r('b', 500, conCambio), r('c', 900, conCambio, { aprobado: true }), r('d', 50, { parado: ['x'] }, { aprobado: true })]
    const v = revision(xs)
    expect([v.listos, v.porAprobar, v.conCambios.map((x) => x.cliente)]).toEqual([{ n: 2, cent: 1000 }, 1, ['c', 'b']])
  })
  it('«Enviar el cobro» dice cuántos, cuánto, de quién, cuándo y lo que se queda fuera', () => {
    const v = revision([r('a', 14520, {}, { aprobado: true }), r('b', 9680, conCambio), r('c', 100, { parado: ['x'] })])
    expect(confirmacionDeEnvio(v, 'Gestoría Demo, S.L.', '2026-12-04')).toEqual({ puede: true,
      texto: 'Se envían a GoCardless 1 recibo de Gestoría Demo, S.L. por 145,20 €, con cargo el 4 de diciembre. Se quedan fuera: 1 con cambios sin aprobar y 1 parado. No hay factura hasta que cada cobro se confirme.' })
    expect(confirmacionDeEnvio(revision([r('b', 9680, conCambio)]), 'X', '2026-12-04'))
      .toEqual({ puede: false, texto: 'No hay ningún recibo aprobado y listo para enviar.' })
  })
})
