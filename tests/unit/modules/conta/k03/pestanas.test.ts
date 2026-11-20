// tests/unit/modules/conta/k03/pestanas.test.ts
//
// K03 · La lógica de las pestañas de trabajo (src/modules/conta/nucleo/pestanas.ts):
// de qué pestaña es cada dirección, abrir, volver, cerrar, recargar y cuántas
// caben en la fila. Y el teclado común (nucleo/teclado.ts).

import { describe, expect, it } from 'vitest'
import { aGuardar, alNavegar, cerrar, claveDe, cuantasCaben, deAlLado, estadoInicial, INICIO, nombrePorDefecto, pestanasGuardadas } from '@/modules/conta/nucleo/pestanas'
import { teclaDelMarco, VUELTA_F8 } from '@/modules/conta/nucleo/teclado'

const ids = (e: { abiertas: { id: string }[] }) => e.abiertas.map((p) => p.id)

describe('K03 · de qué pestaña es cada dirección', () => {
  it('la de su botón de la cinta', () => {
    expect(claveDe('/conta/documentos?ver=por-revisar')).toBe('boton:recibidas')
    expect(claveDe('/conta/bancos')).toBe('boton:bancos')
    expect(claveDe('/conta/libros/mayor/sumas-saldos')).toBe('boton:sumas')
    expect(claveDe('/conta/inicio')).toBe(INICIO)
    expect(claveDe('/conta/ajustes/impuestos')).toBe('persona:ajustes.impuestos')
  })
  it('la ficha de un documento, en la suya (no en la de su lista), una por clase', () => {
    expect(claveDe('/conta/documentos/recibidas/abc')).toBe('ficha:recibida')
    expect(claveDe('/conta/documentos/recibidas/def')).toBe('ficha:recibida')
    expect(claveDe('/conta/documentos/nueva')).toBe('ficha:recibida')
    expect(claveDe('/conta/ventas/facturas/nueva')).toBe('ficha:emitida')
    expect(claveDe('/conta/ventas/facturas')).toBe('boton:emitidas')
    expect(claveDe('/conta/libros/diario/123')).toBe('ficha:asiento')
    expect(claveDe('/conta/libros/diario')).toBe('boton:asientos')
    expect(claveDe('/conta/libros/diario/resumido')).toBe('boton:resumido')
    // N09a · Traer de ERP10 vive bajo libros/diario/, pero no es un asiento: su pestaña es la suya (e2e 1548: se abría como «Asiento»).
    expect(claveDe('/conta/libros/diario/traer-erp10')).toBe('boton:traerErp10')
    expect(nombrePorDefecto({ id: 'boton:traerErp10', url: '/conta/libros/diario/traer-erp10' })).toBe('Traer de ERP10')
    expect(claveDe('/conta/libros/cierre/salida-erp10')).toBe('boton:salidaErp10')
    // N10 · Libros › Diario por su área y su acción no son asientos: el Libro diario y el Diario resumido.
    expect(claveDe('/conta/libros/diario/libro-diario')).toBe('boton:asientos')
    expect(claveDe('/conta/libros/diario/diario-resumido')).toBe('boton:resumido')
    expect(nombrePorDefecto({ id: 'boton:resumido', url: '/conta/libros/diario/diario-resumido' })).toBe('Diario resumido')
  })
  it('el mayor de cada cuenta, en la suya (F5 abre «el mayor de la cuenta en otra pestaña»)', () => {
    expect(claveDe('/conta/plan/40000007')).toBe('mayor:40000007')
    expect(claveDe('/conta/plan/57200001?ejercicio=2026')).toBe('mayor:57200001')
    expect(nombrePorDefecto({ id: 'mayor:40000007', url: '/conta/plan/40000007' })).toBe('Mayor · 40000007')
  })
  it('el nombre, si la pantalla no dice el suyo: el de la pantalla', () => {
    expect(nombrePorDefecto({ id: 'boton:recibidas', url: '/conta/documentos' })).toBe('Facturas recibidas')
    expect(nombrePorDefecto({ id: 'ficha:recibida', url: '/conta/documentos/recibidas/x' })).toBe('Factura recibida')
    expect(nombrePorDefecto({ id: INICIO, url: '/conta/inicio' })).toBe('Inicio')
  })
})

