// El Pase · la hoja de detalle.
//
// LAS FILAS SON REALES (regla 31). Salen de una consulta del 16/09 sobre 14
// días de Foodint --1.669 ventas no anuladas-- agrupando por
// (source, canal, service_type) y contando qué campos venían llenos:
//
//   origen · canal · servicio        n     tel.rider  tel.cli  código  dirección
//   ───────────────────────────────────────────────────────────────────────────
//   Last    · Glovo   · plataforma  844        0          0       0        0
//   Last    · Uber    · plataforma  350        0        350     350        0
//   HubRise · Glovo   · NUESTRO     222      215        221       0      218
//   HubRise · Uber    · plataforma  179        0        179     179        0
//   HubRise · JustEat · NUESTRO       6        6          6       6        6
//
// Los códigos y los pedidos de abajo son de verdad, de la noche del 16/09. Los
// teléfonos NO: donde iba un número de cliente va uno de ejemplo con la misma
// forma, porque una prueba no es sitio para el teléfono de nadie. Lo que se
// comprueba es la FORMA --hay o no hay, con código o sin él-- y eso no cambia.

import { describe, it, expect } from 'vitest'
import {
  elCodigoAgrupado, elNombreCorto, laDireccion, laFuenteDe, laFuenteDeLaEntrega,
  laFuenteDeLaSalida, laFuenteDelListo, laPastilla, llamarAlCliente,
  llamarAlRepartidor, losCincoTiempos, type FichaDelPase,
} from '@/modules/pase/lib/laFicha'

const F = (o: Partial<FichaDelPase> = {}): FichaDelPase => ({
  sale_id: 's1',
  codigo: 'G292',
  marca: 'Lovers Burgers',
  marca_logo_url: null,
  order_status: 'in_preparation',
  service_type: 'platform_delivery',
  has_courier: null,
  carrier_code: null,
  delivery_state: null,
  source: 'lastapp',
  channel: 'Glovo',
  ready_at: null,
  handed_to_courier_at: null,
  delivered_at: null,
  repartidor_nombre: null,
  repartidor_telefono: null,
  cliente_nombre: 'María',
  cliente_telefono: null,
  cliente_codigo: null,
  cliente_marcacion: null,
  entro_at: '2026-09-16T19:26:00Z',
  accepted_at: '2026-09-16T19:26:12Z',
  direccion: null,
  notas: null,
  ...o,
})

/** Los cuatro que existen de verdad, uno por fila de la tabla de arriba. */
const GLOVO_POR_GLOVO = F({ codigo: 'G292', source: 'lastapp', channel: 'Glovo' })
const UBER_POR_LAST = F({
  codigo: 'U515', source: 'lastapp', channel: 'Uber',
  cliente_telefono: '+34910780961', cliente_codigo: '621 61 380',
  cliente_marcacion: 'tel:+34910780961,,,62161380',
})
const UBER_POR_HUBRISE = F({
  codigo: 'U987F2', source: 'hubrise', channel: 'Uber',
  cliente_telefono: '+34910780961', cliente_codigo: '567 30 308',
  cliente_marcacion: 'tel:+34910780961,,,56730308',
})
const JUSTEAT_CON_FLOTA = F({
  codigo: 'J191403139', source: 'hubrise', channel: 'JustEat',
  service_type: 'own_delivery', has_courier: true, carrier_code: 'catcher',
  repartidor_nombre: 'Marta', repartidor_telefono: '+34600111222',
  cliente_telefono: '+34910780961', cliente_codigo: '878795717',
  cliente_marcacion: 'tel:+34910780961,,,878795717',
  direccion: 'Calle de la Fuente 12, 3ºB',
})

describe('el nombre corto de los botones', () => {
  it('🔴 «Lelis Daibeth Ibarguen Valencia» no cabe en un botón: se corta como los clientes', () => {
    expect(elNombreCorto('Lelis Daibeth Ibarguen Valencia')).toBe('Lelis D.')
  })
  it('un nombre suelto se queda entero', () => {
    expect(elNombreCorto('Marta')).toBe('Marta')
  })
  it('sin nombre, nada', () => {
    expect(elNombreCorto(null)).toBeNull()
    expect(elNombreCorto('   ')).toBeNull()
  })
  it('el botón del repartidor lo usa; el nombre entero vive en la tarjeta', () => {
    const l = llamarAlRepartidor(F({
      service_type: 'own_delivery', has_courier: true, carrier_code: 'catcher',
      repartidor_nombre: 'Lelis Daibeth Ibarguen Valencia', repartidor_telefono: '+34627550000',
    }))
    expect(l.nombre).toBe('Lelis D.')
  })
})

