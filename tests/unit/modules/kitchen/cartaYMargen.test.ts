import { describe, it, expect } from 'vitest'
import {
  calculaFila, cifrasDeRentabilidad, construyeMatriz, esBebida, etiquetasDeFila,
  frasePorCuadrante, ganariaSubiendo, motivoSinCoste, parteLaFrase, precioSinIva,
} from '@/modules/kitchen/lib/cartaYMargen'
import { CARTA_DE_MERAKI } from './fixtures/cartaDeMeraki'

// B79 · lote 1. La regla con la que las tres pantallas cuentan lo mismo.
//
// LOS DATOS SON LA CARTA DE VERDAD (regla 31): los 33 productos activos de
// **Meraki Pita** el 06/09/2026, con su precio, su IVA, su `computed_cost` y las
// unidades vendidas en la ventana FIJA `[2026-06-08 00:00+02, 2026-09-06 00:00+02)`.
// Nada está inventado ni redondeado a mano: sale de la base tal cual.
//
// Y se comprueban contra las cifras que la maqueta APROBADA enseña, no contra lo
// que a mí me parezca. Si una prueba de aquí se pone roja, o cambió la carta o
// cambió la regla — y las dos cosas hay que enterarse.

// La carta está en `fixtures/cartaDeMeraki.ts`: la comparten esta prueba y la de
// la captura, para que las dos midan sobre la misma población.
const CARTA = CARTA_DE_MERAKI

const FILAS = CARTA.map(calculaFila)
const buscar = (n: string) => FILAS.find((f) => f.nombre.startsWith(n))!

describe('la fila de un plato', () => {
  it('Patatas Clásicas: 5,50 € de carta son 5,00 sin IVA, coste 0,88 y margen 4,12', () => {
    const p = buscar('Patatas')
    expect(p.precioNeto).toBeCloseTo(5.0, 6)
    expect(p.coste).toBeCloseTo(0.876096, 6)
    expect(p.margen).toBeCloseTo(4.123904, 6)
    expect(p.costeSobrePrecio).toBeCloseTo(17.52, 1)
  })

  it('el coste YA lleva el envase dentro: no se suma dos veces', () => {
    // computed_cost de Patatas = 0,876096, de los cuales 0,22408 son envase.
    // Si el envase se sumara aparte, el margen sería 3,90 € y la maqueta dice 4,12 €.
    expect(buscar('Patatas').margen).toBeGreaterThan(4.0)
  })

  it('sin coste, el margen es null — nunca cero', () => {
    const combo = buscar('Combo DÚO')
    expect(combo.coste).toBeNull()
    expect(combo.margen).toBeNull()
    expect(combo.margenDelPeriodo).toBeNull()
  })
})

describe('el motivo de «sin coste» distingue los dos casos reales', () => {
  it('un combo es un menú y se compone', () => {
    expect(motivoSinCoste('combo')).toEqual({
      motivo: 'Es un menú: se compone de otros platos y no tiene receta propia.',
      boton: 'Componer', destino: 'escandallo',
    })
  })
  it('un item sin receta se costea', () => {
    expect(motivoSinCoste('item').boton).toBe('Poner coste')
  })
  it('los 6 sin coste de Meraki son 4 menús y 2 sin receta', () => {
    const sin = FILAS.filter((f) => f.margen == null)
    expect(sin).toHaveLength(6)
    expect(sin.filter((f) => f.tipo === 'combo')).toHaveLength(4)
    expect(sin.filter((f) => f.tipo === 'item')).toHaveLength(2)
  })
})

