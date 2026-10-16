// tests/unit/modules/reparto/direccionFalta.test.ts
//
// R03 · Los pedidos sin dirección completa (Julio, 16/10, tras ver las
// capturas): salen a Catcher al momento; la tarjeta solo informa; la lista de
// Despacho dice una frase por pedido; «Completar dirección» confirma con
// contenido (regla 8) y, si Catcher ya lo tiene, da el teléfono del
// repartidor para dictársela. Direcciones, nombres y teléfonos inventados.
import { describe, expect, it } from 'vitest'
import {
  avisoDeLaTarjeta, enlaceAlMapa, fraseDeLaLista, mandadoACatcher, nombreDelPortal, numeroParaElPortal,
  puedeCompletar, siguientePaso, type PedidoSinDireccion, type ResultadoFijar,
} from '@/modules/reparto/lib/direccionFalta'

const base: ResultadoFijar = {
  ok: true, sale_id: 's1', direccion: 'Calle Inventada 1, 4ºB', carrier: 'catcher', reason: 'sin regla',
  dispatch_mode: 'auto', ya_en_catcher: false, rider_name: null, rider_phone: null,
}

describe('la línea de la tarjeta (informativa, sin acciones)', () => {
  it('en Catcher: salió con el punto del mapa y el repartidor llamará', () => {
    expect(avisoDeLaTarjeta({ enCatcher: true, dispatchError: null, dispatchMode: 'auto' }))
      .toBe('Sin dirección completa · salió a Catcher con el punto del mapa; el repartidor llamará al cliente')
  })
  it('recién entrado en un local automático: sale ya', () => {
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: null, dispatchMode: 'auto' }))
      .toBe('Sin dirección completa · sale a Catcher con el punto del mapa; el repartidor llamará al cliente')
  })
  it('local a mano: hay que despacharlo, como hoy', () => {
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: null, dispatchMode: 'manual' }))
      .toBe('Sin dirección completa · este local despacha a mano: despáchalo y el repartidor llamará al cliente')
  })
  it('no ha podido salir: el motivo, sin el prefijo de siempre', () => {
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: 'No se pudo enviar a Catcher: 422', dispatchMode: 'auto' }))
      .toBe('Sin dirección completa · no ha salido a Catcher: 422')
  })
})

describe('siguientePaso (al guardar «Completar dirección»)', () => {
  it('sin Catcher todavía, local en automático y resolutor en Catcher: se manda', () => {
    expect(siguientePaso(base)).toEqual({ tipo: 'mandar' })
  })
  it('ya en Catcher con repartidor: «Llamar», con su nombre y teléfono, y reimprimir', () => {
    expect(siguientePaso({ ...base, ya_en_catcher: true, rider_name: 'Ana Prueba', rider_phone: '+34600000009' })).toEqual({
      tipo: 'mensaje',
      texto: 'Guardada: «Calle Inventada 1, 4ºB». Catcher no deja cambiar un pedido ya creado: llama a Ana Prueba y díctasela. Reimprime el ticket de la bolsa para que la lleve.',
      llamar: { nombre: 'Ana Prueba', telefono: '+34600000009' },
    })
  })
  it('ya en Catcher sin repartidor: sin «Llamar», y dice cuándo saldrá', () => {
    const p = siguientePaso({ ...base, ya_en_catcher: true })
    expect(p.tipo === 'mensaje' && p.llamar).toBeUndefined()
    expect(p.tipo === 'mensaje' && p.texto).toContain('aún no ha asignado repartidor: cuando lo asigne, sale aquí su teléfono')
  })
  it('local a mano: dice que se despache a mano', () => {
    const p = siguientePaso({ ...base, dispatch_mode: 'manual' })
    expect(p.tipo === 'mensaje' && p.texto).toBe('Guardada: «Calle Inventada 1, 4ºB». Este local despacha a mano: pulsa «Despachar» en el pedido y sale con ella. Reimprime el ticket de la bolsa para que la lleve.')
  })
  it('el resolutor dice que no: da su motivo', () => {
    const p = siguientePaso({ ...base, carrier: null, reason: 'la reparte la plataforma: no se despacha' })
    expect(p.tipo === 'mensaje' && p.texto).toBe('Guardada: «Calle Inventada 1, 4ºB», pero no se manda: la reparte la plataforma: no se despacha.')
  })
  it('lo confirma con la dirección', () => {
    expect(mandadoACatcher('Calle Inventada 1')).toBe('Guardada y mandada a Catcher con la dirección «Calle Inventada 1». Reimprime el ticket de la bolsa para que la lleve.')
  })
})

