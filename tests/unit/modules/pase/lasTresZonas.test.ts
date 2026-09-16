// El Pase · las tres zonas.
//
// LAS FILAS SON REALES (regla 31). Salen de una consulta sobre `sale` de los
// últimos 90 días de Foodint, agrupando por
// (order_status, delivery_state, delivered_at is not null). No hay ni un caso
// inventado: los cuatro que rompieron mi primer diseño están abajo con su
// número de ocurrencias.

import { describe, it, expect } from 'vitest'
import {
  laSituacion, laZona, tieneBotonDeListo, loQuePasa, loQueNoSabemos,
  elSubtitulo, elTono, losMinutos, loRepartimosConFlota, loRepartelaPlataforma,
  quienLoLleva, esRecogida,
  type PedidoDelPase,
  tieneBotonDeRecogida, MINUTOS_DE_ESPERA_EN_AMBAR,
  seVaSola, MINUTOS_PARA_IRSE_SOLA, sabemosSuCiclo,
} from '@/modules/pase/lib/lasTresZonas'

const P = (o: Partial<PedidoDelPase> = {}): PedidoDelPase => ({
  sale_id: 's1',
  order_status: 'in_preparation',
  service_type: 'own_delivery',
  has_courier: true,
  carrier_code: 'catcher',
  delivery_state: null,
  ready_at: null,
  handed_to_courier_at: null,
  delivered_at: null,
  channel: 'Glovo',
  ...o,
})

describe('las tres zonas · el camino bueno', () => {
  it('sin sello de cocina: sigue aquí, por marcar, y ES el único con botón', () => {
    const p = P()
    expect(laSituacion(p)).toBe('por_marcar')
    expect(laZona(p)).toBe('sigue_aqui')
    expect(tieneBotonDeListo(p)).toBe(true)
  })

  it('marcado y con flota, pero sin salir: sigue aquí y YA no se pulsa nada', () => {
    const p = P({ ready_at: '2026-09-14T19:29:00Z', order_status: 'awaiting_collection' })
    expect(laSituacion(p)).toBe('listo_sin_salir')
    expect(laZona(p)).toBe('sigue_aqui')
    expect(tieneBotonDeListo(p)).toBe(false)
  })

  it('la flota dice que salió: En ruta (629 entregados de 90 días vienen por aquí)', () => {
    const p = P({ ready_at: '2026-09-14T19:29:00Z', delivery_state: 'in_delivery' })
    expect(laSituacion(p)).toBe('en_ruta')
    expect(laZona(p)).toBe('en_ruta')
    expect(loQuePasa(p, 12)).toBe('Salió hace 12 min')
    expect(elTono(p, 12)).toBe('bien')
    expect(elTono(p, 34)).toBe('aviso')   // ámbar, sin rojos ni sonidos
  })

  it('la flota dice que llegó: Entregados', () => {
    const p = P({ ready_at: 'x', delivery_state: 'delivered', delivered_at: 'y',
                  order_status: 'completed' })
    expect(laZona(p)).toBe('entregados')
  })
})

