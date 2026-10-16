// tests/unit/modules/reparto/direccionFalta.test.ts
//
// R03 · Lo que dice el aviso «Falta la dirección» al pegar una dirección
// (regla 8: con contenido). Los casos son los del encargo: no estaba en
// Catcher (se manda), ya estaba (se da al repartidor), local a mano, sin
// motivo para despachar. Direcciones y nombres inventados.
import { describe, expect, it } from 'vitest'
import {
  enlaceAlMapa, estadoDeSalida, mandadoACatcher, nombreDelPortal, numeroParaElPortal, siguientePaso,
  type PedidoSinDireccion, type ResultadoFijar,
} from '@/modules/reparto/lib/direccionFalta'

const base: ResultadoFijar = {
  ok: true, sale_id: 's1', direccion: 'Calle Inventada 1, 4ºB', carrier: 'catcher', reason: 'sin regla',
  dispatch_mode: 'auto', ya_en_catcher: false, rider_name: null, rider_phone: null,
}

describe('siguientePaso', () => {
  it('sin Catcher todavía, local en automático y resolutor en Catcher: se manda', () => {
    expect(siguientePaso(base)).toEqual({ tipo: 'mandar' })
  })
  it('ya en Catcher con repartidor: se le da al repartidor, con su nombre y teléfono', () => {
    const p = siguientePaso({ ...base, ya_en_catcher: true, rider_name: 'Ana Prueba', rider_phone: '600000000' })
    expect(p).toEqual({ tipo: 'mensaje', texto: 'Guardada: «Calle Inventada 1, 4ºB». Catcher ya llevaba este pedido al punto del mapa y no deja cambiarle la dirección: llama al repartidor (Ana Prueba, 600000000) y díctasela.' })
  })
  it('ya en Catcher sin repartidor: dice qué hacer cuando lo tenga', () => {
    const p = siguientePaso({ ...base, ya_en_catcher: true })
    expect(p.tipo === 'mensaje' && p.texto).toContain('en cuanto tenga repartidor, llámale y díctasela')
  })
  it('local a mano: dice que se despache a mano', () => {
    const p = siguientePaso({ ...base, dispatch_mode: 'manual' })
    expect(p.tipo === 'mensaje' && p.texto).toBe('Guardada: «Calle Inventada 1, 4ºB». Este local despacha a mano: pulsa «Despachar» en el pedido.')
  })
  it('el resolutor dice que no: da su motivo', () => {
    const p = siguientePaso({ ...base, carrier: null, reason: 'la reparte la plataforma: no se despacha' })
    expect(p.tipo === 'mensaje' && p.texto).toBe('Guardada: «Calle Inventada 1, 4ºB», pero no se manda: la reparte la plataforma: no se despacha.')
  })
  it('lo confirma con la dirección', () => {
    expect(mandadoACatcher('Calle Inventada 1')).toBe('Mandado a Catcher con la dirección «Calle Inventada 1».')
  })
})

describe('lo que enseña el aviso', () => {
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

describe('estadoDeSalida (la espera de 5 minutos)', () => {
  const p: PedidoSinDireccion = {
    sale_id: 's1', sold_at: '2026-10-16T10:00:00Z', code: 'G301', platform_order_ref: null, channel: 'Glovo', brand: null,
    lat: 40.41, lng: -3.7, carrier_code: null, en_catcher: false, rider_name: null, rider_phone: null, dispatch_error: null,
    sale_solo_at: '2026-10-16T10:05:00Z', dispatch_mode: 'auto',
  }
  const t = (iso: string) => Date.parse(iso)
  it('cuánto falta para que salga solo', () => {
    expect(estadoDeSalida(p, t('2026-10-16T10:01:30Z'))).toBe('Sale solo a Catcher en 3:30 con el punto del mapa, si no pegas la dirección antes.')
    expect(estadoDeSalida(p, t('2026-10-16T10:04:59Z'))).toBe('Sale solo a Catcher en 0:01 con el punto del mapa, si no pegas la dirección antes.')
  })
  it('vencido: saliendo', () => {
    expect(estadoDeSalida(p, t('2026-10-16T10:05:00Z'))).toBe('Saliendo solo a Catcher con el punto del mapa…')
  })
  it('ya en Catcher, con su repartidor', () => {
    expect(estadoDeSalida({ ...p, en_catcher: true, rider_name: 'Ana Prueba' }, 0)).toBe('Ya ha salido a Catcher por el punto del mapa, con Ana Prueba.')
  })
  it('local a mano: no sale solo', () => {
    expect(estadoDeSalida({ ...p, dispatch_mode: 'manual' }, 0)).toBe('Este local despacha a mano: no sale solo.')
  })
})
