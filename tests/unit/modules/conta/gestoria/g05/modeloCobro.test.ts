// G05 · Tarea 4 · «Revisar el cobro» sin pintar (src/modules/conta/gestoria/g05/modeloCobro.ts):
// la lectura de la base, traducida a lo que pinta la maqueta. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { modeloCobro, type DatosCobro, type FilaRecibo } from '../../../../../../src/modules/conta/gestoria/g05/modeloCobro'

const E = { id: 'empresa-1', nombre: 'Gestoría Demo, S.L.' }
const fila = (id: string, cliente: string, cent: number, antes: number | null, extra: Partial<FilaRecibo> = {}): FilaRecibo => ({
  id, cliente_id: `c-${id}`, cliente, clave: `recibo:empresa-1:c-${id}:2026-12`, lineas: [], total_cent: cent, cobrar_cent: cent,
  anterior_cent: antes, cambios: antes === cent ? [] : [{ tipo: antes === null ? 'cliente_nuevo' : 'precio', asignacionId: null, texto: 'Cambia.' }],
  pide_clic: null, parado: [], decision: 'pendiente', estado: 'preparado', cargo_el: null, confirmado_el: null, factura: null, factura_id: null, ...extra,
})
const datos = (recibos: FilaRecibo[], iguales = false, enviado: string | null = null): DatosCobro => ({
  mes: { mes: '2026-12', sin_recibo: [{ cliente: 'Cliente de Baja', porque: 'De baja.', boton: 'Ver la ficha' }], iguales_aprobados: iguales,
    aviso_el: '2026-12-02', cargo_el: '2026-12-04', preparado_at: null, preparado_por_name: null, enviado_at: enviado, enviado_por_name: enviado ? 'Persona Prueba' : null },
  ajustes: { dia_aviso: 2, dia_cargo: 4 }, conexion: { entorno: 'pruebas' }, recibos,
})

describe('G05 · T4 · Revisar el cobro, sin pintar', () => {
  it('antes de enviar: los iguales, los que cambian y lo que falta, con los textos de la maqueta', () => {
    const m = modeloCobro(datos([fila('a', 'Cliente Igual', 6050, 6050), fila('b', 'Cliente Nuevo', 9680, null), fila('c', 'Cliente Parado', 4840, 4840, { parado: ['Sin mandato SEPA en GoCardless: no se le puede cobrar'] })]), E, '2026-12')
    expect(m.antetitulo).toBe('Cobro de diciembre · aviso al cliente el día 2 · cargo el día 4')
    expect(m.enviado).toBe(false)
    expect(m.revision.igual.map((x) => x.cliente)).toEqual(['Cliente Igual'])
    expect(m.revision.conCambios.map((x) => x.cliente)).toEqual(['Cliente Nuevo'])
    expect(m.revision.noEntran.map((x) => x.cliente)).toEqual(['Cliente Parado', 'Cliente de Baja'])
    expect(m.revision.falta).toBe('Falta: 1 cambio por revisar y aprobar el que no cambia.')
    expect(m.aviso).toBeNull()
  })

  it('todo revisado: el aviso dice a cuántos, cuánto y qué días; «Este mes no» queda aparte', () => {
    const m = modeloCobro(datos([fila('a', 'Cliente Igual', 6050, 6050), fila('b', 'Cliente Nuevo', 9680, null, { decision: 'aprobado' }), fila('d', 'Cliente Fuera', 3025, 2420, { decision: 'este_mes_no' })], true), E, '2026-12')
    expect(m.revision.falta).toBe('Todo revisado. Puedes enviarlo.')
    expect(m.revision.listos.texto).toBe('Listos para cobrar: 2 recibos · 157,30 €')
    expect(m.fueraDeEsteCobro.map((x) => x.cliente)).toEqual(['Cliente Fuera'])
    expect(m.aviso).toMatchObject({ titulo: '¿Enviamos el cobro de diciembre?', seCobraA: '2 clientes', enTotal: '157,30 €', desde: 'Gestoría Demo, S.L. · GoCardless',
      avisoAlCliente: '2 de diciembre, por correo', cargo: '4 de diciembre' })
    expect(m.aviso?.nota).toMatch(/^1 recibo que has dejado fuera no se cobra este mes\./)
  })

  it('después de enviar: cómo va cada recibo, con su factura; las cuatro cifras', () => {
    const m = modeloCobro(datos([
      fila('a', 'Cliente Cobrado', 6050, 6050, { decision: 'aprobado', estado: 'facturado', confirmado_el: '2026-12-04', factura: '2026/1/141' }),
      fila('b', 'Cliente Devuelto', 9680, null, { decision: 'aprobado', estado: 'devuelto' }),
      fila('c', 'Cliente En Banco', 4840, 4840, { decision: 'aprobado', estado: 'en_el_banco' }),
    ], true, '2026-12-01T09:42:00Z'), E, '2026-12')
    expect(m.enviado).toBe(true)
    expect(m.enviadoTexto).toBe('Enviado el 1 de diciembre a las 10:42 por Persona Prueba · cargo el día 4')
    expect(m.seguimiento).toEqual([
      { id: 'a', cliente: 'Cliente Cobrado', importe: '60,50 €', estado: 'Facturado', detalle: '4 de diciembre', tono: 'bien', factura: '2026/1/141' },
      { id: 'b', cliente: 'Cliente Devuelto', importe: '96,80 €', estado: 'Devuelto', detalle: 'No se ha podido cobrar', tono: 'mal', factura: 'Sin factura · pasa a «Te deben»' },
      { id: 'c', cliente: 'Cliente En Banco', importe: '48,40 €', estado: 'En el banco', detalle: 'Su banco aún no ha respondido', tono: 'aviso', factura: 'Cuando se cobre' },
    ])
    expect(m.cifras.map((c) => `${c.titulo} ${c.valor} ${c.detalle}`)).toEqual(['Cobrados 1 60,50 €', 'Facturas 1 con Verifactu', 'En el banco 1 48,40 €', 'Devueltos 1 96,80 €'])
    expect(m.pasosHechos).toBe(2)
  })

  it('sin nada preparado, vacío; con una conexión real, solo pruebas', () => {
    expect(modeloCobro({ mes: null, ajustes: null, conexion: { entorno: 'real' }, recibos: [] }, E, '2026-12')).toMatchObject({ vacio: true, soloPruebas: true })
  })
})
