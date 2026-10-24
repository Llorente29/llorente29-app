// tests/unit/modules/conta/v01/cierres.test.ts
//
// V01 · Entrega 2 · El núcleo de Ventas › Cierres del día (lib/cierres.ts) y
// lo que el Libro deja de enseñar (las propuestas de ventas van a Cierres).
// Las filas imitan lo que devuelve conta_cierres en producción (Foodint,
// 24/10: tres canales, 85 validados y 12 propuestos) y en staging (el Glovo
// del 24/09 en Norte Centro: 2 pedidos de Casa Lola y uno de Brasa Prestada,
// cedida, que no sale).

import { describe, expect, it } from 'vitest'
import {
  accionesDe, cierreDeFila, etiquetaAjuste, filtrarCierres, listos, pedidoDeFila, pestanaDe, pestanasCierres, ponerCambio, resumenDeAyer,
  siguientePorValidar, textoCambio, totalConCambios, vecinos, type Cierre, type PedidoCierre,
} from '@/modules/conta/lib/cierres'
import { delLibroDiario, seDecideEnSuSitio, NOMBRE_SITIO } from '@/modules/conta/lib/diario'

const fila = (x: Partial<Record<string, unknown>>) => cierreDeFila({
  id: 'c1', local_id: 'l1', local: 'Alcalá', dia: '2026-10-23', unidad: 'canal', canal_id: 'canal', canal: 'Glovo', canal_slug: 'glovo', marca: null,
  tiques: 12, total: 310.4, asiento_id: 'e1', estado_asiento: 'propuesto', numero_asiento: null, factura_id: null, factura: null, documento: null,
  ajustes: 0, estado: 'por_validar', motivo: null, espera_a_mano: false, ...x,
})

const cierres: Cierre[] = [
  fila({ id: 'a', canal: 'Uber', dia: '2026-10-23', total: 512.3 }),
  fila({ id: 'b', canal: 'Glovo', dia: '2026-10-23', total: 310.4, estado: 'en_espera', motivo: 'Glovo paga 4,50 € menos de lo que dice el cierre.', espera_a_mano: true }),
  fila({ id: 'c', canal: 'JustEat', dia: '2026-10-23', total: 120, estado: 'validado', estado_asiento: 'validado', factura: 'JUS-2026/00001', factura_id: 'f1' }),
  fila({ id: 'd', canal: 'Uber', dia: '2026-10-22', total: 480 }),
  fila({ id: null, canal: 'Sin cierre', dia: '2026-10-21', total: 0, estado: 'en_espera', motivo: 'Mostrador: 2 pedidos abiertos a la hora de cierre.', asiento_id: null }),
]

describe('V01 · cierres · la lista', () => {
  it('las pestañas suman «Todos» y «Anulados» solo sale si los hay (regla 7)', () => {
    const p = pestanasCierres(cierres)
    expect(p.map((x) => [x.id, x.n])).toEqual([['por-validar', 2], ['en-espera', 2], ['validados', 1], ['todos', 5]])
    expect(p.filter((x) => x.id !== 'todos').reduce((t, x) => t + x.n, 0)).toBe(p.find((x) => x.id === 'todos')!.n)
  })
  it('lo que no se pudo proponer sale en espera con su porqué, no se esconde', () => {
    const e = filtrarCierres(cierres, 'en-espera', '')
    expect(e.map((x) => x.motivo)).toEqual(['Glovo paga 4,50 € menos de lo que dice el cierre.', 'Mostrador: 2 pedidos abiertos a la hora de cierre.'])
  })
  it('sin pestaña conocida, «Por validar»; buscar por canal, local, factura o importe', () => {
    expect(pestanaDe(null)).toBe('por-validar')
    expect(pestanaDe('validados')).toBe('validados')
    expect(filtrarCierres(cierres, 'todos', 'jus-2026').map((x) => x.id)).toEqual(['c'])
    expect(filtrarCierres(cierres, 'todos', '512,30').map((x) => x.id)).toEqual(['a'])
  })
  it('«Validar los N listos»: los por validar con asiento; los en espera no', () => {
    expect(listos(cierres).map((x) => x.id)).toEqual(['a', 'd'])
  })
  it('el resumen de ayer es el último día con cierres, sin los anulados, por canal', () => {
    const r = resumenDeAyer(cierres)!
    expect(r.dia).toBe('2026-10-23')
    expect(r.total).toBe(942.7)
    expect(r.porCanal.map((x) => x.canal)).toEqual(['Uber', 'Glovo', 'JustEat'])
    expect(r.porValidar).toBe(1)
  })
  it('‹ › y «Validar y siguiente» recorren los que tienen ficha', () => {
    expect(vecinos(cierres, 'b')).toMatchObject({ anterior: { id: 'a' }, siguiente: { id: 'c' } })
    expect(siguientePorValidar(cierres, 'a')?.id).toBe('d')
    expect(siguientePorValidar(cierres, 'd')?.id).toBe('a')
    expect(siguientePorValidar([cierres[0]], 'a')).toBeNull()
  })
})

