import { describe, it, expect } from 'vitest'
import { Store, Bike, ShoppingBag } from 'lucide-react'
import { iconoDeCanal } from '@/modules/kitchen/lib/iconoDeCanal'

// B80 (06/09/2026). Esta prueba existe por una pantalla en blanco en producción.
//
// `Cannot read properties of null (reading 'toLowerCase')`: al abrir «Budapest»
// se caía la ficha entera. La función decía `channelIcon(name: string)` y recibía
// null, porque `menu_item_economics` empezó a devolver filas (B79) con
// `channelName` vacío — el catálogo no tiene canal asignado.
//
// Lo que hay que retener: la función llevaba meses siendo incorrecta y no fallaba
// **porque nunca se ejecutaba**. La RPC devolvía cero filas y el bucle que la
// llama no tenía sobre qué iterar. Arreglar un cero silencioso aguas arriba
// destapa todo lo que se apoyaba en que ese cero no llegara nunca.
//
// Los nombres de canal son los REALES de la cuenta (regla 31): Glovo, JustEat,
// Mostrador, Shop, Uber — más el null, que también es real y es el caso de hoy.

describe('iconoDeCanal · el caso que tumbó la pantalla', () => {
  it('sin canal (null) no revienta: devuelve el icono neutro', () => {
    expect(iconoDeCanal(null)).toBe(ShoppingBag)
    expect(iconoDeCanal(undefined)).toBe(ShoppingBag)
    expect(iconoDeCanal('')).toBe(ShoppingBag)
  })

  it('los cinco canales reales de la cuenta siguen dando lo de siempre', () => {
    expect(iconoDeCanal('Glovo')).toBe(Bike)
    expect(iconoDeCanal('Uber')).toBe(Bike)
    expect(iconoDeCanal('JustEat')).toBe(Bike)
    expect(iconoDeCanal('Mostrador')).toBe(ShoppingBag)
    expect(iconoDeCanal('Shop')).toBe(Store)
  })

  it('no distingue mayúsculas, que es para lo que estaba el toLowerCase', () => {
    expect(iconoDeCanal('GLOVO')).toBe(Bike)
    expect(iconoDeCanal('sala')).toBe(Store)
    expect(iconoDeCanal('Tienda del centro')).toBe(Store)
  })
})
