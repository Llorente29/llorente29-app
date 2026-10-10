// Compras · lo que dicen las pantallas (lib/compras.ts).
//
// Regla 31: los casos no salen de la cabeza de quien escribió el código.
//   · Las filas son las que devolvió la base en staging (run 126, la prueba
//     de la 0170: «1 · mirar: 101:ficha_sin_forma/25.00/Norte Centro …»,
//     «ficha P1: [{"falta": "tipo_gasto"}, {"falta": "forma_facturar",
//     "ultimo_papel": "albaran"}]», «últimos papeles de P1: ["albaran",
//     "albaran"]»).
//   · Las frases esperadas son las de las maquetas aprobadas (N18, N20).

import { describe, expect, it } from 'vitest'
import {
  albaranesDesde, chocaConLaFicha, cuandoLlega, cuantasAMirar, diaConNombre, estadoLiquidacion, fraseDeFalta, fraseDePregunta,
  fraseLiquidacion, fraseSaldo, fraseUltimosPapeles, importeEsperando, lineaRecepcion, mesAnterior, mesSiguiente, ordenarAMirar,
  type FilaLiquidacion, type Mirar, type RecepcionAMirar,
} from '@/modules/conta/lib/compras'

// Las dos recepciones con pregunta del run 126, tal como las devuelve compras_mirar.
const R101: RecepcionAMirar = {
  tipo: 'recepcion', recepcion: 'c0f00000-0000-4000-8000-000000000101', codigo: 'REC-101', fecha: '2026-10-01',
  proveedor: 'c0f00000-0000-4000-8000-000000000001', proveedor_nombre: 'Verduras Prueba Ocho, S.L.',
  local: 'c01a0000-0000-4000-8000-0000000000a2', local_nombre: 'Norte Centro', base: 25, papel: 'albaran',
  a_nombre_de: 'Taberna de Prueba Norte, S.L.', camino: 'pendiente_factura', pregunta: 'ficha_sin_forma',
  detalle: { ficha: null, ficha_dice: null, papel: 'albaran', sugerida: 'delivery_note_then_invoice', sugerida_dice: 'entrega con albarán y factura después' },
  frase: 'Es un albarán a nombre de tu empresa: queda pendiente de factura.', error: null, factura: null, sesion: null,
}
const R102: RecepcionAMirar = {
  ...R101, recepcion: 'c0f00000-0000-4000-8000-000000000102', codigo: 'REC-102', fecha: '2026-10-02', base: 12.5,
  a_nombre_de: 'Bar Desconocido Ocho', camino: 'sin_decidir', pregunta: 'a_nombre_de',
  detalle: { nombre: 'Bar Desconocido Ocho', candidatos: [] },
  frase: 'El papel va a nombre de «Bar Desconocido Ocho», y Folvy no sabe quién es.',
}

