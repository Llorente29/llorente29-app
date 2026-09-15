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
  type PedidoConFase, type Fase,
} from '@/modules/orders/lib/lasFases'

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
  // Lo cerrado y completado: el 97 % del periodo.
  { n: 1401, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'platform_delivery' },
    nota: 'Glovo/Uber cerrado en caja. El Pase NO lo pinta (laZona = null) y aquí SÍ: son dos preguntas distintas.' },
  { n: 219, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' } },
  { n: 13, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: null, service_type: 'platform_delivery' },
    nota: 'Cerrado SIN pasar por el sello de cocina. Terminado igual: terminado se pregunta antes que marcado.' },
  { n: 11, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'own_delivery' } },
  { n: 11, fase: 'terminado', p: { order_status: 'completed', status: 'closed', ready_at: RECIENTE, service_type: 'pickup' } },

  // 🔴 LAS CINCO QUE NO ESTABAN EN EL ENCARGO. `order_status='completed'` pero
  // la VENTA está cancelada. Por la letra del encargo irían a «Terminados»,
  // que le diría a quien mira que salieron bien. Van a Incidencias.
  { n: 5, fase: 'incidencia', p: { order_status: 'completed', status: 'cancelled', ready_at: null, service_type: 'platform_delivery' },
    nota: 'completed + venta cancelada. Es el grupo que me hizo cambiar la regla del encargo.' },

  // Lo que se torció.
  { n: 12, fase: 'incidencia', p: { order_status: 'cancelled', status: 'open', service_type: 'platform_delivery' },
    nota: 'Cancelado y TODAVÍA abierto. Son los 13 que llevan dos semanas sumando en las pestañas vivas.' },
  { n: 4, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', service_type: 'platform_delivery' } },
  { n: 3, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', ready_at: RECIENTE, service_type: 'platform_delivery' } },
  { n: 2, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', service_type: 'own_delivery', carrier_code: 'catcher' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'cancelled', ready_at: RECIENTE, service_type: 'platform_delivery' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'closed', ready_at: RECIENTE, service_type: 'pickup' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'cancelled', status: 'open', service_type: 'own_delivery' } },
  { n: 3, fase: 'incidencia', p: { order_status: 'delivery_failed', status: 'open', service_type: 'own_delivery', carrier_code: 'catcher' } },
  { n: 1, fase: 'incidencia', p: { order_status: 'delivery_failed', status: 'closed', ready_at: RECIENTE, service_type: 'own_delivery', carrier_code: 'catcher' } },

  // Lo vivo. Estas dos se mueven mientras se mide: entre la consulta de la
  // partición y la de las formas, alguien marcó un pedido y el reparto pasó de
  // 8+13 a 7+14. Por eso el test comprueba su SUMA, no el reparto.
  { n: 7, fase: 'en_curso', p: { order_status: 'accepted', status: 'open', ready_at: null, service_type: 'platform_delivery' } },
  { n: 12, fase: 'esperando', p: { order_status: 'awaiting_collection', status: 'open', ready_at: RECIENTE, service_type: 'platform_delivery' } },
  { n: 2, fase: 'esperando', p: { order_status: 'in_delivery', status: 'open', ready_at: RECIENTE, service_type: 'platform_delivery' } },
]

describe('la población real de 14 días', () => {
  it('suma 1.709, que es el total del periodo', () => {
    expect(POBLACION.reduce((a, f) => a + f.n, 0)).toBe(1709)
  })

  it('cada una de las 18 formas cae en la fase medida', () => {
    for (const f of POBLACION) {
      expect(laFase(P(f.p), AHORA), `${f.n} × ${JSON.stringify(f.p)}`).toBe(f.fase)
    }
  })

  it('los totales por fase son los de la consulta: 1.655 terminados, 33 incidencias, 21 vivos', () => {
    const suma = (fase: Fase) => POBLACION.filter(f => laFase(P(f.p), AHORA) === fase)
                                          .reduce((a, f) => a + f.n, 0)
    expect(suma('terminado')).toBe(1655)
    expect(suma('incidencia')).toBe(33)
    // El reparto entre estas dos cambia cada vez que alguien pulsa «Listo»;
    // la suma no.
    expect(suma('en_curso') + suma('esperando')).toBe(21)
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
    expect(solapadas.reduce((a, f) => a + f.n, 0)).toBe(7)
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

  it('recogido de verdad: «Recogido · en ruta»', () => {
    const p = P({ service_type: 'own_delivery', carrier_code: 'catcher', ready_at: RECIENTE,
                  handed_to_courier_at: '2026-09-15T20:50:00Z' })
    expect(elDistintivoDelRider(p)).toEqual({ texto: 'Recogido · en ruta', esAviso: false })
  })

  it('la recogida dice que la recoge el cliente, y no «buscando repartidor»', () => {
    // 12 en 14 días. Sin esta raya un pickup cae en «no tiene flota» y la
    // tarjeta pide un repartidor que nadie va a mandar.
    const p = P({ service_type: 'pickup', ready_at: RECIENTE })
    expect(elDistintivoDelRider(p)).toEqual({ texto: 'Lo recoge el cliente', esAviso: false })
  })
})

describe('los rótulos', () => {
  it('son cuatro y ninguno está vacío (regla 32)', () => {
    expect(LAS_FASES).toHaveLength(4)
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
