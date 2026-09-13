// tests/unit/modules/kitchen/desdeElPlato.test.ts
//
// LOS DATOS SON REALES: «Kebab Combo Duo» de The Urban Kebab (Foodint), tal y
// como lo devolvió `kitchen_preguntas_de_un_plato` el 13/09 a las 20:1x. No es
// un ejemplo: es el plato con más preguntas de la cuenta, y trae dentro justo
// el caso que nadie había escrito todavía (regla 31).

import { describe, it, expect } from 'vitest'
import {
  laReglaDelPlato, deQuienEsLaCarta, respuestasEnTexto, dondeMasEsta,
  loQueHayQueMirar, textoDeQuitar, loQuePasaSiQuitas, laConfirmacionDeQuitar,
  elVacioDelPlato,
} from '@/modules/kitchen/lib/desdeElPlato'
import type { ElPlato, PreguntaDelPlato, LoQuePreguntaElPlato } from '@/modules/kitchen/lib/desdeElPlato'

const PLATO: ElPlato = {
  id: 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70',
  nombre: 'Kebab Combo Duo',
  precio: 20.5,
  marca: 'The Urban Kebab',
  marcaId: '5a230c99-1de4-47ca-82fb-65d4af589176',
  cedida: false,
  activo: true,
  archivado: false,
}

function P(x: Partial<PreguntaDelPlato> = {}): PreguntaDelPlato {
  return {
    id: 'eebb564c-1735-4547-ba46-2aa81d0a67a0',
    nombre: '1. Escoge tu primer kebab',
    tipo: 'elige', min: 1, max: 1, obligatoria: true, repetible: false,
    dePago: false, activa: true, posicion: 0,
    respuestas: 0, sinDecidir: 0, otrosPlatos: 1,
    sePuedeQuitar: true, porQueNo: null,
    ...x,
  }
}

/** Las siete de verdad, en su orden. */
const LAS_SIETE: PreguntaDelPlato[] = [
  P({ id: 'eebb564c', nombre: '1. Escoge tu primer kebab', respuestas: 0, otrosPlatos: 1, posicion: 0 }),
  P({ id: '8819014c', nombre: '1. Elige el tipo de carne de tu primer Kebab', respuestas: 4, dePago: true, otrosPlatos: 1, posicion: 1 }),
  P({ id: 'e1692b3d', nombre: '1. Escoge la salsa para tu primer kebab', respuestas: 2, max: 3, otrosPlatos: 1, posicion: 2 }),
  P({ id: 'a58d72e7', nombre: '2. Escoge tu segundo kebab', respuestas: 0, otrosPlatos: 0, posicion: 3 }),
  P({ id: 'a6a59e57', nombre: '2. Elige el tipo de carne de tu 2º Kebab', respuestas: 4, dePago: true, otrosPlatos: 0, posicion: 4 }),
  P({ id: 'e4942692', nombre: '2. Escoge la salsa para tu segundo kebab', respuestas: 2, max: 3, otrosPlatos: 0, posicion: 5 }),
  P({ id: '02668c11', nombre: 'Escoge tu entrante favorito', respuestas: 3, sinDecidir: 1, dePago: true, otrosPlatos: 1, posicion: 6 }),
]

const TODO: LoQuePreguntaElPlato = { plato: PLATO, preguntas: LAS_SIETE, cuantas: 7 }

describe('la cabecera del plato', () => {
  it('dice cuántas preguntas le hace al cliente, en plural y en singular', () => {
    expect(laReglaDelPlato(TODO)).toBe(
      'Este plato le hace 7 preguntas al cliente antes de entrar en la comanda.')
    expect(laReglaDelPlato({ ...TODO, cuantas: 1 })).toContain('1 pregunta al cliente')
  })

  it('y cuando no pregunta nada, lo dice en vez de dejar un cero suelto', () => {
    expect(laReglaDelPlato({ ...TODO, cuantas: 0 }))
      .toBe('Este plato no pregunta nada: el cliente lo añade y ya está.')
  })

  it('de quién es la carta, con lo que SÍ se puede hacer si es cedida', () => {
    expect(deQuienEsLaCarta(PLATO)).toBe('The Urban Kebab · marca propia')
    const cedido = { ...PLATO, cedida: true, marca: 'Meraki Pita' }
    expect(deQuienEsLaCarta(cedido)).toContain('la manda Last')
  })
})