describe('la lista «Sin dirección completa» de Despacho', () => {
  const p: PedidoSinDireccion = {
    sale_id: 's1', sold_at: '2026-10-16T10:00:00Z', code: 'G301', platform_order_ref: '100000000301', channel: 'Glovo',
    brand: 'Burger de Prueba', status: 'open', lat: 40.41, lng: -3.7, carrier_code: 'catcher', en_catcher: true,
    rider_name: null, rider_phone: null, dispatch_error: null, dispatch_mode: 'auto',
  }
  it('una frase por pedido, con el código, la marca y la plataforma', () => {
    expect(fraseDeLaLista(p)).toBe('G301 · Burger de Prueba · Glovo — salió a Catcher con el punto del mapa; el repartidor llamará al cliente')
    expect(fraseDeLaLista({ ...p, rider_name: 'Ana Prueba' })).toBe('G301 · Burger de Prueba · Glovo — en Catcher con Ana Prueba; el repartidor llamará al cliente')
  })
  it('la completada se queda en la lista, con quién y qué (la lista no esconde filas)', () => {
    const c = { ...p, direccion_completada: 'Calle Inventada 1, 4ºB', completada_por: 'Persona de Prueba' }
    expect(fraseDeLaLista(c)).toBe('G301 · Burger de Prueba · Glovo — completada por Persona de Prueba: Calle Inventada 1, 4ºB')
    expect(puedeCompletar(c)).toBe(false)
  })
  it('el botón: solo abiertos, sin completar y sin decidir quién reparte', () => {
    expect(puedeCompletar(p)).toBe(true)
    expect(puedeCompletar({ ...p, status: 'closed' })).toBe(false)
    expect(puedeCompletar({ ...p, decidir: true })).toBe(false)
    expect(fraseDeLaLista({ ...p, status: 'closed', en_catcher: false })).toBe('G301 · Burger de Prueba · Glovo — cerrado sin completar la dirección')
  })
  it('un Uber por decidir lo dice', () => {
    expect(fraseDeLaLista({ ...p, channel: 'Uber Eats', decidir: true })).toContain('falta decidir quién reparte este pedido de Uber')
  })
})

describe('lo de siempre', () => {
  it('el número del portal es el largo de la plataforma; si no hay, el corto', () => {
    expect(numeroParaElPortal({ platform_order_ref: '100000000301', code: 'G301' })).toBe('100000000301')
    expect(numeroParaElPortal({ platform_order_ref: null, code: 'G301' })).toBe('G301')
    expect(numeroParaElPortal({ platform_order_ref: ' ', code: null })).toBeNull()
  })
  it('el portal por su nombre corto', () => {
    expect(nombreDelPortal('Glovo')).toBe('Glovo')
    expect(nombreDelPortal('Uber Eats')).toBe('Uber')
    expect(nombreDelPortal(null)).toBe('la plataforma')
  })
  it('el enlace al mapa, solo con coordenadas de verdad (vienen como texto de la base)', () => {
    expect(enlaceAlMapa('40.41', '-3.70')).toBe('https://www.google.com/maps/search/?api=1&query=40.41,-3.7')
    expect(enlaceAlMapa(null, '-3.70')).toBeNull()
    expect(enlaceAlMapa('abc', '-3.70')).toBeNull()
  })
})
