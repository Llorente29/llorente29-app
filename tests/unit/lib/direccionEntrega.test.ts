// tests/unit/lib/direccionEntrega.test.ts
//
// Las direcciones de aquí son REALES, sacadas de producción el 31/08 sobre las
// 1.043 ventas con `delivery_address`. Importan sobre todo las dos que pueden
// romperse: la nota del cliente que lleva la palabra «door» sin ser etiqueta, y
// las etiquetas que ya vienen en español de otros canales.

import { describe, it, expect } from 'vitest'
import {
  traduceDireccionEntrega, etiquetasDesconocidas, ETIQUETAS_DIRECCION,
  quitaDireccionDuplicada, direccionParaMostrar,
} from '@/lib/direccionEntrega'

// Las cuatro direcciones con palabra inglesa que hay hoy en producción.
const CON_ETIQUETAS = 'Calle de la Encomienda de Palacios, 152, Floor: 1, Door: B, 28030'
const CON_NOTA_LIBRE = 'Calle del Corregidor Juan Francisco de Luján, 106, 4, 4B, Press 4B and I will open the door, 28030'
const CON_TIMBRE = 'Calle de la Jacaranda, 10, 5, 435, Doorbell 435, 28045'
const CON_SPAIN = 'C. de Álvarez Abellán, 4, Carabanchel, 28025 Madrid, Spain'

describe('lo que pide el encargo', () => {
  it('Floor→Piso y Door→Puerta, en el caso real', () => {
    expect(traduceDireccionEntrega(CON_ETIQUETAS))
      .toBe('Calle de la Encomienda de Palacios, 152, Piso: 1, Puerta: B, 28030')
  })

  it('la etiqueta sin dos puntos también: «Doorbell 435» → «Timbre 435»', () => {
    expect(traduceDireccionEntrega(CON_TIMBRE))
      .toBe('Calle de la Jacaranda, 10, 5, 435, Timbre 435, 28045')
  })

  it('traduce las demás que pide Julio', () => {
    expect(traduceDireccionEntrega('Flat: 3')).toBe('Apartamento: 3')
    expect(traduceDireccionEntrega('Stairs: A')).toBe('Escalera: A')
    expect(traduceDireccionEntrega('Building: 2')).toBe('Edificio: 2')
    expect(traduceDireccionEntrega('Entrance: C')).toBe('Portal: C')
  })

  it('da igual cómo venga escrita la etiqueta', () => {
    expect(traduceDireccionEntrega('FLOOR: 1')).toBe('Piso: 1')
    expect(traduceDireccionEntrega('floor: 1')).toBe('Piso: 1')
    expect(traduceDireccionEntrega('  Floor : 1')).toBe('  Piso : 1')
  })
})

describe('regla 2 — lo desconocido se enseña tal cual, nunca se adivina ni se tira', () => {
  it('una etiqueta que no está en el mapa pasa intacta', () => {
    expect(traduceDireccionEntrega('Gate: 4')).toBe('Gate: 4')
    expect(traduceDireccionEntrega('Whatever: xyz')).toBe('Whatever: xyz')
  })

  it('las etiquetas que YA vienen en español no se tocan', () => {
    // De producción: otros canales mandan «Timbre: 07», «Llamar: 81 + llave».
    expect(traduceDireccionEntrega('Timbre: 07')).toBe('Timbre: 07')
    expect(traduceDireccionEntrega('Llamar: 81 + llave')).toBe('Llamar: 81 + llave')
  })

  it('no se pierde NI UN carácter de lo que no se reconoce', () => {
    const raro = 'Algo raro: 3º izq., 4-B, #5, (portal azul)'
    expect(traduceDireccionEntrega(raro)).toBe(raro)
  })

  it('null, undefined y vacío entran y salen igual', () => {
    expect(traduceDireccionEntrega(null)).toBeNull()
    expect(traduceDireccionEntrega(undefined)).toBeUndefined()
    expect(traduceDireccionEntrega('')).toBe('')
  })
})