describe('🔴 las cuatro filas reales que rompieron el primer diseño', () => {
  it('(3 casos) CANCELADO con el reparto «delivered» y sellado NO es «Entregados»', () => {
    // order_status=cancelled · delivery_state=delivered · delivered_at sellado.
    // Mi primera versión lo mandaba a «Entregados». Un pedido cancelado no está
    // entregado: no se pinta en ninguna zona.
    const p = P({ order_status: 'cancelled', delivery_state: 'delivered', delivered_at: 'y' })
    expect(laZona(p)).toBeNull()
  })

  it('🔴 DEFENSA, NO CASO CUBIERTO · «delivered» sin `delivered_at`', () => {
    // El sello sólo escribe cuando el estado CAMBIA, así que una fila que nace
    // ya entregada no lo lleva, y preguntando sólo por el sello se perderían.
    //
    // 🔴 PERO ESTA PRUEBA NO CUBRE NINGUNA FILA VIVA, y decía que cubría 41.
    // Las 43 que hay (41 `delivered` + 2 `finish`) son todas `completed` y
    // ninguna tiene sello, handoff ni entrega. `pase_board` no manda una venta
    // cerrada sin ningún instante --no habría reloj que pintar-- así que por
    // el tablero no llega ni una, y no existe la forma «entregada y todavía
    // abierta».
    //
    // Y ADEMÁS ESTÁN EXTINTAS: no son un goteo, son la semana en que se
    // encendió el sello. Todas entre el 06/07 y el 24/07, y 39 de las 43 en la
    // semana del 20/07, que es cuando el sello aparece por primera vez (32 de
    // 111, después de cuatro semanas de cero). Desde el 27/07 no ha habido ni
    // una en siete semanas.
    //
    // Se queda porque es una DEFENSA barata para el día que un broker mande
    // «entregada y todavía abierta», no porque proteja de algo que pase hoy.
    // Llamarla «41 casos» era verde sobre algo que no puede ocurrir (regla 36).
    const p = P({ order_status: 'completed', delivery_state: 'delivered', delivered_at: null })
    expect(laSituacion(p)).toBe('entregado')
    expect(laZona(p)).toBe('entregados')
  })

  it('(1 caso) CERRADO pero la flota dice «in_delivery»: En ruta, no desaparece', () => {
    // Ésta es la avería del encargo en una sola fila: se cerró antes de
    // entregarse. La tarjeta tiene que seguir viéndose donde está la comida.
    const p = P({ order_status: 'completed', ready_at: 'x', delivery_state: 'in_delivery' })
    expect(laZona(p)).toBe('en_ruta')
  })

  it('(4 casos) reparto FALLIDO no se queda en «Sigue aquí» como si faltara marcarlo', () => {
    const p = P({ order_status: 'delivery_failed', delivery_state: 'failed' })
    expect(laZona(p)).toBeNull()
    expect(tieneBotonDeListo(p)).toBe(false)
  })

  it('(23 casos) `order_status` en null no revienta ni esconde la tarjeta', () => {
    const p = P({ order_status: null })
    expect(laZona(p)).toBe('sigue_aqui')
  })
})

describe('la plataforma: se enseña, no se gestiona', () => {
  const glovo = P({ service_type: 'platform_delivery', has_courier: false,
                    carrier_code: null, ready_at: '2026-09-14T19:29:00Z',
                    order_status: 'awaiting_collection', channel: 'Glovo' })

  it('marcada, se queda en «Sigue aquí»: la comida sigue en el local', () => {
    expect(loRepartelaPlataforma(glovo)).toBe(true)
    expect(loRepartimosConFlota(glovo)).toBe(false)
    expect(laSituacion(glovo)).toBe('esperando_rider_plataforma')
    expect(laZona(glovo)).toBe('sigue_aqui')
  })

  it('🔴 y NUNCA pasa por «En ruta» ni por «Entregados»', () => {
    // Al cerrarse la comanda desaparece, sin pintar que llegó: ese `completed`
    // lo escribe `lastapp-webhook` al cerrar caja, mediana 6,4 min desde el
    // «Listo» en Glovo. No es Glovo diciendo que el cliente lo tiene.
    expect(laZona({ ...glovo, order_status: 'completed' })).toBeNull()
  })

  it('dice con esas palabras lo que no sabemos', () => {
    expect(loQuePasa(glovo, null)).toBe('Esperando al rider de Glovo')
    expect(loQueNoSabemos(glovo)).toContain('no nos dice cuándo sale ni cuándo llega')
    expect(loQueNoSabemos(glovo)).not.toContain('entregado')
  })

  it('🔴 YA NO dice «la tarjeta se va sola cuando se cierre la comanda en caja»', () => {
    // La frase describía un mundo que dejó de existir cuando cerrar dejó de ser
    // un botón de cocina. Una nota de pantalla que envejece mal es peor que
    // ninguna: el operario deja de creerse también las que dicen la verdad.
    expect(loQueNoSabemos(glovo)).not.toContain('comanda en caja')
    expect(loQueNoSabemos({ ...glovo, service_type: 'pickup' })).not.toContain('comanda en caja')
  })

  it('🔴 no dice dos veces quién reparte, y dice el GRUPO', () => {
    // Antes: «Glovo · lo reparte Glovo», y debajo «Esperando al rider de
    // Glovo». Tres veces la misma palabra en una tarjeta de cinco líneas.
    // Y «Glovo» a secas tampoco valía: no decía quién reparte (16/09, Julio).
    //
    // Las dos pantallas dicen lo mismo con palabras distintas a propósito: el
    // Pase mira la BOLSA que tiene delante --va a venir alguien a por ella-- y
    // Pedidos mira el PEDIDO entero --de aquí en adelante no sabemos nada--.
    expect(elSubtitulo(glovo)).toBe('Glovo · lo recoge su repartidor')
    expect(elSubtitulo(glovo, 'pedidos')).toBe('Glovo · sin seguimiento')
  })

  it('🔴 y con el grupo 1 dice quién reparte de verdad, igual en las dos', () => {
    const uberPorHubrise = { ...glovo, source: 'hubrise', channel: 'Uber' }
    // 🔴 «Uber · lo reparte Uber» decía lo mismo dos veces: arriba queda el
    // canal, y quién reparte + la hora van en la ETIQUETA (16/09, Julio).
    expect(elSubtitulo(uberPorHubrise)).toBe('Uber')
    expect(elSubtitulo(uberPorHubrise, 'pedidos')).toBe('Uber')
    // Y la flota se ve como flota en las dos, que era lo que faltaba en G292.
    const nuestro = P({ channel: 'Glovo', service_type: 'own_delivery', carrier_code: 'catcher' })
    expect(elSubtitulo(nuestro)).toBe('Glovo · reparto nuestro')
    expect(elSubtitulo(nuestro, 'pedidos')).toBe('Glovo · reparto nuestro')
  })

  it('🔴 a Uber por HubRise ya no se le dice que no sabemos cuándo sale', () => {
    // U8C4DE llevaba ese aviso mientras Uber nos estaba diciendo la recogida.
    const uberPorHubrise = { ...glovo, source: 'hubrise', channel: 'Uber' }
    expect(loQueNoSabemos(uberPorHubrise)).toBeNull()
    // Y por Last, el MISMO canal sigue sin decirnos nada: el aviso se queda.
    const uberPorLast = { ...glovo, source: 'lastapp', channel: 'Uber' }
    expect(loQueNoSabemos(uberPorLast)).toContain('no nos dice cuándo sale')
  })

  it('y con Uber lo dice con el nombre de Uber, no con uno genérico', () => {
    const uber = { ...glovo, channel: 'Uber' }
    expect(loQuePasa(uber, null)).toBe('Esperando al rider de Uber')
    expect(loQueNoSabemos(uber)).toContain('Uber no nos dice')
  })
})