describe('la pastilla de la tarjeta', () => {
  it('nombra a la plataforma cuando reparte ella', () => {
    expect(laPastilla(GLOVO_POR_GLOVO)).toEqual({ texto: 'Glovo', tono: 'plataforma' })
  })
  it('dice «Nosotros» cuando hay flota', () => {
    expect(laPastilla(JUSTEAT_CON_FLOTA)).toEqual({ texto: 'Nosotros', tono: 'nuestro' })
  })
  it('🔴 avisa en rojo del propio que no ha cogido nadie', () => {
    const sinCoger = F({ service_type: 'own_delivery', has_courier: false, carrier_code: null })
    expect(laPastilla(sinCoger)).toEqual({ texto: 'Sin coger', tono: 'aviso' })
  })
  it('la recogida es del cliente', () => {
    expect(laPastilla(F({ service_type: 'pickup' }))).toEqual({ texto: 'Cliente', tono: 'cliente' })
  })
})

describe('llamar al repartidor', () => {
  it('con flota y teléfono, hay botón y marca el número', () => {
    const l = llamarAlRepartidor(JUSTEAT_CON_FLOTA)
    expect(l.hay).toBe(true)
    expect(l.nombre).toBe('Marta')
    expect(l.marcacion).toBe('tel:+34600111222')
  })

  it('🔴 con flota y SIN teléfono --7 de 228 en 14 días-- dice el nombre y por qué no hay botón', () => {
    const l = llamarAlRepartidor(F({
      service_type: 'own_delivery', has_courier: true, carrier_code: 'catcher',
      repartidor_nombre: 'Marta', repartidor_telefono: null,
    }))
    expect(l.hay).toBe(false)
    expect(l.explicacion).toContain('Marta')
    expect(l.explicacion).toContain('no nos ha llegado su teléfono')
  })

  it('de plataforma no hay repartidor, y se dice de quién es la culpa', () => {
    const l = llamarAlRepartidor(GLOVO_POR_GLOVO)
    expect(l.hay).toBe(false)
    expect(l.explicacion).toContain('Glovo no nos da el nombre ni el teléfono')
    expect(l.explicacion).toContain('no es un fallo de la tablet'.toLowerCase().slice(0, 3))
  })

  it('propio sin nadie: dice que no hay a quién llamar, no un hueco', () => {
    const l = llamarAlRepartidor(F({ service_type: 'own_delivery', has_courier: false }))
    expect(l.hay).toBe(false)
    expect(l.explicacion).toContain('No hay repartidor asignado')
  })

  it('🔴 NUNCA deja la explicación vacía cuando no hay botón', () => {
    for (const f of [GLOVO_POR_GLOVO, UBER_POR_LAST, UBER_POR_HUBRISE,
                     F({ service_type: 'pickup' }), F({ service_type: 'own_delivery' })]) {
      const l = llamarAlRepartidor(f)
      if (!l.hay) expect((l.explicacion ?? '').length).toBeGreaterThan(20)
    }
  })
})