describe('Qué tienes que mirar', () => {
  it('la fila de la recepción dice día, local e importe (N18)', () => {
    expect(diaConNombre('2026-10-05')).toBe('lunes 5 de octubre')
    expect(lineaRecepcion({ ...R101, codigo: null, fecha: '2026-10-05', local_nombre: 'Local Centro', base: 191 }))
      .toBe('Recepción del lunes 5 de octubre · Local Centro · 191,00 €')
    expect(lineaRecepcion({ ...R101, base: null })).toContain('sin importe')
  })

  it('papel contra ficha, con las palabras de la maqueta N18', () => {
    const r: RecepcionAMirar = { ...R101, proveedor_nombre: 'Hostelería Amaro', pregunta: 'papel_y_ficha',
      detalle: { ficha: 'per_delivery', ficha_dice: 'con cada entrega', papel: 'albaran', sugerida: 'delivery_note_then_invoice' } }
    expect(fraseDePregunta(r)).toBe('Hostelería Amaro ha entregado con albarán, y en su ficha pone que factura con cada entrega.')
  })

  it('a nombre de otro (N18)', () => {
    const r: RecepcionAMirar = { ...R101, proveedor_nombre: 'Bodegas Ribera', papel: 'factura', a_nombre_de: 'Contado', pregunta: 'a_nombre_de_otro', detalle: null }
    expect(fraseDePregunta(r)).toBe('Una factura de Bodegas Ribera viene a nombre de «Contado», no de tu empresa. Así no puedes descontar su IVA.')
  })

  it('las dos del run 126: sin forma y un nombre que no se sabe de quién es', () => {
    expect(fraseDePregunta(R101)).toBe('Verduras Prueba Ocho, S.L. ha entregado con albarán, y su ficha no dice cómo factura.')
    expect(fraseDePregunta(R102)).toBe('El papel de Verduras Prueba Ocho, S.L. va a nombre de «Bar Desconocido Ocho», y no sé quién es.')
  })

  it('lo que le falta a la ficha: la forma del run 126 y el NIF de la maqueta', () => {
    expect(fraseDeFalta('Verduras Prueba Ocho, S.L.', { falta: 'forma_facturar', ultimo_papel: 'albaran' }))
      .toBe('No sé cómo factura Verduras Prueba Ocho, S.L. Su último papel fue un albarán.')
    expect(fraseDeFalta('Carnes del Valle', { falta: 'nif', ofrece: 'B-12345678', veces: 1, otros_distintos: 0 }))
      .toBe('A Carnes del Valle le falta el NIF. Sin él no puedo contabilizar sus facturas. En su último papel pone B-12345678. Compruébalo antes de aceptarlo.')
    expect(fraseDeFalta('X', { falta: 'nif', ofrece: 'B1', veces: 3, otros_distintos: 1 })).toContain('hay otro papel con uno distinto')
  })

  it('cuenta todo y no esconde nada: ordena por fecha', () => {
    const m: Mirar = {
      recepciones: [R102, R101],
      sin_camino: [{ tipo: 'sin_camino', recepcion: 'x', codigo: null, fecha: '2026-10-03', proveedor_nombre: null, local_nombre: null }],
      fichas: [{ tipo: 'ficha', proveedor: 'p', proveedor_nombre: 'Verduras Prueba Ocho, S.L.',
        falta: [{ falta: 'tipo_gasto' }, { falta: 'forma_facturar', ultimo_papel: 'albaran' }] }],
    }
    const o = ordenarAMirar(m)
    expect(o.recepciones.map((r) => r.codigo)).toEqual(['REC-101', 'REC-102'])
    expect(cuantasAMirar(o)).toBe(5)
    expect(o.recepciones.length + o.sin_camino.length + o.fichas.length).toBe(4)
  })
})

describe('Qué está esperando factura (N18)', () => {
  it('albaranes e importe', () => {
    expect(albaranesDesde({ receipts: 3, oldest: '2026-09-04' })).toBe('3 desde el 4 de sept.')
    expect(albaranesDesde({ receipts: 1, oldest: '2026-09-18' })).toBe('1 del 18 de sept.')
    expect(importeEsperando({ base: 911.38, without_base: 0 })).toBe('911,38 €')
    expect(importeEsperando({ base: 100, without_base: 2 })).toBe('100,00 € (y 2 sin importe)')
  })
  it('«Lleva 38 días sin facturar» el 10/10 desde el 2 de septiembre', () => {
    expect(cuandoLlega({ oldest: '2026-09-02', per_location: false }, '2026-10-10')).toBe('Lleva 38 días sin facturar')
    expect(cuandoLlega({ oldest: '2026-09-18', per_location: true }, '2026-10-10')).toBe('Una por local')
  })
})