describe('el propio SIN flota: envejece a la vista y no se toca', () => {
  const sinFlota = P({ has_courier: false, carrier_code: null,
                       ready_at: '2026-09-14T19:16:00Z', order_status: 'awaiting_collection',
                       channel: 'Tienda' })

  it('se queda en «Sigue aquí» con su crono', () => {
    expect(laSituacion(sinFlota)).toBe('esperando_que_lo_cojan')
    expect(laZona(sinFlota)).toBe('sigue_aqui')
    expect(loQuePasa(sinFlota, 18)).toBe('Esperando a que alguien lo coja · 18 min')
    expect(elTono(sinFlota, 18)).toBe('aviso')
    expect(elTono(sinFlota, 5)).toBe('neutro')
  })

  it('y dice que aquí no se toca: lo marca quien se lo lleve', () => {
    expect(loQueNoSabemos(sinFlota)).toContain('desde su móvil')
    expect(tieneBotonDeListo(sinFlota)).toBe(false)
    expect(elSubtitulo(sinFlota)).toBe('Tienda · lo lleva alguien de casa')
  })
})

describe('🔴 en toda la pantalla sólo se pulsa UNA cosa', () => {
  it('el botón sale exactamente en una situación, y en ninguna otra', () => {
    const casos: PedidoDelPase[] = [
      P(),                                                                   // por marcar
      P({ ready_at: 'x', order_status: 'awaiting_collection' }),              // listo sin salir
      P({ ready_at: 'x', delivery_state: 'in_delivery' }),                    // en ruta
      P({ ready_at: 'x', delivery_state: 'delivered', order_status: 'completed' }),
      P({ service_type: 'platform_delivery', has_courier: false, carrier_code: null, ready_at: 'x' }),
      P({ has_courier: false, carrier_code: null, ready_at: 'x' }),
      P({ order_status: 'cancelled' }),
      P({ order_status: 'delivery_failed', delivery_state: 'failed' }),
    ]
    expect(casos.filter(tieneBotonDeListo)).toHaveLength(1)
  })
})