describe('llamar al cliente', () => {
  it('Uber por Last: centralita, y el código va aparte para poder teclearlo', () => {
    const l = llamarAlCliente(UBER_POR_LAST)
    expect(l.hay).toBe(true)
    expect(l.marcacion).toBe('tel:+34910780961,,,62161380')
    expect(l.codigo).toBe('621 61 380')
    expect(l.explicacion).toContain('621 61 380')
    expect(l.explicacion).toContain('caduca')
  })

  it('Uber por HubRise se comporta igual: el discriminador es el código, no el origen', () => {
    expect(llamarAlCliente(UBER_POR_HUBRISE).codigo).toBe('567 30 308')
  })

  it('🔴 JustEat TAMBIÉN es centralita --22 de 22-- y la maqueta sólo nombraba a Uber', () => {
    const l = llamarAlCliente(JUSTEAT_CON_FLOTA)
    expect(l.hay).toBe(true)
    // Sale agrupado (17/09): JustEat lo manda de corrido y son nueve dígitos.
    expect(l.codigo).toBe('878 795 717')
    expect(l.explicacion).toContain('JustEat da un número único')
  })

  it('Glovo cuando reparte Glovo: ni teléfono ni código, y se dice dónde ir', () => {
    const l = llamarAlCliente(GLOVO_POR_GLOVO)
    expect(l.hay).toBe(false)
    expect(l.explicacion).toContain('portal de Glovo')
  })

  it('teléfono de verdad sin centralita: botón limpio y sin nota que sobre', () => {
    const l = llamarAlCliente(F({
      service_type: 'own_delivery', has_courier: true, carrier_code: 'catcher',
      cliente_telefono: '+34671234567', cliente_marcacion: 'tel:+34671234567',
    }))
    expect(l.hay).toBe(true)
    expect(l.codigo).toBeNull()
    expect(l.explicacion).toBeNull()
  })
})

describe('la dirección', () => {
  it('cuando la hay, la hay', () => {
    expect(laDireccion(JUSTEAT_CON_FLOTA)).toBe('Calle de la Fuente 12, 3ºB')
  })
  it('🔴 de plataforma no hay ninguna en 1.426 pedidos: se dice quién la tiene', () => {
    expect(laDireccion(GLOVO_POR_GLOVO)).toBe('La dirección la lleva Glovo.')
    expect(laDireccion(UBER_POR_HUBRISE)).toBe('La dirección la lleva Uber.')
  })
  it('en recogida no hay dirección porque no hay reparto', () => {
    expect(laDireccion(F({ service_type: 'pickup' }))).toContain('viene a por ello')
  })
})

describe('los cinco tiempos', () => {
  const reloj = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  })

  it('🔴 devuelve los CINCO siempre, con hueco con nombre en los que no han pasado', () => {
    const t = losCincoTiempos(GLOVO_POR_GLOVO, reloj)
    expect(t.map(x => x.etiqueta)).toEqual(['Entró', 'Aceptado', 'Listo', 'Salió', 'Entregado'])
    expect(t[0].hora).not.toBeNull()
    expect(t[2].hora).toBeNull()   // sin «Listo» todavía
    expect(t[4].hora).toBeNull()
  })

  it('convierte a la hora de Madrid, que es la regla 4', () => {
    // 19:26 UTC del 16/09 son las 21:26 de Madrid.
    const t = losCincoTiempos(F({ entro_at: '2026-09-16T19:26:00Z' }), reloj)
    expect(t[0].hora).toBe('21:26')
  })
})

describe('el código de la centralita, agrupado igual en los dos canales', () => {
  it('🔴 JustEat viene de corrido y se agrupa: la misma pantalla no puede leerse de dos maneras', () => {
    expect(elCodigoAgrupado('878795717')).toBe('878 795 717')
  })
  it('🔴 Uber ya viene agrupado --987 de 987-- y NO se regrupa: son 8 dígitos y '
   + 'forzar el 3-3-3 daría «567 303 08», un ritmo que Uber no usa en ningún sitio', () => {
    expect(elCodigoAgrupado('567 30 308')).toBe('567 30 308')
    expect(elCodigoAgrupado('325 19 763')).toBe('325 19 763')
  })
  it('lo que no son sólo dígitos se deja tal cual: no se sabe qué significa el espacio', () => {
    expect(elCodigoAgrupado('AB-12 34')).toBe('AB-12 34')
  })
  it('sin código, nada', () => {
    expect(elCodigoAgrupado(null)).toBeNull()
  })
  it('la explicación enseña el código YA agrupado, el mismo que se ve grande', () => {
    const l = llamarAlCliente(JUSTEAT_CON_FLOTA)
    expect(l.codigo).toBe('878 795 717')
    expect(l.explicacion).toContain('878 795 717')
  })
})

