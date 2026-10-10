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
