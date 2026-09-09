// Una sección vacía no se pinta en la carta del cliente.
//
// El caso es real y medido (09/09): el importador crea una categoría por
// CATÁLOGO de Last —Glovo, Uber, web, sala…— y los platos cuelgan de una sola,
// así que las demás quedan vacías. En Foodint son 102 de 182, con «Bebidas»
// hasta por triplicado. Al cliente le llegan tres secciones seguidas y dos sin
// nada dentro.

import { describe, it, expect, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, isSupabaseEnabled: true }))

import { getBrandMenu } from '@/modules/shop/services/brandMenuService'

/** Respuesta con la forma real de la RPC, con el caso de «Bebidas» x3. */
function respuesta() {
  return {
    brand_id: 'b1', brand_name: 'Big Mike´s', is_open: true, location_ids: [],
    categories: [
      { id: 'c1', name: 'Basic Burgers', position: 1,
        products: [{ id: 'p1', name: 'Smash', price: 9.5 }] },
      { id: 'c2', name: 'Bebidas', position: 2,
        products: [{ id: 'p2', name: 'Coca-Cola', price: 2.5 }] },
      // Las dos copias que crea el importador, una por catálogo de Last.
      { id: 'c3', name: 'Bebidas', position: 3, products: [] },
      { id: 'c4', name: 'Bebidas', position: 4, products: [] },
      { id: 'c5', name: 'Basic Burgers', position: 5, products: [] },
    ],
  }
}

describe('la carta del cliente', () => {
  it('deja fuera las secciones sin platos', async () => {
    rpc.mockResolvedValue({ data: respuesta(), error: null })
    const menu = await getBrandMenu('mi-tienda', 'b1')
    expect(menu!.categories.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('no se lleva por delante la sección que sí tiene platos con el mismo nombre', async () => {
    // Lo que se filtra es «vacía», no «repetida»: fusionar las duplicadas es
    // otro trabajo, y hacerlo aquí borraría la buena si llega la primera.
    rpc.mockResolvedValue({ data: respuesta(), error: null })
    const menu = await getBrandMenu('mi-tienda', 'b1')
    const bebidas = menu!.categories.filter(c => c.name === 'Bebidas')
    expect(bebidas).toHaveLength(1)
    expect(bebidas[0].products.map(p => p.name)).toEqual(['Coca-Cola'])
  })

  it('si TODAS están vacías, la carta queda vacía y la pantalla lo dice', async () => {
    // No es lo mismo «sin secciones» que «secciones sin nada»: la primera ya
    // tiene su mensaje en pantalla («Esta marca aún no tiene platos
    // disponibles»); la segunda parecía una avería.
    rpc.mockResolvedValue({
      data: { ...respuesta(), categories: [{ id: 'c9', name: 'Bebidas', products: [] }] },
      error: null,
    })
    const menu = await getBrandMenu('mi-tienda', 'b1')
    expect(menu!.categories).toEqual([])
  })
})
