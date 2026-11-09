// G05 · Tarea 2 · El recibo del mes y lo que cambia frente al anterior
// (supabase/functions/_shared/cobro/recibo.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  UMBRAL_DE_CAMBIO, claveDelRecibo, lineasDelMes, mesAnterior, mesSiguiente, porqueDelClic, prepararRecibo,
  type ReciboAnterior,
} from '../../../../../../supabase/functions/_shared/cobro/recibo'
import { C, E, GESTORIA, LABORAL, asignaciones, catalogo, precio, trabajador } from './comun'

const anteriorDe = (mes: string, cat = catalogo(), as = asignaciones()): ReciboAnterior => {
  const lineas = lineasDelMes(cat, as, C, E, mes)
  return { mes, lineas, totalCent: lineas.reduce((s, l) => s + (l.importeCent ?? 0), 0) }
}
const preparar = (o: Partial<Parameters<typeof prepararRecibo>[0]> = {}) => prepararRecibo({
  catalogo: catalogo(), asignaciones: asignaciones(), clienteId: C, empresaId: E, mes: '2026-11', situacionElDia1: 'activo',
  anterior: anteriorDe('2026-10'), ...o,
})
const recibo = (o: Parameters<typeof preparar>[0] = {}) => {
  const r = preparar(o)
  if (!r.hay) throw new Error(`Sin recibo: ${r.porque}`)
  return r.recibo
}

