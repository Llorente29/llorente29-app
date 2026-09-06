// B78. Las guardas de la tabla de Informes.
//
// QUE PASO. La primera vez que Julio abrio la pantalla, la tabla pinto DOS
// filas que no eran de su consulta. Una se reprodujo al centimo contra la base:
// `{canal: "Uber"}` con 96 pedidos y 2.017,41 e era la respuesta de OTRA
// pregunta -- eje canal, Alcala, propias, semana en curso -- pintada debajo de
// un informe de `marca x propiedad`. Sus dims no traian ni marca ni propiedad.
//
// Y no se veia: el pie sumaba 1.079,94 e, que es la suma de las filas BUENAS,
// asi que la tabla enseñaba una lista que su propio pie contradecia. Solo se
// noto porque Julio sumo a mano.
//
// Estas dos guardas cierran el sintoma sin depender de saber como llego ahi:
// una fila que no trae los ejes preguntados no se pinta, y si las filas no
// suman el total, la tabla lo dice.

import { describe, it, expect } from 'vitest'
import { filtraPorEjes, cuadra } from '../../../../src/modules/ventas/services/reportSalesService'

const fila = (dims: Record<string, string>, neto: number, pedidos: number) =>
  ({ dims, neto, pedidos })

// Las 7 filas reales de la captura, medidas contra la base el 06/09.
const MARCAS = [
  fila({ marca: 'Meraki Pita', propiedad: 'propia' }, 473.32, 21),
  fila({ marca: 'Milanesa House', propiedad: 'propia' }, 228.19, 11),
  fila({ marca: "Mila's Sandwiches", propiedad: 'propia' }, 133.97, 6),
  fila({ marca: 'Smash Brothers Burgers', propiedad: 'propia' }, 96.47, 5),
  fila({ marca: 'Scandal Burgers', propiedad: 'propia' }, 80.20, 4),
  fila({ marca: 'Lovers Burgers', propiedad: 'propia' }, 46.09, 3),
  fila({ marca: 'Bendito Burrito', propiedad: 'propia' }, 21.70, 1),
]
// La 8a: estaba en el espejo y ya no vende. Sale a cero y TIENE que seguir saliendo.
const URBAN = fila({ marca: 'The Urban Kebab', propiedad: 'propia' }, 0, 0)
// Las dos intrusas, con sus cifras reales.
const UBER = fila({ canal: 'Uber' }, 2017.41, 96)
const ALCALA = fila({ local: 'Foodint Alcalá' }, 890.25, 44)

describe('filtraPorEjes — la fila que no es de esta pregunta no se pinta', () => {
  const EJES = ['marca', 'propiedad'] as const

  it('el caso de Julio: entran las 8 de marca y se quedan fuera las 2 intrusas', () => {
    const r = filtraPorEjes([...MARCAS, URBAN, UBER, ALCALA], [...EJES])
    expect(r.visibles).toHaveLength(8)
    expect(r.descartadas).toHaveLength(2)
    expect(r.descartadas.map(d => JSON.stringify(d.dims))).toEqual([
      '{"canal":"Uber"}', '{"local":"Foodint Alcalá"}',
    ])
  })

  it('y lo que queda suma 1.079,94 e y 51 pedidos, igual que el pie', () => {
    const { visibles } = filtraPorEjes([...MARCAS, URBAN, UBER, ALCALA], [...EJES])
    const neto = Math.round(visibles.reduce((a, f) => a + f.neto, 0) * 100) / 100
    expect(neto).toBe(1079.94)
    expect(visibles.reduce((a, f) => a + f.pedidos, 0)).toBe(51)
  })

  // LA FILA A CERO NO SE PIERDE. Es lo que el encargo protege explicitamente.
  it('la marca que vendia y ya no vende SIGUE pasando la guarda', () => {
    const { visibles } = filtraPorEjes([URBAN], [...EJES])
    expect(visibles).toHaveLength(1)
  })

  it('una fila a la que le falta UNO de los dos ejes tampoco pasa', () => {
    const { visibles, descartadas } = filtraPorEjes([fila({ marca: 'X' }, 10, 1)], [...EJES])
    expect(visibles).toHaveLength(0)
    expect(descartadas).toHaveLength(1)
  })

  it('una fila con un eje DE MAS tampoco pasa: tampoco es de esta pregunta', () => {
    const conSobrante = fila({ marca: 'X', propiedad: 'propia', canal: 'Uber' }, 10, 1)
    expect(filtraPorEjes([conSobrante], [...EJES]).descartadas).toHaveLength(1)
  })

  it('con un solo eje, pasan las de ese eje y solo esas', () => {
    const r = filtraPorEjes([...MARCAS, UBER], ['canal'])
    expect(r.visibles).toEqual([UBER])
    expect(r.descartadas).toHaveLength(7)
  })

  it('sin ejes (el total) solo pasa la fila sin dims', () => {
    const r = filtraPorEjes([fila({}, 100, 5), UBER], [])
    expect(r.visibles).toHaveLength(1)
    expect(r.descartadas).toEqual([UBER])
  })

  it('una fila sin dims no revienta la guarda', () => {
    expect(() => filtraPorEjes([{ dims: undefined as unknown as Record<string, string> }], ['marca']))
      .not.toThrow()
  })
})

describe('cuadra — si las filas no suman el total, se dice', () => {
  const total = { neto: 1079.94, pedidos: 51 }

  it('las 8 filas buenas cuadran con el pie', () => {
    expect(cuadra([...MARCAS, URBAN], total).ok).toBe(true)
  })

  // AL REVES: forzando el descuadre, tiene que detectarlo.
  it('si falta una fila, NO cuadra y devuelve las dos cifras', () => {
    const r = cuadra(MARCAS.slice(0, 6), total)
    expect(r.ok).toBe(false)
    expect(r.sumaNeto).toBe(1058.24)
    expect(r.sumaPedidos).toBe(50)
  })

  it('si sobra una fila intrusa, tampoco cuadra', () => {
    expect(cuadra([...MARCAS, URBAN, UBER], total).ok).toBe(false)
  })

  it('un descuadre de solo pedidos tambien se caza', () => {
    expect(cuadra([...MARCAS, URBAN], { neto: 1079.94, pedidos: 52 }).ok).toBe(false)
  })

  it('un centimo de redondeo NO es un descuadre', () => {
    expect(cuadra([...MARCAS, URBAN], { neto: 1079.95, pedidos: 51 }).ok).toBe(true)
  })

  it('dos centimos si lo son', () => {
    expect(cuadra([...MARCAS, URBAN], { neto: 1079.96, pedidos: 51 }).ok).toBe(false)
  })
})
