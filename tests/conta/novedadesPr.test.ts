// NV1 (03/11) · «## Novedades» en cada PR a main: lo que enseña el cartel de
// versión nueva. Contra frases de verdad: las de la maqueta aprobada por Julio
// y la descripción del #461 tal como se fusionó (sin la sección: hoy no pasaría).
import { describe, expect, it } from 'vitest'
import { ficheroDeNovedades, jergaDe, novedadesDelCuerpo, revisarNovedades } from '../../scripts/pr/novedades.mjs'

const BUENA = `## Qué hace
Cosas.

## Novedades
### Sumied
- **Pagos:** Ya puedes pagar varias facturas de una vez y mandar el justificante por WhatsApp. (/conta/compras/pagos)
- **Liquidaciones:** Un mes entero en una pantalla, por plataforma y tienda.
### Folvy
ninguna

## Producto
Sumied
`

describe('la sección «Novedades»', () => {
  it('lee cada grupo con su apartado, su frase y su pantalla', () => {
    const n = novedadesDelCuerpo(BUENA)!
    expect(n.fallos).toEqual([])
    expect(n.sumied).toEqual([
      { apartado: 'Pagos', frase: 'Ya puedes pagar varias facturas de una vez y mandar el justificante por WhatsApp.', ruta: '/conta/compras/pagos' },
      { apartado: 'Liquidaciones', frase: 'Un mes entero en una pantalla, por plataforma y tienda.', ruta: null },
    ])
    expect(n.folvy).toEqual([])
    expect(n.comun).toBeNull()
    expect(revisarNovedades(BUENA)).toEqual([])
  })

  it('el #461 se fusionó sin la sección: hoy no pasaría', () => {
    const cuerpo461 = '## Qué hace\n\n1. **Arriba:** el mes con ‹ ›...\n\n## Producto\n\nSumied\n\n## Funciones a desplegar a mano\n\n### Sumied\nninguna\n\n### Folvy\nninguna\n'
    expect(novedadesDelCuerpo(cuerpo461)).toBeNull()
    expect(revisarNovedades(cuerpo461)[0]).toMatch(/^Falta la sección «## Novedades»/)
  })

  it('pide los dos grupos, aunque sea con «ninguna»', () => {
    expect(revisarNovedades('## Novedades\n### Sumied\nninguna\n')).toEqual(['En «## Novedades» falta «### Folvy» (con sus frases o «ninguna»).'])
    expect(revisarNovedades('## Novedades\n### Sumied\nninguna\n### Folvy\n- ninguna\n### Común\n- **Entrar:** Ahora recuerda tu correo.')).toEqual([])
  })

  it('cada línea, con su apartado en negrita', () => {
    expect(revisarNovedades('## Novedades\n### Sumied\n- Pagos más rápidos\n### Folvy\nninguna')[0]).toMatch(/no tiene la forma «- \*\*Apartado:\*\* lo que cambia\.»/)
  })

  it('sin jerga: palabras de quien programa y nombres de tablas no pasan', () => {
    const mal = '## Novedades\n### Sumied\n- **Liquidaciones:** Fix en la migración de conta_liquidaciones_mes.\n### Folvy\nninguna'
    const f = revisarNovedades(mal)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/fix/)
    expect(f[0]).toMatch(/migración/)
    expect(f[0]).toMatch(/conta_liquidaciones_mes/)
    expect(jergaDe('Este PR arregla un bug')).toEqual(['pr', 'bug'])
    expect(jergaDe('El `tabla` nueva')).toContain('comillas invertidas (`…`)')
  })

  it('las palabras de quien usa Sumied pasan (las frases de la maqueta)', () => {
    for (const t of [
      'Pagos: Paga varias facturas de una vez desde Revolut y manda el justificante al proveedor por WhatsApp.',
      'Liquidaciones: Un mes entero en una pantalla, por plataforma y tienda, con lo que falta en cada una.',
      'Usuarios: Invita a cualquier persona a una o varias empresas y elige qué puede hacer en cada una.',
      'Bancos: La tabla de amortización del préstamo, con su índice de cuotas.',
      'Compras: Las facturas de tu proveedor, por fecha.',
    ]) expect(jergaDe(t), t).toEqual([])
  })

  it('como mucho 3 por grupo y dos frases cada una', () => {
    const cuatro = ['A', 'B', 'C', 'D'].map((x) => `- **${x}:** Algo nuevo.`).join('\n')
    expect(revisarNovedades(`## Novedades\n### Sumied\n${cuatro}\n### Folvy\nninguna`)[0]).toMatch(/lleva 4 novedades: como mucho 3/)
    expect(revisarNovedades('## Novedades\n### Sumied\n- **A:** Una. Dos. Tres.\n### Folvy\nninguna')[0]).toMatch(/más de dos frases/)
  })
})

describe('el fichero que se escribe al fusionar', () => {
  it('una línea por novedad, con su producto y su id', () => {
    expect(ficheroDeNovedades({ pr: 470, fecha: '2026-11-03T20:10:00Z', cuerpo: BUENA })).toEqual([
      { id: '470-1', pr: 470, fecha: '2026-11-03T20:10:00Z', producto: 'sumied', apartado: 'Pagos', frase: 'Ya puedes pagar varias facturas de una vez y mandar el justificante por WhatsApp.', ruta: '/conta/compras/pagos' },
      { id: '470-2', pr: 470, fecha: '2026-11-03T20:10:00Z', producto: 'sumied', apartado: 'Liquidaciones', frase: 'Un mes entero en una pantalla, por plataforma y tienda.', ruta: null },
    ])
  })
  it('sin novedades (todo «ninguna»), no se escribe nada', () => {
    expect(ficheroDeNovedades({ pr: 1, fecha: 'x', cuerpo: '## Novedades\n### Sumied\nninguna\n### Folvy\nninguna' })).toBeNull()
  })
})