describe('G05 · el recibo del mes', () => {
  it('el ejemplo de flujo_recibos_qbo.md: 96,80 + 24,20 + 24,20 = 145,20 €, con los trabajadores por su nombre', () => {
    const r = recibo()
    expect([r.totalCent, r.lineas.map((l) => l.texto)]).toEqual([14520, ['Gestoría mensual', 'Gestión laboral · 2 trabajadores']])
    expect(r.lineas[1].trabajadores?.map((t) => t.nombre)).toEqual(['Persona Prueba 1', 'Persona Prueba 2'])
    expect(r.lineas[0].trabajadores).toBeNull()
  })
  it('una clave única por empresa, cliente y mes (la misma va a GoCardless, menos de 128 caracteres)', () => {
    expect(recibo().clave).toBe(claveDelRecibo(E, C, '2026-11'))
    expect(claveDelRecibo(E, C, '2026-11')).not.toBe(claveDelRecibo(E, C, '2026-12'))
    const larga = claveDelRecibo('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '2026-11')
    expect(larga.length).toBeLessThanOrEqual(128)
  })
  it('igual que el mes pasado: sin cambios y se aprueba en lote', () => {
    const r = recibo()
    expect([r.igualQueElMesPasado, r.cambios, r.pideClic, r.parado]).toEqual([true, [], null, []])
  })
  it('un trabajador nuevo: «+1 trabajador», con su día de alta', () => {
    const r = recibo({ asignaciones: asignaciones([trabajador('Persona Prueba 1'), trabajador('Persona Prueba 2'), trabajador('Persona Prueba 3', '2026-11', null, '2026-11-12')]) })
    expect(r.cambios.map((c) => c.texto)).toEqual(['+1 trabajador: Persona Prueba 3, alta el 12 de noviembre. Se cobra el mes entero.'])
    expect([r.igualQueElMesPasado, r.totalCent]).toEqual([false, 16940])
  })
  it('un trabajador de baja el mes pasado ya no se cobra: «−1 trabajador»', () => {
    const as = asignaciones([trabajador('Persona Prueba 1'), trabajador('Persona Prueba 2', '2026-01', '2026-10')])
    const r = recibo({ asignaciones: as, anterior: anteriorDe('2026-10', catalogo(), as) })
    expect(r.cambios.map((c) => c.texto)).toEqual(['−1 trabajador: Persona Prueba 2, de baja en octubre (octubre se cobró entero).'])
    expect(r.totalCent).toBe(12100)
  })
  it('un precio nuevo: «Precio nuevo desde …» con el de antes y el de ahora', () => {
    const cat = catalogo([precio('pg', GESTORIA, 9680, false, '2026-01', '2026-10'), precio('pg2', GESTORIA, 10285, false, '2026-11'), precio('pl', LABORAL, 2420, true)])
    const r = recibo({ catalogo: cat })
    expect(r.cambios.map((c) => c.texto)).toEqual(['Precio nuevo desde noviembre: Gestoría mensual pasa de 96,80 € a 102,85 €.'])
  })
  it('un servicio nuevo y uno que ya no está', () => {
    const antes: ReciboAnterior = { mes: '2026-10', totalCent: 9680 + 3000, lineas: [
      ...anteriorDe('2026-10').lineas.filter((l) => l.asignacionId === 'a-gestoria'),
      { asignacionId: 'a-vieja', servicioId: 'renta', texto: 'Renta anual', importeCent: 3000, cuenta: '', trabajadores: null },
    ] }
    const r = recibo({ anterior: antes })
    expect(r.cambios.map((c) => c.tipo)).toEqual(['linea_nueva', 'linea_quitada'])
    expect(r.cambios[0].texto).toBe('Nuevo: Gestión laboral (48,40 €) desde noviembre.')
    expect(r.cambios[1].texto).toBe('Ya no se cobra: Renta anual (30,00 €).')
  })
  it('el primer recibo: «Cliente nuevo», con los que cambian (uno a uno), sin pedir el clic del 30 %', () => {
    const r = recibo({ anterior: null })
    expect([r.cambios.map((c) => c.texto), r.igualQueElMesPasado, r.pideClic])
      .toEqual([['Cliente nuevo: Gestoría mensual y Gestión laboral desde el 1 de noviembre.'], false, null])
  })
  it('un nivel por otro del mismo servicio: «Cambia de tarifa», no una baja y un alta', () => {
    const cat = { ...catalogo(), servicios: [{ id: 'gestoria', empresaId: E, nombre: 'Gestoría' }, { id: 'laboral', empresaId: E, nombre: 'Gestión laboral' }],
      niveles: [{ id: 'aut', servicioId: 'gestoria', nombre: 'Autónomos', orden: 1, incluye: [], masElegido: false }, { id: 'est', servicioId: 'gestoria', nombre: 'Estándar', orden: 2, incluye: [], masElegido: false }],
      precios: [precio('pa', { tipo: 'nivel', servicioId: 'gestoria', nivelId: 'aut' }, 4840), precio('pe', { tipo: 'nivel', servicioId: 'gestoria', nivelId: 'est' }, 6050)] }
    const antes = [{ id: 'a-aut', clienteId: C, empresaId: E, objetivo: { tipo: 'nivel', servicioId: 'gestoria', nivelId: 'aut' } as const, desde: '2026-01', hasta: '2026-10' }]
    const ahora = [...antes, { id: 'a-est', clienteId: C, empresaId: E, objetivo: { tipo: 'nivel', servicioId: 'gestoria', nivelId: 'est' } as const, desde: '2026-11', hasta: null }]
    const r = recibo({ catalogo: cat, asignaciones: ahora, anterior: anteriorDe('2026-10', cat, antes) })
    expect(r.cambios.map((c) => c.texto)).toEqual(['Cambia de tarifa: de Autónomos a Estándar desde noviembre.'])
  })
  it('más de un 30 % de cambio pide un clic y dice por qué; justo el 30 %, no', () => {
    expect(UMBRAL_DE_CAMBIO).toBe(0.3)
    expect(porqueDelClic(10000, 13000)).toBeNull()
    expect(porqueDelClic(10000, 13001)).toBe('Sube un 30 %')
    expect(porqueDelClic(14520, 9680)).toBe('Baja un 33 %')
    const muchos = Array.from({ length: 4 }, (_, i) => trabajador(`Persona Prueba ${i + 3}`, '2026-11'))
    const r = recibo({ asignaciones: asignaciones([trabajador('Persona Prueba 1'), trabajador('Persona Prueba 2'), ...muchos]) })
    expect(r.pideClic).toBe('Sube un 67 %')
  })
  it('sin recibo si el día 1 no se le cobra (de baja, «solo renta», sin situación) o no tiene nada', () => {
    expect(preparar({ situacionElDia1: 'baja' })).toEqual({ hay: false, porque: 'No se le cobra: el día 1 está de baja' })
    expect(preparar({ situacionElDia1: 'solo_renta' })).toEqual({ hay: false, porque: 'No se le cobra: el día 1 es «solo renta»' })
    expect(preparar({ situacionElDia1: null })).toEqual({ hay: false, porque: 'No se le cobra: el día 1 no tiene situación' })
    expect(preparar({ asignaciones: [] })).toEqual({ hay: false, porque: 'No tiene nada que cobrar en noviembre de 2026' })
    expect(preparar({ situacionElDia1: 'moroso' }).hay).toBe(true)
  })
  it('una línea sin precio no se cobra a cero: el recibo queda parado y dice cuál', () => {
    const r = recibo({ catalogo: catalogo([precio('pg', GESTORIA, 9680)]) })
    expect([r.totalCent, r.parado]).toEqual([9680, ['Una línea sin precio: Gestión laboral']])
  })
  it('sin recibo de Sumied el mes anterior, se compara con lo que cobraba GoCardless, al céntimo', () => {
    const gc = (cent: number): ReciboAnterior => ({ mes: '2026-10', totalCent: cent, lineas: [], deGoCardless: true })
    expect([recibo({ anterior: gc(14520) }).cambios, recibo({ anterior: gc(14520) }).igualQueElMesPasado]).toEqual([[], true])
    const r = recibo({ anterior: gc(9680) })
    expect([r.cambios.map((c) => c.texto), r.pideClic]).toEqual([['GoCardless le cobraba 96,80 € al mes y Sumied calcula 145,20 €.'], 'Sube un 50 %'])
  })
  it('los meses de al lado, también en enero y diciembre', () => {
    expect([mesAnterior('2026-01'), mesAnterior('2026-11'), mesSiguiente('2026-12'), mesSiguiente('2026-03')]).toEqual(['2025-12', '2026-10', '2027-01', '2026-04'])
  })
})
