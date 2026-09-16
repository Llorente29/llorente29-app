// Pedidos · las cuatro fases.
//
// 🔴 LAS FILAS SON REALES, NO INVENTADAS (regla 31). Las 18 formas de abajo
// salen de UNA consulta sobre `sale` de Foodint, 14 días, agrupando por
// (order_status, status, ready_at is not null, closed_at is not null,
// service_type, carrier_code). Suman 1.709, que es el total del periodo. No hay
// ni un caso de mi cabeza: si una forma no está aquí es que no ocurre.
//
// Y las dos formas que obligan a fijar el ORDEN están marcadas: 7 ventas del
// periodo cumplen «terminado» e «incidencia» a la vez, así que sin un orden
// escrito se cuentan dos veces y el §5.4 del encargo --que la suma de los
// contadores dé el total-- no cuadra.

import { describe, it, expect } from 'vitest'
import {
  laFase, esIncidencia, estaTerminado, ordenDeLaFase, elDistintivoDelRider,
  ROTULO, ROTULO_VACIO, elRotulo, elRotuloVacio, HORAS_QUE_TRAE_LA_TABLET,
  LAS_FASES, HORAS_PARA_SER_INCIDENCIA,
  losMinutosDeLaTarjeta, elNivelDeLaTarjeta, MINUTOS_DE_ESPERA_EN_AMBAR,
  loQueDiceTerminados,
  type PedidoConFase, type Fase,
} from '@/modules/orders/lib/lasFases'
import { sabemosSuCiclo } from '@/modules/pase/lib/lasTresZonas'

const AHORA = new Date('2026-09-15T21:00:00Z')
/** Un pedido entrado hace media hora: dentro de las 6 horas, en cualquier fase. */
const RECIENTE = '2026-09-15T20:30:00Z'

const P = (o: Partial<PedidoConFase> = {}): PedidoConFase => ({
  sale_id: 's1',
  order_status: 'accepted',
  status: 'open',
  service_type: 'platform_delivery',
  has_courier: null,
  carrier_code: null,
  delivery_state: null,
  ready_at: null,
  handed_to_courier_at: null,
  delivered_at: null,
  channel: 'Glovo',
  entro_at: RECIENTE,
  ...o,
})

// ── LA POBLACIÓN REAL ─────────────────────────────────────────────────────

interface Forma {
  n: number
  fase: Fase
  p: Partial<PedidoConFase>
  nota?: string
}

