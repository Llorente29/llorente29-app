import { describe, expect, it } from 'vitest'
import {
  migasFichaProveedor, migasProveedores, redireccionesDelModulo, resolverRedireccion,
  rutaFichaProveedor, rutaListaProveedores, rutaSubirFacturaProveedor, PROVEEDORES,
} from '@/config/navegacion'

describe('configuración única de navegación (C01)', () => {
  it('la lista y la ficha salen de un sitio', () => {
    expect(rutaListaProveedores()).toBe('/kitchen/proveedores')
    expect(rutaFichaProveedor('c01a0000-0000-4000-8000-0000000000a3')).toBe('/kitchen/proveedores/c01a0000-0000-4000-8000-0000000000a3')
    expect(rutaFichaProveedor('x', 'pago')).toBe('/kitchen/proveedores/x/pago')
    expect(rutaSubirFacturaProveedor('x')).toBe('/supply/facturas?escanear=1&proveedor=x')
    expect(rutaSubirFacturaProveedor('x', true)).toBe('/supply/facturas?escanear=camara&proveedor=x')
  })
  it('las migas de hoy: Cocina › Proveedores › nombre', () => {
    expect(migasProveedores().map((m) => m.etiqueta)).toEqual(['Cocina', 'Proveedores'])
    const m = migasFichaProveedor('Hermanos Ruiz')
    expect(m.map((x) => x.etiqueta)).toEqual(['Cocina', 'Proveedores', 'Hermanos Ruiz'])
    expect(m[1].ruta).toBe('/kitchen/proveedores')
    expect(m[2].ruta).toBeUndefined()
  })
  it('las rutas del módulo son relativas a él', () => {
    expect(PROVEEDORES.ficha.startsWith('/')).toBe(false)
    expect(PROVEEDORES.apartado).toBe('proveedores/:supplierId/:apartado')
  })
  it('si la dirección cambia, la vieja redirige con sus parámetros', () => {
    // El día de la reorganización: la ficha se va a /compras/… y la vieja sigue valiendo.
    const lista = [{ desde: '/kitchen/proveedores/:supplierId', hasta: '/compras/proveedores/:supplierId' }]
    const r = redireccionesDelModulo('kitchen', lista)
    expect(r).toEqual([{ path: 'proveedores/:supplierId', hasta: '/compras/proveedores/:supplierId' }])
    expect(resolverRedireccion(r[0].hasta, { supplierId: 'abc' })).toBe('/compras/proveedores/abc')
    expect(redireccionesDelModulo('supply', lista)).toEqual([])
  })
})
