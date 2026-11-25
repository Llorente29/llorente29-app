// R19 · paso 1 · Sumied igual a GoCardless (conta-gocardless-leer/igualar.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { fraseNoIgualada, mesDeBaja, planIgualar, type LineaParaIgualar, type SuscripcionParaIgualar } from '../../../../../supabase/functions/conta-gocardless-leer/igualar'
import type { Tarifa } from '../../../../../supabase/functions/conta-gocardless-leer/comparacion'

const E = 'emp-1'
const HOY = '2026-11-25'
const MES = '2026-12'
const linea = (id: string, partyId: string, suscripcionId: string, x: Partial<LineaParaIgualar> = {}): LineaParaIgualar => ({
  id, partyId, emisor: E, servicio: 'srv-gestoria', nombreServicio: 'Gestoría mensual', detalle: null, empleado: null, importePropioCent: null,
  periodo: 'mes', desde: '2026-01', hasta: null, suscripcionId, ...x,
})
const susc = (id: string, cliente: string, importeCent: number, x: Partial<SuscripcionParaIgualar> = {}): SuscripcionParaIgualar => ({
  id, clienteGcId: cliente, nombreCliente: `Cliente ${cliente}`, nombre: 'GESTORIA MENSUAL', importeCent, estado: 'active', fin: null, periodo: 'mes', cobraEnElMes: true, ...x,
})
const tarifas: Tarifa[] = [{ emisor: E, servicio: 'srv-gestoria', clienteId: null, importeCent: 6050, periodo: 'mes', desde: '2026-01', hasta: null }]