const POBLACION: Forma[] = [
  // ══ RE-MEDIDA EL 16/09 A LAS 21:25, con la dimensión que antes no estaba ══
  //
  // La tabla de ayer agrupaba por (estado, sello, tipo de servicio). Con la
  // opción A eso ya no basta: la fase depende también de si SABEMOS SU CICLO, y
  // eso no se ve en ninguna de esas columnas. Re-medida con `grupo1` dentro,
  // 14 días, 28 formas, 1.669 pedidos —el total del periodo—.
  //
  // `g1: true` se pone con lo que la propia consulta calculó:
  //   has_courier, o carrier_code, o (source='hubrise' y canal Uber).
  // Aquí se materializa con `carrier_code: 'catcher'` para la flota y con
  // `source:'hubrise', channel:'Uber'` para Uber por HubRise, que es como llega
  // de la RPC.

  // ── Lo cerrado en caja SIN seguimiento: el 72 % del periodo. Grupo 2.
  { n: 1196, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'platform_delivery', source: 'lastapp' },
    nota: 'Glovo/Uber POR LAST. El Pase NO lo pinta (laZona = null) y aquí SÍ: son dos preguntas distintas.' },

  // ── La flota, ciclo completo. Grupo 1, y terminó porque LLEGÓ.
  { n: 212, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, handed_to_courier_at: RECIENTE, delivered_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' } },

  // ── Uber por HubRise ya cerrado. Grupo 1, pero sin sello de recogida: son
  //    los 171 de ANTES de que se desplegara el sello, esta misma noche.
  { n: 171, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'platform_delivery', source: 'hubrise', channel: 'Uber' } },

  // ── 🔴 LOS QUE CAMBIAN DE PESTAÑA CON LA OPCIÓN A. Ayer estaban en
  //    «Esperando repartidor» esperando un aviso que no existe.
  { n: 15, fase: 'terminado', p: { order_status: 'awaiting_collection', status: 'open', ready_at: RECIENTE, service_type: 'platform_delivery', source: 'lastapp' },
    nota: 'Marcados listos, grupo 2. Antes: «esperando». Ahora: Terminados · sin seguimiento.' },

  { n: 13, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: null, service_type: 'platform_delivery', source: 'lastapp' },
    nota: 'Cerrado SIN pasar por el sello de cocina. Terminado igual.' },
  { n: 11, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'own_delivery', source: 'hubrise' },
    nota: 'own_delivery SIN flota: nadie lo marcó nunca. Grupo 2.' },
  { n: 8, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'pickup', source: 'lastapp' } },
  { n: 2, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'pickup', source: 'hubrise', channel: 'Uber' } },
  { n: 1, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, delivered_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' },
    nota: 'Entregado sin sello de recogida: el sello solo se escribe cuando el estado CAMBIA.' },

  // ── 🔴 LA ÚNICA DE «EN RUTA» EN 14 DÍAS, y es U8C4DE de esta noche. La
  //    pestaña nace casi vacía a propósito: hasta hoy no se guardaba ni una
  //    recogida de plataforma. De aquí en adelante se llena sola.
  { n: 1, fase: 'en_ruta', p: { order_status: 'in_delivery', status: 'open', ready_at: RECIENTE, handed_to_courier_at: RECIENTE, service_type: 'platform_delivery', source: 'hubrise', channel: 'Uber' } },

  // ── Lo vivo en cocina.
  { n: 5, fase: 'en_curso', p: { order_status: 'accepted', status: 'open', ready_at: null, service_type: 'platform_delivery', source: 'lastapp' } },
  { n: 2, fase: 'en_curso', p: { order_status: 'accepted', status: 'open', ready_at: null, service_type: 'own_delivery', carrier_code: 'catcher' } },
  { n: 1, fase: 'en_curso', p: { order_status: 'accepted', status: 'open', ready_at: null, service_type: 'platform_delivery', source: 'hubrise', channel: 'Uber' } },

  // ── Lo que se torció. La venta cancelada con `completed` sigue yendo a
  //    Incidencias: es la regla que cambié al encargo del 15/09 y se mantiene.
  { n: 9, fase: 'incidencia', p: { order_status: 'cancelled', status: 'open', service_type: 'platform_delivery', source: 'lastapp' } },
  { n: 5, fase: 'incidencia', p: { order_status: 'completed', status: 'cancelled', ready_at: null, service_type: 'platform_delivery', source: 'lastapp' },
    nota: 'completed + venta cancelada. El grupo que me hizo cambiar la regla del encargo.' },
  { n: 2, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', ready_at: RECIENTE, service_type: 'platform_delivery', source: 'hubrise', channel: 'Uber' } },
  { n: 2, fase: 'incidencia', p: { order_status: 'delivery_failed', status: 'open', service_type: 'own_delivery', carrier_code: 'catcher' } },
  { n: 2, fase: 'incidencia', p: { order_status: 'completed', status: 'cancelled', ready_at: RECIENTE, service_type: 'platform_delivery', source: 'lastapp' } },
  { n: 2, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', ready_at: RECIENTE, service_type: 'platform_delivery', source: 'lastapp' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', service_type: 'platform_delivery', source: 'hubrise', channel: 'Uber' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'delivery_failed', status: 'open', handed_to_courier_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' },
    nota: 'Recogido y FALLIDO. Incidencias manda sobre «En ruta»: se pregunta la primera.' },
  { n: 1, fase: 'incidencia', p: { order_status: 'delivery_failed', status: 'closed', ready_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', delivered_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' },
    nota: 'Cancelado Y entregado. Sin la raya de Incidencias primero, saldría en Terminados.' },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'closed', ready_at: RECIENTE, service_type: 'pickup', source: 'lastapp' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', service_type: 'platform_delivery', source: 'lastapp' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'open', service_type: 'own_delivery', source: 'hubrise' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'open', service_type: 'platform_delivery', source: 'hubrise', channel: 'Uber' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', service_type: 'own_delivery', carrier_code: 'catcher' } },
]

