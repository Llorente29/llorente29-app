// Rutas de publicación por (local, canal) — ENCARGO CODE 21/08 §4.1,
// rehecho el 01/10 («Pantalla de precios por canal»).
//
// Regla 31: la población es la REAL. Dos fotos de `channel_publish_route` de
// Foodint: la que se sembró a mano el 18/08 y nadie actualizó, y la corregida
// el 01/10. Las ventas son las de las marcas propias de los 7 días anteriores
// al 01/10, contadas en la base por (local, canal, vía).
import { describe, it, expect } from 'vitest'
import {
  veredicto, esEditable, llegaAPlataforma, fraseDeRuta, derivas, fraseDeDeriva, nombresCortos,
  type RouteRow, type VentasPorRuta, type VeredictoArgs,
} from '@/modules/kitchen/services/channelRouteService'

const ALCALA = 'loc-alcala'
const CARABANCHEL = 'loc-carabanchel'
const GLOVO = 'ch-glovo'
const UBER = 'ch-uber'
const JUSTEAT = 'ch-justeat'
const MOSTRADOR = 'ch-mostrador'
const LOCALES = [
  { id: ALCALA, name: 'Foodint Alcalá' },
  { id: CARABANCHEL, name: 'Foodint Carabanchel' },
]

// La foto del 18/08 (la que hacía mentir a la pantalla el 01/10).
const FILAS_1808: RouteRow[] = [
  { locationId: ALCALA, channelId: GLOVO, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
  { locationId: ALCALA, channelId: UBER, route: 'hubrise', effectiveFrom: '2026-08-06', notes: null },
  { locationId: ALCALA, channelId: JUSTEAT, route: 'hubrise', effectiveFrom: '2026-08-13', notes: null },
  { locationId: CARABANCHEL, channelId: GLOVO, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
  { locationId: CARABANCHEL, channelId: UBER, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
  { locationId: CARABANCHEL, channelId: JUSTEAT, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
]

// La foto corregida el 01/10, copiada de la base.
const FILAS_0110: RouteRow[] = [
  { locationId: ALCALA, channelId: GLOVO, route: 'hubrise', effectiveFrom: '2026-08-27', notes: null },
  { locationId: ALCALA, channelId: UBER, route: 'hubrise', effectiveFrom: '2026-08-06', notes: null },
  { locationId: ALCALA, channelId: JUSTEAT, route: 'hubrise', effectiveFrom: '2026-08-13', notes: null },
  { locationId: CARABANCHEL, channelId: GLOVO, route: 'hubrise', effectiveFrom: '2026-08-27', notes: null },
  { locationId: CARABANCHEL, channelId: UBER, route: 'hubrise', effectiveFrom: '2026-08-28', notes: null },
  { locationId: CARABANCHEL, channelId: JUSTEAT, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
]

// Ventas de marcas propias, 24/09–01/10, medidas en la base. Just Eat de
// Carabanchel no tiene ninguna: no sale en la lista.
const VENTAS_7D: VentasPorRuta[] = [
  { locationId: ALCALA, channelId: GLOVO, source: 'hubrise', n: 66 },
  { locationId: ALCALA, channelId: JUSTEAT, source: 'hubrise', n: 3 },
  { locationId: ALCALA, channelId: UBER, source: 'hubrise', n: 27 },
  { locationId: CARABANCHEL, channelId: GLOVO, source: 'hubrise', n: 22 },
  { locationId: CARABANCHEL, channelId: UBER, source: 'hubrise', n: 14 },
]

const HOY = '2026-10-01'
const v = (o: Partial<VeredictoArgs> & Pick<VeredictoArgs, 'channelId'>) => veredicto({
  rows: FILAS_0110, locationId: null, locales: LOCALES, channelType: 'delivery', cedida: false, hoy: HOY, ...o,
})

describe('veredicto por local', () => {
  it('Glovo en Alcalá lo publica Folvy desde el 27/08 — el caso del encargo', () => {
    const r = v({ locationId: ALCALA, channelId: GLOVO })
    expect(r.kind).toBe('folvy')
    expect(esEditable(r)).toBe(true)
    expect(fraseDeRuta(r)).toBe('Publica Folvy')
  })

  it('Just Eat de Carabanchel sigue sin conectar, cerrada y con la frase del cliente', () => {
    const r = v({ locationId: CARABANCHEL, channelId: JUSTEAT })
    expect(r.kind).toBe('no_conectada')
    expect(esEditable(r)).toBe(false)
    expect(llegaAPlataforma(r)).toBe(false)
    expect(fraseDeRuta(r)).toBe('Esta plataforma no está conectada a Folvy')
  })

  it('un canal de reparto sin fila es NO CONECTADO, no «sin declarar»', () => {
    // Kitchen Grill y Folvy Interno no tienen ni una fila.
    const r = v({ rows: [], locationId: ALCALA, channelId: GLOVO })
    expect(r.kind).toBe('no_conectada')
    expect(esEditable(r)).toBe(false)
  })

  it('una ruta que aún no ha entrado en vigor no cuenta', () => {
    expect(v({ locationId: CARABANCHEL, channelId: UBER, hoy: '2026-08-27' }).kind).toBe('no_conectada')
    expect(v({ locationId: CARABANCHEL, channelId: UBER, hoy: '2026-08-28' }).kind).toBe('folvy')
  })

  it('con dos cortes vigentes manda el MÁS RECIENTE', () => {
    const conCorte: RouteRow[] = [
      { locationId: ALCALA, channelId: GLOVO, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
      { locationId: ALCALA, channelId: GLOVO, route: 'hubrise', effectiveFrom: '2026-08-27', notes: null },
    ]
    expect(v({ rows: conCorte, locationId: ALCALA, channelId: GLOVO }).kind).toBe('folvy')
    expect(v({ rows: conCorte, locationId: ALCALA, channelId: GLOVO, hoy: '2026-08-26' }).kind).toBe('no_conectada')
  })

  it('Mostrador no es de reparto: vale dentro de Folvy y se edita', () => {
    const r = v({ locationId: ALCALA, channelId: MOSTRADOR, channelType: 'dine_in' })
    expect(r.kind).toBe('interno')
    expect(esEditable(r)).toBe(true)
  })
})

describe('marca cedida', () => {
  it('bloquea TODAS las columnas aunque la tabla diga que publica Folvy', () => {
    // La regla va por brand.ownership_type: que la tabla no tenga filas de
    // cedidas no es la razón, y aquí se prueba con filas que dicen «hubrise».
    for (const [loc, ch, tipo] of [
      [ALCALA, GLOVO, 'delivery'], [CARABANCHEL, UBER, 'delivery'], [null, GLOVO, 'delivery'],
      [ALCALA, MOSTRADOR, 'dine_in'],
    ] as const) {
      const r = v({ cedida: true, locationId: loc, channelId: ch, channelType: tipo })
      expect(r.kind).toBe('cedida')
      expect(esEditable(r)).toBe(false)
      expect(llegaAPlataforma(r)).toBe(false)
      expect(fraseDeRuta(r)).toBe('Marca cedida: el precio no se cambia desde Folvy')
    }
  })
})

describe('«todos los locales»', () => {
  it('si los dos coinciden se dice eso, no «sin declarar»', () => {
    expect(v({ channelId: GLOVO }).kind).toBe('folvy')
    expect(v({ channelId: UBER }).kind).toBe('folvy')
  })

  it('si no coinciden, dice en cuáles sí y en cuáles no — y se puede editar', () => {
    const r = v({ channelId: JUSTEAT })
    expect(r).toEqual({ kind: 'mixto', llegaEn: ['Alcalá'], noEn: ['Carabanchel'] })
    expect(fraseDeRuta(r)).toBe('Llega en Alcalá · en Carabanchel no')
    expect(esEditable(r)).toBe(true)
    expect(llegaAPlataforma(r)).toBe(true)
  })

  it('con la foto del 18/08: Glovo no conectado en ninguno, Uber mixto', () => {
    expect(v({ rows: FILAS_1808, channelId: GLOVO }).kind).toBe('no_conectada')
    expect(fraseDeRuta(v({ rows: FILAS_1808, channelId: UBER }))).toBe('Llega en Alcalá · en Carabanchel no')
  })

  it('sin lista de locales usa los locales que nombra la tabla', () => {
    expect(v({ locales: [], channelId: GLOVO }).kind).toBe('folvy')
    expect(v({ locales: [], rows: [], channelId: GLOVO }).kind).toBe('no_conectada')
  })
})

describe('nombres cortos', () => {
  it('quita el prefijo común sólo si todos lo comparten', () => {
    const m = nombresCortos(LOCALES)
    expect(m.get(ALCALA)).toBe('Alcalá')
    expect(m.get(CARABANCHEL)).toBe('Carabanchel')
    const solo = nombresCortos([{ id: 'x', name: 'Kitchen Grill LstQ' }])
    expect(solo.get('x')).toBe('Kitchen Grill LstQ')
  })
})

describe('deriva: lo declarado contra lo que entra', () => {
  it('con la tabla corregida el 01/10 no hay ninguna', () => {
    expect(derivas(FILAS_0110, VENTAS_7D, HOY)).toEqual([])
  })

  it('con la foto del 18/08 salen EXACTAMENTE las tres que se corrigieron a mano', () => {
    const ds = derivas(FILAS_1808, VENTAS_7D, HOY)
    const claves = ds.map((d) => `${d.locationId}/${d.channelId}`).sort()
    expect(claves).toEqual([`${ALCALA}/${GLOVO}`, `${CARABANCHEL}/${GLOVO}`, `${CARABANCHEL}/${UBER}`].sort())
    for (const d of ds) {
      expect(d.declarada).toBe('no_conectada')
      expect(d.observada).toBe('folvy')
    }
  })

  it('Just Eat de Carabanchel, sin ventas, no avisa: no hay con qué comparar', () => {
    const ds = derivas(FILAS_1808, VENTAS_7D, HOY)
    expect(ds.some((d) => d.locationId === CARABANCHEL && d.channelId === JUSTEAT)).toBe(false)
  })

  it('al revés también: declarado Folvy y los pedidos entran por otra vía', () => {
    const ventas: VentasPorRuta[] = [
      { locationId: ALCALA, channelId: UBER, source: 'lastapp', n: 20 },
      { locationId: ALCALA, channelId: UBER, source: 'hubrise', n: 2 },
    ]
    const [d] = derivas(FILAS_0110, ventas, HOY)
    expect(d).toMatchObject({ declarada: 'folvy', observada: 'no_conectada', porFolvy: 2, total: 22 })
  })

  it('un pedido suelto no da la vuelta a un canal: manda la vía mayoritaria', () => {
    const ventas: VentasPorRuta[] = [
      { locationId: ALCALA, channelId: GLOVO, source: 'hubrise', n: 30 },
      { locationId: ALCALA, channelId: GLOVO, source: 'lastapp', n: 1 },
    ]
    expect(derivas(FILAS_0110, ventas, HOY)).toEqual([])
  })

  it('la frase del aviso no nombra la fontanería', () => {
    const [d] = derivas(FILAS_1808, VENTAS_7D, HOY).filter((x) => x.locationId === ALCALA)
    const t = fraseDeDeriva(d, 'Glovo', 'Alcalá')
    expect(t).toBe('Glovo en Alcalá: en los últimos 7 días 66 de 66 pedidos entraron por Folvy, ' +
      'pero aquí consta como no conectada. Hay que corregir la configuración.')
    expect(t.toLowerCase()).not.toContain('hubrise')
  })
})

describe('el cliente no ve nunca la palabra HubRise', () => {
  it('en ninguna frase de columna', () => {
    const todas = [
      v({ locationId: ALCALA, channelId: GLOVO }),
      v({ locationId: CARABANCHEL, channelId: JUSTEAT }),
      v({ cedida: true, channelId: GLOVO }),
      v({ channelId: JUSTEAT }),
      v({ channelId: MOSTRADOR, channelType: 'dine_in' }),
    ]
    for (const r of todas) expect(fraseDeRuta(r).toLowerCase()).not.toMatch(/hubrise|last/)
  })
})
