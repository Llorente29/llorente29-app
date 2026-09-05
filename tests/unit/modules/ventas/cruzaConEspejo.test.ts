// El cruce de cada fila con la suya del espejo.
//
// POR QUE ESTA PRUEBA EXISTE. Un `join` normal hace DESAPARECER la fila que
// existia en el espejo y ya no existe: un local o una marca que vendia y ha
// dejado de vender es la fila mas importante del informe, y con un join
// interior el informe la enseña como si nunca hubiera existido. Regla 7 -- el
// eje ordena y etiqueta, no decide la existencia.
//
// Las cifras son las reales de la semana 24->30/08 contra 17->23/08.

import { describe, it, expect } from 'vitest'
import {
  cruzaConEspejo, claveDeFila, type FilaInformeVentas,
} from '../../../../src/modules/ventas/services/reportSalesService'

/** Redondeo a `d` decimales sin pasar por texto. */
const red = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

const fila = (
  dims: Record<string, string>, pedidos: number, bruto: number, descuentos: number,
): FilaInformeVentas => ({
  dims, pedidos, bruto, descuentos, neto: red(bruto - descuentos),
  ticket_medio: red((bruto - descuentos) / pedidos),
  coste: null, pedidos_costeados: 0, neto_costeado: null,
  pedidos_sin_hueco: 0, neto_sin_hueco: null, pedidos_mod_sin_impacto: 0,
})

const ALCALA      = fila({ local: 'Foodint Alcalá' }, 332, 9525.60, 1973.00)
const CARABANCHEL = fila({ local: 'Foodint Carabanchel' }, 243, 6156.24, 473.91)
const ALCALA_E    = fila({ local: 'Foodint Alcalá' }, 438, 11193.79, 1479.17)
const CARABAN_E   = fila({ local: 'Foodint Carabanchel' }, 258, 6507.69, 559.52)

describe('cruzaConEspejo', () => {
  it('casa cada local con el suyo y da el delta real de la semana', () => {
    const r = cruzaConEspejo([ALCALA, CARABANCHEL], [ALCALA_E, CARABAN_E])
    const alcala = r.find(x => x.dims.local === 'Foodint Alcalá')!
    expect(alcala.neto).toBe(7552.60)
    expect(alcala.espejo!.neto).toBe(9714.62)
    expect(red(alcala.deltaNeto!)).toBe(-2162.02)
    expect(red(alcala.deltaNetoPct!, 1)).toBe(-22.3)
    expect(alcala.deltaPedidos).toBe(-106)
  })

  it('ordena por neto de la ventana actual', () => {
    const r = cruzaConEspejo([CARABANCHEL, ALCALA], [ALCALA_E, CARABAN_E])
    expect(r[0].dims.local).toBe('Foodint Alcalá')
  })

  // LA FILA QUE DESAPARECE. Un join interior la borraria.
  it('una marca que vendia y ha dejado de vender SIGUE saliendo, a cero', () => {
    const cerrada = fila({ marca: 'Marca Cerrada' }, 40, 900, 0)
    const r = cruzaConEspejo([fila({ marca: 'Viva' }, 10, 200, 0)], [cerrada])
    const desaparecida = r.find(x => x.dims.marca === 'Marca Cerrada')
    expect(desaparecida).toBeDefined()
    expect(desaparecida!.pedidos).toBe(0)
    expect(desaparecida!.neto).toBe(0)
    expect(desaparecida!.espejo!.neto).toBe(900)
    expect(red(desaparecida!.deltaNetoPct!, 1)).toBe(-100)
  })

  // De 0 a 100 € no es «+infinito %»: es que no habia con que comparar.
  it('sin base no inventa un porcentaje, devuelve null', () => {
    const nueva = fila({ marca: 'Nueva' }, 5, 100, 0)
    const espejoCero = { ...fila({ marca: 'Nueva' }, 1, 0, 0), pedidos: 0, ticket_medio: 0 }
    const r = cruzaConEspejo([nueva], [espejoCero])
    expect(r[0].deltaNeto).toBe(100)
    expect(r[0].deltaNetoPct).toBeNull()
  })

  it('sin espejo en absoluto, los tres deltas son null y no cero', () => {
    const r = cruzaConEspejo([ALCALA], [])
    expect(r[0].espejo).toBeNull()
    expect(r[0].deltaNeto).toBeNull()
    expect(r[0].deltaNetoPct).toBeNull()
    expect(r[0].deltaPedidos).toBeNull()
  })

  it('la clave no depende del orden de los ejes', () => {
    expect(claveDeFila({ local: 'A', marca: 'B' })).toBe(claveDeFila({ marca: 'B', local: 'A' }))
  })

  it('con dos ejes casa por la combinacion, no por uno solo', () => {
    const a = fila({ local: 'Alcalá', marca: 'X' }, 10, 100, 0)
    const b = fila({ local: 'Alcalá', marca: 'Y' }, 10, 300, 0)
    const r = cruzaConEspejo([a], [b])
    expect(r).toHaveLength(2)
    expect(r.find(x => x.dims.marca === 'X')!.espejo).toBeNull()
    expect(r.find(x => x.dims.marca === 'Y')!.pedidos).toBe(0)
  })
})