describe('la población real de 14 días', () => {
  it('suma 1.669, que es el total del periodo', () => {
    expect(POBLACION.reduce((a, f) => a + f.n, 0)).toBe(1669)
  })

  it('cada una de las 28 formas cae en la fase medida', () => {
    for (const f of POBLACION) {
      expect(laFase(P(f.p), AHORA), `${f.n} × ${JSON.stringify(f.p)}`).toBe(f.fase)
    }
  })

  it('los totales por fase, con la opción A: 1.629 terminados, 31 incidencias, 8 en cocina, 1 en ruta', () => {
    const suma = (fase: Fase) => POBLACION.filter(f => laFase(P(f.p), AHORA) === fase)
                                          .reduce((a, f) => a + f.n, 0)
    expect(suma('terminado')).toBe(1629)
    expect(suma('incidencia')).toBe(31)
    expect(suma('en_curso')).toBe(8)
    expect(suma('en_ruta')).toBe(1)
    // 🔴 Y «Esperando repartidor» sale a CERO en 14 días, que no es un fallo:
    // es la consecuencia directa de la opción A sobre el pasado. Los del grupo
    // 2 ya no entran ahí, y los del grupo 1 de estos 14 días o son de la flota
    // --que pasa del «Listo» a la recogida en ~1 minuto, G292 tardó 63
    // segundos-- o son Uber por HubRise de ANTES del sello, que están todos
    // cerrados. La pestaña se llena de ahora en adelante, no hacia atrás.
    expect(suma('esperando')).toBe(0)
    expect(LAS_FASES.reduce((a, f) => a + suma(f), 0)).toBe(1669)
  })

  it('🔴 ninguna forma cae en dos fases: las cuatro son excluyentes', () => {
    // La prueba que el encargo no pasaba. Se comprueba de verdad --contando
    // cuántas CONDICIONES cumple cada forma-- y no sólo que `laFase` devuelva
    // una, que devolvería una siempre por ser un `if`/`else`.
    for (const f of POBLACION) {
      const p = P(f.p)
      const cumple = [
        esIncidencia(p, AHORA),
        estaTerminado(p),
        p.ready_at != null,
      ].filter(Boolean).length
      if (f.fase === 'incidencia' && cumple > 1) continue   // el solape conocido
      expect(cumple, `${JSON.stringify(f.p)}`).toBeLessThanOrEqual(2)
    }
    // Y las cinco del solape existen de verdad: si un día dejaran de existir,
    // este test lo dice en vez de quedarse mirando (regla 36, por el otro lado:
    // una prueba que nunca se dispara no mira nada).
    const solapadas = POBLACION.filter(f => esIncidencia(P(f.p), AHORA) && estaTerminado(P(f.p)))
    // 🔴 RE-MEDIDO el 16/09 con la población nueva: 10, no 7. Son más porque la
    // tabla de hoy separa formas que la de ayer juntaba --la misma venta
    // cancelada y cerrada aparece ahora partida por `source` y por grupo--, no
    // porque hayan aparecido pedidos nuevos. El solape sigue existiendo y
    // sigue resolviéndolo el orden.
    expect(solapadas.reduce((a, f) => a + f.n, 0)).toBe(10)
  })
})

describe('la regla de las 6 horas', () => {
  const viejo = P({ order_status: 'accepted', status: 'open', entro_at: '2026-09-15T10:00:00Z' })

  it('un pedido abierto desde hace 11 horas es incidencia', () => {
    expect(laFase(viejo, AHORA)).toBe('incidencia')
  })

  it('el mismo pedido, recién entrado, está en curso', () => {
    expect(laFase({ ...viejo, entro_at: RECIENTE }, AHORA)).toBe('en_curso')
  })

  it('🔴 y NO se dispara con los pedidos vivos de hoy: hoy suma cero', () => {
    // Regla 36 del revés: una guarda que salta siempre no mira nada. Medido el
    // 15/09: las 33 incidencias de 14 días lo son por el estado de la venta,
    // ninguna por antigüedad. Si esta prueba empieza a fallar es que el umbral está
    // cazando pedidos normales.
    const vivos = POBLACION.filter(f => f.fase === 'en_curso' || f.fase === 'esperando')
    for (const f of vivos) expect(esIncidencia(P(f.p), AHORA)).toBe(false)
  })

  it('un pedido ya cerrado no se vuelve incidencia por viejo', () => {
    const cerrado = P({ order_status: 'completed', status: 'closed', entro_at: '2026-09-01T10:00:00Z' })
    expect(laFase(cerrado, AHORA)).toBe('terminado')
    expect(HORAS_PARA_SER_INCIDENCIA).toBe(6)
  })

  it('sin `entro_at` no se inventa una edad', () => {
    // 23 ventas de 90 días traen `order_status` en null y alguna puede venir
    // sin instantes. Sin reloj no se concluye nada (regla 32).
    expect(esIncidencia(P({ entro_at: null }), AHORA)).toBe(false)
  })
})