describe('🔴 desde cuándo se cuenta: cada zona mira un reloj distinto', () => {
  const AHORA = new Date('2026-09-14T20:00:00Z')
  const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString()

  it('por marcar: desde que ENTRÓ el pedido', () => {
    expect(losMinutos(P({ entro_at: hace(7) }), AHORA)).toBe(7)
  })

  it('esperando a que lo cojan: desde el SELLO, no desde que entró', () => {
    const p = P({ has_courier: false, carrier_code: null,
                  entro_at: hace(40), ready_at: hace(18) })
    expect(losMinutos(p, AHORA)).toBe(18)
  })

  it('en ruta: desde el HANDOFF cuando lo hay', () => {
    const p = P({ ready_at: hace(30), handed_to_courier_at: hace(12),
                  delivery_state: 'in_delivery' })
    expect(losMinutos(p, AHORA)).toBe(12)
  })

  it('🔴 y en ruta SIN handoff cae al sello: Catcher casi nunca lo manda', () => {
    // Medido: de 250 repartos propios de 14 días, 226 tienen handoff y 229
    // entrega. Sin este respaldo, 24 tarjetas se quedarían sin crono.
    const p = P({ ready_at: hace(30), handed_to_courier_at: null,
                  delivery_state: 'in_delivery' })
    expect(losMinutos(p, AHORA)).toBe(30)
  })

  it('entregado: desde la ENTREGA', () => {
    const p = P({ ready_at: hace(60), delivery_state: 'delivered',
                  delivered_at: hace(4), order_status: 'completed' })
    expect(losMinutos(p, AHORA)).toBe(4)
  })

  it('y sin instante que mirar devuelve null, no un cero que parece medido', () => {
    // Regla 32: un «no lo sé» no se disfraza de valor.
    expect(losMinutos(P({ entro_at: null }), AHORA)).toBeNull()
  })
})

// ── QUIÉN LO LLEVA ────────────────────────────────────────────────────────
//
// Los cinco casos son los MEDIDOS hoy sobre 14 días de Foodint (1.681 ventas).
// El reparto exacto está en el comentario de `quienLoLleva`.

describe('quién lo lleva · los cinco casos de la población real', () => {
  it('(231) propio con flota: dice el nombre y trae el teléfono del repartidor', () => {
    const q = quienLoLleva(P({ repartidor_nombre: 'Marta', repartidor_telefono: '+34600111222' }))
    // 🔴 Y dice HACIA DÓNDE va mientras no haya recogido (16/09): el del pase
    // necesita saber si el de la moto viene o ya se fue. Antes, con G941, la
    // tarjeta decía «Nuestro, ya asignado» y no decía quién.
    expect(q.texto).toBe('Nuestro · Marta · en camino al local')
    expect(quienLoLleva(P({ repartidor_nombre: 'Marta',
                           handed_to_courier_at: '2026-09-16T18:31:00Z' })).texto)
      .toBe('Nuestro · Marta')
    expect(q.telefono).toBe('+34600111222')
    expect(q.esAviso).toBe(false)
  })

  it('(1.424) plataforma: dice quién reparte y NO se inventa repartidor', () => {
    const q = quienLoLleva(P({ service_type: 'platform_delivery', has_courier: false,
                               carrier_code: null, channel: 'Uber' }))
    expect(q.texto).toBe('Lo reparte Uber')
    expect(q.nombre).toBeNull()
    expect(q.telefono).toBeNull()
  })

  it('🔴 (14) propio y sin coger: es un AVISO, no un hueco', () => {
    // Comida nuestra, reparto nuestro y nadie asignado. El pase tiene que
    // saberlo antes de que llame el cliente.
    const q = quienLoLleva(P({ has_courier: false, carrier_code: null,
                               repartidor_nombre: null, repartidor_telefono: null }))
    expect(q.texto).toBe('Nuestro, y todavía no lo ha cogido nadie')
    expect(q.esAviso).toBe(true)
  })

  it('(12) recogida: lo recoge el cliente, y no hay repartidor a quien llamar', () => {
    const q = quienLoLleva(P({ service_type: 'pickup', has_courier: false, carrier_code: null }))
    expect(q.texto).toBe('Lo recoge el cliente')
    expect(q.telefono).toBeNull()
    expect(q.esAviso).toBe(false)
  })

  it('(0 hoy) con flota y sin nombre: dice lo que sabe, no se queda en blanco', () => {
    const q = quienLoLleva(P({ repartidor_nombre: null }))
    expect(q.texto).toBe('Nuestro, ya asignado')
  })

  it('🔴 REGLA 32 · nunca en blanco, en ninguna combinación', () => {
    const casos: PedidoDelPase[] = [
      P(),
      P({ service_type: 'platform_delivery', has_courier: false, carrier_code: null }),
      P({ service_type: 'platform_delivery', channel: null, has_courier: false, carrier_code: null }),
      P({ service_type: 'pickup', has_courier: false, carrier_code: null }),
      P({ has_courier: false, carrier_code: null }),
      P({ service_type: null, has_courier: false, carrier_code: null }),
      P({ service_type: 'algo_que_no_existe', has_courier: false, carrier_code: null }),
      P({ repartidor_nombre: '   ' }),
    ]
    for (const c of casos) expect(quienLoLleva(c).texto.trim()).not.toBe('')
  })

  it('y el cuarto valor que no existe hoy dice que no lo sabemos', () => {
    // En 90 días `service_type` sólo vale platform_delivery, own_delivery o
    // pickup, y nunca null. El día que entre un cuarto, esto no inventa nada.
    const q = quienLoLleva(P({ service_type: 'catering', has_courier: false, carrier_code: null }))
    expect(q.texto).toBe('No sabemos quién lo lleva')
    expect(q.esAviso).toBe(true)
  })
})