describe('la trampa: «door» dentro de una nota del cliente', () => {
  it('NO destroza «Press 4B and I will open the door»', () => {
    expect(traduceDireccionEntrega(CON_NOTA_LIBRE)).toBe(CON_NOTA_LIBRE)
    expect(traduceDireccionEntrega(CON_NOTA_LIBRE)).not.toContain('Puerta')
  })

  it('una frase que EMPIEZA por una etiqueta tampoco se traduce', () => {
    // Sin dos puntos y con valor largo: `floor` aquí es la primera palabra de
    // una frase, no una etiqueta.
    const frase = 'Floor is broken use the stairs'
    expect(traduceDireccionEntrega(frase)).toBe(frase)
  })

  it('pero con un valor corto sí es una etiqueta', () => {
    expect(traduceDireccionEntrega('Floor 3')).toBe('Piso 3')
  })
})

describe('lo que NO se traduce, decidido', () => {
  it('«Spain» se queda: es un valor, y ya no llega (0 veces en los últimos 30 días)', () => {
    // 475 de las 1.033 históricas de Foodint, ninguna en los últimos 30 días.
    expect(traduceDireccionEntrega(CON_SPAIN)).toBe(CON_SPAIN)
  })

  it('una dirección sin nada en inglés sale idéntica', () => {
    const es = 'Calle Mayor, 3, 2º B, 28013 Madrid'
    expect(traduceDireccionEntrega(es)).toBe(es)
  })
})

describe('no se confunde el piso con el apartamento', () => {
  it('Floor y Flat NO son la misma palabra en castellano', () => {
    expect(ETIQUETAS_DIRECCION.floor).toBe('Piso')
    expect(ETIQUETAS_DIRECCION.flat).toBe('Apartamento')
    expect(ETIQUETAS_DIRECCION.floor).not.toBe(ETIQUETAS_DIRECCION.flat)
  })

  it('los dos juntos siguen siendo dos datos distintos', () => {
    expect(traduceDireccionEntrega('Floor: 4, Flat: 2')).toBe('Piso: 4, Apartamento: 2')
  })
})

describe('auditar qué está llegando (para hacer crecer el mapa con datos)', () => {
  it('lista las etiquetas con forma de etiqueta que no se conocen', () => {
    expect(etiquetasDesconocidas('Floor: 1, Gate: 4, Door: B')).toEqual(['Gate'])
  })

  it('las conocidas no salen', () => {
    expect(etiquetasDesconocidas(CON_ETIQUETAS)).toEqual([])
  })

  it('una nota libre no es una etiqueta desconocida', () => {
    expect(etiquetasDesconocidas(CON_NOTA_LIBRE)).toEqual([])
  })
})