describe('Liquidaciones del mes (N18)', () => {
  const base: FilaLiquidacion = {
    proveedor: 'p', proveedor_nombre: 'Distribuciones Aurora', local: 'l', local_nombre: 'Local Sur',
    recepciones: 5, base: 2977.74, liquidacion: null, estado: null, referencia: null, saldo: null, bloqueos: null,
  }
  it('septiembre sin llegar, octubre que aún no toca', () => {
    expect(fraseLiquidacion(base, '2026-09-01', '2026-10-10')).toBe('Todavía no ha llegado. Recibiste 5 albaranes suyos por 2.977,74 €.')
    expect(fraseLiquidacion({ ...base, recepciones: 15, base: 9898.17 }, '2026-10-01', '2026-10-10'))
      .toBe('Aún no toca: llega a primeros de noviembre. Llevas recibidos 15 albaranes por 9.898,17 €.')
  })
  it('la que ha llegado: el saldo del run 124, y si hay bloqueos se dice', () => {
    const llegada = { ...base, liquidacion: 'x', estado: 'borrador', saldo: 5545.84, bloqueos: 0 }
    expect(estadoLiquidacion(llegada, '2026-09-01', '2026-10-10')).toBe('por_confirmar')
    expect(fraseSaldo(5545.84)).toBe('Te paga 5.545,84 €')
    expect(fraseSaldo(-120)).toBe('Le pagas 120,00 €')
    expect(fraseLiquidacion({ ...llegada, bloqueos: 2 }, '2026-09-01', '2026-10-10')).toContain('2 cosas que no cuadran')
    expect(estadoLiquidacion({ ...llegada, estado: 'confirmada' }, '2026-09-01', '2026-10-10')).toBe('confirmada')
  })
  it('los meses de alrededor, también en enero y diciembre', () => {
    expect(mesAnterior('2026-01-15')).toBe('2025-12-01')
    expect(mesSiguiente('2026-12-03')).toBe('2027-01-01')
  })
})

describe('Cómo te factura (N20)', () => {
  it('lo que dicen sus últimos papeles (run 126 y la maqueta)', () => {
    expect(fraseUltimosPapeles(['albaran', 'albaran'])).toBe('Sus 2 últimas entregas vinieron con albarán.')
    expect(fraseUltimosPapeles(['albaran', 'albaran', 'albaran', 'albaran', 'albaran'])).toBe('Sus 5 últimas entregas vinieron con albarán.')
    expect(fraseUltimosPapeles(['albaran', 'factura', 'albaran'])).toBe('De sus 3 últimas entregas, 2 con albarán y 1 con factura.')
    expect(fraseUltimosPapeles([])).toBeNull()
  })
  it('choca con la ficha cuando la mayoría dice otra cosa', () => {
    expect(chocaConLaFicha(['albaran', 'albaran', 'albaran', 'albaran', 'albaran'], 'per_delivery')).toBe(true)
    expect(chocaConLaFicha(['factura', 'factura'], 'per_delivery')).toBe(false)
    expect(chocaConLaFicha(['factura', 'albaran_factura'], 'delivery_note_then_invoice')).toBe(true)
    expect(chocaConLaFicha(['albaran'], 'monthly_settlement')).toBe(false)
    expect(chocaConLaFicha(['albaran'], null)).toBe(false)
  })
})

// ── Repaso (10/10) ──────────────────────────────────────────────────────────
import {
  agruparAMirar, coincide, documentosLeidos, fraseFicha, porQueFicha, propuestasDeNombre, rangoFechas,
  veredictoCompras, veredictoProductos, veredictoVentas, type Candidato,
} from '@/modules/conta/lib/compras'

// La forma de octubre en Foodint (nombres cambiados): el socio trae el género
// a nombre de dos locales suyos; uno de ellos escrito de dos maneras (con y
// sin el código de cliente delante).
const SOCIO = 'socio-1'
const CANDIDATOS: Candidato[] = [
  { tipo: 'empresa', id: 'emp-1', nombre: 'Taberna Norte, S.L.', orden: '1' },
  { tipo: 'proveedor', id: SOCIO, nombre: 'AURORA BRANDS, S.L.', orden: '0' },
  { tipo: 'proveedor', id: 'prov-x', nombre: 'Pepeoto Lopez, s.l.', orden: '1' },
]
const papel = (i: number, nombre: string, fecha: string): RecepcionAMirar => ({
  ...R102, recepcion: `r-${i}`, codigo: `ALB-${String(i).padStart(5, '0')}`, fecha, proveedor: SOCIO, proveedor_nombre: 'AURORA BRANDS, S.L.',
  a_nombre_de: nombre, base: 100 + i, detalle: { nombre, candidatos: CANDIDATOS },
})