describe('etiquetas de fila', () => {
  const caros = (objetivo: number | null) =>
    FILAS.filter((f) => etiquetasDeFila(f, objetivo).includes('caro de hacer'))
      .map((f) => f.nombre).sort()

  // §3.21.2 · HOY FOODINT NO TIENE OBJETIVO, así que hoy no hay ni una pastilla.
  // Es lo correcto y es lo que dice la otra pantalla: el Resumen lleva «Sin
  // objetivo de comida» con su botón. Las dos cuentan la misma historia.
  it('sin objetivo puesto no se llama «caro» a nadie: no hay vara con la que medir', () => {
    expect(caros(null)).toEqual([])
  })

  // Y el día que Julio lo ponga, aparecen solas. Con el 40 % que estaba escrito
  // a mano salen exactamente las mismas cuatro que antes: el cambio es de dónde
  // sale el número, no de la regla.
  it('con objetivo al 40 % son las dos tartas y las dos marquesas', () => {
    expect(caros(40)).toEqual([
      'Cheesecake de Nutella', 'Marquesa de Choco-Avellanas',
      'Marquesa de Dulce de Leche', 'Tarta 3 Leches',
    ])
  })

  // Una vara más exigente señala a más platos: es la prueba de que la pastilla
  // se mueve con el objetivo y no con un número escondido en el código.
  it('con objetivo al 25 % señala a más, y con el 60 % a ninguno', () => {
    expect(caros(25).length).toBeGreaterThan(caros(40).length)
    expect(caros(60)).toEqual([])
  })

  // El límite es ESTRICTO: un plato que cuesta exactamente el objetivo lo
  // cumple, no lo incumple. «Caro» es pasarse, no llegar.
  it('justo en el objetivo no es caro: se pasa o no se pasa', () => {
    const tarta = FILAS.find((f) => f.nombre === 'Tarta 3 Leches')!
    const suyo = tarta.costeSobrePrecio as number
    expect(etiquetasDeFila(tarta, suyo)).not.toContain('caro de hacer')
    expect(etiquetasDeFila(tarta, suyo - 0.01)).toContain('caro de hacer')
  })

  // Esta NO depende del objetivo: cero ventas es cero ventas.
  it('«sin ventas en el periodo» son las dos marquesas y las dos Daily Box', () => {
    const sinVentas = FILAS.filter((f) => etiquetasDeFila(f, null).includes('sin ventas en el periodo'))
    expect(sinVentas).toHaveLength(4)
    expect(sinVentas.every((f) => f.uds === 0)).toBe(true)
  })
})

describe('Rentabilidad · las cinco cifras de la maqueta', () => {
  const c = cifrasDeRentabilidad(FILAS, 90)

  it('33 platos en carta, 27 con coste y 6 sin', () => {
    expect(c.platosEnCarta).toBe(33)
    expect(c.conCoste).toBe(27)
    expect(c.sinCoste).toBe(6)
  })

  it('margen por unidad vendida: 8,04 € (ponderado, bebidas incluidas)', () => {
    expect(c.margenPorUnidadVendida).toBeCloseTo(8.04, 2)
  })

  it('margen del periodo: 15.790,99 € — la regla que NO redondea hasta el final', () => {
    expect(c.margenDelPeriodo).toBeCloseTo(15790.99, 2)
    // Las otras dos cifras que circularon, para que quede escrito por qué no son:
    const porLinea = FILAS.filter((f) => f.margen != null)
      .reduce((s, f) => s + Math.round((f.margen as number) * 100) / 100 * f.uds, 0)
    expect(porLinea).toBeCloseTo(15791.48, 2)
    expect(Math.round(c.margenDelPeriodo * 100) / 100).not.toBeCloseTo(15791.98, 2)
  })

  it('5.264 € al mes sobre 90 días', () => {
    expect(Math.round(c.margenPorMes as number)).toBe(5264)
  })

  it('mejor plato: Pita BOWL Ternera — 11,81 €, no los 11,82 de la maqueta', () => {
    // La maqueta dice 11,82 €. Sale de restar con el coste YA redondeado
    // (13,55 − 1,73), que es exactamente el método que Julio derogó al cerrar la
    // definición del margen: «sin redondear hasta el final».
    // 14,90 / 1,10 = 13,545454… − 1,733826 = 11,8116 → 11,81.
    // La regla manda sobre el dibujo: la maqueta tiene un céntimo que corregir,
    // no el código. Va dicho, no arreglado por mi cuenta.
    expect(c.mejorPlato?.nombre).toContain('Pita BOWL Ternera')
    expect(c.mejorPlato?.margen).toBeCloseTo(11.8116, 3)
    expect((c.mejorPlato as { margen: number }).margen.toFixed(2)).toBe('11.81')
  })

  it('89 unidades vendidas sin saber el coste, de 2.053', () => {
    expect(c.udsSinCoste).toBe(89)
    expect(c.udsTotales).toBe(2053)
  })
})

