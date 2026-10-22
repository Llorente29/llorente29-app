// tests/unit/modules/conta/s01e/esqueleto-confunde.test.ts
//
// S01e · Lo que confundía del esqueleto (auditoría, PR 3):
//   · «Más ▾» cambiaba de sitio según la pantalla enseñara o no el ejercicio, y
//     con la activa dentro («Cierre y Registro ▾») pisaba «Buscar»;
//   · en el móvil, las pestañas y la cinta se cortaban sin señal de que hubiera
//     más, y la activa podía quedar fuera de la vista;
//   · el nivel salía suelto («Medio») junto al nombre.
// Con los anchos de las pestañas de Contabilidad medidos a 14 px en negrita.

import { describe, expect, it } from 'vitest'
import { bordesOcultos, desplazamientoParaVer } from '@/modules/conta/esqueleto/deslizable'
import { NIVELES, fraseNivel } from '@/modules/conta/esqueleto/preferencias'


// S02 · Se acabaron las pestañas en la cabecera (y con ellas «Más ▾» y su reserva
// de ancho): las páginas de un apartado van debajo de él, en la barra.

describe('una fila que se desliza (móvil)', () => {
  it('dice a qué lado queda algo por ver', () => {
    expect(bordesOcultos(0, 375, 375)).toEqual({ izquierda: false, derecha: false })
    expect(bordesOcultos(0, 375, 1590)).toEqual({ izquierda: false, derecha: true })
    expect(bordesOcultos(600, 375, 1590)).toEqual({ izquierda: true, derecha: true })
    expect(bordesOcultos(1215, 375, 1590)).toEqual({ izquierda: true, derecha: false })
  })
  it('lleva lo actual a la vista, centrado, sin pasarse de los bordes', () => {
    // Una pestaña en 900–1000 de una fila de 1590 vista por 375: queda centrada.
    const x = desplazamientoParaVer(900, 100, 375, 1590)
    expect(x).toBe(763)
    expect(900 - x).toBeGreaterThanOrEqual(0)
    expect(1000 - x).toBeLessThanOrEqual(375)
    expect(desplazamientoParaVer(10, 80, 375, 1590)).toBe(0)
    expect(desplazamientoParaVer(1500, 90, 375, 1590)).toBe(1215)
    expect(desplazamientoParaVer(50, 80, 375, 300)).toBe(0)
  })
})

describe('el nivel, con lo que es', () => {
  it('«Nivel medio», no «Medio» suelto', () => {
    expect(NIVELES.map(fraseNivel)).toEqual(['Nivel sin experiencia', 'Nivel medio', 'Nivel experto'])
  })
})