describe('Repaso · una fila por decisión', () => {
  const horno = Array.from({ length: 9 }, (_, i) => papel(i, 'AURORA EL HORNO BOUTIQUE', `2026-10-0${1 + (i % 9)}`))
  const carab = [papel(20, 'AURORA CARABANCH', '2026-10-01'), papel(21, '047319- AURORA CARABANCH', '2026-10-01'),
                 papel(22, 'AURORA CARABANCH', '2026-10-07'), papel(23, 'AURORA CARABANCH', '2026-10-07')]
  const m: Mirar = {
    recepciones: [...horno, ...carab, R101],
    sin_camino: [],
    fichas: [{ tipo: 'ficha', proveedor: R101.proveedor!, proveedor_nombre: 'Verduras Prueba Ocho, S.L.', falta: [{ falta: 'nif', ofrece: 'B12345674', veces: 1, otros_distintos: 0 }, { falta: 'tipo_gasto' }, { falta: 'forma_facturar', ultimo_papel: 'albaran' }] }],
  }
  const filas = agruparAMirar(m)
  it('13 papeles a nombre de dos locales son dos filas; la ficha incompleta, una con todo junto', () => {
    expect(filas.map((f) => [f.tipo, 'papeles' in f ? f.papeles.length : 0])).toEqual([['nombre', 9], ['nombre', 4], ['ficha', 1]])
    const ficha = filas[2]
    expect(ficha.tipo === 'ficha' && fraseFicha(ficha.proveedor_nombre, ficha.falta)).toBe('A Verduras Prueba Ocho, S.L. le faltan el NIF, el tipo de gasto y cómo te factura.')
    expect(ficha.tipo === 'ficha' && ficha.sugerida).toBe('delivery_note_then_invoice')
  })
  it('agrupar no esconde: todos los papeles están en alguna fila', () => {
    const n = filas.reduce((s, f) => s + ('papeles' in f ? f.papeles.length : 0), 0)
    expect(n).toBe(m.recepciones.length)
  })
  it('el rango de fechas de la fila', () => {
    expect(rangoFechas(horno.map((h) => h.fecha))).toBe('del 1 al 9 de octubre')
    expect(rangoFechas(['2026-09-30', '2026-10-02'])).toBe('del 30 de septiembre al 2 de octubre')
  })
  it('lo que falta, dicho con su porqué', () => {
    expect(porQueFicha([{ falta: 'nif', ofrece: 'B12345674', veces: 1, otros_distintos: 0 }, { falta: 'tipo_gasto' }]))
      .toBe('Sin NIF no puedo contabilizar sus facturas; en su último papel pone B12345674: compruébalo antes de aceptarlo; sin tipo de gasto no sé a qué cuenta van.')
  })
})

describe('Repaso · a nombre de quién: como mucho dos propuestas, con su porqué', () => {
  it('el local del socio: el socio, porque comparte el nombre y es quien trae el género; ni la empresa ni un tercero cualquiera', () => {
    const p = propuestasDeNombre('AURORA EL HORNO BOUTIQUE', CANDIDATOS, [SOCIO])
    expect(p).toEqual([{ tipo: 'proveedor', id: SOCIO, nombre: 'AURORA BRANDS, S.L.', porque: 'Comparte «aurora» y es quien trae el género' }])
  })
  it('sin ninguna pista, ninguna propuesta (y la pantalla ofrece «Es de otro…»)', () => {
    expect(propuestasDeNombre('Bar Desconocido Ocho', CANDIDATOS, [])).toEqual([])
  })
  it('nunca más de dos', () => {
    const muchos: Candidato[] = ['Aurora Uno', 'Aurora Dos', 'Aurora Tres'].map((n, i) => ({ tipo: 'proveedor', id: `a${i}`, nombre: n, orden: '0' }))
    expect(propuestasDeNombre('Aurora Centro', muchos, [])).toHaveLength(2)
  })
})

