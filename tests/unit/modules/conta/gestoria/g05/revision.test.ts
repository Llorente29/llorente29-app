// G05 · Tarea 2 · «Revisar el cobro» y el aviso de «Enviar el cobro»
// (supabase/functions/_shared/cobro/revision.ts), con los textos de la maqueta
// Cobro.dc.html. Clientes e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  avisoDeEnvio, botonDeAprobar, grupoDelRecibo, loQueFalta, revision, type ReciboEnRevision,
} from '../../../../../../supabase/functions/_shared/cobro/revision'
import type { Cambio, Recibo } from '../../../../../../supabase/functions/_shared/cobro/recibo'

const r = (cliente: string, totalCent: number, o: Partial<Recibo> = {}, x: Partial<ReciboEnRevision> = {}): ReciboEnRevision => ({
  cliente, decision: 'pendiente', mandato: { vale: true },
  recibo: { clave: `recibo:e:${cliente}:2026-12`, clienteId: cliente, empresaId: 'e', mes: '2026-12', lineas: [], totalCent, anteriorCent: totalCent,
    cambios: [], igualQueElMesPasado: true, pideClic: null, parado: [], ...o },
  ...x,
})
const alta: Cambio = { tipo: 'alta', asignacionId: 'a', altas: 1, texto: '+1 trabajador: Persona Prueba 3, alta el 12 de noviembre.' }
const conCambio = (antes: number) => ({ igualQueElMesPasado: false, cambios: [alta], anteriorCent: antes })

describe('G05 · Revisar el cobro', () => {
  it('separa «igual que noviembre», «con cambios» y «no entran»', () => {
    expect(grupoDelRecibo(r('a', 100))).toBe('igual')
    expect(grupoDelRecibo(r('b', 100, conCambio(90)))).toBe('con_cambios')
    expect(grupoDelRecibo(r('c', 100, { pideClic: 'Sube un 40 %' }))).toBe('con_cambios')
    expect(grupoDelRecibo(r('d', 100, { parado: ['Una línea sin precio'] }))).toBe('no_entra')
    expect(grupoDelRecibo(r('e', 100, {}, { mandato: { vale: false, porque: 'Mandato sin firmar' } }))).toBe('no_entra')
    expect(loQueFalta(r('f', 100, { parado: ['Una línea sin precio'] }, { mandato: { vale: false, porque: 'Mandato sin firmar' } })))
      .toEqual(['Una línea sin precio', 'Mandato sin firmar'])
  })
  it('el botón: «Aprobar», o «Lo he mirado, aprobar» si cambia más de un 30 %', () => {
    expect([botonDeAprobar(r('a', 100, conCambio(90))), botonDeAprobar(r('b', 100, { pideClic: 'Sube un 40 %' }))]).toEqual(['Aprobar', 'Lo he mirado, aprobar'])
  })
  it('la línea de arriba: «236 recibos · 22.845 € · 14 con cambios», y cuánto cambia frente a noviembre y por qué', () => {
    const xs = [
      ...Array.from({ length: 222 }, (_, i) => r(`igual${i}`, 9680)),
      ...Array.from({ length: 13 }, (_, i) => r(`cambia${i}`, 9680, conCambio(7260))),
      r('nuevo', 9680, { anteriorCent: null, igualQueElMesPasado: false, cambios: [{ tipo: 'cliente_nuevo', asignacionId: null, texto: 'Cliente nuevo: …' }] }),
    ]
    const v = revision(xs, [{ cliente: 'De baja, S.L.', porque: 'De baja el 18 de noviembre.', boton: 'Ver la ficha' }], false)
    expect(v.titulo).toBe('236 recibos · 22.845 € · 14 con cambios')
    expect(v.frente).toBe('+411,40 € frente a noviembre · 1 cliente nuevo, 1 que no entra y 13 trabajadores más')
  })
  it('«Enviar el cobro» no se puede pulsar mientras falte algo, y dice qué', () => {
    const xs = [r('a', 100), r('b', 500, conCambio(400)), r('c', 900, conCambio(800), { decision: 'aprobado' }), r('d', 300, conCambio(200), { decision: 'este_mes_no' })]
    const v = revision(xs, [], false)
    expect([v.puedeEnviar, v.falta, v.porRevisar]).toEqual([false, 'Falta: 1 cambio por revisar y aprobar el que no cambia.', { n: 1, fuertes: 0 }])
    expect(v.listos.texto).toBe('Listos para cobrar: 1 recibo · 9,00 €')
    const todo = revision([r('a', 100), r('b', 500, conCambio(400), { decision: 'aprobado' }), r('d', 300, conCambio(200), { decision: 'este_mes_no' })], [], true)
    expect([todo.puedeEnviar, todo.falta, todo.listos]).toEqual([true, 'Todo revisado. Puedes enviarlo.', { n: 2, cent: 600, texto: 'Listos para cobrar: 2 recibos · 6,00 €' }])
  })
  it('«No entran»: los que no se pueden enviar y los que no tienen recibo, todos a la vista', () => {
    const v = revision([r('a', 100, {}, { mandato: { vale: false, porque: 'Mandato sin firmar. Se le envió el 25 de noviembre.' } })],
      [{ cliente: 'Sin cuota, S.L.', porque: 'Activa en el CRM, pero sin cuota en Sumied.', boton: 'Ponerle la cuota' }], true)
    expect(v.noEntran.map((x) => [x.cliente, x.porque, x.boton])).toEqual([
      ['a', 'Mandato sin firmar. Se le envió el 25 de noviembre.', 'Reenviar el mandato'],
      ['Sin cuota, S.L.', 'Activa en el CRM, pero sin cuota en Sumied.', 'Ponerle la cuota'],
    ])
  })
  it('el aviso antes de enviar: a cuántos, cuánto, desde dónde, el aviso al cliente y el cargo', () => {
    const v = revision([r('a', 14520), r('b', 9680, conCambio(7260), { decision: 'este_mes_no' })], [], true)
    expect(avisoDeEnvio(v, '2026-12', 'Gestoría Demo, S.L.', '2026-12-02', '2026-12-04', 2)).toEqual({
      titulo: '¿Enviamos el cobro de diciembre?', seCobraA: '1 cliente', enTotal: '145,20 €', desde: 'Gestoría Demo, S.L. · GoCardless',
      avisoAlCliente: '2 de diciembre, por correo', cargo: '4 de diciembre',
      nota: '1 recibo que has dejado fuera no se cobra este mes. Cada cliente recibe el aviso con el detalle de lo que se le cobra. Mientras GoCardless no lo mande al banco, cualquier cobro se puede parar desde la ficha del cliente.',
    })
    expect(avisoDeEnvio(revision([r('a', 100)], [], false), '2026-12', 'X', '2026-12-02', '2026-12-04', 1)).toBeNull()
  })
})