describe('K03 · abrir, volver y cerrar', () => {
  const e0 = estadoInicial(0)
  it('Inicio está siempre, la primera', () => {
    expect(ids(e0)).toEqual([INICIO])
    expect(e0.activa).toBe(INICIO)
  })
  it('abrir tres pantallas: tres pestañas, la última activa', () => {
    let e = alNavegar(e0, '/conta/documentos', 1)
    e = alNavegar(e, '/conta/bancos', 2)
    e = alNavegar(e, '/conta/libros/mayor/sumas-saldos', 3)
    expect(ids(e)).toEqual([INICIO, 'boton:recibidas', 'boton:bancos', 'boton:sumas'])
    expect(e.activa).toBe('boton:sumas')
  })
  it('volver a una abierta (un botón, atrás, un enlace) la activa, con la dirección nueva, sin abrir otra', () => {
    let e = alNavegar(e0, '/conta/documentos', 1)
    e = alNavegar(e, '/conta/bancos', 2)
    e = alNavegar(e, '/conta/documentos?ver=por-aclarar', 3)
    expect(ids(e)).toEqual([INICIO, 'boton:recibidas', 'boton:bancos'])
    expect(e.activa).toBe('boton:recibidas')
    expect(e.abiertas[1].url).toBe('/conta/documentos?ver=por-aclarar')
  })
  it('cerrar la activa vuelve a la última que se miró', () => {
    let e = alNavegar(e0, '/conta/documentos', 1)
    e = alNavegar(e, '/conta/bancos', 2)
    e = alNavegar(e, '/conta/documentos', 3)
    e = alNavegar(e, '/conta/libros/diario', 4)
    const r = cerrar(e, 'boton:asientos')
    expect(ids(r.estado)).toEqual([INICIO, 'boton:recibidas', 'boton:bancos'])
    expect(r.estado.activa).toBe('boton:recibidas')
    expect(r.ir).toBe('/conta/documentos')
  })
  it('cerrar otra que no es la activa no mueve nada', () => {
    let e = alNavegar(e0, '/conta/documentos', 1)
    e = alNavegar(e, '/conta/bancos', 2)
    const r = cerrar(e, 'boton:recibidas')
    expect(r.estado.activa).toBe('boton:bancos')
    expect(r.ir).toBeNull()
  })
  it('Inicio no se cierra', () => {
    const r = cerrar(alNavegar(e0, '/conta/bancos', 1), INICIO)
    expect(ids(r.estado)).toEqual([INICIO, 'boton:bancos'])
    expect(r.ir).toBeNull()
  })
  it('cerrar la última vuelve a Inicio', () => {
    const e = alNavegar(e0, '/conta/bancos', 1)
    const r = cerrar(e, 'boton:bancos')
    expect(r.estado.activa).toBe(INICIO)
    expect(r.ir).toBe('/conta/inicio')
  })
  it('moverse entre pestañas (Alt Av Pág / Re Pág), dando la vuelta', () => {
    let e = alNavegar(e0, '/conta/documentos', 1)
    e = alNavegar(e, '/conta/bancos', 2)
    expect(deAlLado(e, 1).id).toBe(INICIO)
    expect(deAlLado(e, -1).id).toBe('boton:recibidas')
  })
})

describe('K03 · recargar no pierde las pestañas', () => {
  it('vuelven todas, en su orden, dormidas; la de la dirección, activa y despierta', () => {
    let e = alNavegar(estadoInicial(0), '/conta/documentos', 1)
    e = alNavegar(e, '/conta/bancos', 2)
    e = alNavegar(e, '/conta/plan/40000007', 3)
    const guardado = JSON.parse(JSON.stringify(aGuardar(e)))
    const r = pestanasGuardadas(guardado, '/conta/plan/40000007', 10)
    expect(ids(r)).toEqual([INICIO, 'boton:recibidas', 'boton:bancos', 'mayor:40000007'])
    expect(r.activa).toBe('mayor:40000007')
    expect(r.abiertas.map((p) => p.montada)).toEqual([false, false, false, true])
  })
  it('un enlace directo a otra cosa: las de antes siguen, y se abre la suya', () => {
    const e = alNavegar(estadoInicial(0), '/conta/bancos', 1)
    const r = pestanasGuardadas(aGuardar(e), '/conta/documentos', 5)
    expect(ids(r)).toEqual([INICIO, 'boton:bancos', 'boton:recibidas'])
    expect(r.activa).toBe('boton:recibidas')
  })
  it('lo guardado que no se entiende se ignora: lo de hoy no se rompe', () => {
    for (const raro of [null, 'texto', { abiertas: 3 }, { abiertas: [{ url: 'https://otra.cosa/x' }, { url: 7 }] }]) {
      const r = pestanasGuardadas(raro, '/conta/bancos', 1)
      expect(ids(r)).toEqual([INICIO, 'boton:bancos'])
    }
  })
})

