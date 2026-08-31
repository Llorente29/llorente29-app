// tests/unit/lib/direccionEntrega.test.ts
//
// Las direcciones de aquí son REALES, sacadas de producción el 31/08 sobre las
// 1.043 ventas con `delivery_address`. Importan sobre todo las dos que pueden
// romperse: la nota del cliente que lleva la palabra «door» sin ser etiqueta, y
// las etiquetas que ya vienen en español de otros canales.

import { describe, it, expect } from 'vitest'
import {
  traduceDireccionEntrega, etiquetasDesconocidas, ETIQUETAS_DIRECCION,
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

describe('lo que NO se traduce, declarado', () => {
  it('«Spain» se queda: es un valor, no una etiqueta (481 de 1.043 direcciones)', () => {
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
