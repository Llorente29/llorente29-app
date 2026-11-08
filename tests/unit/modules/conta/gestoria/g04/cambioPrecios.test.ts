// G04 · Tarea 2 · El ensayo de «Cambiar precios»
// (supabase/functions/_shared/tarifa/cambioPrecios.ts): a todos, a tres
// elegidos y por filtro, con y sin los precios del cliente, y una bajada.
// Clientes e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import { cambiarForma, ensayarCambio, type CambioDePrecios } from '../../../../../../supabase/functions/_shared/tarifa/cambioPrecios'
import type { Asignacion, Catalogo, Objetivo, Precio } from '../../../../../../supabase/functions/_shared/tarifa/precio'

const E = 'empresa-1'
const LABORAL: Objetivo = { tipo: 'servicio', servicioId: 'laboral' }
const GESTORIA: Objetivo = { tipo: 'servicio', servicioId: 'gestoria' }
const nombre = (o: Objetivo) => (o.tipo === 'servicio' && o.servicioId === 'laboral' ? 'Gestión laboral' : 'Gestoría mensual')

// Seis clientes con Gestión laboral (24,20 € por trabajador) y Gestoría mensual (60,50 €).
// c6 tiene un precio especial de laboral: 20,00 €.
const precios: Precio[] = [
  { id: 'g-lab', empresaId: E, objetivo: LABORAL, clienteId: null, forma: { tipo: 'por_trabajador', importeCent: 2420 }, desde: '2024-01', hasta: null },
  { id: 'g-ges', empresaId: E, objetivo: GESTORIA, clienteId: null, forma: { tipo: 'fijo', periodo: 'mes', importeCent: 6050 }, desde: '2024-01', hasta: null },
  { id: 'c6-lab', empresaId: E, objetivo: LABORAL, clienteId: 'c6', forma: { tipo: 'por_trabajador', importeCent: 2000 }, desde: '2025-01', hasta: null },
]
const c: Catalogo = { servicios: [], niveles: [], paquetes: [], precios }
const t = (n: number) => Array.from({ length: n }, (_, i) => ({ nombre: `Persona Prueba ${i + 1}`, desde: '2024-01', hasta: null }))
const asignaciones: Asignacion[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].flatMap((id, i) => [
  { id: `${id}-lab`, clienteId: id, empresaId: E, objetivo: LABORAL, desde: '2024-01', hasta: null, trabajadores: t(i + 1) }, // c1: 1 … c6: 6
  { id: `${id}-ges`, clienteId: id, empresaId: E, objetivo: GESTORIA, desde: '2024-01', hasta: null },
])
const op = (x: Partial<CambioDePrecios>): CambioDePrecios => ({
  empresaId: E, sentido: 'subir', cantidad: { tipo: 'porcentaje', valor: 3 }, desde: '2027-01', que: [LABORAL],
  aQuien: { tipo: 'todos' }, preciosDelCliente: 'se_quedan', ...x,
})

