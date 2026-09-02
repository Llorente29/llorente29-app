// tests/unit/shell/homeCatalog.test.ts
//
// Las reglas del catálogo híbrido del Inicio, que son decisiones de Julio y no
// detalles de implementación: el CÓDIGO es la verdad, una fila huérfana no se
// pinta pero tampoco se calla, y el interruptor por cuenta manda sobre el
// espejo.

import { describe, it, expect } from 'vitest'
import {
  catalogoDisponible, resolverMosaico, mover, alternar,
  rolPuedeVer, type CatalogEntry,
} from '@/shell/home/homeCatalog'

const componente = (() => null) as unknown as CatalogEntry['component']
const tarjeta = (key: string, moduleId = 'shell', moduleName = 'Inicio', extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  key, title: key, size: 'sm', component: componente, moduleId, moduleName, ...extra,
})

const A = tarjeta('shell.a')
const B = tarjeta('shell.b')
const C = tarjeta('ventas.c', 'ventas', 'Folvy Sales')
const CATALOGO = [A, B, C]

describe('el código es la verdad', () => {
  it('una fila del espejo SIN componente no aparece nunca en lo disponible', () => {
    const disp = catalogoDisponible(CATALOGO, [{ card_key: 'fantasma', active: true }], [], 'admin')
    expect(disp.map(c => c.key)).not.toContain('fantasma')
    expect(disp).toHaveLength(3)
  })

  it('una tarjeta NUEVA en código, aún sin fila en el espejo, ya está disponible', () => {
    // Verificación 5 del encargo: añadir una homeCard la hace aparecer en el
    // cajón. Si hiciera falta que el deploy sembrara el espejo primero, sería
    // mentira hasta el siguiente arranque.
    const disp = catalogoDisponible(CATALOGO, [], [], 'admin')
    expect(disp).toHaveLength(3)
  })
})

describe('el interruptor', () => {
  it('el espejo puede apagar una tarjeta', () => {
    const disp = catalogoDisponible(CATALOGO, [{ card_key: 'shell.b', active: false }], [], 'admin')
    expect(disp.map(c => c.key)).toEqual(['shell.a', 'ventas.c'])
  })

  it('la cuenta manda sobre el espejo, en los dos sentidos', () => {
    const apagadaEnEspejo = catalogoDisponible(
      CATALOGO, [{ card_key: 'shell.b', active: false }], [{ card_key: 'shell.b', active: true }], 'admin')
    expect(apagadaEnEspejo.map(c => c.key)).toContain('shell.b')

    const apagadaEnCuenta = catalogoDisponible(
      CATALOGO, [{ card_key: 'shell.b', active: true }], [{ card_key: 'shell.b', active: false }], 'admin')
    expect(apagadaEnCuenta.map(c => c.key)).not.toContain('shell.b')
  })
})

describe('la fila huérfana no se pinta, y no se calla', () => {
  it('se queda fuera del mosaico y sale en `huerfanas`', () => {
    const { tarjetas, huerfanas } = resolverMosaico(['shell.a', 'ya.no.existe', 'shell.b'], CATALOGO)
    expect(tarjetas.map(c => c.key)).toEqual(['shell.a', 'shell.b'])
    expect(huerfanas).toEqual(['ya.no.existe'])
  })

  it('desaparecer en silencio sería el fallo: la lista NO se devuelve vacía', () => {
    const { tarjetas, huerfanas } = resolverMosaico(['nada.de.nada'], CATALOGO)
    expect(tarjetas).toEqual([])
    expect(huerfanas).toEqual(['nada.de.nada'])
  })
})

describe('el orden de la lista es el orden en pantalla', () => {
  it('se respeta el orden guardado, no el del catálogo', () => {
    const { tarjetas } = resolverMosaico(['ventas.c', 'shell.a'], CATALOGO)
    expect(tarjetas.map(c => c.key)).toEqual(['ventas.c', 'shell.a'])
  })

  it('una clave repetida se pinta una vez: dos tarjetas iguales no son dos datos', () => {
    const { tarjetas } = resolverMosaico(['shell.a', 'shell.a'], CATALOGO)
    expect(tarjetas.map(c => c.key)).toEqual(['shell.a'])
  })
})

describe('subir y bajar', () => {
  const claves = ['a', 'b', 'c']
  it('sube y baja una posición', () => {
    expect(mover(claves, 'b', 'arriba')).toEqual(['b', 'a', 'c'])
    expect(mover(claves, 'b', 'abajo')).toEqual(['a', 'c', 'b'])
  })
  it('en los extremos no se cae por el borde', () => {
    expect(mover(claves, 'a', 'arriba')).toEqual(claves)
    expect(mover(claves, 'c', 'abajo')).toEqual(claves)
  })
  it('una clave que no está no altera nada', () => {
    expect(mover(claves, 'z', 'arriba')).toEqual(claves)
  })
  it('devuelve una lista NUEVA, no muta la de entrada', () => {
    const original = ['a', 'b', 'c']
    mover(original, 'b', 'arriba')
    expect(original).toEqual(['a', 'b', 'c'])
  })
})

describe('poner y quitar', () => {
  it('añade al final si no estaba', () => {
    expect(alternar(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('quita si estaba', () => {
    expect(alternar(['a', 'b'], 'a')).toEqual(['b'])
  })
})

// La agrupación por MÓDULO se retiró el 02/09: el cajón agrupa por GRUPO DE
// NEGOCIO —Ventas, Team, Cocina, Almacén, Canales, Agentes—, que es el idioma
// con el que se habla del negocio, no el nombre de nuestros módulos. Sus
// pruebas viven ahora en tests/unit/shell/home/cajon.test.ts.
//
// El módulo NO desaparece del catálogo: `moduleId`/`moduleName` siguen ahí y
// siguen siendo de quien aporta el código. Lo que ya no hace es decidir bajo
// qué epígrafe se ve la tarjeta.

describe('rol — P1 solo admin', () => {
  it('una tarjeta sin rol exigido la ve cualquiera', () => {
    expect(rolPuedeVer(A, 'worker')).toBe(true)
    expect(rolPuedeVer(A, null)).toBe(true)
  })
  it('admin ve también las que piden rol', () => {
    const soloAdmin = tarjeta('x', 'shell', 'Inicio', { requiredRole: 'admin' })
    expect(rolPuedeVer(soloAdmin, 'admin')).toBe(true)
    expect(rolPuedeVer(soloAdmin, 'worker')).toBe(false)
  })
})
