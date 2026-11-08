// G04 · Tarea 2 · Un solo cálculo del precio de un cliente en un mes
// (supabase/functions/_shared/tarifa/precio.ts). Servicios, niveles, paquetes,
// clientes e importes inventados (T11), salvo Gestoría mensual 60,50 €.
import { describe, expect, it } from 'vitest'
import {
  PALABRA_DE_PRECIO, fallosDeForma, importeDeForma, mesDeFecha, porSeparado, precioDelMes, reciboDelMes,
  type Asignacion, type Catalogo, type Forma, type Precio,
} from '../../../../../../supabase/functions/_shared/tarifa/precio'

const E = 'empresa-1'
const p = (id: string, objetivo: Precio['objetivo'], forma: Forma, desde = '2026-01', clienteId: string | null = null, hasta: string | null = null): Precio =>
  ({ id, empresaId: E, objetivo, clienteId, forma, desde, hasta })

const GESTORIA = { tipo: 'servicio', servicioId: 'gestoria' } as const
const LABORAL = { tipo: 'servicio', servicioId: 'laboral' } as const
const ESTANDAR = { tipo: 'nivel', servicioId: 'gestoria', nivelId: 'estandar' } as const

const catalogo = (precios: Precio[]): Catalogo => ({
  servicios: [{ id: 'gestoria', empresaId: E, nombre: 'Gestoría mensual' }, { id: 'laboral', empresaId: E, nombre: 'Gestión laboral' }],
  niveles: [
    { id: 'basica', servicioId: 'gestoria', nombre: 'Básica', orden: 1, incluye: ['Contabilidad'], masElegido: false },
    { id: 'estandar', servicioId: 'gestoria', nombre: 'Estándar', orden: 2, incluye: ['Contabilidad', 'Impuestos trimestrales'], masElegido: true },
  ],
  paquetes: [{ id: 'pyme', empresaId: E, nombre: 'Pack Pyme', descripcion: null,
    lineas: [{ objetivo: ESTANDAR, limiteTrabajadores: null }, { objetivo: LABORAL, limiteTrabajadores: 5 }], excesoPorTrabajadorCent: 1800 }],
  precios,
})
const trabajadores = (n: number, desde = '2026-01') => Array.from({ length: n }, (_, i) => ({ nombre: `Persona Prueba ${i + 1}`, desde, hasta: null }))

describe('G04 · las cuatro formas de cobro', () => {
  it('fijo: al mes, al año (entre 12, al céntimo) y por vez', () => {
    expect(importeDeForma({ tipo: 'fijo', periodo: 'mes', importeCent: 6050 }, 0)).toEqual({ cent: 6050, cuenta: '60,50 € al mes' })
    expect(importeDeForma({ tipo: 'fijo', periodo: 'anio', importeCent: 30000 }, 0)?.cent).toBe(2500)
    expect(importeDeForma({ tipo: 'fijo', periodo: 'anio', importeCent: 10000 }, 0)?.cent).toBe(833)
    expect(importeDeForma({ tipo: 'fijo', periodo: 'vez', importeCent: 6000 }, 0)?.cuenta).toBe('60,00 € cada vez')
  })
  it('por trabajador: 18 × 24,20 € = 435,60 €', () => {
    expect(importeDeForma({ tipo: 'por_trabajador', importeCent: 2420 }, 18)).toEqual({ cent: 43560, cuenta: '18 × 24,20 €' })
  })
  it('por tramos: el tramo en el que cae; uno «por unidad» cobra cada trabajador', () => {
    const f: Forma = { tipo: 'tramos', tramos: [
      { desde: 1, hasta: 5, importeCent: 10000, porUnidad: false },
      { desde: 6, hasta: 10, importeCent: 15000, porUnidad: false },
      { desde: 11, hasta: null, importeCent: 1500, porUnidad: true }] }
    expect(importeDeForma(f, 3)?.cent).toBe(10000)
    expect(importeDeForma(f, 8)).toEqual({ cent: 15000, cuenta: 'tramo de 6 a 10: 150,00 €' })
    expect(importeDeForma(f, 12)?.cent).toBe(18000)
    expect(importeDeForma(f, 0)).toBeNull() // ningún tramo para 0: no se inventa
  })
  it('tramo y por trabajador: «de 1 a 5, 100 €; después 18 € por cada uno» (con 8, 154 €)', () => {
    const f: Forma = { tipo: 'tramo_y_por_trabajador', tramos: [
      { desde: 1, hasta: 5, importeCent: 10000, porUnidad: false },
      { desde: 6, hasta: null, importeCent: 1800, porUnidad: true }] }
    expect(importeDeForma(f, 8)).toEqual({ cent: 15400, cuenta: 'de 1 a 5: 100,00 € + 3 × 18,00 €' })
    expect(importeDeForma(f, 5)?.cent).toBe(10000)
    expect(importeDeForma(f, 1)?.cent).toBe(10000)
  })
  it('los fallos de unos tramos, en palabras', () => {
    expect(fallosDeForma({ tipo: 'tramos', tramos: [{ desde: 1, hasta: 5, importeCent: 100, porUnidad: false }, { desde: 5, hasta: 9, importeCent: 200, porUnidad: false }] }))
      .toEqual(['Los tramos que empiezan en 1 y en 5 se pisan.'])
    expect(fallosDeForma({ tipo: 'tramos', tramos: [{ desde: 1, hasta: 5, importeCent: 100, porUnidad: false }, { desde: 8, hasta: null, importeCent: 200, porUnidad: false }] }))
      .toEqual(['Entre 5 y 8 no hay tramo.'])
    expect(fallosDeForma({ tipo: 'fijo', periodo: 'mes', importeCent: -1 })).toEqual(['Un importe es negativo o no está en céntimos.'])
    expect(fallosDeForma({ tipo: 'por_trabajador', importeCent: 2420 })).toEqual([])
  })
})

