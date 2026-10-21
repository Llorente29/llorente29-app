// tests/unit/modules/conta/s01e/esqueleto-confunde.test.ts
//
// S01e · Lo que confundía del esqueleto (auditoría, PR 3):
//   · «Más ▾» cambiaba de sitio según la pantalla enseñara o no el ejercicio, y
//     con la activa dentro («Cierre y Registro ▾») pisaba «Buscar»;
//   · en el móvil, las pestañas y la cinta se cortaban sin señal de que hubiera
//     más, y la activa podía quedar fuera de la vista;
//   · el nivel salía suelto («Medio») junto al nombre.
// Con los anchos de las pestañas de Contabilidad medidos a 14 px en negrita.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCTOS, anchoParaPestanas, cuantasCaben } from '@/modules/conta/esqueleto/productos'
import { bordesOcultos, desplazamientoParaVer } from '@/modules/conta/esqueleto/deslizable'
import { NIVELES, fraseNivel } from '@/modules/conta/esqueleto/preferencias'

// Asientos · Libros y listados · Definiciones · Cierre y Registro · Importar
const ANCHOS = [82, 140, 112, 150, 84]
const MAS = 64
// «Asientos ▾» … «Importar ▾»
const ACTIVA = [98, 156, 128, 166, 100]

describe('«Más ▾» no pisa «Buscar» con la activa dentro', () => {
  it('se reserva el botón de la más ancha de las que irían dentro', () => {
    // Con «Más ▾» a secas cabrían 3 (82+140+112 + 3 huecos de 4 + 64 = 410 ≤ 420)…
    expect(cuantasCaben(ANCHOS, 420, MAS, 4)).toBe(3)
    // …pero «Cierre y Registro ▾» mide 166: con 3 a la vista no cabe, con 2 sí.
    expect(cuantasCaben(ANCHOS, 420, MAS, 4, ACTIVA)).toBe(2)
  })
  it('lo que se ve no cambia con la pestaña activa (no la recibe)', () => {
    for (const d of [300, 420, 520, 600]) {
      const n = cuantasCaben(ANCHOS, d, MAS, 4, ACTIVA)
      const usado = ANCHOS.slice(0, n).reduce((s, a) => s + a + 4, 0)
      const boton = n < ANCHOS.length ? Math.max(MAS, ...ACTIVA.slice(n)) : 0
      expect(usado + boton, `a ${d} px`).toBeLessThanOrEqual(d)
    }
  })
  it('si caben todas, todas y sin «Más»', () => {
    expect(cuantasCaben(ANCHOS, 600, MAS, 4, ACTIVA)).toBe(5)
  })
})

describe('el ejercicio en unas pantallas y en otras no: las mismas pestañas a la vista', () => {
  const RESERVA = 210
  it('con el ejercicio o sin él, el mismo ancho para las pestañas', () => {
    const sinPeriodo = 760
    const periodo = 200 + 8
    const conPeriodo = sinPeriodo - periodo   // el centro encoge lo que ocupa el ejercicio
    expect(anchoParaPestanas(sinPeriodo, 0, RESERVA)).toBe(anchoParaPestanas(conPeriodo, periodo, RESERVA))
    expect(cuantasCaben(ANCHOS, anchoParaPestanas(sinPeriodo, 0, RESERVA), MAS, 4, ACTIVA))
      .toBe(cuantasCaben(ANCHOS, anchoParaPestanas(conPeriodo, periodo, RESERVA), MAS, 4, ACTIVA))
  })
  it('un periodo más ancho que la reserva no se resta dos veces; sin reserva, todo el ancho', () => {
    expect(anchoParaPestanas(500, 260, RESERVA)).toBe(500)
    expect(anchoParaPestanas(500, 0, 0)).toBe(500)
    expect(anchoParaPestanas(100, 0, RESERVA)).toBe(0)
  })
  it('los productos que ponen el ejercicio o el mes en la cabecera lo guardan', () => {
    const conPeriodo = PRODUCTOS.filter((p) => (p.periodo ?? 0) > 0).map((p) => p.id).sort()
    expect(conPeriodo).toEqual(['bancos', 'compras', 'contabilidad'])
    // El ejercicio de Contabilidad es el más ancho («Ejercicio 2025 · cerrado»).
    expect(PRODUCTOS.find((p) => p.id === 'contabilidad')!.periodo).toBeGreaterThan(PRODUCTOS.find((p) => p.id === 'bancos')!.periodo!)
    // Y son los que tienen pantallas con PeriodoEnBarra.
    for (const f of ['src/modules/conta/libros/LibrosPage.tsx', 'src/modules/conta/bancos/BancosPage.tsx', 'src/modules/conta/documentos/DocumentosPage.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('<PeriodoEnBarra>')
    }
  })
})

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
  it('el CSS pinta el degradado y deja «Ocultar» a la derecha, fuera de la fila que se desliza (S01f)', () => {
    const css = readFileSync('src/modules/conta/esqueleto/esqueleto.css', 'utf8')
    const diseno = readFileSync('src/modules/conta/diseno/diseno.css', 'utf8')
    expect(css).toContain('.s-pestanas-movil[data-mas-derecha]')
    expect(css).toContain('.s-cinta-grupos[data-mas-izquierda]')
    expect(css).toContain('.s-cinta-grupos[data-mas-derecha]')
    // S01f (Julio, 20/10): pegado encima de la fila tapaba «Revisar y presentar…»; ahora va fuera de ella.
    expect(css).not.toMatch(/\.s-cinta-ocultar \{ position: sticky/)
    expect(diseno).toMatch(/\.s-cinta-ocultar \{ display: none; \}/)
    expect(diseno).toMatch(/\.s-cinta-ocultar-fuera \{\s*display: inline-flex; flex-shrink: 0;/)
  })
})

describe('el nivel, con lo que es', () => {
  it('«Nivel medio», no «Medio» suelto', () => {
    expect(NIVELES.map(fraseNivel)).toEqual(['Nivel sin experiencia', 'Nivel medio', 'Nivel experto'])
  })
})