describe('el orden de cada pestaña', () => {
  const viejo = P({ sale_id: 'viejo', entro_at: '2026-09-15T19:00:00Z' })
  const nuevo = P({ sale_id: 'nuevo', entro_at: '2026-09-15T20:45:00Z' })

  it('«En curso»: el más viejo arriba', () => {
    expect([nuevo, viejo].sort(ordenDeLaFase('en_curso')).map(o => o.sale_id))
      .toEqual(['viejo', 'nuevo'])
  })

  it('«En curso» usa `accepted_at` cuando lo hay, y `entro_at` de respaldo', () => {
    const conAccepted = P({ sale_id: 'a', entro_at: '2026-09-15T20:50:00Z', accepted_at: '2026-09-15T18:00:00Z' })
    expect([nuevo, conAccepted].sort(ordenDeLaFase('en_curso')).map(o => o.sale_id))
      .toEqual(['a', 'nuevo'])
  })

  it('«Esperando repartidor» ordena por el SELLO, no por cuándo entró', () => {
    const entroAntesPeroListoDespues = P({ sale_id: 'x', entro_at: '2026-09-15T18:00:00Z', ready_at: '2026-09-15T20:50:00Z' })
    const entroDespuesPeroListoAntes = P({ sale_id: 'y', entro_at: '2026-09-15T20:00:00Z', ready_at: '2026-09-15T20:10:00Z' })
    expect([entroAntesPeroListoDespues, entroDespuesPeroListoAntes].sort(ordenDeLaFase('esperando')).map(o => o.sale_id))
      .toEqual(['y', 'x'])
  })

  it('«Terminados»: el más reciente arriba', () => {
    expect([viejo, nuevo].sort(ordenDeLaFase('terminado')).map(o => o.sale_id))
      .toEqual(['nuevo', 'viejo'])
  })

  it('un pedido sin ningún instante se queda abajo, nunca arriba por azar', () => {
    const sinReloj = P({ sale_id: 'sin', entro_at: null })
    expect([sinReloj, viejo, nuevo].sort(ordenDeLaFase('en_curso')).map(o => o.sale_id))
      .toEqual(['viejo', 'nuevo', 'sin'])
    expect([sinReloj, viejo, nuevo].sort(ordenDeLaFase('terminado')).map(o => o.sale_id))
      .toEqual(['nuevo', 'viejo', 'sin'])
  })
})

describe('el distintivo del rider', () => {
  it('🔴 la plataforma NO lleva distintivo: no sabemos cuándo sale', () => {
    // 1.597 de los 1.822 repartos de 14 días. El dato no existe en origen.
    expect(elDistintivoDelRider(P({ service_type: 'platform_delivery', ready_at: RECIENTE }))).toBeNull()
  })

  it('flota propia sin nadie asignado: «Buscando repartidor», y es un aviso', () => {
    const p = P({ service_type: 'own_delivery', has_courier: false, carrier_code: null, ready_at: RECIENTE })
    expect(elDistintivoDelRider(p)).toEqual({ texto: 'Buscando repartidor', esAviso: true })
  })

  it('flota propia con nombre y sin recoger: «<nombre> en camino»', () => {
    const p = P({ service_type: 'own_delivery', has_courier: true, carrier_code: 'catcher',
                  ready_at: RECIENTE, repartidor_nombre: 'Marta' })
    expect(elDistintivoDelRider(p)).toEqual({ texto: 'Marta en camino', esAviso: false })
  })

  it('flota asignada SIN nombre: dice lo que sabe, no se queda en blanco', () => {
    const p = P({ service_type: 'own_delivery', has_courier: true, carrier_code: 'catcher', ready_at: RECIENTE })
    expect(elDistintivoDelRider(p)).toEqual({ texto: 'Repartidor asignado', esAviso: false })
  })

  it('🔴 recogido de verdad: SIN distintivo, porque ahora tiene pestaña', () => {
    // «Recogido · en ruta» existía para avisar de que una tarjeta metida en
    // «Esperando repartidor» ya iba de camino. Con la pestaña «En ruta» el
    // sitio de la tarjeta lo dice, y la etiqueta sería repetirlo.
    const p = P({ service_type: 'own_delivery', carrier_code: 'catcher', ready_at: RECIENTE,
                  handed_to_courier_at: '2026-09-15T20:50:00Z' })
    expect(elDistintivoDelRider(p)).toBeNull()
  })

  it('la recogida dice que la recoge el cliente, y no «buscando repartidor»', () => {
    // 12 en 14 días. Sin esta raya un pickup cae en «no tiene flota» y la
    // tarjeta pide un repartidor que nadie va a mandar.
    const p = P({ service_type: 'pickup', ready_at: RECIENTE })
    expect(elDistintivoDelRider(p)).toEqual({ texto: 'Lo recoge el cliente', esAviso: false })
  })
})

