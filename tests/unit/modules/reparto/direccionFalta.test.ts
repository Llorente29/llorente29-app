// tests/unit/modules/reparto/direccionFalta.test.ts
//
// R03 · Los pedidos sin dirección completa (Julio, 16/10, tras ver las
// capturas): salen a Catcher al momento; la tarjeta solo informa; la lista de
// Despacho dice una frase por pedido; «Completar dirección» confirma con
// contenido (regla 8) y, si Catcher ya lo tiene, da el teléfono del
// repartidor para dictársela. Textos en automático (Julio, 17/10). Direcciones, nombres y teléfonos inventados.
import { describe, expect, it } from 'vitest'
import {
  avisoDeLaTarjeta, enlaceAlMapa, fraseDeLaLista, haSalido, HA_SALIDO, lineaDeCompletada, motivoDelFallo,
  NO_HA_SALIDO, necesitaAAlguien, nombreDelPortal, numeroParaElPortal, ordenarLaLista, puedeCompletar,
  siguientePaso, telefonoDelCliente, type PedidoSinDireccion, type ResultadoFijar,
} from '@/modules/reparto/lib/direccionFalta'

const base: ResultadoFijar = {
  ok: true, sale_id: 's1', direccion: 'Calle Inventada 1, 4ºB', carrier: 'catcher', reason: 'sin regla',
  dispatch_mode: 'auto', ya_en_catcher: false, rider_name: null, rider_phone: null, por: 'Persona de Prueba',
}

describe('la línea de la tarjeta, en automático (el caso real)', () => {
  it('ha salido: informativa, con el texto de Julio', () => {
    expect(HA_SALIDO).toBe('Ha salido a Catcher con el punto del mapa · el repartidor llamará al cliente')
    expect(avisoDeLaTarjeta({ enCatcher: true, dispatchError: null, dispatchMode: 'auto' })).toBe(HA_SALIDO)
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: null, dispatchMode: 'auto', hayPunto: true })).toBe(HA_SALIDO)
  })
  it('ni calle ni punto, o Catcher lo ha rechazado: hay que llamar al cliente', () => {
    expect(NO_HA_SALIDO).toBe('No ha salido a Catcher · llama al cliente y completa la dirección')
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: 'No se pudo enviar a Catcher: 422', dispatchMode: 'auto' })).toBe(NO_HA_SALIDO)
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: null, dispatchMode: 'auto', hayPunto: false })).toBe(NO_HA_SALIDO)
    expect(haSalido({ enCatcher: false, dispatchError: null, dispatchMode: 'auto', hayPunto: false })).toBe(false)
  })
  it('local a mano (ninguno en producción): que se despache', () => {
    expect(avisoDeLaTarjeta({ enCatcher: false, dispatchError: null, dispatchMode: 'manual' }))
      .toBe('Este local despacha a mano · despáchalo y el repartidor llamará al cliente')
  })
  it('el motivo del aviso rojo, sin el prefijo y con mayúscula', () => {
    expect(motivoDelFallo('No se despachó: la dirección no ha llegado y tampoco el punto del mapa: no se puede despachar'))
      .toBe('La dirección no ha llegado y tampoco el punto del mapa: no se puede despachar')
    expect(motivoDelFallo(null)).toBe('')
  })
  it('el teléfono del cliente, con el código de Uber', () => {
    expect(telefonoDelCliente('+34900000000', '12345678')).toBe('Tel. +34900000000 · código 12345678')
    expect(telefonoDelCliente('+34600000003', null)).toBe('Tel. +34600000003')
    expect(telefonoDelCliente(null, null)).toBeNull()
  })
})

