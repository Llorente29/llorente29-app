// tests/unit/modules/conta/d04/reparto-pdf.test.ts
//
// D04 · El reparto de la ficha (datos como mucho 680 px, el ancho recordado
// por persona) y la resolución a la que se pinta el PDF (la del panel por la
// densidad de la pantalla). La página de la COHELDI es un A4: 595 × 842 puntos.

import { describe, expect, it } from 'vitest'
import { DATOS_MAX, DATOS_MIN, acotarAncho, anchoConTecla, claveAncho, guardarAncho, leerAncho } from '../../../../../src/modules/conta/diseno/plantillas/reparto'
import { MAX_PIXELES, escalaParaPintar } from '../../../../../src/modules/conta/documentos/escalaPdf'

const A4 = { width: 595, height: 842 }

class Almacen {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

describe('D04 · el reparto de la ficha', () => {
  it('los datos, como mucho 680 px y como poco 360; lo que no se entiende, lo de serie', () => {
    expect(DATOS_MAX).toBe(680)
    expect(acotarAncho(900)).toBe(680)
    expect(acotarAncho(100)).toBe(DATOS_MIN)
    expect(acotarAncho(512.6)).toBe(513)
    expect(acotarAncho('500')).toBe(500)
    expect(acotarAncho('nada')).toBe(680)
    expect(acotarAncho(undefined)).toBe(680)
  })

  it('el ancho se recuerda por persona: lo de una no es lo de otra', () => {
    const a = new Almacen()
    expect(leerAncho('u1', a)).toBe(680)
    guardarAncho('u1', 480, a)
    expect(leerAncho('u1', a)).toBe(480)
    expect(leerAncho('u2', a)).toBe(680)
    expect(claveAncho('u1')).not.toBe(claveAncho('u2'))
    // Un navegador que no deja guardar no rompe nada.
    expect(() => guardarAncho('u1', 400, { setItem: () => { throw new Error('lleno') } })).not.toThrow()
    expect(leerAncho('u1', { getItem: () => { throw new Error('sin permiso') } })).toBe(680)
  })

  it('el separador con el teclado: flechas de 20 en 20, Inicio y Fin a los bordes', () => {
    expect(anchoConTecla(600, 'ArrowLeft')).toBe(580)
    expect(anchoConTecla(670, 'ArrowRight')).toBe(680)
    expect(anchoConTecla(600, 'Home')).toBe(DATOS_MIN)
    expect(anchoConTecla(400, 'End')).toBe(DATOS_MAX)
    expect(anchoConTecla(600, 'Enter')).toBeNull()
  })
})

describe('D04 · el PDF a la resolución del panel', () => {
  it('el lienzo mide el ancho del panel por la densidad de la pantalla, no un tamaño fijo', () => {
    // Un panel de 900 px en una pantalla de densidad 2: 1800 píxeles de lienzo.
    expect(escalaParaPintar(900, A4, 2).ancho).toBe(1800)
    expect(escalaParaPintar(900, A4, 1).ancho).toBe(900)
    // Al ampliar (el panel al 150 %), más píxeles, no los mismos estirados.
    expect(escalaParaPintar(1350, A4, 2).ancho).toBe(2700)
    // Y guarda la proporción de la hoja.
    const e = escalaParaPintar(900, A4, 2)
    expect(Math.abs(e.alto / e.ancho - A4.height / A4.width)).toBeLessThan(0.01)
  })

  it('una página enorme no pasa del tope de memoria; y lo que no se sabe medir, a escala 1', () => {
    const e = escalaParaPintar(4000, A4, 3)
    expect(e.ancho * e.alto).toBeLessThanOrEqual(MAX_PIXELES)
    expect(escalaParaPintar(0, A4, 0).ancho).toBe(595)
  })
})

import { queCuentaLaCola } from '../../../../../src/modules/conta/documentos/recibidas'

describe('D04 · la cifra dice qué cuenta', () => {
  it('«1 de 77 por revisar»: la cola de la ficha lleva el nombre de su pestaña', () => {
    expect(queCuentaLaCola('por-revisar')).toBe('por revisar')
    expect(queCuentaLaCola('por-aclarar')).toBe('por aclarar')
    expect(queCuentaLaCola('todas')).toBe('en total')
  })
})
