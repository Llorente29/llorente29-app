// G05 · nº 71, punto 3 · Un trabajo suelto «sumado al recibo» entra en el recibo
// de su mes, una vez, con su concepto y su importe
// (supabase/functions/_shared/cobro/datos.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { catalogoYAsignaciones, type FilasDeLaTarifa } from '../../../../../../supabase/functions/_shared/cobro/datos'
import { lineasDelMes, prepararRecibo } from '../../../../../../supabase/functions/_shared/cobro/recibo'

const E = 'empresa-prueba', C = 'cliente-prueba'
const filas = (): FilasDeLaTarifa => ({
  servicios: [{ id: 'gestoria', company_id: E, nombre: 'Gestoría mensual', forma: 'fijo_mes' }, { id: 'renta', company_id: E, nombre: 'Declaración de la renta', forma: 'fijo_mes' }],
  precios: [{ id: 'p1', empresa_id: E, servicio_id: 'gestoria', forma: 'fijo', periodo: 'mes', importe: 96.8, desde: '2026-01-01' }],
  asignaciones: [
    { id: 'linea:cuota', tipo: 'cuota', cliente_id: C, empresa_id: E, servicio_id: 'gestoria', desde: '2026-01-01', hasta: null },
    { id: 'linea:renta', tipo: 'suelto', cliente_id: C, empresa_id: E, servicio_id: 'renta', detalle: 'Renta 2025 de la administradora', importe_propio: 60.5, desde: '2026-12-01', hasta: '2026-12-01' },
  ],
  niveles: [], paquetes: [], lineasDePaquete: [], ajustes: [],
})

describe('G05 · nº 71 · trabajo suelto sumado al recibo', () => {
  it('entra en el recibo de su mes, con su concepto y su importe, y en el siguiente ya no', () => {
    const { catalogo, asignaciones } = catalogoYAsignaciones(filas(), { conSueltos: true })
    const dic = lineasDelMes(catalogo, asignaciones, C, E, '2026-12')
    expect(dic.map((l) => [l.texto, l.importeCent])).toEqual([['Gestoría mensual', 9680], ['Renta 2025 de la administradora', 6050]])
    expect(lineasDelMes(catalogo, asignaciones, C, E, '2027-01').map((l) => l.texto)).toEqual(['Gestoría mensual'])
    expect(lineasDelMes(catalogo, asignaciones, C, E, '2026-11').map((l) => l.texto)).toEqual(['Gestoría mensual'])
  })
  it('la cuota al mes (pantalla de Clientes y pestaña de Bitrix24) no lo cuenta', () => {
    const { catalogo, asignaciones } = catalogoYAsignaciones(filas())
    expect(lineasDelMes(catalogo, asignaciones, C, E, '2026-12').map((l) => l.texto)).toEqual(['Gestoría mensual'])
  })
  it('frente al mes pasado, es una línea nueva y el total sube lo suyo', () => {
    const { catalogo, asignaciones } = catalogoYAsignaciones(filas(), { conSueltos: true })
    const nov = lineasDelMes(catalogo, asignaciones, C, E, '2026-11')
    const r = prepararRecibo({ catalogo, asignaciones, clienteId: C, empresaId: E, mes: '2026-12', situacionElDia1: 'activo',
      anterior: { mes: '2026-11', totalCent: 9680, lineas: nov } })
    if (!r.hay) throw new Error(r.porque)
    expect(r.recibo.totalCent).toBe(15730)
    expect(r.recibo.cambios.map((c) => c.tipo)).toEqual(['linea_nueva'])
  })
  it('sin importe no entra (la base no deja guardarlo así)', () => {
    const f = filas(); f.asignaciones[1].importe_propio = null
    const { catalogo, asignaciones } = catalogoYAsignaciones(f, { conSueltos: true })
    expect(lineasDelMes(catalogo, asignaciones, C, E, '2026-12').map((l) => l.texto)).toEqual(['Gestoría mensual'])
  })
})