// Los pedidos del Glovo del 24/09 en staging, como los devuelve conta_cierre_pedidos.
const pedidos: PedidoCierre[] = [
  pedidoDeFila({ id: 'p1', codigo: 'R9-2401', hora: '13:00', dia: '2026-09-24', marca: 'Casa Lola', propia: true, estado: 'closed', total: 22, total_pedido: 22, cuenta: true, ajuste: null }),
  pedidoDeFila({ id: 'p2', codigo: 'R9-2402', hora: '14:00', dia: '2026-09-24', marca: 'Casa Lola', propia: true, estado: 'closed', total: 11, total_pedido: 11, cuenta: true, ajuste: null }),
]

describe('V01 · cierres · los cambios de los pedidos (nada se guarda solo)', () => {
  it('el total con cambios sin guardar: quitar, ajustar y pasar a otro día', () => {
    expect(totalConCambios(pedidos, [], '2026-09-24')).toBe(33)
    expect(totalConCambios(pedidos, [{ pedido: 'p1', accion: 'importe', importe: 21 }], '2026-09-24')).toBe(32)
    expect(totalConCambios(pedidos, [{ pedido: 'p2', accion: 'quitar', motivo: 'Pedido de prueba' }], '2026-09-24')).toBe(22)
    expect(totalConCambios(pedidos, [{ pedido: 'p2', accion: 'mover', dia: '2026-09-25' }], '2026-09-24')).toBe(22)
  })
  it('un cambio por pedido: el último manda', () => {
    const cs = ponerCambio(ponerCambio([], { pedido: 'p1', accion: 'importe', importe: 21 }), { pedido: 'p1', accion: 'quitar', motivo: 'x' })
    expect(cs).toEqual([{ pedido: 'p1', accion: 'quitar', motivo: 'x' }])
  })
  it('cada cambio dice qué hace, con el importe de antes', () => {
    expect(textoCambio({ pedido: 'p1', accion: 'importe', importe: 21 }, pedidos[0])).toBe('El R9-2401 cuenta 21,00 € (era 22,00 €)')
    expect(textoCambio({ pedido: 'p2', accion: 'mover', dia: '2026-09-25' }, pedidos[1])).toBe('Pasar el R9-2402 al 25/09')
    expect(textoCambio({ pedido: 'p2', accion: 'quitar', motivo: 'Pedido de prueba' }, pedidos[1])).toBe('Quitar el R9-2402 de este cierre: Pedido de prueba')
  })
  it('el menú «⋯» ofrece lo que se puede, y lo guardado lleva su etiqueta', () => {
    expect(accionesDe(pedidos[0])).toEqual(['quitar', 'mover', 'importe', 'ver'])
    const quitado = pedidoDeFila({ ...pedidos[1], total_pedido: 11, ajuste: { quitado: true, importe_antes: 11, motivo: 'x' } })
    expect(accionesDe(quitado)).toEqual(['deshacer', 'mover', 'ver'])
    expect(etiquetaAjuste(quitado.ajuste!)).toBe('QUITADO')
    expect(etiquetaAjuste({ quitado: false, dia: null, importe: 21, importeAntes: 22, motivo: null, quien: null, deOtroDia: false })).toBe('CAMBIADO')
    expect(etiquetaAjuste({ quitado: false, dia: '2026-09-25', importe: null, importeAntes: 22, motivo: null, quien: null, deOtroDia: false })).toBe('PASADO AL 25/09')
  })
})

describe('V01 · el Libro: las propuestas de ventas se deciden en Cierres del día', () => {
  it('una propuesta del cierre del día no es de Asientos; validada, sí (es libro)', () => {
    expect(seDecideEnSuSitio({ estado: 'propuesto', origen: 'sales_day' })).toBe('cierres')
    expect(seDecideEnSuSitio({ estado: 'validado', origen: 'sales_day' })).toBeNull()
    expect(delLibroDiario([{ estado: 'propuesto', origen: 'sales_day' }, { estado: 'validado', origen: 'sales_day' }])).toHaveLength(1)
    expect(NOMBRE_SITIO.cierres).toBe('Ventas › Cierres del día')
  })
  it('una del día entero «a la antigua» (sin canal) no tiene cierre en esa pantalla: se queda en Asientos (regla 7)', () => {
    // Staging, 24/10: «Ventas del día · Norte Centro» del 05/10, propuesta y sin canal.
    expect(seDecideEnSuSitio({ estado: 'propuesto', origen: 'sales_day', sinCanal: true })).toBeNull()
    expect(delLibroDiario([{ estado: 'propuesto', origen: 'sales_day', sinCanal: true }, { estado: 'propuesto', origen: 'sales_day' }])).toHaveLength(1)
  })
})