describe('Ingeniería · la matriz', () => {
  const m = construyeMatriz(FILAS)

  it('las bebidas se reconocen por la categoría de la CARTA, no por la ficha', () => {
    expect(esBebida('Bebidas')).toBe(true)
    expect(esBebida('bebidas')).toBe(true)
    expect(esBebida('EL ARTE DEL PICOTEO (Entrantes)')).toBe(false)
    expect(esBebida(null)).toBe(false)
    expect(FILAS.filter((f) => esBebida(f.categoria))).toHaveLength(6)
  })

  it('entran 19 platos: con coste, con ventas y sin bebidas', () => {
    expect(m.platos).toHaveLength(19)
  })

  it('la media simple es 7,98 € y 94 unidades', () => {
    expect(m.mediaSimpleDeMargen).toBeCloseTo(7.98, 2)
    expect(Math.round(m.mediaSimpleDeUnidades as number)).toBe(94)
  })

  it('los cuadrantes salen 4 / 2 / 5 / 8', () => {
    expect(m.conteo).toEqual({ estrella: 4, caballo: 2, joya: 5, lastre: 8 })
  })

  it('con las bebidas dentro la media caería a 6,48 € — por eso van aparte', () => {
    const conBebidas = FILAS.filter((f) => f.margen != null && f.uds > 0)
    const media = conBebidas.reduce((s, f) => s + (f.margen as number), 0) / conBebidas.length
    expect(conBebidas).toHaveLength(25)
    expect(media).toBeCloseTo(6.48, 2)
    // Y la Pita de Ternera Gyros (7,72 €) pasaría de estar por encima a por debajo.
    expect(buscar('Kebab de Ternera').margen).toBeGreaterThan(media)
    expect(buscar('Kebab de Ternera').margen).toBeLessThan(m.mediaSimpleDeMargen as number)
  })

  it('Patatas es caballo de batalla: 149 uds y 4,12 €', () => {
    expect(m.cuadranteDe.get('19')).toBe('caballo')
  })

  it('The Mixed Master es estrella: 433 uds y 10,38 €', () => {
    expect(m.cuadranteDe.get('32')).toBe('estrella')
  })
})

describe('las frases de cada fila', () => {
  const m = construyeMatriz(FILAS)
  const media = m.mediaSimpleDeMargen as number

  it('caballo: la frase de la maqueta, con los 68 € del IVA bien puestos', () => {
    const r = frasePorCuadrante(buscar('Patatas'), 'caballo', media)
    expect(r.frase).toBe('Se vende mucho (149) pero deja 4,12 €. Con 0,50 € más de precio habrías ganado 68 € más en el periodo.')
    expect(r.botones.map((b) => b.texto)).toEqual(['Subir precio', 'Ver receta'])
  })

  it('subir 0,50 € con IVA son 0,4545 € netos: 68 €, no 74', () => {
    expect(Math.round(ganariaSubiendo(149, 0.5, 10))).toBe(68)
    expect(Math.round(ganariaSubiendo(142, 0.5, 10))).toBe(65)
  })

  it('joya muy por encima de la media: «de lo mejor de la carta»', () => {
    expect(frasePorCuadrante(buscar('Pita BOWL Pollo'), 'joya', media).frase)
      .toContain('de lo mejor de la carta')
  })

  it('joya normal: «por encima de la media»', () => {
    expect(frasePorCuadrante(buscar('The Green Falafel'), 'joya', media).frase)
      .toBe('Deja 8,94 €, por encima de la media, y se vende 48 veces. Que se vea más en la carta.')
  })

  it('lastre caro de hacer: se ofrece subir precio, no sólo quitar', () => {
    const r = frasePorCuadrante(buscar('Tarta 3 Leches'), 'lastre', media)
    expect(r.frase).toBe('Cuesta el 44 % del precio y deja 4,02 €. O sube el precio o cambia la receta.')
    expect(r.botones.map((b) => b.texto)).toEqual(['Subir precio', 'Quitar de la carta'])
  })

  it('NINGÚN botón sin destino: «Mantener» no existe y «Quitar» lleva a «En carta»', () => {
    const r = frasePorCuadrante(buscar('Rollitos'), 'lastre', media)
    expect(r.frase).toBe('Deja 4,03 €, por debajo de la media, y se vende 85 veces. Si se queda, que sea por algo que no sea el margen.')
    expect(r.botones.map((b) => b.texto)).toEqual(['Quitar de la carta', 'Abrir'])
    expect(r.botones[0].destino).toBe('en_carta')
    // La regla de la casa del 06/09: no decidir es el estado por defecto.
    for (const c of ['estrella', 'caballo', 'joya', 'lastre'] as const) {
      const botones = frasePorCuadrante(buscar('Rollitos'), c, media).botones
      expect(botones.map((b) => b.texto)).not.toContain('Mantener')
      expect(botones.every((b) => ['escandallo', 'en_carta', 'economia'].includes(b.destino))).toBe(true)
    }
  })

  // La negrita de la maqueta: el número por el que se decide, y NADA más.
  it('la negrita marca el número que decide, y sólo donde hay uno', () => {
    const caballo = frasePorCuadrante(buscar('Patatas'), 'caballo', media)
    expect(caballo.destacado).toBe('68 € más')
    expect(parteLaFrase(caballo.frase, caballo.destacado)).toEqual([
      'Se vende mucho (149) pero deja 4,12 €. Con 0,50 € más de precio habrías ganado ',
      '68 € más', ' en el periodo.',
    ])

    // Una joya de lo mejor de la carta destaca su margen; una joya normal no
    // destaca nada, porque si todas llevaran negrita la negrita no diría nada.
    expect(frasePorCuadrante(buscar('Pita BOWL Pollo'), 'joya', media).destacado).toBe('11,69 €')
    expect(frasePorCuadrante(buscar('The Green Falafel'), 'joya', media).destacado).toBeUndefined()
    expect(frasePorCuadrante(buscar('Rollitos'), 'lastre', media).destacado).toBeUndefined()
    expect(frasePorCuadrante(buscar('The Mixed Master'), 'estrella', media).destacado).toBeUndefined()
  })

  // Sin destacado —o con uno que no está— se devuelve la frase ENTERA en el
  // primer trozo: la pantalla la pinta igual y no se pierde ni una palabra.
  it('sin negrita, la frase sale entera y no se come nada', () => {
    expect(parteLaFrase('Se vende y deja.')).toEqual(['Se vende y deja.', '', ''])
    expect(parteLaFrase('Se vende y deja.', 'no está')).toEqual(['Se vende y deja.', '', ''])
  })

  // Y para todas las filas de verdad: los tres trozos vuelven a ser la frase.
  it('partir y volver a juntar da exactamente la frase, en las 19', () => {
    for (const f of m.platos) {
      const c = m.cuadranteDe.get(f.id)!
      const r = frasePorCuadrante(f, c, media)
      expect(parteLaFrase(r.frase, r.destacado).join('')).toBe(r.frase)
    }
  })

  it('estrella: no se toca', () => {
    expect(frasePorCuadrante(buscar('The Mixed Master'), 'estrella', media).frase)
      .toBe('Se vende y deja. Vigila que el coste no suba.')
  })
})

