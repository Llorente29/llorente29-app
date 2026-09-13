// LAS DOS LLAVES Y LAS DOS CARAS, fijadas aquí para que se puedan leer sin
// montar React ni abrir la base.
//
// LOS ESTADOS SON REALES (regla 31). Salen de medir Foodint el 13/09:
//   · los tres locales tienen TURNO PARTIDO de lunes a jueves, así que la
//     ventana no es solo la de madrugada;
//   · a Plaza Castilla le FALTA el lunes en `business_hours`, que es el caso
//     `sin_horario_declarado_hoy`;
//   · las tres tablets vivas (Pase, Cocina, camichi4) corrían el paquete 285.
//
// Y lo que más importa: la puerta CIEGA. Hasta el 13/09, si la tablet no podía
// preguntar a la base, se actualizaba igual. Ese es el agujero por el que una
// tablet se recarga en plena cena — y falla justo cuando la red va mal, que es
// cuando más se sondea en vano.

import { describe, it, expect } from 'vitest'
import {
  loQueEsperaLaTablet, loQueLeeLaOficina, sePuedeAplicarAhora, laHora,
  NO_PUEDE_PREGUNTAR,
} from '@/modules/kds/lib/palabrasDeLaActualizacion'
import type { UpdateWindow } from '@/native/appUpdate'

/** Ventana con las dos llaves abiertas: madrugada, cocina parada. */
const W = (o: Partial<UpdateWindow> = {}): UpdateWindow => ({
  ok: true, safe: true, reasons: [],
  pendingJobs: 0, activeOrders: 0, minutesSinceSale: null,
  enVentana: true, motivoVentana: null, ventanaHasta: '2026-09-14T12:15:00',
  soportaVentana: true, ...o,
})

/** En servicio: la primera llave cerrada, la cocina puede estar en calma. */
const EN_SERVICIO = W({ enVentana: false, motivoVentana: 'servicio_o_margen',
                        ventanaHasta: null, reasons: ['servicio_o_margen'] })

const ESTACION = { esEstacion: true, tabletLibre: true, urgente: false, blind: false }

describe('las dos llaves, y las dos tienen que abrir', () => {
  it('las dos abiertas: se aplica', () => {
    expect(sePuedeAplicarAhora({ ...ESTACION, w: W() }).puede).toBe(true)
  })

  it('🔴 EN SERVICIO con la cocina en calma NO se aplica — el hueco de antes', () => {
    // A las 14:30 de un martes flojo, sin tickets y con 20 min sin venta, la
    // guarda vieja decía «calma» y la tablet se recargaba en pleno servicio.
    expect(EN_SERVICIO.safe).toBe(true)          // la segunda llave SÍ abre
    expect(sePuedeAplicarAhora({ ...ESTACION, w: EN_SERVICIO }).puede).toBe(false)
  })

  it('en ventana pero con pedidos en marcha tampoco se aplica', () => {
    const w = W({ safe: false, activeOrders: 2, reasons: ['pedidos_en_curso'] })
    expect(sePuedeAplicarAhora({ ...ESTACION, w }).puede).toBe(false)
  })

  it('sin horario declarado hoy no se aplica: la ausencia de un dato no es un permiso', () => {
    const w = W({ enVentana: false, motivoVentana: 'sin_horario_declarado_hoy' })
    expect(sePuedeAplicarAhora({ ...ESTACION, w }).puede).toBe(false)
  })

  it('y la tablet ocupada espera aunque las dos llaves abran', () => {
    expect(sePuedeAplicarAhora({ ...ESTACION, tabletLibre: false, w: W() }).puede).toBe(false)
  })
})

describe('🔴 la puerta ciega, que estaba al revés', () => {
  const CIEGOS: Array<[string, UpdateWindow | null]> = [
    ['la base no contesta', null],
    ['la RPC no existe', W({ unsupported: true, soportaVentana: false, safe: false, enVentana: false })],
    ['la base no conoce la primera llave', W({ soportaVentana: false })],
  ]

  it.each(CIEGOS)('%s → NO se actualiza', (_caso, w) => {
    const r = sePuedeAplicarAhora({ ...ESTACION, w })
    expect(r.ciego).toBe(true)
    expect(r.puede).toBe(false)
  })

  it('30 sondeos mudos seguidos tampoco abren la puerta', () => {
    expect(sePuedeAplicarAhora({ ...ESTACION, w: W(), blind: true }).puede).toBe(false)
  })

  it('la ÚNICA salida es que una persona marque la publicación como urgente', () => {
    for (const [, w] of CIEGOS) {
      expect(sePuedeAplicarAhora({ ...ESTACION, w, urgente: true }).puede).toBe(true)
    }
    expect(sePuedeAplicarAhora({ ...ESTACION, w: W(), blind: true, urgente: true }).puede).toBe(true)
  })

  it('un aparato que NO es estación no tiene cocina que interrumpir', () => {
    // Móvil de equipo, navegador: solo cuenta que no lo estén tocando.
    expect(sePuedeAplicarAhora({ ...ESTACION, esEstacion: false, w: null }).puede).toBe(true)
    expect(sePuedeAplicarAhora({ esEstacion: false, tabletLibre: false, urgente: false, blind: false, w: null }).puede).toBe(false)
  })
})

