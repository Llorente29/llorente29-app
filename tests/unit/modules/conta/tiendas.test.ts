// D01 · «Sus tiendas» (16/10): el estado de cada tienda, la marca que se
// propone por el nombre y lo que se dice. Nombres inventados con la forma de
// los de Uber en producción (medida el 16/10: las 7 son «Marca (dirección,
// ciudad, país, código postal)»); ninguno real.
import { describe, expect, it } from 'vitest'
import { estadoTienda, marcaPropuesta, resumenTiendas, textoGuardada, type TiendaPlataforma } from '@/modules/conta/lib/tiendas'
import { vendePorPlataformas } from '@/modules/conta/lib/terceros'

const marcas = [
  { id: 'm1', nombre: 'Burger Norte' }, { id: 'm2', nombre: 'Pita del Sur' }, { id: 'm3', nombre: 'Lovers de Prueba' },
  { id: 'm4', nombre: 'Smash' }, { id: 'm5', nombre: 'SMASH' },
]
const t = (o: Partial<TiendaPlataforma> = {}): TiendaPlataforma =>
  ({ id: 't', nombre: 'Burger Norte (Calle Inventada 5, Madrid, ES, 28001)', marcaId: null, localId: null, bancoId: null, liquidaciones: 0, ...o })

describe('Sus tiendas', () => {
  it('sin marca o sin local, sin asignar; con las dos y sin cuenta, le falta la cuenta; con las tres, asignada', () => {
    expect(estadoTienda(t())).toBe('sin_asignar')
    expect(estadoTienda(t({ marcaId: 'm1' }))).toBe('sin_asignar')
    expect(estadoTienda(t({ localId: 'l1' }))).toBe('sin_asignar')
    expect(estadoTienda(t({ marcaId: 'm1', localId: 'l1' }))).toBe('sin_banco')
    expect(estadoTienda(t({ marcaId: 'm1', localId: 'l1', bancoId: 'b1' }))).toBe('asignada')
  })
  it('la marca se propone solo si hay UNA que se llama igual que lo de antes del paréntesis (sin tildes ni mayúsculas)', () => {
    expect(marcaPropuesta('Burger Norte (Calle Inventada 5, Madrid, ES, 28001)', marcas)).toBe('m1')
    expect(marcaPropuesta('PITA DEL SUR (Avenida Inventada 9, Madrid, ES, 28005)', marcas)).toBe('m2')
    expect(marcaPropuesta('Lovers de Prueba', marcas)).toBe('m3')
    // Dos que se llaman igual: no se adivina.
    expect(marcaPropuesta('Smash (Plaza Inventada 1, Madrid, ES, 28004)', marcas)).toBeNull()
    // Parecida no es igual.
    expect(marcaPropuesta('Burger Norte Express (Calle Inventada 5, Madrid, ES, 28001)', marcas)).toBeNull()
    expect(marcaPropuesta('(sin marca)', marcas)).toBeNull()
  })
  it('el resumen dice cuántas faltan y qué pasa con ellas; sin ninguna, que entran solas', () => {
    expect(resumenTiendas([])).toBe('Aún no ha llegado ninguna tienda suya: entran solas con su primer resumen de pagos.')
    expect(resumenTiendas([t(), t({ id: 'b' }), t({ id: 'c', marcaId: 'm1', localId: 'l1' }), t({ id: 'd', marcaId: 'm2', localId: 'l1', bancoId: 'b1' })]))
      .toBe('De 4 tiendas, 2 no tienen marca y local: sus liquidaciones no se comparan ni se asientan hasta que se lo digas; 1 no tiene cuenta de cobro: su cobro no se casa solo en Bancos.')
    expect(resumenTiendas([t({ marcaId: 'm1', localId: 'l1', bancoId: 'b1' })])).toBe('La tienda tiene su marca, su local y su cuenta de cobro.')
    expect(resumenTiendas([t({ marcaId: 'm1', localId: 'l1', bancoId: 'b1' }), t({ id: 'b', marcaId: 'm2', localId: 'l1', bancoId: 'b1' })]))
      .toBe('Las 2 tiendas tienen su marca, su local y su cuenta de cobro.')
  })
  it('al guardar se dice qué es la tienda, dónde cobra y qué pasa con sus liquidaciones', () => {
    expect(textoGuardada(t({ liquidaciones: 3 }), 'Burger Norte', 'Norte Centro', 'Cuenta principal ···1332'))
      .toBe('Guardado: «Burger Norte (Calle Inventada 5, Madrid, ES, 28001)» es Burger Norte en Norte Centro; cobra en Cuenta principal ···1332. Sus 3 liquidaciones ya tienen marca y local.')
    expect(textoGuardada(t({ liquidaciones: 1 }), 'Burger Norte', 'Norte Centro', null))
      .toBe('Guardado: «Burger Norte (Calle Inventada 5, Madrid, ES, 28001)» es Burger Norte en Norte Centro; sin cuenta de cobro. Su liquidación ya tiene marca y local.')
    expect(textoGuardada(t(), null, null, null)).toBe('Guardado: «Burger Norte (Calle Inventada 5, Madrid, ES, 28001)» queda sin marca y local; sin cuenta de cobro.')
  })
})

// Regla de Julio (17/10). Los slugs son los de producción el 17/10: glovo,
// justeat, shop, uber, salon y tpv-mostrador.
describe('¿vende por plataformas?', () => {
  it('sí con un canal de Glovo, Uber o Just Eat; no con tienda, salón o mostrador, ni sin canales', () => {
    expect(vendePorPlataformas([{ slug: 'glovo' }])).toBe(true)
    expect(vendePorPlataformas([{ slug: 'shop' }, { slug: 'uber' }])).toBe(true)
    expect(vendePorPlataformas([{ slug: 'justeat' }])).toBe(true)
    expect(vendePorPlataformas([{ slug: 'shop' }, { slug: 'salon' }, { slug: 'tpv-mostrador' }])).toBe(false)
    expect(vendePorPlataformas([])).toBe(false)
    expect(vendePorPlataformas([{ slug: null }, {}])).toBe(false)
  })
})