describe('G04 · el precio de un cliente: el suyo manda sobre el general', () => {
  const general = p('g', GESTORIA, { tipo: 'fijo', periodo: 'mes', importeCent: 6050 })
  it('sin precio suyo: el de la tarifa', () => {
    expect(precioDelMes([general], E, GESTORIA, 'c1', '2026-11')).toEqual({ forma: general.forma, dePrecio: 'tarifa' })
  })
  it('con uno suyo distinto: «Precio especial», y manda', () => {
    const suyo = p('s', GESTORIA, { tipo: 'fijo', periodo: 'mes', importeCent: 5000 }, '2026-03', 'c1')
    const r = precioDelMes([general, suyo], E, GESTORIA, 'c1', '2026-11')
    expect([r?.dePrecio, r?.forma]).toEqual(['especial', suyo.forma])
    expect(PALABRA_DE_PRECIO[r!.dePrecio]).toBe('Precio especial')
  })
  it('sin precio general (lo importado de GoCardless): «Precio de este cliente», nunca «especial»', () => {
    const suyo = p('s', GESTORIA, { tipo: 'fijo', periodo: 'mes', importeCent: 5000 }, '2026-03', 'c1')
    expect(PALABRA_DE_PRECIO[precioDelMes([suyo], E, GESTORIA, 'c1', '2026-11')!.dePrecio]).toBe('Precio de este cliente')
  })
  it('uno suyo igual que el general es «Precio de tarifa»', () => {
    const igual = p('s', GESTORIA, { tipo: 'fijo', periodo: 'mes', importeCent: 6050 }, '2026-03', 'c1')
    expect(precioDelMes([general, igual], E, GESTORIA, 'c1', '2026-11')?.dePrecio).toBe('tarifa')
  })
  it('sin ningún precio: null (no se inventa)', () => {
    expect(precioDelMes([], E, GESTORIA, 'c1', '2026-11')).toBeNull()
  })
  it('con dos que valen el mismo mes, el de «desde» más reciente; y un precio acabado ya no vale', () => {
    const viejo = p('v', GESTORIA, { tipo: 'fijo', periodo: 'mes', importeCent: 5500 }, '2025-01', null, '2026-06')
    const nuevo = p('n', GESTORIA, { tipo: 'fijo', periodo: 'mes', importeCent: 6050 }, '2026-07')
    expect(precioDelMes([viejo, nuevo], E, GESTORIA, 'c1', '2026-06')?.forma).toEqual(viejo.forma)
    expect(precioDelMes([viejo, nuevo], E, GESTORIA, 'c1', '2026-11')?.forma).toEqual(nuevo.forma)
  })
})