describe('K03 · cuántas caben en la fila (el tope)', () => {
  it('si caben todas, todas en la fila', () => {
    expect(cuantasCaben([100, 100, 100], 400, 90, 2)).toEqual({ enFila: [0, 1, 2], enMenu: [] })
  })
  it('las que no caben van al menú, dejando sitio para «N más ▾»; ninguna se pierde', () => {
    const r = cuantasCaben([100, 150, 150, 150, 150], 500, 90, 1)
    // 500 de ancho, 90 para «N más ▾»: caben 100 + 150 + 150 = 400.
    expect(r.enFila).toEqual([0, 1, 2])
    expect(r.enMenu).toEqual([3, 4])
    expect([...r.enFila, ...r.enMenu].sort()).toEqual([0, 1, 2, 3, 4])
  })
  it('la activa siempre se ve, aunque esté al final (sale de la fila la de antes de ella)', () => {
    const r = cuantasCaben([100, 150, 150, 150, 150], 500, 90, 4)
    expect(r.enFila).toContain(4)
    expect(r.enFila).toContain(0)
    expect(r.enMenu).not.toContain(4)
  })
})

describe('K03 · el teclado común', () => {
  const ctx = { cuenta: null as string | null, pathname: '/conta/documentos', enElMarco: false }
  it('F5 con cuenta elegida: su mayor; sin cuenta, nada (y no recarga); con Ctrl o Mayúsculas, del navegador', () => {
    expect(teclaDelMarco({ key: 'F5' }, { ...ctx, cuenta: '40000007' })).toEqual({ que: 'mayor', cuenta: '40000007' })
    expect(teclaDelMarco({ key: 'F5' }, ctx)).toEqual({ que: 'nada' })
    expect(teclaDelMarco({ key: 'F5', ctrlKey: true }, ctx)).toBeNull()
    expect(teclaDelMarco({ key: 'F5', shiftKey: true }, ctx)).toBeNull()
  })
  it('F4 busca, salvo que la pantalla la haya cogido (la casilla de una cuenta)', () => {
    expect(teclaDelMarco({ key: 'F4' }, ctx)).toEqual({ que: 'buscar' })
    expect(teclaDelMarco({ key: 'F4', defaultPrevented: true }, ctx)).toBeNull()
  })
  it('F8 da la vuelta a las tres clases de documento nuevo; fuera de ellas, nada', () => {
    expect(VUELTA_F8).toEqual(['documentos/nueva', 'ventas/facturas/nueva', 'libros/diario/nuevo'])
    expect(teclaDelMarco({ key: 'F8' }, { ...ctx, pathname: '/conta/documentos/nueva' })).toEqual({ que: 'clase', a: 'ventas/facturas/nueva' })
    expect(teclaDelMarco({ key: 'F8' }, { ...ctx, pathname: '/conta/libros/diario/nuevo' })).toEqual({ que: 'clase', a: 'documentos/nueva' })
    expect(teclaDelMarco({ key: 'F8' }, ctx)).toBeNull()
  })
  it('Esc desde el marco vuelve a la pantalla; desde la pantalla, es de la pantalla', () => {
    expect(teclaDelMarco({ key: 'Escape' }, { ...ctx, enElMarco: true })).toEqual({ que: 'volver' })
    expect(teclaDelMarco({ key: 'Escape' }, ctx)).toBeNull()
  })
  it('Alt Av Pág y Alt Re Pág, la pestaña siguiente y la anterior', () => {
    expect(teclaDelMarco({ key: 'PageDown', altKey: true }, ctx)).toEqual({ que: 'pestana', paso: 1 })
    expect(teclaDelMarco({ key: 'PageUp', altKey: true }, ctx)).toEqual({ que: 'pestana', paso: -1 })
    expect(teclaDelMarco({ key: 'PageDown' }, ctx)).toBeNull()
  })
  it('Intro no se toca aquí (va con la ficha, K04)', () => {
    expect(teclaDelMarco({ key: 'Enter' }, ctx)).toBeNull()
  })
})