describe('🔴 la recogida: 12 tarjetas que decían algo que no pasa', () => {
  const recogida = P({ service_type: 'pickup', has_courier: false, carrier_code: null,
                       ready_at: '2026-09-14T19:16:00Z', order_status: 'awaiting_collection',
                       channel: 'Uber' })

  it('marcada, se queda en «Sigue aquí» con su propia situación', () => {
    expect(esRecogida(recogida)).toBe(true)
    expect(laSituacion(recogida)).toBe('lo_recoge_el_cliente')
    expect(laZona(recogida)).toBe('sigue_aqui')
    expect(tieneBotonDeListo(recogida)).toBe(false)
  })

  it('y NO dice «lo marca quien se lo lleve desde su móvil»: el cliente no tiene app', () => {
    expect(loQuePasa(recogida, 8)).toBe('Listo, esperando a que lo recojan · 8 min')
    expect(loQueNoSabemos(recogida)).toContain('Viene el cliente a por ello')
    expect(loQueNoSabemos(recogida)).not.toContain('su móvil')
    expect(elSubtitulo(recogida)).toBe('Uber · lo recoge el cliente')
  })

  it('se va al cerrarse la comanda, sin pintar que llegó (0 de 63 tienen entrega)', () => {
    // Medido en 90 días: las 63 recogidas sin `delivery_state` y sin
    // `delivered_at`. Nadie las marca nunca.
    expect(laZona({ ...recogida, order_status: 'completed' })).toBeNull()
  })

  it('sin marcar sigue siendo «por marcar», y ése sí tiene botón', () => {
    expect(tieneBotonDeListo({ ...recogida, ready_at: null })).toBe(true)
  })
})

describe('«Se lo ha llevado» y el ámbar de las bolsas · 16/09', () => {
  const hecha = P({
    service_type: 'platform_delivery', has_courier: false, carrier_code: null,
    channel: 'Glovo', order_status: 'awaiting_collection',
    ready_at: '2026-09-16T18:38:36Z', handed_to_courier_at: null,
  })

  it('una bolsa hecha y sin recoger puede decir que se la han llevado', () => {
    expect(tieneBotonDeRecogida(hecha)).toBe(true)
  })
  it('una que ya tiene la hora, no: no se pisa lo que ya sabíamos', () => {
    expect(tieneBotonDeRecogida({ ...hecha, handed_to_courier_at: '2026-09-16T18:48:21Z' })).toBe(false)
  })
  it('una sin marcar tampoco: primero se marca «Listo»', () => {
    expect(tieneBotonDeRecogida({ ...hecha, ready_at: null })).toBe(false)
  })
  it('una recogida de mostrador tampoco: ahí no se lo lleva un repartidor', () => {
    expect(tieneBotonDeRecogida({ ...hecha, service_type: 'pickup' })).toBe(false)
  })
  it('se ofrece en plataforma, que es donde no hay otro escritor', () => {
    expect(tieneBotonDeRecogida({ ...hecha, source: 'hubrise', channel: 'Uber' })).toBe(true)
  })
  it('🔴 NO en los de nuestra flota: su recogida la avisa el repartidor', () => {
    // 213 de 224 en 14 días llegan solas. Dos escritores para el mismo hito es
    // como se acaba discutiendo cuál de las dos horas era la buena.
    const nuestro = P({ service_type: 'own_delivery', carrier_code: 'catcher', has_courier: true,
                        order_status: 'awaiting_collection', ready_at: '2026-09-16T18:38:36Z' })
    expect(tieneBotonDeRecogida(nuestro)).toBe(false)
  })
  it('sí en un propio SIN flota: ésos no los coge nadie', () => {
    const sinFlota = P({ service_type: 'own_delivery', carrier_code: null, has_courier: false,
                         order_status: 'awaiting_collection', ready_at: '2026-09-16T18:38:36Z' })
    expect(tieneBotonDeRecogida(sinFlota)).toBe(true)
  })

  it('🔴 los minutos van DENTRO de la frase, que es lo que faltaba', () => {
    // U8C4DE llevaba 24 minutos hecho y la pantalla decía sólo «Esperando al
    // rider de Uber», igual que si acabara de salir de la plancha.
    expect(loQuePasa(hecha, 24)).toBe('Esperando al rider de Glovo · 24 min')
  })
  it('🔴 y a los 20 minutos la bolsa se pone ámbar', () => {
    expect(elTono(hecha, 19)).toBe('neutro')
    expect(elTono(hecha, 21)).toBe('aviso')
    expect(MINUTOS_DE_ESPERA_EN_AMBAR).toBe(20)
  })
})