describe('G04 · el recibo de un cliente en un mes', () => {
  const precios = [
    p('niv', ESTANDAR, { tipo: 'fijo', periodo: 'mes', importeCent: 6050 }),
    p('lab', LABORAL, { tipo: 'por_trabajador', importeCent: 2420 }),
    p('pyme', { tipo: 'paquete', paqueteId: 'pyme' }, { tipo: 'fijo', periodo: 'mes', importeCent: 15000 }),
  ]
  it('un nivel y la laboral por trabajador: 60,50 + 18 × 24,20 = 496,10 €', () => {
    const a: Asignacion[] = [
      { id: 'a1', clienteId: 'c1', empresaId: E, objetivo: ESTANDAR, desde: '2024-01', hasta: null },
      { id: 'a2', clienteId: 'c1', empresaId: E, objetivo: LABORAL, desde: '2024-01', hasta: null, trabajadores: trabajadores(18) },
    ]
    const r = reciboDelMes(catalogo(precios), a, 'c1', E, '2026-12')
    expect(r.lineas.map((l) => [l.texto, l.importeCent, l.dePrecio])).toEqual([
      ['Gestoría mensual · Estándar', 6050, 'tarifa'],
      ['Gestión laboral · 18 trabajadores', 43560, 'tarifa'],
    ])
    expect(r.totalCent).toBe(49610)
  })
  it('un paquete con exceso: hasta 5 trabajadores, 150 €; con 8, tres de más a 18 € (204 €)', () => {
    const a: Asignacion[] = [{ id: 'a', clienteId: 'c1', empresaId: E, objetivo: { tipo: 'paquete', paqueteId: 'pyme' }, desde: '2026-01', hasta: null, trabajadores: trabajadores(8) }]
    const l = reciboDelMes(catalogo(precios), a, 'c1', E, '2026-11').lineas[0]
    expect([l.texto, l.importeCent, l.cuenta]).toEqual(['Pack Pyme · 8 trabajadores', 20400, '150,00 € al mes + 3 de más × 18,00 €'])
    const cinco = reciboDelMes(catalogo(precios), [{ ...a[0], trabajadores: trabajadores(5) }], 'c1', E, '2026-11')
    expect(cinco.totalCent).toBe(15000)
  })
  it('lo que ahorra el paquete: por separado 60,50 + 5 × 24,20 = 181,50 € frente a 150 €; sin precio general de algo, null', () => {
    const c = catalogo(precios)
    expect(porSeparado(c, c.paquetes[0], 5, '2026-11')).toBe(18150)
    expect(porSeparado(catalogo([precios[0]]), c.paquetes[0], 5, '2026-11')).toBeNull()
  })
  it('un alta y una baja a mitad de mes: los dos meses se cobran enteros, y salen como etiqueta', () => {
    const ts = [
      { nombre: 'Persona Prueba Uno', desde: '2026-01', hasta: null },
      { nombre: 'Persona Prueba Alta', desde: mesDeFecha('2026-11-15'), hasta: null },
      { nombre: 'Persona Prueba Baja', desde: '2026-01', hasta: mesDeFecha('2026-11-20') },
    ]
    const a: Asignacion[] = [{ id: 'a', clienteId: 'c1', empresaId: E, objetivo: LABORAL, desde: '2026-01', hasta: null, trabajadores: ts }]
    const nov = reciboDelMes(catalogo(precios), a, 'c1', E, '2026-11').lineas[0]
    expect([nov.trabajadores, nov.importeCent, nov.altasDelMes, nov.bajasDelMes]).toEqual([3, 7260, ['Persona Prueba Alta'], ['Persona Prueba Baja']])
    const dic = reciboDelMes(catalogo(precios), a, 'c1', E, '2026-12').lineas[0]
    expect([dic.trabajadores, dic.importeCent, dic.altasDelMes, dic.bajasDelMes]).toEqual([2, 4840, [], []])
  })
  it('el alta y la baja de un servicio: cuenta de su «desde» a su «hasta», incluidos', () => {
    const a: Asignacion[] = [{ id: 'a', clienteId: 'c1', empresaId: E, objetivo: ESTANDAR, desde: '2026-11', hasta: '2027-01' }]
    const c = catalogo(precios)
    expect(['2026-10', '2026-11', '2027-01', '2027-02'].map((m) => reciboDelMes(c, a, 'c1', E, m).totalCent)).toEqual([0, 6050, 6050, 0])
  })
  it('una línea sin precio no suma y se dice; las de otra empresa o de otro cliente no salen', () => {
    const a: Asignacion[] = [
      { id: 'a1', clienteId: 'c1', empresaId: E, objetivo: GESTORIA, desde: '2026-01', hasta: null },
      { id: 'a2', clienteId: 'c1', empresaId: 'empresa-2', objetivo: ESTANDAR, desde: '2026-01', hasta: null },
      { id: 'a3', clienteId: 'c2', empresaId: E, objetivo: ESTANDAR, desde: '2026-01', hasta: null },
    ]
    const r = reciboDelMes(catalogo(precios), a, 'c1', E, '2026-11')
    expect([r.lineas.length, r.totalCent, r.sinPrecio, r.lineas[0].dePrecio, r.lineas[0].cuenta]).toEqual([1, 0, 1, 'sin_precio', 'Sin precio en la tarifa ni para este cliente'])
  })
})
