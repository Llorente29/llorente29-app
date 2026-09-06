import { describe, it, expect } from 'vitest'
import {
  calculaFila, construyeMatriz, frasePorCuadrante, motivoSinCoste,
  type Cuadrante, type ProductoDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'

// B79 · lote 3. LA REGLA DE HOY, FIJADA: ningún botón sin destino que exista.
//
// Julio, 06/09: «un botón que no hace nada en cada fila de Lastres es justo lo
// que suspende el test del administrativo». De ahí salió la regla —«si no hay
// destino, no hay botón»— y de ahí sale esta prueba: la comparten DOS pantallas
// y SEIS botones, y sin ella el siguiente que toque una fila la rompe sin
// enterarse. Es lo que pidió al aprobar el lote 2.
//
// LO QUE COMPRUEBA, por tipo de fila: qué botones salen y a qué pestaña van.
// Las tres pestañas de destino existen hoy en la ficha del plato
// (`escandallo`, `economia`, `en_carta`) y se llega a ellas por
// `/kitchen/recetas?recipe=…&tab=…`; los productos SIN receta —los menús— van a
// `/kitchen/menu?producto=…`, que es el parámetro que se añadió a Cartas para
// que estos botones tuvieran a dónde ir.

/** Las pestañas de la ficha que existen y a las que se puede enviar a alguien. */
const DESTINOS_QUE_EXISTEN = ['escandallo', 'economia', 'en_carta'] as const

const P = (o: Partial<ProductoDeCarta>): ProductoDeCarta => ({
  id: 'x', nombre: 'x', tipo: 'item', categoria: 'PITAS', precio: 10, ivaPct: 10,
  coste: 2, uds: 10, ...o,
})

describe('filas SIN coste · el motivo y el botón dependen de qué le falta', () => {
  it('un MENÚ se compone, y no se le pide un escandallo que no le toca', () => {
    const m = motivoSinCoste('combo')
    expect(m.boton).toBe('Componer')
    expect(m.motivo).toContain('Es un menú')
    expect(DESTINOS_QUE_EXISTEN).toContain(m.destino)
  })

  it('un PLATO sin receta se costea', () => {
    const m = motivoSinCoste('item')
    expect(m.boton).toBe('Poner coste')
    expect(m.motivo).toContain('No tiene receta')
    expect(DESTINOS_QUE_EXISTEN).toContain(m.destino)
  })

  it('sin tipo conocido no se inventa un menú: se pide la receta', () => {
    expect(motivoSinCoste(null).boton).toBe('Poner coste')
  })
})

describe('filas CON coste · un botón por cuadrante, todos con destino', () => {
  // Población mínima pero real en su forma: cuatro platos que caen uno en cada
  // cuadrante, más un lastre caro de hacer.
  const CARTA: ProductoDeCarta[] = [
    P({ id: 'estrella', nombre: 'Pita Mixta',  precio: 13.9, coste: 2.26, uds: 400 }),
    P({ id: 'caballo',  nombre: 'Patatas',     precio: 5.5,  coste: 0.88, uds: 300 }),
    P({ id: 'joya',     nombre: 'Pita BOWL',   precio: 14.7, coste: 1.67, uds: 10 }),
    P({ id: 'lastre',   nombre: 'Rollitos',    precio: 6.3,  coste: 1.69, uds: 5 }),
    P({ id: 'caro',     nombre: 'Tarta',       precio: 7.9,  coste: 3.16, uds: 4 }),
  ]
  const filas = CARTA.map(calculaFila)
  const m = construyeMatriz(filas)
  const media = m.mediaSimpleDeMargen as number
  const fila = (id: string) => filas.find((f) => f.id === id)!

  it('cada uno cae en su cuadrante', () => {
    expect(m.cuadranteDe.get('estrella')).toBe('estrella')
    expect(m.cuadranteDe.get('caballo')).toBe('caballo')
    expect(m.cuadranteDe.get('joya')).toBe('joya')
    expect(m.cuadranteDe.get('lastre')).toBe('lastre')
  })

  it('ESTRELLA: sólo se abre, no se toca', () => {
    const r = frasePorCuadrante(fila('estrella'), 'estrella', media)
    expect(r.botones.map((b) => b.texto)).toEqual(['Abrir'])
  })

  it('CABALLO: subir precio (a Economía) y ver receta (a Escandallo)', () => {
    const r = frasePorCuadrante(fila('caballo'), 'caballo', media)
    expect(r.botones).toEqual([
      { texto: 'Subir precio', destino: 'economia' },
      { texto: 'Ver receta', destino: 'escandallo' },
    ])
  })

  it('JOYA: darle sitio va a «En carta», que es donde se ordena la carta', () => {
    const r = frasePorCuadrante(fila('joya'), 'joya', media)
    expect(r.botones[0]).toEqual({ texto: 'Darle sitio', destino: 'en_carta' })
  })

  it('LASTRE normal: UN solo botón, y es «Quitar de la carta»', () => {
    const r = frasePorCuadrante(fila('lastre'), 'lastre', media)
    expect(r.botones).toEqual([{ texto: 'Quitar de la carta', destino: 'en_carta' }])
  })

  it('LASTRE caro de hacer: antes de quitarlo se ofrece subir el precio', () => {
    const r = frasePorCuadrante(fila('caro'), 'lastre', media)
    expect(r.botones.map((b) => b.texto)).toEqual(['Subir precio', 'Quitar de la carta'])
  })

  it('«Mantener» NO existe en ningún cuadrante: no decidir es el estado por defecto', () => {
    for (const c of ['estrella', 'caballo', 'joya', 'lastre'] as Cuadrante[]) {
      for (const f of filas) {
        const textos = frasePorCuadrante(f, c, media).botones.map((b) => b.texto)
        expect(textos, `${f.nombre} · ${c}`).not.toContain('Mantener')
      }
    }
  })

  it('TODO botón, en TODA fila y TODO cuadrante, apunta a una pestaña que existe', () => {
    for (const c of ['estrella', 'caballo', 'joya', 'lastre'] as Cuadrante[]) {
      for (const f of filas) {
        const r = frasePorCuadrante(f, c, media)
        expect(r.botones.length, `${f.nombre} · ${c}: sin botones`).toBeGreaterThan(0)
        for (const b of r.botones) {
          expect(DESTINOS_QUE_EXISTEN, `${f.nombre} · ${c} · ${b.texto}`).toContain(b.destino)
          expect(b.texto.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('y toda fila lleva su frase: ningún botón sin el porqué al lado', () => {
    for (const c of ['estrella', 'caballo', 'joya', 'lastre'] as Cuadrante[]) {
      for (const f of filas) {
        expect(frasePorCuadrante(f, c, media).frase.trim().length).toBeGreaterThan(20)
      }
    }
  })
})