describe('precioSinIva', () => {
  it('14,90 € al 10 % son 13,55 €', () => {
    expect(precioSinIva(14.9, 10)).toBeCloseTo(13.5454, 3)
  })
  it('sin IVA declarado, el precio no se toca', () => {
    expect(precioSinIva(10, null)).toBe(10)
  })
})


// ── B83 ─────────────────────────────────────────────────────────────────────
// «Mejor plato» salía en Bendito Burrito como «Burrito Colosal · sin ventas en el
// periodo». Como respuesta a «¿qué platos te dejan más margen?» no vale: un plato
// que no se ha vendido no te ha dejado nada.
describe('el mejor plato se elige entre los VENDIDOS', () => {
  const P2 = (o: Partial<ProductoDeCarta>): ProductoDeCarta => ({
    id: 'x', nombre: 'x', tipo: 'item', categoria: 'PITAS', precio: 10, ivaPct: 10,
    coste: 2, uds: 10, ...o,
  })

  it('un plato de margen enorme y CERO ventas no puede ser el mejor', () => {
    const filas = [
      P2({ id: 'caro',    nombre: 'Burrito Colosal', precio: 40, coste: 2, uds: 0 }),
      P2({ id: 'vendido', nombre: 'Pita Mixta',      precio: 14, coste: 2, uds: 300 }),
    ].map((p) => calculaFila(p))
    const c = cifrasDeRentabilidad(filas, 90)
    expect(c.mejorPlato?.nombre).toBe('Pita Mixta')
  })

  it('si NADA se ha vendido, no hay mejor plato: null, no un invento', () => {
    const filas = [P2({ nombre: 'Burrito Colosal', precio: 40, coste: 2, uds: 0 })].map((p) => calculaFila(p))
    expect(cifrasDeRentabilidad(filas, 90).mejorPlato).toBeNull()
  })

  it('entre dos vendidos gana el de más margen por unidad, no el que más vende', () => {
    const filas = [
      P2({ id: 'a', nombre: 'Mucho volumen', precio: 6,  coste: 1, uds: 900 }),
      P2({ id: 'b', nombre: 'Mucho margen',  precio: 20, coste: 2, uds: 5 }),
    ].map((p) => calculaFila(p))
    expect(cifrasDeRentabilidad(filas, 90).mejorPlato?.nombre).toBe('Mucho margen')
  })
})