describe('🔴 lo que salió solo al abrir la pantalla contra datos reales', () => {
  it('una pregunta OBLIGATORIA sin respuestas se dice en rojo, y dice qué rompe', () => {
    // «1. Escoge tu primer kebab» y «2. Escoge tu segundo kebab» están así en
    // producción. No es una pregunta fea: es un plato que el cliente no puede
    // terminar de pedir.
    const rota = LAS_SIETE[0]
    const avisos = loQueHayQueMirar(rota)
    expect(avisos[0].tono).toBe('rojo')
    expect(avisos[0].texto).toContain('no puede terminar el pedido')
  })

  it('dos de las siete están así, y ninguna otra', () => {
    const rojas = LAS_SIETE.filter((p) => loQueHayQueMirar(p).some((a) => a.tono === 'rojo'))
    expect(rojas.map((p) => p.nombre)).toEqual([
      '1. Escoge tu primer kebab',
      '2. Escoge tu segundo kebab',
    ])
  })

  it('sin respuestas pero NO obligatoria es ámbar, no rojo: molesta, no rompe', () => {
    const a = loQueHayQueMirar(P({ respuestas: 0, obligatoria: false }))
    expect(a[0].tono).toBe('ambar')
    expect(a[0].texto).toContain('no le pregunta nada a nadie')
  })

  it('y lo que no descuenta del almacén va aparte, en ámbar', () => {
    const a = loQueHayQueMirar(LAS_SIETE[6])
    expect(a.some((x) => x.texto === '1 respuesta no descuenta nada del almacén')).toBe(true)
    expect(a.every((x) => x.tono !== 'rojo')).toBe(true)
  })
})

describe('las columnas de cada fila', () => {
  it('las respuestas llevan pegado lo que falta', () => {
    expect(respuestasEnTexto(LAS_SIETE[0])).toBe('Ninguna respuesta')
    expect(respuestasEnTexto(LAS_SIETE[1])).toBe('4 respuestas')
    expect(respuestasEnTexto(LAS_SIETE[6])).toBe('3 respuestas · 1 sin decidir qué llevan')
  })

  it('dónde más está decide si quitarla de aquí es un gesto pequeño', () => {
    expect(dondeMasEsta(LAS_SIETE[3])).toBe('Sólo está en este plato')
    expect(dondeMasEsta(LAS_SIETE[0])).toBe('También está en 1 plato más')
    expect(dondeMasEsta(P({ otrosPlatos: 4 }))).toBe('También está en 4 platos más')
  })
})

describe('🔴 quitar: nunca a ciegas, y nunca un botón apagado sin frase', () => {
  it('lo que va a pasar se lee ANTES, y dice que la pregunta no se borra', () => {
    const t = loQuePasaSiQuitas(LAS_SIETE[3], PLATO)
    expect(t).toContain('«2. Escoge tu segundo kebab» dejará de preguntarse en «Kebab Combo Duo»')
    expect(t).toContain('dejará de preguntarse en toda la carta')
    expect(t).toContain('La pregunta no se borra.')
  })

  it('y si vive en más platos, lo dice: no es lo mismo quitar la única', () => {
    expect(loQuePasaSiQuitas(LAS_SIETE[0], PLATO)).toContain('Seguirá preguntándose en el otro plato')
    expect(loQuePasaSiQuitas(P({ otrosPlatos: 3 }), PLATO)).toContain('los otros 3 platos')
  })

  it('una cedida no se puede quitar, y el botón apagado LLEVA su frase', () => {
    const cedida = P({
      sePuedeQuitar: false,
      porQueNo: 'La carta de «Meraki Pita» la manda Last: sus preguntas se ponen y se quitan allí. Si la quitaras aquí, volvería de madrugada.',
    })
    expect(textoDeQuitar(cedida)).toBe('No se puede quitar aquí')
    const frase = loQuePasaSiQuitas(cedida, PLATO)
    expect(frase).toContain('la manda Last')
    expect(frase).toContain('de madrugada')
    // Y NUNCA una hora de reloj: el cron es UTC y la cocina cuenta en Madrid.
    expect(frase).not.toContain('03:20')
    expect(frase).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('la confirmación lleva CONTENIDO: el número nuevo y dónde sigue viva', () => {
    expect(laConfirmacionDeQuitar({
      pregunta: 'Escoge tu entrante favorito', plato: 'Kebab Combo Duo',
      marca: 'The Urban Kebab', leQuedan: 6, sigueEnPlatos: 1,
    })).toBe('Quitada «Escoge tu entrante favorito» de «Kebab Combo Duo». Le quedan 6 preguntas, y sigue en 1 plato.')
  })

  it('y el caso que asusta se dice entero: ya no queda ninguna, en ningún sitio', () => {
    const t = laConfirmacionDeQuitar({
      pregunta: 'X', plato: 'Y', marca: 'Z', leQuedan: 0, sigueEnPlatos: 0,
    })
    expect(t).toContain('Ya no pregunta nada')
    expect(t).toContain('ya no está en ningún plato')
  })
})

describe('el vacío se explica, no se deja en blanco', () => {
  it('y dice dónde se arregla, distinto según de quién sea la carta', () => {
    expect(elVacioDelPlato(PLATO)).toContain('Preguntas de la carta')
    expect(elVacioDelPlato({ ...PLATO, cedida: true })).toContain('las preguntas se le ponen allí')
  })
})