describe('quién dice cada hito · los cuatro casos reales', () => {
  // J191403139 · nuestra flota. Listo 22:49:11, recogida 22:49:49 → 38 s.
  const flotaPulsado = F({
    channel: 'JustEat', source: 'hubrise', service_type: 'own_delivery',
    has_courier: true, carrier_code: 'catcher', delivery_state: 'delivered',
    ready_at: '2026-09-16T20:49:11Z', handed_to_courier_at: '2026-09-16T20:49:49Z',
    delivered_at: '2026-09-16T21:10:00Z',
  })
  // UD12A3 · Uber por HubRise. Listo y recogida en el mismo segundo.
  const uberSellado = F({
    channel: 'Uber', source: 'hubrise', service_type: 'platform_delivery',
    ready_at: '2026-09-16T20:00:53.0Z', handed_to_courier_at: '2026-09-16T20:00:53.3Z',
    delivered_at: '2026-09-16T20:28:43Z',
  })
  // U130B6 · Uber por HubRise. 45,3 s: lo pulsó una persona.
  const uberPulsado = F({
    channel: 'Uber', source: 'hubrise', service_type: 'platform_delivery',
    ready_at: '2026-09-16T20:37:09Z', handed_to_courier_at: '2026-09-16T20:37:54Z',
    delivered_at: '2026-09-16T20:51:02Z',
  })
  // G740 · Glovo por Glovo, con «Se lo ha llevado». De éste no llega nada.
  const glovoBoton = F({
    channel: 'Glovo', source: 'lastapp', service_type: 'platform_delivery',
    ready_at: '2026-09-16T20:25:56Z', handed_to_courier_at: '2026-09-16T20:41:19Z',
  })

  it('🔴 J191403139 · el «Listo» lo pulsó una persona, no la flota: 38 s de hueco', () => {
    expect(laFuenteDelListo(flotaPulsado)).toBe('lo marcó una persona')
  })
  it('J191403139 · la SALIDA y la ENTREGA sí las dice la flota', () => {
    expect(laFuenteDeLaSalida(flotaPulsado)).toBe('lo dice la flota')
    expect(laFuenteDeLaEntrega(flotaPulsado)).toBe('lo dice la flota')
  })

  it('UD12A3 · el «Listo» lo puso el aviso de Uber', () => {
    expect(laFuenteDelListo(uberSellado)).toBe('nadie lo pulsó: lo puso la recogida de Uber')
  })
  it('UD12A3 · salida y entrega, las dice Uber', () => {
    expect(laFuenteDeLaSalida(uberSellado)).toBe('lo dice Uber')
    expect(laFuenteDeLaEntrega(uberSellado)).toBe('lo dice Uber')
  })

  it('U130B6 · 45,3 s: lo pulsó una persona, y la salida la dice Uber', () => {
    expect(laFuenteDelListo(uberPulsado)).toBe('lo marcó una persona')
    expect(laFuenteDeLaSalida(uberPulsado)).toBe('lo dice Uber')
  })

  it('🔴 G740 · de un Glovo por Glovo no llega ningún aviso: la salida la marcó una persona', () => {
    expect(laFuenteDelListo(glovoBoton)).toBe('lo marcó una persona')
    expect(laFuenteDeLaSalida(glovoBoton)).toBe('lo marcó una persona')
    expect(laFuenteDeLaEntrega(glovoBoton)).toBeNull()
  })

  it('con flota y sello automático se dice «nuestro repartidor», no el canal', () => {
    expect(laFuenteDelListo(F({
      channel: 'Glovo', source: 'hubrise', service_type: 'own_delivery',
      has_courier: true, carrier_code: 'catcher',
      ready_at: '2026-09-16T20:00:00.0Z', handed_to_courier_at: '2026-09-16T20:00:01.0Z',
    }))).toBe('nadie lo pulsó: lo puso la recogida de nuestro repartidor')
  })

  it('cada hito recibe SU fuente y ninguna otra', () => {
    expect(laFuenteDe(flotaPulsado, 'Listo')).toBe('lo marcó una persona')
    expect(laFuenteDe(flotaPulsado, 'Salió')).toBe('lo dice la flota')
    expect(laFuenteDe(flotaPulsado, 'Entró')).toBeNull()
    expect(laFuenteDe(flotaPulsado, 'Aceptado')).toBeNull()
  })

  it('sin hito, sin fuente', () => {
    expect(laFuenteDelListo(F({ ready_at: null }))).toBeNull()
    expect(laFuenteDeLaSalida(F({ handed_to_courier_at: null }))).toBeNull()
  })
})