describe('la franja de la tablet habla como un cocinero, no como un servidor', () => {
  it('en servicio dice cuándo se instalará, no un código', () => {
    const t = loQueEsperaLaTablet(EN_SERVICIO, true)
    expect(t).toBe('Se instalará sola al cerrar el local.')
    expect(t).not.toMatch(/bundle|versión \d|servicio_o_margen/)
  })

  it('con tickets o pedidos nombra lo que está pasando', () => {
    expect(loQueEsperaLaTablet(W({ safe: false, pendingJobs: 2 }), true))
      .toContain('tickets imprimiéndose')
    expect(loQueEsperaLaTablet(W({ safe: false, activeOrders: 3 }), true))
      .toContain('pedidos en marcha')
  })

  it('y sin poder preguntar lo dice, en vez de callarse', () => {
    // El miedo original era que una migración olvidada dejara la flota sin
    // actualizar «en silencio». Ya no es silencio: sale en pantalla.
    expect(NO_PUEDE_PREGUNTAR).toContain('no se instalará sola')
  })
})

describe('la línea de la oficina: en palabras, y el rojo solo si hay que hacer algo', () => {
  const B = (o: Partial<Parameters<typeof loQueLeeLaOficina>[0]> = {}) =>
    loQueLeeLaOficina({ estado: 'atrasado', motivoEspera: null,
                        aplicadoEn: null, horasDesfase: null, ...o })

  it('al día dice la hora a la que se puso al día', () => {
    const r = B({ estado: 'al_dia', aplicadoEn: '2026-09-13T14:03:00Z', motivoEspera: null })
    expect(r.texto).toMatch(/^Puesta al día a las \d{2}:\d{2}$/)
    expect(r.rojo).toBe(false)
  })

  it('🔴 esperar el servicio NO es una alarma (regla 7)', () => {
    const r = B({ motivoEspera: 'servicio_o_margen', aplicadoEn: '2026-09-12T22:12:00Z' })
    expect(r.texto).toContain('Esperando a que acabe el servicio')
    expect(r.rojo).toBe(false)
  })

  it('pero un local sin horario puesto sí lo es, y dice por qué', () => {
    const r = B({ motivoEspera: 'sin_horario_declarado_hoy' })
    expect(r.rojo).toBe(true)
    expect(r.texto).toContain('no tiene horario puesto para hoy')
  })

  it('una tablet muda con horas de retraso es roja y dice cuántas', () => {
    const r = B({ estado: 'muy_atrasado', motivoEspera: 'no_da_senales', horasDesfase: 31 })
    expect(r.rojo).toBe(true)
    expect(r.texto).toContain('31 h')
  })

  it('una revocada no es una alarma: no va a actualizarse y punto', () => {
    expect(B({ motivoEspera: 'aparato_apagado' }).rojo).toBe(false)
  })

  it('y NINGUNA línea dice «bundle» ni un número de versión', () => {
    const estados = ['al_dia', 'atrasado', 'muy_atrasado', 'builtin', 'desconocido'] as const
    const motivos = ['aparato_apagado', 'no_da_senales', 'servicio_o_margen',
                     'sin_horario_declarado_hoy', 'fuera_de_ventana', 'cocina_ocupada',
                     'a_punto_de_instalarse', null] as const
    for (const estado of estados) {
      for (const motivoEspera of motivos) {
        const { texto } = loQueLeeLaOficina({
          estado, motivoEspera, aplicadoEn: '2026-09-13T12:00:00Z', horasDesfase: 4,
        })
        expect(texto, `${estado}/${motivoEspera}`).not.toMatch(/bundle|paquete \d|_/)
        expect(texto.length, `${estado}/${motivoEspera}`).toBeGreaterThan(10)
      }
    }
  })
})

describe('la hora', () => {
  it('sin sello no inventa una', () => {
    expect(laHora(null)).toBe('')
  })
})
