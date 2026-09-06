import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'

// B79 (06/09/2026). Esta prueba existe por un cartel que mintió durante casi tres
// meses.
//
// LA FACTURA. Rentabilidad decía «Esta marca no tiene platos en carta todavía»
// sobre Ay Mamita Bowls, que tiene 23 productos activos. Y lo decía por DOS
// motivos distintos que la pantalla no distinguía:
//   1. la RPC devolvía cero filas (INNER JOIN contra un `channel_id` vacío);
//   2. **y también cuando la carga fallaba** — `rows` se quedaba a [] y el mismo
//      cartel convertía un error de permisos o de red en una afirmación sobre el
//      inventario del cliente.
//
// El caso 2 es el que fija esta prueba, porque es el que no se ve venir: se
// arregla la RPC, el cartel deja de salir, y el modo «error disfrazado de vacío»
// sigue ahí esperando al siguiente fallo.
//
// Sin jsdom (environment: 'node'): `renderToStaticMarkup` basta para leer el texto.

const html = (p: Parameters<typeof EstadoDeLaConsulta>[0]) =>
  renderToStaticMarkup(<EstadoDeLaConsulta {...p} />)

describe('EstadoDeLaConsulta · el error manda sobre el vacío', () => {
  it('con error, NO dice que no haya datos: dice que no se han podido leer', () => {
    const s = html({
      error: 'Sin permiso para la economía de la marca 092fb053',
      queSePregunto: 'la economía de Ay Mamita Bowls',
      matiz: 'esto no debería salir cuando hay error',
    })
    expect(s).toContain('No se ha podido cargar la economía de Ay Mamita Bowls')
    expect(s).toContain('Sin permiso para la economía de la marca 092fb053')
    expect(s).toContain('no se han podido leer')
    // Lo que NO puede pasar nunca: que un fallo se cuente como inventario vacío.
    expect(s).not.toContain('no ha devuelto ninguna fila')
    expect(s).not.toContain('esto no debería salir cuando hay error')
  })

  it('sin error y vacío, habla de la CONSULTA, no del negocio del cliente', () => {
    const s = html({
      error: null,
      queSePregunto: 'la economía de Ay Mamita Bowls',
      matiz: 'revisa que tengan escandallo.',
    })
    expect(s).toContain('La consulta de la economía de Ay Mamita Bowls no ha devuelto ninguna fila')
    expect(s).toContain('revisa que tengan escandallo.')
    // La frase que costó tres meses no puede volver por ninguna vía.
    expect(s).not.toContain('no tiene platos')
    expect(s).not.toContain('Sin datos todavía')
  })

  it('cargando gana a todo, y dice QUÉ está haciendo', () => {
    const s = html({
      cargando: true,
      textoCargando: 'Cruzando coste real con ventas reales…',
      error: 'un error que todavía no toca enseñar',
      queSePregunto: 'la ingeniería de menús',
    })
    expect(s).toContain('Cruzando coste real con ventas reales…')
    expect(s).not.toContain('un error que todavía no toca enseñar')
    expect(s).not.toContain('no ha devuelto ninguna fila')
  })

  it('el matiz es opcional: sin él, el vacío se dice sin adornos', () => {
    const s = html({ error: null, queSePregunto: 'la rentabilidad' })
    expect(s).toContain('La consulta de la rentabilidad no ha devuelto ninguna fila')
  })
})