describe('idempotencia — traducir dos veces da lo mismo', () => {
  it('pasar la salida por la función otra vez no la cambia', () => {
    const una = traduceDireccionEntrega(CON_ETIQUETAS)
    expect(traduceDireccionEntrega(una)).toBe(una)
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// LA DIRECCIÓN REPETIDA
// Direcciones reales de producción. Las de Just Eat por Last.app repiten calle
// y CP en los últimos 30 días: 25 de 25 en Foodint y 7 de 7 en Kitchen Grill
// LstQ — el 100 % en DOS cuentas independientes. Por HubRise, 0 de 76.
// (Contado por cuenta: regla 9. La primera versión decía «32 de 32» sumando
// las dos cuentas en una cifra que no era de nadie.)
// ═══════════════════════════════════════════════════════════════════════════

// La última del 31/08, a las 14:58 hora de Madrid.
const JE_MALICIOSA = 'Plaza Maliciosa, 1 3 Izda, 28027, Plaza Maliciosa, 1 3 Izda, España, 28027'
const JE_ORTIZ = 'Calle de Ricardo Ortiz, 38, 6 A, 28017, Calle de Ricardo Ortiz, 38, 6 A, Madrid, 28017'
const JE_SIRO = 'Siro Muela 71, 28027, Siro Muela 71, Madrid, 28027'
const JE_HUMBOLT = 'Calle Alejandro Humbolt, 15, 4E, Entrada Por María Teresa De león, 21, 28051, Calle Alejandro Humbolt, 15, 4E, Entrada Por María Teresa De león, 21, Madrid, 28051'

describe('quitar la dirección repetida', () => {
  it('la última real: se queda la copia con ciudad', () => {
    expect(quitaDireccionDuplicada(JE_MALICIOSA)).toBe('Plaza Maliciosa, 1 3 Izda, España, 28027')
  })

  it('con piso y letra', () => {
    expect(quitaDireccionDuplicada(JE_ORTIZ)).toBe('Calle de Ricardo Ortiz, 38, 6 A, Madrid, 28017')
  })

  it('sin coma entre calle y número', () => {
    expect(quitaDireccionDuplicada(JE_SIRO)).toBe('Siro Muela 71, Madrid, 28027')
  })

  it('con una indicación larga dentro, y acentos', () => {
    expect(quitaDireccionDuplicada(JE_HUMBOLT))
      .toBe('Calle Alejandro Humbolt, 15, 4E, Entrada Por María Teresa De león, 21, Madrid, 28051')
  })

  it('no se pierde NADA de lo que había en la copia que se queda', () => {
    const salida = quitaDireccionDuplicada(JE_HUMBOLT)!
    for (const trozo of ['Humbolt', '15', '4E', 'María Teresa De león', '21', 'Madrid', '28051']) {
      expect(salida).toContain(trozo)
    }
  })
})

describe('mejor repetida que recortada de más', () => {
  it('si la primera copia tiene algo que la segunda no, NO se toca', () => {
    // Aquí «Piso 3» solo está en la primera copia: recortar lo perdería, y una
    // dirección sin piso es un pedido que no llega.
    const asimetrica = 'Calle X, Piso 3, 28001, Calle X, Madrid, 28001'
    expect(quitaDireccionDuplicada(asimetrica)).toBe(asimetrica)
  })

  it('una dirección normal (Glovo, HubRise) no se toca: 0 de 76 repiten', () => {
    const glovo = 'Calle de la Encomienda de Palacios, 152, Floor: 1, Door: B, 28030'
    expect(quitaDireccionDuplicada(glovo)).toBe(glovo)
    const gmaps = 'C. de Álvarez Abellán, 4, Carabanchel, 28025 Madrid, Spain'
    expect(quitaDireccionDuplicada(gmaps)).toBe(gmaps)
  })

  it('si al cortar se perdiera el código postal, no se corta', () => {
    // «A, 28001, A»: el resto no es más largo que la cabeza. Se deja repetida.
    expect(quitaDireccionDuplicada('Calle X, 28001, Calle X')).toBe('Calle X, 28001, Calle X')
  })

  it('sin código postal no hay nada que reconocer', () => {
    expect(quitaDireccionDuplicada('Calle X, Calle X')).toBe('Calle X, Calle X')
  })

  it('null, undefined y vacío entran y salen igual', () => {
    expect(quitaDireccionDuplicada(null)).toBeNull()
    expect(quitaDireccionDuplicada(undefined)).toBeUndefined()
    expect(quitaDireccionDuplicada('')).toBe('')
  })

  it('idempotente: pasarla dos veces da lo mismo', () => {
    const una = quitaDireccionDuplicada(JE_ORTIZ)
    expect(quitaDireccionDuplicada(una)).toBe(una)
  })
})

describe('direccionParaMostrar — lo que ven la pantalla y el ticket', () => {
  it('hace las dos cosas: quita la copia y traduce las etiquetas', () => {
    const ambas = 'Calle X, Floor: 2, 28001, Calle X, Floor: 2, Madrid, 28001'
    expect(direccionParaMostrar(ambas)).toBe('Calle X, Piso: 2, Madrid, 28001')
  })

  it('una dirección de Just Eat real queda legible', () => {
    expect(direccionParaMostrar(JE_SIRO)).toBe('Siro Muela 71, Madrid, 28027')
  })

  it('y si no encaja ninguna de las dos reglas, sale tal cual', () => {
    const raro = 'Algo raro: 3º izq., 4-B, #5'
    expect(direccionParaMostrar(raro)).toBe(raro)
  })
})
