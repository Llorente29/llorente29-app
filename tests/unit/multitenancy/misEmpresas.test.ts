// DM1 · PR 1 (30/10/2026). El selector de empresas de quien tiene varias
// cuentas (decisión 7): una fila por sociedad, agrupadas por cuenta; una cuenta
// con una sola sociedad (o ninguna) sale en una fila. Empresas inventadas.
import { describe, it, expect } from 'vitest'
import { detalleDeCuenta, gruposDeEmpresas, salePorVariasCuentas, type CuentaMia } from '../../../src/modules/multitenancy/lib/misEmpresas'

const cuenta = (id: string, nombre: string, extra: Partial<CuentaMia> = {}): CuentaMia => ({
  account_id: id, nombre, slug: id, logo: null, rol: 'admin', solo_sumied: false, activa: false, sociedades: [], ...extra,
})
const soc = (id: string, nombre: string) => ({ id, nombre, razon_social: `${nombre} S.L.`, color: '#123456', logo: 'ruta/en/el/almacen.png' })

describe('DM1 · el selector de varias empresas', () => {
  it('sale solo con más de una cuenta', () => {
    expect(salePorVariasCuentas([cuenta('a', 'Bar Prueba')])).toBe(false)
    expect(salePorVariasCuentas([cuenta('a', 'Bar Prueba'), cuenta('b', 'Restaurante Ejemplo')])).toBe(true)
  })
  it('una cuenta con una sola sociedad (o ninguna) es una fila; con varias, título y una fila por sociedad', () => {
    const g = gruposDeEmpresas([
      cuenta('a', 'Bar Prueba', { activa: true, sociedades: [soc('s1', 'Bar Prueba')] }),
      cuenta('b', 'Grupo Ejemplo', { sociedades: [soc('s2', 'Ejemplo Norte'), soc('s3', 'Ejemplo Sur')] }),
      cuenta('c', 'Solo Cocina'),
    ], 's1')
    expect(g.map((x) => [x.titulo, x.filas.map((f) => f.nombre)])).toEqual([
      [null, ['Bar Prueba']], ['Grupo Ejemplo', ['Ejemplo Norte', 'Ejemplo Sur']], [null, ['Solo Cocina']],
    ])
    expect(g[0].filas[0].abierta).toBe(true)
    expect(g[1].filas.some((f) => f.abierta)).toBe(false)
    // El logo de una sociedad es una ruta del almacén, no un enlace: va su inicial.
    expect(g[0].filas[0].logo).toBeNull()
  })
  it('en una cuenta abierta con varias sociedades, la abierta es la elegida (o la primera)', () => {
    const c = cuenta('b', 'Grupo Ejemplo', { activa: true, sociedades: [soc('s2', 'Ejemplo Norte'), soc('s3', 'Ejemplo Sur')] })
    expect(gruposDeEmpresas([c], 's3')[0].filas.map((f) => f.abierta)).toEqual([false, true])
    expect(gruposDeEmpresas([c], null)[0].filas.map((f) => f.abierta)).toEqual([true, false])
  })
  it('el detalle, como en el tablero: productos y permiso', () => {
    expect(detalleDeCuenta({ solo_sumied: false, rol: 'admin' })).toBe('Folvy y Sumied · Administrador')
    expect(detalleDeCuenta({ solo_sumied: true, rol: 'manager' })).toBe('Sumied · Encargado')
  })
})