describe('G04 · el ensayo de un cambio de precios', () => {
  it('a todos, sin los precios del cliente: cambia el general; c6 (especial) se queda', () => {
    const e = ensayarCambio(c, asignaciones, op({}), nombre)
    expect(e.clientes).toBe(5)
    expect(e.lineas.map((l) => [l.clienteId, l.antesCent, l.despuesCent, l.como])).toEqual([
      ['c1', 2420, 2493, 'tarifa'], ['c2', 4840, 4986, 'tarifa'], ['c3', 7260, 7479, 'tarifa'], ['c4', 9680, 9972, 'tarifa'], ['c5', 12100, 12465, 'tarifa'],
    ])
    expect(e.guardar).toEqual({ nuevos: [{ empresaId: E, objetivo: LABORAL, clienteId: null, forma: { tipo: 'por_trabajador', importeCent: 2493 }, desde: '2027-01', hasta: null }], acabanAntes: ['g-lab'] })
    // El total de enero de los afectados (con su gestoría mensual): 5 × 60,50 + 15 × 24,20 = 665,50 → 5 × 60,50 + 15 × 24,93 = 676,45
    expect([e.antesCent, e.despuesCent]).toEqual([66550, 67645])
    expect(e.frase).toBe('Gestión laboral sube un 3 % desde enero para 5 clientes. El total de enero sube 10,95 €: de 665,50 € a 676,45 €.')
  })
  it('a todos, con los precios del cliente: también c6 (20,00 → 20,60 €)', () => {
    const e = ensayarCambio(c, asignaciones, op({ preciosDelCliente: 'cambian' }), nombre)
    expect(e.clientes).toBe(6)
    expect(e.lineas.find((l) => l.clienteId === 'c6')).toEqual({ clienteId: 'c6', objetivo: LABORAL, antesCent: 12000, despuesCent: 12360, como: 'suyo' })
    expect(e.guardar.acabanAntes).toEqual(['g-lab', 'c6-lab'])
  })
  it('a tres elegidos: el general no se toca; cada uno pasa a un precio suyo', () => {
    const e = ensayarCambio(c, asignaciones, op({ aQuien: { tipo: 'elegidos', clienteIds: ['c1', 'c3', 'c6'] } }), nombre)
    expect(e.lineas.map((l) => [l.clienteId, l.como])).toEqual([['c1', 'nuevo_suyo'], ['c3', 'nuevo_suyo']]) // c6 tiene el suyo y se queda
    expect(e.guardar.nuevos.map((n) => [n.clienteId, n.forma])).toEqual([['c1', { tipo: 'por_trabajador', importeCent: 2493 }], ['c3', { tipo: 'por_trabajador', importeCent: 2493 }]])
    expect(e.guardar.acabanAntes).toEqual([]) // el general sigue para todos los demás
  })
  it('a tres elegidos, con los precios del cliente: c6 también', () => {
    const e = ensayarCambio(c, asignaciones, op({ aQuien: { tipo: 'elegidos', clienteIds: ['c1', 'c3', 'c6'] }, preciosDelCliente: 'cambian' }), nombre)
    expect(e.lineas.map((l) => [l.clienteId, l.como])).toEqual([['c1', 'nuevo_suyo'], ['c3', 'nuevo_suyo'], ['c6', 'suyo']])
    expect(e.guardar.acabanAntes).toEqual(['c6-lab'])
  })
  it('por filtro: «de 1 a 3 trabajadores» llega a c1, c2 y c3', () => {
    const e = ensayarCambio(c, asignaciones, op({ aQuien: { tipo: 'filtro', queTengan: LABORAL, trabajadoresDesde: 1, trabajadoresHasta: 3 } }), nombre)
    expect(e.lineas.map((l) => l.clienteId)).toEqual(['c1', 'c2', 'c3'])
  })
  it('por filtro «más de 4 trabajadores», con los precios del cliente: c5 y c6', () => {
    const e = ensayarCambio(c, asignaciones, op({ aQuien: { tipo: 'filtro', trabajadoresDesde: 5 }, preciosDelCliente: 'cambian' }), nombre)
    expect(e.lineas.map((l) => [l.clienteId, l.como])).toEqual([['c5', 'nuevo_suyo'], ['c6', 'suyo']])
  })
  it('una bajada en euros de toda la tarifa: la gestoría baja 5 €, la laboral 5 € por trabajador', () => {
    const e = ensayarCambio(c, asignaciones, op({ sentido: 'bajar', cantidad: { tipo: 'euros', cent: 500 }, que: null }), nombre)
    expect(e.lineas.filter((l) => l.clienteId === 'c2').map((l) => [l.antesCent, l.despuesCent])).toEqual([[4840, 3840], [6050, 5550]])
    // Enero, los 6: laboral 15 × 24,20 + c6 6 × 20,00 (se queda) + gestoría 6 × 60,50 = 846,00 → 15 × 19,20 + 120,00 + 6 × 55,50 = 741,00
    expect(e.frase).toBe('Toda la tarifa baja 5,00 € desde enero para 6 clientes. El total de enero baja 105,00 €: de 846,00 € a 741,00 €.')
  })
  it('una bajada mayor que el precio se queda en 0 € y se dice', () => {
    expect(cambiarForma({ tipo: 'fijo', periodo: 'mes', importeCent: 300 }, 'bajar', { tipo: 'euros', cent: 500 })).toEqual({ forma: { tipo: 'fijo', periodo: 'mes', importeCent: 0 }, enCero: 1 })
    const e = ensayarCambio(c, asignaciones, op({ sentido: 'bajar', cantidad: { tipo: 'euros', cent: 7000 }, que: [GESTORIA] }), nombre)
    expect(e.enCero).toBe(1)
    expect(e.frase).toMatch(/1 importe se queda en 0 €: la bajada era mayor que el precio\.$/)
  })
  it('los tramos cambian tramo a tramo', () => {
    expect(cambiarForma({ tipo: 'tramo_y_por_trabajador', tramos: [{ desde: 1, hasta: 5, importeCent: 10000, porUnidad: false }, { desde: 6, hasta: null, importeCent: 1800, porUnidad: true }] }, 'subir', { tipo: 'porcentaje', valor: 10 }).forma)
      .toEqual({ tipo: 'tramo_y_por_trabajador', tramos: [{ desde: 1, hasta: 5, importeCent: 11000, porUnidad: false }, { desde: 6, hasta: null, importeCent: 1980, porUnidad: true }] })
  })
  it('a nadie: lo dice', () => {
    expect(ensayarCambio(c, asignaciones, op({ aQuien: { tipo: 'elegidos', clienteIds: [] } }), nombre).frase).toBe('Con esto no cambia el precio de ningún cliente en enero.')
  })
})