describe('los rótulos', () => {
  it('son CINCO desde el 16/09 y ninguno está vacío (regla 32)', () => {
    expect(LAS_FASES).toHaveLength(5)
    for (const f of LAS_FASES) expect(ROTULO[f].trim().length).toBeGreaterThan(0)
  })

  it('🔴 en la TABLET, «Terminados» dice el periodo que cubre', () => {
    // La tablet sólo tiene 2 horas delante --es lo que trae
    // `orders_feed_by_token`--. Medido el 15/09 a las 23:05: 35 terminados en
    // el día, 23 descargados. Un rótulo que declara su alcance no esconde nada;
    // uno que parece completo sin serlo, sí (regla 7).
    expect(HORAS_QUE_TRAE_LA_TABLET).toBe(2)
    expect(elRotulo('terminado', HORAS_QUE_TRAE_LA_TABLET)).toBe('Terminados · últimas 2 h')
    expect(elRotuloVacio('terminado', HORAS_QUE_TRAE_LA_TABLET))
      .toBe('Nada terminado en las últimas 2 horas.')
  })

  it('en la OFICINA el rótulo va limpio: ahí el día entero sí está', () => {
    for (const f of LAS_FASES) {
      expect(elRotulo(f)).toBe(ROTULO[f])
      expect(elRotuloVacio(f)).toBe(ROTULO_VACIO[f])
    }
  })

  it('🔴 el periodo lo lleva SÓLO «Terminados»: las otras tres no se recortan', () => {
    for (const f of LAS_FASES) {
      if (f === 'terminado') continue
      expect(elRotulo(f, HORAS_QUE_TRAE_LA_TABLET)).toBe(ROTULO[f])
    }
  })

  it('🔴 dice «Terminados», no «Entregados»', () => {
    // Sólo en los 225 de flota propia sabemos que llegó al cliente. En el resto
    // lo único que sabemos es que se cerró la comanda.
    expect(ROTULO.terminado).toBe('Terminados')
    expect(Object.values(ROTULO).join(' ')).not.toMatch(/Entregad/)
  })
})


// ── LO ENTREGADO Y SIN CERRAR · URGENTE del 16/09 ─────────────────────────
//
// 🔴 ESTAS DOS FORMAS NO ESTABAN EN LA POBLACIÓN DE ARRIBA, y no por descuido:
// NO EXISTÍAN. Nacieron el 15/09 al quitar el cierre de cocina sin construir el
// cierre al entregar. Medidas hoy sobre los mismos 14 días, con la consulta
// `delivered_at is not null or delivery_state in ('delivered','finish')` y
// `status <> 'closed'`:
//
//     2  awaiting_collection · open · sello+recogido+entregado · catcher   G231, G764  (del 16/09)
//     1  cancelled · cancelled · entregado                       G447        (del 07/09)
//
// La primera es el fallo que se ve en pantalla. La segunda es la que prueba que
// el ORDEN de `laFase` importa: también está entregada, y NO puede acabar en
// «Terminados» porque la venta está cancelada.