describe('a los 30 minutos la bolsa del grupo 2 se va sola · 16/09', () => {
  const AHORA = new Date('2026-09-16T19:30:00Z')
  // G265 y U511, reales: listos a las 20:51 y 20:59 de Madrid.
  const G265 = P({ service_type: 'platform_delivery', has_courier: false, carrier_code: null,
                   source: 'lastapp', channel: 'Glovo', order_status: 'awaiting_collection',
                   ready_at: '2026-09-16T18:51:12.39881Z' })
  const U511 = P({ service_type: 'platform_delivery', has_courier: false, carrier_code: null,
                   source: 'lastapp', channel: 'Uber', order_status: 'awaiting_collection',
                   ready_at: '2026-09-16T18:59:32.184566Z' })

  it('G265, con 39 min, se va', () => {
    expect(losMinutos(G265, AHORA)).toBe(39)
    expect(seVaSola(G265, AHORA)).toBe(true)
  })
  it('U511, con 30 clavados, también', () => {
    // Julio lo vio como 31 en la maqueta: medido a las 21:30:00 en punto salen
    // 30,47 → 30. La cifra es la misma bolsa, y con 30 ya se va.
    expect(losMinutos(U511, AHORA)).toBe(30)
    expect(seVaSola(U511, AHORA)).toBe(true)
  })
  it('a los 29 todavía no, y a los 30 justos sí', () => {
    const listo = (min: number) => P({
      service_type: 'platform_delivery', has_courier: false, carrier_code: null,
      source: 'lastapp', channel: 'Glovo', order_status: 'awaiting_collection',
      ready_at: new Date(AHORA.getTime() - min * 60_000).toISOString() })
    expect(seVaSola(listo(29), AHORA)).toBe(false)
    expect(seVaSola(listo(30), AHORA)).toBe(true)
    expect(MINUTOS_PARA_IRSE_SOLA).toBe(30)
  })
  it('🔴 la del GRUPO 1 no se va: de ésa sí estamos esperando algo', () => {
    const uber = { ...G265, source: 'hubrise', channel: 'Uber' }
    expect(sabemosSuCiclo(uber)).toBe(true)
    expect(seVaSola(uber, AHORA)).toBe(false)
  })
  it('sin «Listo» tampoco: eso sigue en cocina', () => {
    expect(seVaSola({ ...G265, ready_at: null }, AHORA)).toBe(false)
  })
  it('🔴 irse de la pantalla NO cambia el pedido: en Pedidos sigue en Terminados', () => {
    // La zona del Pase y la fase de Pedidos son dos preguntas distintas, y
    // ésta es la que lo demuestra: la misma venta, fuera del Pase y dentro de
    // Terminados, sin que nadie haya escrito nada en la venta.
    expect(laZona(G265)).toBe('sigue_aqui')   // sigue siendo su zona…
    expect(seVaSola(G265, AHORA)).toBe(true)  // …pero la pantalla ya no la pinta
  })
})
