import { describe, it, expect } from 'vitest'
import {
  calculaFila, cifrasDeRentabilidad, construyeMatriz, esBebida, etiquetasDeFila,
  frasePorCuadrante, ganariaSubiendo, motivoSinCoste, precioSinIva,
  type ProductoDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'

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

const CARTA: ProductoDeCarta[] = [
  { id: '1',  nombre: 'Agua Mineral 50 CL', tipo: 'item', categoria: 'Bebidas', precio: 1.9, ivaPct: 10, coste: 0.35, uds: 21 },
  { id: '2',  nombre: 'Cheesecake de Nutella', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 7.9, ivaPct: 10, coste: 3.158, uds: 21 },
  { id: '3',  nombre: 'Coca-Cola Original Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.5909375, uds: 35 },
  { id: '4',  nombre: 'Coca-Cola Zero Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.7675, uds: 44 },
  { id: '5',  nombre: 'Combo DÚO Mediterráneo (Para 2)', tipo: 'combo', categoria: 'EXPERIENCIAS MERAKÍ (Combos)', precio: 34.9, ivaPct: 10, coste: null, uds: 23 },
  { id: '6',  nombre: 'Crispy Falafel & Greek Dip (3 uds)', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 6.5, ivaPct: 10, coste: 1.12224, uds: 142 },
  { id: '7',  nombre: 'Daily Box Esencial', tipo: 'combo', categoria: 'Menús Merakí: Daily Boxes (L-V)', precio: 12.9, ivaPct: 10, coste: null, uds: 0 },
  { id: '8',  nombre: 'Daily Box Premium', tipo: 'combo', categoria: 'Menús Merakí: Daily Boxes (L-V)', precio: 16.9, ivaPct: 10, coste: null, uds: 0 },
  { id: '9',  nombre: 'Fanta Limón Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.6216666666666667, uds: 8 },
  { id: '10', nombre: 'Fanta Naranja Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.495, uds: 16 },
  { id: '11', nombre: 'Kebab de Falafel', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 9.9, ivaPct: 10, coste: 1.774405957397009, uds: 23 },
  { id: '12', nombre: 'Kebab de Pollo Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 10.5, ivaPct: 10, coste: 2.2905423210333726, uds: 18 },
  { id: '13', nombre: 'Kebab de Ternera Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 11.1, ivaPct: 10, coste: 2.370335518597933, uds: 22 },
  { id: '14', nombre: 'Kebab Mixto: Pollo y Ternera', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 10.9, ivaPct: 10, coste: 2.332153700416115, uds: 62 },
  { id: '15', nombre: 'MAHOU 5 ESTRELLAS', tipo: 'item', categoria: 'Bebidas', precio: 2.8, ivaPct: 10, coste: 0.5092857142857142, uds: 48 },
  { id: '16', nombre: 'Marquesa de Choco-Avellanas', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 6.9, ivaPct: 10, coste: 2.59875, uds: 0 },
  { id: '17', nombre: 'Marquesa de Dulce de Leche', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 6.9, ivaPct: 10, coste: 2.607083333333333, uds: 0 },
  { id: '18', nombre: 'Menú Individual "Crea tu Experiencia"', tipo: 'combo', categoria: 'EXPERIENCIAS MERAKÍ (Combos)', precio: 19.9, ivaPct: 10, coste: null, uds: 50 },
  { id: '19', nombre: 'Patatas Clásicas Meraki', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 5.5, ivaPct: 10, coste: 0.876096, uds: 149 },
  { id: '20', nombre: 'Pita BOWL Falafel: El Delirio Veggie', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.7, ivaPct: 10, coste: null, uds: 10 },
  { id: '21', nombre: 'Pita BOWL Mixto: La Experiencia Completa', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.8, ivaPct: 10, coste: 2.036168715359134, uds: 170 },
  { id: '22', nombre: 'Pita BOWL Pollo: El Clásico Jugoso', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.7, ivaPct: 10, coste: 1.6701894224298413, uds: 64 },
  { id: '23', nombre: 'Pita BOWL Ternera: Sabor Tradicional', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.9, ivaPct: 10, coste: 1.7338257860662047, uds: 15 },
  { id: '24', nombre: 'Plato Mixto Gyros: Carne y Patatas', tipo: 'item', categoria: 'TRIBUTO AL GYROS (Platos)', precio: 12.9, ivaPct: 10, coste: 1.7099373737373738, uds: 31 },
  { id: '25', nombre: 'Plato Pollo Gyros: Pollo y Patatas', tipo: 'item', categoria: 'TRIBUTO AL GYROS (Platos)', precio: 11.9, ivaPct: 10, coste: 1.678119191919192, uds: 15 },
  { id: '26', nombre: 'Plato Ternera Gyros: Carne y Patatas', tipo: 'item', categoria: 'TRIBUTO AL GYROS (Platos)', precio: 13.1, ivaPct: 10, coste: null, uds: 6 },
  { id: '27', nombre: 'Rollitos de Queso Feta (3 unidades)', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 6.3, ivaPct: 10, coste: 1.6940800000000003, uds: 85 },
  { id: '28', nombre: 'Tarta 3 Leches', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 7.9, ivaPct: 10, coste: 3.158, uds: 27 },
  { id: '29', nombre: 'The Beef Legend: Pita de Ternera Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 13.9, ivaPct: 10, coste: 2.2920535638439827, uds: 203 },
  { id: '30', nombre: 'The Golden Chicken: Pita de Pollo Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 12.9, ivaPct: 10, coste: 2.224987639006695, uds: 200 },
  { id: '31', nombre: 'The Green Falafel: Pita Artesana', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 11.9, ivaPct: 10, coste: 1.8795535638439826, uds: 48 },
  { id: '32', nombre: 'The Mixed Master: Pita Mixta Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 13.9, ivaPct: 10, coste: 2.2602353820258005, uds: 433 },
  { id: '33', nombre: 'The Spanakopita Twist (Greek Spiral)', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 9.9, ivaPct: 10, coste: 1.42062, uds: 64 },
]

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
  it('«caro de hacer» a partir del 40 % — las dos tartas y las dos marquesas', () => {
    const caros = FILAS.filter((f) => etiquetasDeFila(f).includes('caro de hacer')).map((f) => f.nombre)
    expect(caros.sort()).toEqual([
      'Cheesecake de Nutella', 'Marquesa de Choco-Avellanas',
      'Marquesa de Dulce de Leche', 'Tarta 3 Leches',
    ])
  })
  it('«sin ventas en el periodo» son las dos marquesas y las dos Daily Box', () => {
    const sinVentas = FILAS.filter((f) => etiquetasDeFila(f).includes('sin ventas en el periodo'))
    expect(sinVentas).toHaveLength(4)
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
    expect(r.botones.map((b) => b.texto)).toEqual(['Quitar de la carta'])
    expect(r.botones[0].destino).toBe('en_carta')
    // La regla de la casa del 06/09: no decidir es el estado por defecto.
    for (const c of ['estrella', 'caballo', 'joya', 'lastre'] as const) {
      const botones = frasePorCuadrante(buscar('Rollitos'), c, media).botones
      expect(botones.map((b) => b.texto)).not.toContain('Mantener')
      expect(botones.every((b) => ['escandallo', 'en_carta', 'economia'].includes(b.destino))).toBe(true)
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
