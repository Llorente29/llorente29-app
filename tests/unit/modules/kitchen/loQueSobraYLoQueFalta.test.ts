import { describe, it, expect } from 'vitest'
import {
  tituloDeLoQueFalta, tituloDeLoQueSobra, porDondeEmpezarLoQueFalta,
  elDesgloseDeLoQueSobra, rotuloDeLasDecididasHacePoco, ROTULO_DE_LAS_CEDIDAS,
  elDiaQueEsteTodoHecho, loQueLlevaSinVenderse, loDeLosPedidosAnulados,
  cuandoSeDecidio, loQuePasaSiRetiras, elAvisoDeQueSeVende,
  porQueNoSePuedeRetirar, textoDelBotonDeRetirar, laConfirmacionDeRetirar,
  laLineaDeDondeEsta, cuantasDeAhiSiguenSinDecidir, laLineaDeCuantoSePide,
  type UnaQueNadiePide, type UnNombreSinDecidir, type DondeVive,
} from '@/modules/kitchen/lib/loQueSobraYLoQueFalta'

// LOS DATOS SON REALES (regla 31). Salen de `kitchen_para_trabajar` sobre
// Foodint el 13/09 a las 17:4x: 97 sin decidir en 53 nombres; 123 sin venta en
// 30 días, que se reparten en 52 candidatas + 41 decididas hace poco + 30
// cedidas. Ni un nombre inventado.

const FALTAN: UnNombreSinDecidir[] = [
  { nombre: 'Salsa Harissa (Picante)', cuantas: 7, alcanzables: 7,
    marcas: ['Meraki Pita', 'The Urban Kebab'], entrarPor: 'fd265738' },
  { nombre: 'Salsa Yogur', cuantas: 6, alcanzables: 6,
    marcas: ['Meraki Pita', 'The Urban Kebab'], entrarPor: '5d7d6d2b' },
  { nombre: 'Salsa Tzatziki (Recomendada)', cuantas: 5, alcanzables: 5,
    marcas: ['Meraki Pita', 'The Urban Kebab'], entrarPor: 'aece3725' },
]

const SOBRA = {
  respuestas: 123, candidatas: 52, alcanzables: 93,
  decididasHacePoco: 41, cedidas: 30, preguntas: 36, conPedidoAnulado: 7,
  filas: [] as UnaQueNadiePide[], dias: 30,
}

const fila = (x: Partial<UnaQueNadiePide> = {}): UnaQueNadiePide => ({
  id: 'o1', nombre: 'Salsa Chipotle', pregunta: 'Elige la salsa de tu Burrito/Bowl.',
  preguntaId: 'g1', marca: 'Bendito Burrito', cedida: false, precio: 0,
  pedidosAnulados: 0, ultimaVenta: null, diasSinVenderse: null,
  decidida: false, decididaAt: null, decididaReciente: false, ...x,
})

describe('los dos montones · sus rótulos', () => {
  it('dicen el número, y a cero dicen que está hecho', () => {
    expect(tituloDeLoQueFalta(97)).toBe('Le falta decir qué lleva · 97')
    expect(tituloDeLoQueFalta(0)).toBe('Todas dicen qué llevan')
    expect(tituloDeLoQueSobra(52)).toBe('No lo pide nadie · 52')
    expect(tituloDeLoQueSobra(0)).toBe('Todo lo de la carta se pide')
  })

  it('«por dónde empezar» dice lo que RINDE, no lo primero de la lista', () => {
    // El montón va por cuántas veces se repite el nombre: resolver «Salsa
    // Harissa» resuelve 7 de una vez, y decirlo es lo que hace que alguien
    // empiece por ahí.
    const f = porDondeEmpezarLoQueFalta(FALTAN)
    expect(f).toContain('Salsa Harissa (Picante)')
    expect(f).toContain('7 preguntas')
    expect(f).toContain('de una vez')
  })

  it('el desglose dice los tres escalones: 52 de 123 es lo que hay que limpiar', () => {
    const d = elDesgloseDeLoQueSobra(SOBRA)
    expect(d).toContain('30 días')
    expect(d).toContain('41 se decidieron hace poco')
    expect(d).toContain('30 son de marcas que manda Last')
  })

  it('🔴 y el rótulo del grupo que baja lleva su número, no «algunas»', () => {
    expect(rotuloDeLasDecididasHacePoco(41, 30)).toContain('41')
    expect(rotuloDeLasDecididasHacePoco(41, 30)).toContain('30 días')
    expect(ROTULO_DE_LAS_CEDIDAS).toContain('se ven y no se tocan')
  })

  it('la frase del día que esté todo hecho solo sale cuando lo está', () => {
    expect(elDiaQueEsteTodoHecho(97, 52)).toBeNull()
    expect(elDiaQueEsteTodoHecho(0, 52)).toBeNull()
    expect(elDiaQueEsteTodoHecho(0, 0)).toContain('Las dos listas a cero')
  })
})

