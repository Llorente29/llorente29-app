// B68 §1 (05/09/2026). El boton al portal, probado con los canales de verdad.
//
// POR QUE ESTA PRUEBA EXISTE. La primera version de esta tabla llevaba tres
// URL puestas de memoria y una, `managerportal.glovoapp.com`, no existe. Un
// boton roto en el aviso de «sin direccion» es peor que no tener boton: sale
// justo cuando alguien tiene prisa por saber a donde lleva un pedido.
//
// Los canales no son inventados: son los SIETE valores distintos de
// `sale.external_channel_text` que hay en Foodint en 30 dias (medido el
// 05/09/2026), incluida la mezcla de mayusculas de las dos pasarelas --
// Last.app manda 'glovo' y HubRise manda 'Glovo'.

import { describe, it, expect } from 'vitest'
import { portalDeLaPlataforma } from '../../../../src/modules/orders/services/ordersFeedService'

describe('portalDeLaPlataforma', () => {
  // Las dos formas reales de Glovo: minuscula (Last.app) y capitalizada (HubRise).
  it.each(['glovo', 'Glovo'])('devuelve el portal de Glovo para %s', canal => {
    const p = portalDeLaPlataforma(canal)
    expect(p).not.toBeNull()
    expect(p!.nombre).toBe('Glovo')
    expect(p!.url).toBe('https://portal.glovoapp.com/dashboard')
  })

  // Uber y Just Eat: URL SIN CONFIRMAR, asi que no hay boton. Esto no es una
  // carencia que arreglar a la ligera -- es la decision. Si alguien anade la
  // URL sin verificarla, esta prueba se pone roja y obliga a decir por que.
  it.each(['uber', 'Uber Eats', 'justeat', 'Just Eat'])(
    'NO devuelve portal para %s mientras su URL no este confirmada',
    canal => {
      expect(portalDeLaPlataforma(canal)).toBeNull()
    },
  )

  it('no devuelve portal sin canal', () => {
    expect(portalDeLaPlataforma(null)).toBeNull()
    expect(portalDeLaPlataforma('')).toBeNull()
  })

  it('no casa con un canal desconocido', () => {
    expect(portalDeLaPlataforma('folvy_shop')).toBeNull()
    expect(portalDeLaPlataforma('(sin canal)')).toBeNull()
  })

  // La URL que se pinte tiene que ser https y del dominio que decimos: un
  // enlace en una tarjeta de pedido no puede acabar en cualquier sitio.
  it('la unica URL viva es https y de glovoapp.com', () => {
    const p = portalDeLaPlataforma('glovo')!
    const u = new URL(p.url)
    expect(u.protocol).toBe('https:')
    expect(u.hostname).toBe('portal.glovoapp.com')
  })
})