describe('Repaso · los tres veredictos de la liquidación', () => {
  it('el umbral: 2 € o el 0,1 %, lo que sea mayor', () => {
    expect(coincide(1.12, 11393.44)).toBe(true)
    expect(coincide(12, 11393.44)).toBe(false)
    expect(coincide(1.99, 100)).toBe(true)
    expect(coincide(2.01, 100)).toBe(false)
  })
  it('compras de septiembre (T5, producción): coincide', () => {
    const v = veredictoCompras({ folvy: 11394.56, recepciones: 26, sin_base: 0, documento: 11393.44, diferencia: 1.12 })
    expect(v.estado).toBe('coincide')
    expect(v.detalle).toBe('Él dice 11.393,44 €. En el local se recibieron 26 albaranes por 11.394,56 €. Diferencia: 1,12 €.')
  })
  it('compras sin su inventario: no se puede, y dice qué falta', () => {
    expect(veredictoCompras({ folvy: 450, recepciones: 2, sin_base: 0, documento: null, diferencia: null }).estado).toBe('no_se_puede')
  })
  it('ventas de septiembre (maqueta N19): se parece, cuánto y dónde', () => {
    const v = veredictoVentas([
      { plataforma: 'Glovo', documento: 19497.01, folvy: 19402.62, pedidos: 1016, diferencia: -94.39 },
      { plataforma: 'Uber Eats', documento: 8282.10, folvy: 8462.48, pedidos: 397, diferencia: 180.38 },
      { plataforma: 'Just Eat', documento: 679.54, folvy: 725.82, pedidos: 28, diferencia: 46.28 },
    ], 'cedidas_sin_acuerdo')
    expect(v.estado).toBe('se_parece')
    expect(v.detalle).toContain('Folvy cuenta 132,27 € más que él, sin IVA: Uber Eats, 180,38 € más; Glovo, 94,39 € menos; Just Eat, 46,28 € más.')
  })
  it('ventas que Folvy no tiene (la captura: 4.000 € contra nada): no se puede, no «se parece»', () => {
    const v = veredictoVentas([{ plataforma: 'Glovo', documento: 4000, folvy: null, pedidos: null, diferencia: -4000 }], 'ninguna')
    expect(v.estado).toBe('no_se_puede')
    expect(v.detalle).toContain('acuerdos de cesión')
  })
  it('producto a producto: sin casar no se puede; casado y cuadrado, coincide', () => {
    const base = { casados: 0, no_nuestros: 0, sin_casar: 3, sin_casar_con_compras: 2, no_coinciden: [] }
    expect(veredictoProductos(base, 3).estado).toBe('no_se_puede')
    expect(veredictoProductos({ ...base, casados: 3, sin_casar: 0, sin_casar_con_compras: 0 }, 3).estado).toBe('coincide')
  })
  it('producto a producto: la frase no dice «Reconozco 0» (la captura del e2e 171)', () => {
    const base = { casados: 0, no_nuestros: 0, sin_casar: 3, sin_casar_con_compras: 2, no_coinciden: [] }
    expect(veredictoProductos(base, 3).detalle).toBe('Todavía no reconozco ninguno de sus 3 productos: los llama de otra manera. Dime una vez cuál es cuál y lo recuerdo para todos los meses.')
    expect(veredictoProductos({ ...base, casados: 2, sin_casar: 1 }, 3).detalle).toMatch(/^Reconozco 2 de sus 3 productos; el otro lo llama de otra manera\./)
  })
  it('los cinco documentos: si falta uno, cuál y qué no se comprueba', () => {
    const d = documentosLeidos({ emitida: {}, recibida: {}, transaccion: {}, ventas: null, inventario: {} })
    expect(d.filter((x) => !x.llegado).map((x) => `${x.nombre}: ${x.sinEl}`)).toEqual(['Ventas: sin ellas no compruebo tu servicio'])
  })
})