describe('🔴 una fila que sobra · el 0 nunca va solo', () => {
  it('nunca vendida NO es «hace 0 días»: es otra cosa y se dice distinto', () => {
    expect(loQueLlevaSinVenderse(fila({ diasSinVenderse: null }))).toBe('Nunca se ha vendido')
    expect(loQueLlevaSinVenderse(fila({ diasSinVenderse: 0 }))).toBe('La última vez, hoy')
    expect(loQueLlevaSinVenderse(fila({ diasSinVenderse: 1 }))).toBe('La última vez, ayer')
    expect(loQueLlevaSinVenderse(fila({ diasSinVenderse: 45 }))).toContain('hace 45 días')
    expect(loQueLlevaSinVenderse(fila({ diasSinVenderse: 120 }))).toContain('hace 4 meses')
  })

  it('los pedidos anulados se dicen: es la diferencia entre 86 y 93', () => {
    // Las siete de Bendito Burrito cuya única actividad en 30 días es UNA
    // comanda de HubRise anulada el 29/08. Sin esta línea, quien mire concluye
    // que nadie las pidió jamás, y no es verdad.
    expect(loDeLosPedidosAnulados(fila({ pedidosAnulados: 0 }))).toBeNull()
    const uno = loDeLosPedidosAnulados(fila({ pedidosAnulados: 1 }))
    expect(uno).toContain('se anuló')
    expect(uno).toContain('no cuenta como venta')
  })

  it('cuándo se decidió, en palabras y no en ISO', () => {
    const ahora = new Date('2026-09-13T20:00:00Z')
    expect(cuandoSeDecidio(fila({ decidida: false }), ahora)).toBeNull()
    expect(cuandoSeDecidio(
      fila({ decidida: true, decididaAt: '2026-09-13T15:14:35Z' }), ahora,
    )).toBe('Alguien dijo qué lleva hace 5 horas')
    expect(cuandoSeDecidio(
      fila({ decidida: true, decididaAt: '2026-09-11T20:00:00Z' }), ahora,
    )).toBe('Alguien dijo qué lleva hace 2 días')
  })
})

describe('🔴 retirar · la verdad delante, no un «¿seguro?»', () => {
  const x = {
    nombre: 'Salsa Harissa (Picante)', preguntas: 7, platos: 34,
    ventas: 0, dias: 30, cedida: false, marca: 'Meraki Pita',
  }

  it('dice los números ANTES, y qué pasa exactamente', () => {
    const t = loQuePasaSiRetiras(x)
    expect(t).toContain('7 preguntas')
    expect(t).toContain('34 platos')
    expect(t).toContain('No se ha pedido ni una vez en 30 días')
    expect(t).toContain('Glovo, Uber y la web')
    expect(t).toContain('próxima publicación')
  })

  it('si SE VENDE, se dice más fuerte — pero no se impide', () => {
    expect(elAvisoDeQueSeVende(x)).toBeNull()
    const aviso = elAvisoDeQueSeVende({ ...x, ventas: 12 })
    expect(aviso).toContain('12 veces')
    expect(aviso).toContain('se lo quita a quien lo pida')
  })

  it('en cedidas no se retira, y se dice con las palabras de la casa', () => {
    expect(porQueNoSePuedeRetirar({ cedida: false, marca: 'Meraki Pita' })).toBeNull()
    const no = porQueNoSePuedeRetirar({ cedida: true, marca: 'Lobbers' })
    expect(no).toContain('Lobbers')
    expect(no).toContain('03:20')
    expect(no).toContain('Se cambia en Last')
  })

  it('el botón dice a cuántas va, y la confirmación lleva contenido', () => {
    expect(textoDelBotonDeRetirar(1)).toBe('Retirar de la carta')
    expect(textoDelBotonDeRetirar(7)).toBe('Retirar las 7 de la carta')

    const c = laConfirmacionDeRetirar({
      respuestas: 1, preguntas: 0, pregunta: null, encendido: false })
    expect(c).toContain('1 respuesta retirada')
    expect(c).toContain('quién y cuándo')
    expect(c).toContain('volver a encender')

    const entera = laConfirmacionDeRetirar({
      respuestas: 4, preguntas: 1, pregunta: '¿Quieres pepinillos?', encendido: false })
    expect(entera).toContain('«¿Quieres pepinillos?» retirada entera, con 4 respuestas')

    const vuelve = laConfirmacionDeRetirar({
      respuestas: 4, preguntas: 1, pregunta: '¿Quieres pepinillos?', encendido: true })
    expect(vuelve).toContain('vuelve a la carta')
  })
})

describe('la ficha · cada número es un sitio al que ir', () => {
  const sitios: DondeVive[] = [
    { id: 'a', pregunta: 'Escoge una salsa para tu pita', preguntaId: 'g1',
      marca: 'Meraki Pita', cedida: false, activa: true, esEsta: true,
      platos: 7, decidida: false },
    { id: 'b', pregunta: 'Escoge una salsa para tu bowl/plato', preguntaId: 'g2',
      marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false,
      platos: 5, decidida: false },
    { id: 'c', pregunta: 'Algun extra en tu pita?', preguntaId: 'g3',
      marca: 'Meraki Pita', cedida: false, activa: true, esEsta: false,
      platos: 3, decidida: true },
  ]

  it('«dónde está» nombra las marcas cuando son varias', () => {
    expect(laLineaDeDondeEsta(sitios)).toContain('3 preguntas')
    expect(laLineaDeDondeEsta(sitios)).toContain('Meraki Pita')
    expect(laLineaDeDondeEsta(sitios)).toContain('The Urban Kebab')
    expect(laLineaDeDondeEsta([sitios[0]])).toBe('Solo está en esta pregunta')
  })

  it('y dice cuántas de ahí se pueden resolver todavía', () => {
    expect(cuantasDeAhiSiguenSinDecidir(sitios)).toBe(2)
    // Una cedida no cuenta: no se puede tocar.
    expect(cuantasDeAhiSiguenSinDecidir(
      [...sitios, { ...sitios[1], id: 'd', cedida: true }])).toBe(2)
  })

  it('🔴 la línea de ventas nunca deja un 0 solo', () => {
    expect(laLineaDeCuantoSePide({ ventas: 0, anuladas: 0, dias: 30 }))
      .toBe('No se ha pedido en 30 días')
    const con = laLineaDeCuantoSePide({ ventas: 0, anuladas: 1, dias: 30 })
    expect(con).toContain('No se ha pedido en 30 días')
    expect(con).toContain('1 pedido anulado')
    expect(con).toContain('no cuenta como venta')
  })
})
