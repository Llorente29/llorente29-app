// tests/unit/modules/conta/x35/escapa.test.ts
//
// X35 · PR 2 · «Cobrado y sin cobrar» y «Dónde se te escapa el dinero»: cada barra y cada tarjeta son la suma de su lista;
// el cobrado del mes cuenta los mismos estados que la fila de GoCardless del cuadre; lo sin cobrar es «Te deben» por el
// mes de cada recibo. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { lista, type NoCobrado } from '../../../../../supabase/functions/_shared/tarifa/cifras'
import { dondeSeEscapa, grafica, seisMeses, type CobroGc } from '@/modules/conta/gestoria/x35/escapa'

const HOY = '2026-11-27'
const fila = (id: string, fecha: string, cent: number, ficha = id) => ({ id, texto: `Cliente ${id}`, detalle: '', importeCent: cent, fichaId: ficha, fecha })
const NC: NoCobrado = {
  titulo: 'Te deben', cruzado: true, recibos: 3, clientes: 2, desde: '2026-06-04',
  lista: lista('Te deben', [fila('a', '2026-06-04', 6050), fila('b', '2026-06-04', 12100), fila('a2', '2026-11-04', 6050, 'a')]),
  tramos: [{ texto: 'Más de 90 días', lista: lista('', [fila('a', '2026-06-04', 6050), fila('b', '2026-06-04', 12100)]) }],
  conMandatoCancelado: lista('', []),
  pagadoPorElBanco: lista('Pagado', [fila('c', '2026-08-04', 10890)]),
  tarjetaSinAsignar: lista('Tarjeta', [{ id: 't1', texto: 'TPV', detalle: '', importeCent: 30000, fichaId: null }, { id: 't2', texto: 'TPV', detalle: '', importeCent: 2028, fichaId: null }]),
  faltanPorCruzar: [],
}
const gc = (id: string, fecha: string, importe: number, estado = 'paid_out'): CobroGc => ({ gcId: id, fecha, importe, estado, nombre: 'GESTORIA MENSUAL' })
const COBROS = [gc('1', '2026-06-04', 121), gc('2', '2026-06-04', 60.5, 'failed'), gc('3', '2026-11-04', 145, 'confirmed'), gc('4', '2026-11-04', 10, 'pending_submission'), gc('5', '2026-05-04', 99)]

describe('«Cobrado y sin cobrar»', () => {
  it('los seis meses que acaban en el de hoy', () => {
    expect(seisMeses(HOY)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
  })
  it('cada barra es la suma de su lista; cobrado, con los estados del cuadre; sin cobrar, «Te deben» por el mes del recibo', () => {
    const g = grafica(HOY, COBROS, NC)
    for (const m of g) for (const l of [m.cobrado, m.sinCobrar]) expect(l.totalCent).toBe(l.filas.reduce((s, f) => s + f.importeCent, 0))
    const jun = g[0], nov = g[5]
    expect(jun.cobrado.totalCent).toBe(12100)
    expect(jun.sinCobrar.totalCent).toBe(18150)
    expect(jun.pct).toBe('60,0 %')
    // Noviembre: el confirmado cuenta, el que está por enviar no.
    expect(nov.cobrado.totalCent).toBe(14500)
    expect(nov.sinCobrar.totalCent).toBe(6050)
    // Mayo no entra en los seis meses.
    expect(g.some((m) => m.mes === '2026-05')).toBe(false)
    expect(g[1].pct).toBe('—')
  })
})

describe('«Dónde se te escapa el dinero»', () => {
  it('cada tarjeta es la suma de su lista, y la frase cuenta lo que GoCardless no cobró', () => {
    const d = dondeSeEscapa(NC)
    expect(d.tarjetas.map((t) => [t.id, t.cifra])).toEqual([['pagadoDespues', '108,90 €'], ['sinPagar', '2 clientes'], ['tarjeta', '320,28 €']])
    for (const t of d.tarjetas) expect(t.lista.totalCent).toBe(t.lista.filas.reduce((s, f) => s + f.importeCent, 0))
    expect(d.tarjetas[1].texto).toContain('181,50 €')
    expect(d.frase).toBe('Desde junio de 2026 · GoCardless no cobró 4 recibos, 350,90 € · cruzado con las transferencias del banco')
    expect(d.nota).toContain('Falta el detalle del TPV')
  })
})