describe('«Completar dirección»: una línea', () => {
  it('con quién y el ticket', () => {
    expect(lineaDeCompletada('Persona de Prueba', { trabajos: 1 })).toBe('Dirección completada por Persona de Prueba · ticket reimpreso')
    expect(lineaDeCompletada('Persona de Prueba', null)).toBe('Dirección completada por Persona de Prueba')
    expect(lineaDeCompletada(null, { trabajos: 0 })).toBe('Dirección completada · el local no tiene impresora para el ticket de la bolsa')
    expect(lineaDeCompletada('Persona de Prueba', { error: 'x' })).toBe('Dirección completada por Persona de Prueba · no se ha podido reimprimir el ticket')
  })
  it('sin Catcher todavía, local en automático y resolutor en Catcher: se manda', () => {
    expect(siguientePaso(base)).toEqual({ tipo: 'mandar' })
  })
  it('ya en Catcher con repartidor: nada que añadir (su «Llamar» está en su fila de reparto)', () => {
    expect(siguientePaso({ ...base, ya_en_catcher: true, rider_name: 'Ana Prueba', rider_phone: '+34600000009' }))
      .toEqual({ tipo: 'mensaje', texto: '' })
  })
  it('ya en Catcher sin repartidor: nada que añadir', () => {
    expect(siguientePaso({ ...base, ya_en_catcher: true })).toEqual({ tipo: 'mensaje', texto: '' })
  })
  it('el resolutor dice que no: da su motivo', () => {
    const p = siguientePaso({ ...base, carrier: null, reason: 'la reparte la plataforma: no se despacha' })
    expect(p.tipo === 'mensaje' && p.texto).toBe('No se manda a Catcher: la reparte la plataforma: no se despacha.')
  })
})

describe('la lista «Sin dirección completa» de Despacho', () => {
  const p: PedidoSinDireccion = {
    sale_id: 's1', sold_at: '2026-10-16T10:00:00Z', code: 'G301', platform_order_ref: '100000000301', channel: 'Glovo',
    brand: 'Burger de Prueba', status: 'open', lat: 40.41, lng: -3.7, carrier_code: 'catcher', en_catcher: true,
    rider_name: null, rider_phone: null, dispatch_error: null, dispatch_mode: 'auto',
  }
  const rojo: PedidoSinDireccion = {
    ...p, sale_id: 's2', sold_at: '2026-10-16T09:00:00Z', code: 'G302', en_catcher: false, carrier_code: null, lat: null, lng: null,
    dispatch_error: 'No se despachó: la dirección no ha llegado y tampoco el punto del mapa', no_ha_salido: true,
  }
  it('una frase por pedido, con el código, la marca y la plataforma', () => {
    expect(fraseDeLaLista(p)).toBe(`G301 · Burger de Prueba · Glovo — ${HA_SALIDO}`)
    expect(fraseDeLaLista(rojo)).toBe(`G302 · Burger de Prueba · Glovo — ${NO_HA_SALIDO}`)
  })
  it('primero, aunque sea más antiguo, el que no ha salido; luego los que sí', () => {
    expect(necesitaAAlguien(rojo)).toBe(true)
    expect(necesitaAAlguien(p)).toBe(false)
    expect(ordenarLaLista([p, rojo]).map(x => x.code)).toEqual(['G302', 'G301'])
  })
  it('la completada se queda en la lista, con quién y qué, en gris (la lista no esconde filas)', () => {
    const c = { ...rojo, direccion_completada: 'Calle Inventada 1, 4ºB', completada_por: 'Persona de Prueba' }
    expect(fraseDeLaLista(c)).toBe('G302 · Burger de Prueba · Glovo — Dirección completada por Persona de Prueba: Calle Inventada 1, 4ºB')
    expect(puedeCompletar(c)).toBe(false)
    expect(necesitaAAlguien(c)).toBe(false)
  })
  it('el botón: solo abiertos, sin completar y sin decidir quién reparte', () => {
    expect(puedeCompletar(p)).toBe(true)
    expect(puedeCompletar({ ...p, status: 'closed' })).toBe(false)
    expect(puedeCompletar({ ...p, decidir: true })).toBe(false)
    expect(fraseDeLaLista({ ...p, status: 'closed', en_catcher: false })).toBe('G301 · Burger de Prueba · Glovo — Cerrado sin completar la dirección')
  })
  it('un Uber por decidir lo dice, y va arriba', () => {
    expect(fraseDeLaLista({ ...p, channel: 'Uber Eats', decidir: true })).toContain('Falta decidir quién reparte este pedido de Uber')
    expect(necesitaAAlguien({ ...p, decidir: true })).toBe(true)
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