describe('R19 · Sumied igual a GoCardless', () => {
  it('atado y con el mismo importe: no cambia nada', () => {
    const r = planIgualar(E, HOY, MES, [linea('l1', 'p1', 's1')], tarifas, [susc('s1', 'c1', 6050)], new Map([['c1', 'p1']]), new Set())
    expect(r).toEqual({ cambios: [], pendientes: [] })
  })
  it('atado y GoCardless cobra otro importe: la línea lleva el de GoCardless', () => {
    const r = planIgualar(E, HOY, MES, [linea('l1', 'p1', 's1')], tarifas, [susc('s1', 'c1', 7260)], new Map([['c1', 'p1']]), new Set())
    expect(r.cambios).toEqual([{ lineaId: 'l1', partyId: 'p1', que: 'importe', linea: 'Gestoría mensual', importePropioCent: 7260, antes: { hasta: null, importePropioCent: null, alMesCent: 6050 },
      porque: '«Gestoría mensual»: Sumied 60,50 € y GoCardless cobra 72,60 € al mes: se pone el de GoCardless.' }])
  })
  it('atado y GoCardless ya no la cobra: la baja, el día 1 del último mes que se cobra entero (la regla de Sumied)', () => {
    const r = planIgualar(E, HOY, MES, [linea('l1', 'p1', 's1'), linea('l2', 'p1', 's2'), linea('l3', 'p1', 's3')], tarifas,
      [susc('s1', 'c1', 6050, { estado: 'cancelled' }), susc('s2', 'c1', 6050, { estado: 'finished', fin: '2027-01-01' }), susc('s3', 'c1', 6050, { estado: 'cancelled', fin: '2026-12-15' })],
      new Map([['c1', 'p1']]), new Set())
    expect(r.cambios.map((c) => [c.lineaId, c.que, c.hasta])).toEqual([['l1', 'baja', '2026-11-01'], ['l2', 'baja', '2026-12-01'], ['l3', 'baja', '2026-12-01']])
    // Cumple el CHECK de conta_linea: día 1 y no antes de «desde».
    for (const c of r.cambios) { expect(c.hasta!.slice(8)).toBe('01'); expect(c.hasta!.slice(0, 7) >= '2026-01').toBe(true) }
    expect(r.cambios[0].porque).toBe('GoCardless ya no cobra «GESTORIA MENSUAL» (cancelada): «Gestoría mensual» se cobra entera noviembre de 2026 y ya no desde el mes siguiente.')
  })
  it('la baja caería antes del alta de la línea: no se fuerza, va a «Pendiente de revisar»', () => {
    const r = planIgualar(E, HOY, MES, [linea('l1', 'p1', 's1', { desde: '2026-12' })], tarifas, [susc('s1', 'c1', 6050, { estado: 'cancelled' })], new Map([['c1', 'p1']]), new Set())
    expect(r.cambios).toEqual([])
    expect(r.pendientes.map((p) => [p.tipo, p.porque_codigo, p.party_id])).toEqual([['totales_distintos', 'baja_antes_del_alta', 'p1']])
    expect(r.pendientes[0].porque).toBe('GoCardless ya no cobra «GESTORIA MENSUAL», pero «Gestoría mensual» empieza en diciembre de 2026 y la baja sería en noviembre de 2026: Sumied no la da de baja antes de su alta. Revísala.')
  })
  it('el mes de la baja: el del día anterior al fin de GoCardless; sin fin, el de hoy', () => {
    expect([mesDeBaja(null, '2026-11-25'), mesDeBaja('2026-12-01', '2026-11-25'), mesDeBaja('2026-12-04', '2026-11-25'), mesDeBaja('2027-01-01', '2026-11-25')])
      .toEqual(['2026-11-01', '2026-11-01', '2026-12-01', '2026-12-01'])
  })
  it('lo que no se ha podido igualar se dice en palabras, con el cliente y la línea; nunca el texto de la base', () => {
    const c = { lineaId: 'l1', partyId: 'p1', que: 'baja' as const, linea: 'Gestoría mensual', hasta: '2026-11-01', antes: { hasta: null, importePropioCent: null, alMesCent: 6050 }, porque: 'x' }
    const f = fraseNoIgualada(c, 'Cliente de prueba, S.L.', 'new row for relation "conta_linea" violates check constraint "conta_linea_check"')
    expect(f).toBe('No se ha podido dar de baja en noviembre de 2026 «Gestoría mensual» de Cliente de prueba, S.L.: la fecha de baja tiene que ser el día 1 de un mes y no antes de su alta. Lo demás se ha igualado; esta, revísala a mano.')
    expect(f).not.toMatch(/relation|constraint|violates/)
  })
  it('una línea ya de baja (antes o en el mes de la baja) no se vuelve a tocar', () => {
    for (const hasta of ['2026-10', '2026-11']) {
      const r = planIgualar(E, HOY, MES, [linea('l1', 'p1', 's1', { hasta })], tarifas, [susc('s1', 'c1', 6050, { estado: 'cancelled' })], new Map([['c1', 'p1']]), new Set())
      expect(r.cambios).toEqual([])
    }
  })
  it('lo no atado no se adivina: a «Pendiente de revisar», sin tocar la línea', () => {
    const r = planIgualar(E, HOY, MES, [linea('l1', 'p1', 's1'), linea('l2', 'p2', 's2')], tarifas,
      [susc('s1', 'c1', 9999), susc('s2', 'c2', 9999, { estado: 'cancelled' })], new Map([['c2', 'p9']]), new Set())
    expect(r.cambios).toEqual([])
    expect(r.pendientes.map((p) => [p.tipo, p.party_id, p.gc_cliente_id])).toEqual([['linea_sin_atar', 'p1', 'c1'], ['linea_en_otra_ficha', 'p2', 'c2'], ['gc_sin_atar', null, 'c1']])
    expect(r.pendientes[0].porque).toBe('«Gestoría mensual» sale de lo que GoCardless cobra a Cliente c1, que no está atado a ninguna ficha: Sumied no la cambia hasta que se ate.')
  })
  it('un cliente de GoCardless sin atar y que cobra en el mes: una sola línea con lo que cobra; si ya sale como «sin ficha», no se repite', () => {
    const ss = [susc('s1', 'c1', 6050), susc('s2', 'c1', 1200, { periodo: 'anio' }), susc('s3', 'c3', 6050), susc('s4', 'c4', 6050, { cobraEnElMes: false })]
    const r = planIgualar(E, HOY, MES, [], tarifas, ss, new Map(), new Set(['c3']))
    expect(r.pendientes.map((p) => [p.tipo, p.gc_cliente_id])).toEqual([['gc_sin_atar', 'c1']])
    expect(r.pendientes[0].porque).toBe('GoCardless cobra a Cliente c1 61,50 € al mes (2 suscripciones) y no está atado a ninguna ficha: no cuenta en Sumied hasta que se ate.')
  })
  it('una anual se compara en su periodo, y una de otro periodo no se toca', () => {
    const anual = linea('l1', 'p1', 's1', { periodo: 'anio', importePropioCent: 60000 })
    expect(planIgualar(E, HOY, MES, [anual], tarifas, [susc('s1', 'c1', 60000, { periodo: 'anio' })], new Map([['c1', 'p1']]), new Set()).cambios).toEqual([])
    expect(planIgualar(E, HOY, MES, [anual], tarifas, [susc('s1', 'c1', 5000, { periodo: 'mes' })], new Map([['c1', 'p1']]), new Set()).cambios).toEqual([])
  })
})