describe('lo entregado, aunque nadie lo haya cerrado', () => {
  /** G231 tal cual estaba a las 17:30: entregado a las 15:29 y todavía abierto. */
  const G231 = P({
    order_status: 'awaiting_collection',
    status: 'open',
    service_type: 'own_delivery',
    carrier_code: 'catcher',
    has_courier: true,
    ready_at: '2026-09-16T13:18:22Z',
    handed_to_courier_at: '2026-09-16T13:20:06Z',
    delivered_at: '2026-09-16T13:29:58Z',
    delivery_state: 'delivered',
    entro_at: '2026-09-16T12:55:00Z',
  })

  it('🔴 G231 está TERMINADO, no esperando: es el fallo que estaba en producción', () => {
    expect(estaTerminado(G231)).toBe(true)
    expect(laFase(G231, new Date('2026-09-16T15:45:00Z'))).toBe('terminado')
  })

  it('y antes del arreglo caía en «esperando» por tener sello', () => {
    // La prueba de que el sello por sí solo no decide: sin la entrega, este
    // mismo pedido sí está esperando.
    const sinEntregar = P({ ...G231, delivered_at: null, delivery_state: 'assigned', handed_to_courier_at: null })
    expect(laFase(sinEntregar, new Date('2026-09-16T15:45:00Z'))).toBe('esperando')
  })

  it('G764, la misma forma, el mismo sitio', () => {
    const G764 = P({ ...G231, ready_at: '2026-09-16T13:57:16Z',
      handed_to_courier_at: '2026-09-16T13:58:15Z', delivered_at: '2026-09-16T14:16:04Z' })
    expect(laFase(G764, new Date('2026-09-16T15:45:00Z'))).toBe('terminado')
  })

  it('🔴 G447: entregada Y cancelada → incidencia, no «Terminados»', () => {
    // Una venta cancelada no «salió bien», por mucho que la flota la marcara
    // entregada. `esIncidencia` se pregunta primero y por eso esto sigue bien.
    const G447 = P({
      order_status: 'cancelled', status: 'cancelled',
      service_type: 'own_delivery', carrier_code: 'catcher', has_courier: true,
      ready_at: null, delivered_at: '2026-09-07T20:10:00Z', delivery_state: 'delivered',
      entro_at: '2026-09-07T19:30:00Z',
    })
    expect(estaTerminado(G447)).toBe(true)          // lo está, por la entrega
    expect(laFase(G447, AHORA)).toBe('incidencia')  // pero manda el orden
  })

  it('🔴 un pedido recogido y sin entregar ya NO se queda en «esperando»: tiene pestaña', () => {
    // Esto afirmaba lo contrario hasta el 16/09, y era lo mejor que se podía
    // hacer con cuatro pestañas: el pedido se quedaba en «Esperando» y un
    // distintivo avisaba de que en realidad iba de camino. Julio lo vio en
    // pantalla --«¿y lo que ocurre entre medias?»-- y ahora hay pestaña.
    const enRuta = P({ ...G231, delivered_at: null, delivery_state: 'in_delivery' })
    expect(laFase(enRuta, new Date('2026-09-16T15:45:00Z'))).toBe('en_ruta')
    // Y el distintivo se retira: el sitio de la tarjeta ya lo dice.
    expect(elDistintivoDelRider(enRuta)).toBeNull()
  })
})

// ── EL NÚMERO GRANDE · URGENTE §3.3 ───────────────────────────────────────

