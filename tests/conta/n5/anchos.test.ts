// tests/conta/n5/anchos.test.ts
//
// N5 · La regla de anchos de pantalla (Julio, 23/10): los tramos, la barra, el
// PDF y las columnas que caben. Las columnas son las de Facturas recibidas, con
// sus prioridades y mínimos de verdad (DocumentosPage).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { barraAbierta, columnasQueCaben, documentoEnPanel, textoColumnasOcultas, tramoDeAncho } from '../../../src/modules/conta/diseno/plantillas/anchos'

describe('N5 · los tramos', () => {
  it.each([
    [1920, 'ancho'], [1600, 'ancho'], [1599, 'medio'], [1366, 'medio'], [1280, 'medio'], [1279, 'estrecho'], [1024, 'estrecho'],
    [1023, 'tableta'], [768, 'tableta'], [767, 'movil'], [390, 'movil'],
  ] as const)('%i px → %s', (px, t) => expect(tramoDeAncho(px)).toBe(t))
})

describe('N5 · la barra', () => {
  it('con 1600 px o más, como la deje cada persona', () => {
    expect(barraAbierta('ancho', true, null)).toBe(true)
    expect(barraAbierta('ancho', false, null)).toBe(false)
    expect(barraAbierta('ancho', false, true)).toBe(false)
  })
  it('de 1280 a 1599 (y por debajo), plegada sola aunque la preferencia sea abierta; abierta solo si se abre a mano', () => {
    expect(barraAbierta('medio', true, null)).toBe(false)
    expect(barraAbierta('medio', true, true)).toBe(true)
    expect(barraAbierta('estrecho', true, null)).toBe(false)
  })
})

describe('N5 · el PDF', () => {
  it('al lado con 1280 px o más; en un panel de 768 a 1279; en el móvil, lo de siempre', () => {
    expect([1920, 1366, 1280, 1279, 1024, 900, 767, 390].map((px) => documentoEnPanel(tramoDeAncho(px)))).toEqual([false, false, false, true, true, true, false, false])
  })
})

describe('N5 · las columnas de Facturas recibidas se ocultan por prioridad, sin desplazarse de lado', () => {
  // Las de DocumentosPage: fecha, proveedor, nº, local, base, IVA, total y «¿Lista para validar?».
  const cols = [
    { id: 'fecha', prioridad: 1, minimo: 80 }, { id: 'proveedor', prioridad: 1, minimo: 200 }, { id: 'numero', prioridad: 3, minimo: 130 },
    { id: 'local', prioridad: 5, minimo: 120 }, { id: 'base', prioridad: 4, minimo: 100 }, { id: 'iva', prioridad: 4, minimo: 90 },
    { id: 'total', prioridad: 1, minimo: 110 }, { id: 'lista', prioridad: 2, minimo: 170 },
  ]
  it('con sitio, todas, en su orden', () => expect(columnasQueCaben(cols, 1200)).toEqual(cols.map((c) => c.id)))
  it('primero se va el local; luego el IVA y la base (la de más a la derecha antes); luego el número; luego «¿Lista?»', () => {
    expect(columnasQueCaben(cols, 950)).toEqual(['fecha', 'proveedor', 'numero', 'base', 'iva', 'total', 'lista'])
    expect(columnasQueCaben(cols, 800)).toEqual(['fecha', 'proveedor', 'numero', 'base', 'total', 'lista'])
    expect(columnasQueCaben(cols, 700)).toEqual(['fecha', 'proveedor', 'numero', 'total', 'lista'])
    expect(columnasQueCaben(cols, 600)).toEqual(['fecha', 'proveedor', 'total', 'lista'])
    expect(columnasQueCaben(cols, 400)).toEqual(['fecha', 'proveedor', 'total'])
  })
  it('las de prioridad 1 no se quitan nunca, aunque no quepan', () => expect(columnasQueCaben(cols, 100)).toEqual(['fecha', 'proveedor', 'total']))
  it('sin prioridad ni mínimo, todas valen 1 y 96 px: ninguna lista de antes cambia', () => {
    expect(columnasQueCaben([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 10)).toEqual(['a', 'b', 'c'])
  })
  it('lo que se dice de las ocultas (para el lector)', () => {
    expect(textoColumnasOcultas([])).toBeNull()
    expect(textoColumnasOcultas(['Local', 'IVA', 'Base'])).toBe('Con este ancho no caben Local, IVA y Base: están en la ficha de cada una.')
  })
})

describe('N5 · dónde se aplica (por ahora, Compras y gastos)', () => {
  it('el marco pliega la barra solo en Compras y gastos; la preferencia guardada no se toca por debajo de 1600', () => {
    const m = readFileSync('src/modules/conta/marco/Marco.tsx', 'utf8')
    expect(m).toContain("const conRegla = producto?.id === 'compras'")
    expect(m).toContain('<Barra d={datosBarra} desplegada={desplegada} alternar={alternarBarra}')
  })
  it('las dos fichas de Compras llevan la regla; las listas, sus prioridades', () => {
    expect(readFileSync('src/modules/conta/documentos/RevisarFacturaPage.tsx', 'utf8')).toContain('usuario={userId} reglaAnchos />')
    expect(readFileSync('src/modules/conta/documentos/RecibidaAMano.tsx', 'utf8')).toContain('usuario={userId} reglaAnchos />')
    expect(readFileSync('src/modules/conta/documentos/DocumentosPage.tsx', 'utf8')).toContain("id: 'local', titulo: ejeLocal.nombre, prioridad: 5, minimo: 120")
    expect(readFileSync('src/modules/conta/compras/LiquidacionesPage.tsx', 'utf8')).toContain("id: 'estado', titulo: 'Estado', prioridad: 3, minimo: 160")
  })
})