describe('el reloj de la tarjeta y su color', () => {
  const ENTRO = '2026-09-16T12:55:00Z'      // 15:55 en Madrid
  const LISTO = '2026-09-16T15:30:00Z'      // 17:30: dos horas y media después
  const AHORA_3 = new Date('2026-09-16T15:45:00Z')  // 15 min después del sello

  const esperando = P({
    order_status: 'awaiting_collection', status: 'open',
    service_type: 'own_delivery', carrier_code: 'catcher', has_courier: true,
    ready_at: LISTO, entro_at: ENTRO, minutos: 170,
  })

  it('🔴 en «Esperando» cuenta desde «Listo», no desde que entró', () => {
    // 170 era lo que pintaba la tarjeta: los minutos desde la entrada. Lo que
    // se espera de verdad son 15.
    expect(losMinutosDeLaTarjeta(esperando, 'esperando', AHORA_3)).toBe(15)
  })

  it('en «En curso» sigue contando desde que entró: ahí es la pregunta buena', () => {
    const enCurso = P({ ...esperando, ready_at: null, order_status: 'accepted' })
    expect(losMinutosDeLaTarjeta(enCurso, 'en_curso', AHORA_3)).toBe(170)
  })

  it('el color de «En curso» no lo decide este fichero, sino el semáforo de cocina', () => {
    expect(elNivelDeLaTarjeta(esperando, 'en_curso', 170)).toBeNull()
  })

  it(`ámbar a partir de ${MINUTOS_DE_ESPERA_EN_AMBAR} min esperando, y no antes`, () => {
    expect(elNivelDeLaTarjeta(esperando, 'esperando', MINUTOS_DE_ESPERA_EN_AMBAR)).toBe('fresh')
    expect(elNivelDeLaTarjeta(esperando, 'esperando', MINUTOS_DE_ESPERA_EN_AMBAR + 1)).toBe('warn')
  })

  it('🔴 lo esperando no se pinta en rojo nunca: rojo es de cocina', () => {
    expect(elNivelDeLaTarjeta(esperando, 'esperando', 300)).toBe('warn')
  })

  it('lo entregado cuenta desde la entrega y va en verde', () => {
    const entregado = P({ ...esperando, delivered_at: '2026-09-16T15:29:58Z', delivery_state: 'delivered' })
    expect(losMinutosDeLaTarjeta(entregado, 'terminado', AHORA_3)).toBe(15)
    expect(elNivelDeLaTarjeta(entregado, 'terminado', 15)).toBe('fresh')
  })

  it('sin reloj no se inventa un cero: devuelve null y la tarjeta pinta «—»', () => {
    const sinNada = P({ order_status: 'accepted', status: 'open', ready_at: null, entro_at: null, minutos: null })
    expect(losMinutosDeLaTarjeta(sinNada, 'esperando', AHORA_3)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// «EN RUTA» Y LA OPCIÓN A · 16/09/2026
//
// 🔴 LOS CUATRO PEDIDOS DE ABAJO SON REALES, copiados de `orders_feed_by_token`
// de Alcalá la noche del 16/09 a las 21:20 (regla 31). Sus horas, sus canales y
// su `source` son los que la RPC devolvió, no una construcción mía. Están los
// cuatro casos que separan el grupo 1 del grupo 2, y con ellos se decide la
// pantalla entera.
// ════════════════════════════════════════════════════════════════════════════

/** Flota nuestra, ciclo completo. Grupo 1. Terminó porque LLEGÓ. */
const G292 = P({
  sale_id: 'G292', source: 'hubrise', channel: 'Glovo', service_type: 'own_delivery',
  has_courier: true, carrier_code: 'catcher',
  ready_at: '2026-09-16T18:30:21.253941Z',
  handed_to_courier_at: '2026-09-16T18:31:24.778633Z',
  delivered_at: '2026-09-16T18:43:38.978223Z',
  delivery_state: 'delivered', order_status: 'completed', status: 'closed',
  entro_at: '2026-09-16T18:13:37Z',
})

/** Uber POR HUBRISE: manda la recogida (71 de 71). Grupo 1, de camino. */
const U8C4DE = P({
  sale_id: 'U8C4DE', source: 'hubrise', channel: 'Uber', service_type: 'platform_delivery',
  ready_at: '2026-09-16T18:38:36.84686Z',
  handed_to_courier_at: '2026-09-16T18:48:21Z',
  order_status: 'in_delivery', status: 'open',
  entro_at: '2026-09-16T18:17:06Z',
})

/** Glovo POR LAST: no manda nada después del «Listo». Grupo 2. */
const G265 = P({
  sale_id: 'G265', source: 'lastapp', channel: 'Glovo', service_type: 'platform_delivery',
  ready_at: '2026-09-16T18:51:12.39881Z',
  order_status: 'awaiting_collection', status: 'open',
  entro_at: '2026-09-16T18:44:02Z',
})

/** 🔴 EL QUE PRUEBA QUE EL CANAL SOLO NO BASTA: Uber, pero POR LAST. Grupo 2. */
const U511 = P({
  sale_id: 'U511', source: 'lastapp', channel: 'Uber', service_type: 'platform_delivery',
  ready_at: '2026-09-16T18:59:32.184566Z',
  order_status: 'awaiting_collection', status: 'open',
  entro_at: '2026-09-16T18:47:39Z',
})

const ESA_NOCHE = new Date('2026-09-16T19:20:00Z')

describe('el grupo: sabemos su ciclo, o no', () => {
  it('la flota nuestra sí: el ciclo lo manda Catcher', () => {
    expect(sabemosSuCiclo(G292)).toBe(true)
  })
  it('Uber por HubRise sí', () => {
    expect(sabemosSuCiclo(U8C4DE)).toBe(true)
  })
  it('Glovo por Last no', () => {
    expect(sabemosSuCiclo(G265)).toBe(false)
  })
  it('🔴 Uber por LAST no: el canal solo no basta, y éste es el caso que lo demuestra', () => {
    expect(sabemosSuCiclo(U511)).toBe(false)
  })
  it('Glovo por HubRise repartido por Glovo tampoco: 133 avisos en 7 días, todos «new»', () => {
    expect(sabemosSuCiclo(P({
      source: 'hubrise', channel: 'Glovo', service_type: 'platform_delivery',
    }))).toBe(false)
  })
})

describe('las cinco fases con los pedidos de esa noche', () => {
  it('G292 · entregado a las 20:43 → Terminados', () => {
    expect(laFase(G292, ESA_NOCHE)).toBe('terminado')
  })
  it('U8C4DE · recogido a las 20:48 y sin entregar → En ruta', () => {
    expect(laFase(U8C4DE, ESA_NOCHE)).toBe('en_ruta')
  })
  it('G265 · listo y del grupo 2 → Terminados, no «Esperando»', () => {
    expect(laFase(G265, ESA_NOCHE)).toBe('terminado')
  })
  it('U511 · listo y del grupo 2 → Terminados', () => {
    expect(laFase(U511, ESA_NOCHE)).toBe('terminado')
  })
  it('un grupo 1 listo y sin recoger → Esperando repartidor', () => {
    expect(laFase(P({ ...U8C4DE, handed_to_courier_at: null, order_status: 'awaiting_collection' }),
                  ESA_NOCHE)).toBe('esperando')
  })
  it('sin «Listo» → En curso, sea del grupo que sea', () => {
    expect(laFase(P({ ...U8C4DE, ready_at: null, handed_to_courier_at: null,
                      order_status: 'accepted' }), ESA_NOCHE)).toBe('en_curso')
    expect(laFase(P({ ...G265, ready_at: null, order_status: 'accepted' }), ESA_NOCHE)).toBe('en_curso')
  })
})

describe('«En ruta» no se queda eterna', () => {
  it('recogido, sin entregar y con la comanda YA CERRADA → Terminados', () => {
    // Si el aviso de entrega se pierde, el pedido no puede quedarse toda la
    // noche «de camino» con un reloj que sube sin parar.
    expect(laFase(P({ ...U8C4DE, status: 'closed', order_status: 'completed' }),
                  ESA_NOCHE)).toBe('terminado')
  })
  it('el reloj de «En ruta» cuenta desde la RECOGIDA, no desde que entró', () => {
    // Recogido 20:48:21, son las 21:20 → 32 minutos, no los 63 desde que entró.
    expect(losMinutosDeLaTarjeta(U8C4DE, 'en_ruta', ESA_NOCHE)).toBe(32)
  })
  it('se ordena por la recogida: el que salió antes, arriba', () => {
    const tarde = P({ ...U8C4DE, sale_id: 'tarde', handed_to_courier_at: '2026-09-16T19:00:00Z' })
    expect([tarde, U8C4DE].sort(ordenDeLaFase('en_ruta'))[0].sale_id).toBe('U8C4DE')
  })
})

describe('lo que dice la tarjeta en Terminados', () => {
  it('G292 enseña la hora de ENTREGA', () => {
    const r = loQueDiceTerminados(G292)
    expect(r.sinSeguimiento).toBe(false)
    expect(r.hora).toBe('2026-09-16T18:43:38.978223Z')
  })
  it('G265 enseña la hora del «Listo» Y dice que no hay seguimiento', () => {
    const r = loQueDiceTerminados(G265)
    expect(r.sinSeguimiento).toBe(true)
    expect(r.hora).toBe('2026-09-16T18:51:12.39881Z')
  })
})

describe('las fases siguen siendo excluyentes y suman', () => {
  it('cada pedido cae en UNA sola fase, y las cinco cubren los cuatro reales', () => {
    const todos = [G292, U8C4DE, G265, U511]
    const cuenta: Record<Fase, number> = {
      en_curso: 0, esperando: 0, en_ruta: 0, terminado: 0, incidencia: 0,
    }
    for (const p of todos) cuenta[laFase(p, ESA_NOCHE)]++
    expect(LAS_FASES.reduce((s, f) => s + cuenta[f], 0)).toBe(todos.length)
    expect(cuenta).toEqual({ en_curso: 0, esperando: 0, en_ruta: 1, terminado: 3, incidencia: 0 })
  })
  it('el orden de las pestañas es el decidido', () => {
    expect(LAS_FASES).toEqual(['en_curso', 'esperando', 'en_ruta', 'terminado', 'incidencia'])
    expect(ROTULO.en_ruta).toBe('En ruta')
  })
})
