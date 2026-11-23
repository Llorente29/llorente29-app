// tests/conta/e10/lecturaPorPartes.test.ts
//
// E10 · La factura larga se lee entera: el núcleo de supabase/functions/_shared/lecturaPorPartes.ts.
//   · juntar los trozos: una línea partida entre dos páginas queda una; ninguna repetida ni perdida;
//     dos líneas iguales de dos albaranes seguidos siguen siendo dos;
//   · la suma de las líneas contra las bases, al céntimo;
//   · un trozo que falla: la factura sigue, faltan sus líneas y se dice cuáles; «Leer las que faltan»
//     las completa sin repetir;
//   · la cabecera: sin líneas, con cuántas trae y cuántas páginas;
//   · con la factura inventada de 5 páginas (scripts/conta/e10/facturaLarga.mjs): 34 líneas.

import { describe, expect, it } from 'vitest'
import {
  baseDeLaCabecera, cuadreLineas, esCortada, estadoLineas, estadoVisto, juntarTrozos, leerCabecera, leerLasLineas,
  promptCabecera, promptLineas, type LineaLeida, type Llamar, type TrozoLeido,
} from '../../../supabase/functions/_shared/lecturaPorPartes'
import { buildPrompt } from '../../../supabase/functions/_shared/ocrAlbaranNucleo'
// @ts-expect-error módulo .mjs sin tipos
import { facturaLarga } from '../../../scripts/conta/e10/facturaLarga.mjs'

type Fac = { lineas: LineaLeida[]; albaranes: { lineas: LineaLeida[] }[]; tipos: { vat_pct: number; base: number; vat_amount: number }[]; base: number }
const F = facturaLarga() as Fac
const linea = (texto: string, importe: number | null, extra: Partial<LineaLeida> = {}): LineaLeida =>
  ({ raw_text: texto, line_amount: importe, supplier_code: null, quantity: 1, packages: null, unit: 'kg', unit_price_net: importe, discount_pct: null, vat_pct: 10, lot_code: null, expiry_date: null, note: null, format_name: null, pack_size: null, pack_unit: null, ...extra })

/** Las 34 líneas repartidas en 5 páginas (7, 7, 7, 7, 6), como en el PDF. */
const POR_PAGINA = [7, 7, 7, 7, 6]
function paginas(lineas: LineaLeida[] = F.lineas): LineaLeida[][] {
  const out: LineaLeida[][] = []
  let i = 0
  for (const n of POR_PAGINA) { out.push(lineas.slice(i, i + n)); i += n }
  return out
}

describe('E10 · juntar los trozos', () => {
  it('las 34 líneas de 5 páginas, en su orden, ninguna repetida ni perdida', () => {
    const t: TrozoLeido[] = paginas().map((l, i) => ({ desde: i + 1, hasta: i + 1, lineas: l }))
    const r = juntarTrozos([t[3], t[0], t[4], t[2], t[1]]) // llegan en cualquier orden
    expect(r.fallidos).toEqual([])
    expect(r.lineas).toHaveLength(34)
    expect(r.lineas.map((l) => l.lot_code)).toEqual(F.lineas.map((l) => l.lot_code))
  })

  it('una línea partida entre dos páginas (su lote y caducidad en la siguiente) queda una sola, con lo de las dos', () => {
    const p = paginas()
    const ultima = p[0][6]
    p[0][6] = { ...ultima, lot_code: null, expiry_date: null }
    p[1] = [linea('', null, { continues_previous: true, lot_code: ultima.lot_code, expiry_date: ultima.expiry_date, quantity: null, unit: null, vat_pct: null }), ...p[1]]
    const r = juntarTrozos(p.map((l, i) => ({ desde: i + 1, hasta: i + 1, lineas: l })))
    expect(r.lineas).toHaveLength(34)
    expect(r.lineas[6]).toMatchObject({ raw_text: ultima.raw_text, line_amount: ultima.line_amount, lot_code: ultima.lot_code, expiry_date: ultima.expiry_date })
    expect(r.lineas.some((l) => 'continues_previous' in l)).toBe(false)
  })

  it('dos líneas iguales de dos albaranes seguidos, en el borde de una página, siguen siendo dos', () => {
    const igual = linea('Pollo entero limpio', 17.25, { supplier_code: 'P0101', quantity: 5 })
    const r = juntarTrozos([{ desde: 1, hasta: 1, lineas: [igual] }, { desde: 2, hasta: 2, lineas: [{ ...igual }] }])
    expect(r.lineas).toHaveLength(2)
  })

  it('un trozo que falla: sus líneas faltan y se dice qué página; el resto de la siguiente, sin su línea, no se inventa', () => {
    const p = paginas()
    const r = juntarTrozos([
      { desde: 1, hasta: 1, lineas: p[0] }, { desde: 2, hasta: 2, lineas: null },
      { desde: 3, hasta: 3, lineas: [linea('', null, { continues_previous: true, lot_code: 'L-RESTO' }), ...p[2]] },
      { desde: 4, hasta: 4, lineas: p[3] }, { desde: 5, hasta: 5, lineas: p[4] },
    ])
    expect(r.fallidos).toEqual([{ desde: 2, hasta: 2 }])
    expect(r.lineas).toHaveLength(27)
    expect(r.lineas.some((l) => l.lot_code === 'L-RESTO')).toBe(false)
  })
})

describe('E10 · la suma de las líneas contra las bases, al céntimo', () => {
  it('las 34 líneas suman la base del cuadro de impuestos', () => {
    const base = baseDeLaCabecera({ factura: { tax_breakdown: F.tipos } })
    expect(base).toBe(F.base)
    expect(cuadreLineas(F.lineas, base)).toEqual({ suman: F.base, base: F.base, cuadra: true })
  })
  it('un céntimo de diferencia ya no cuadra', () => {
    const l = F.lineas.map((x, i) => (i === 0 ? { ...x, line_amount: (x.line_amount as number) + 0.01 } : x))
    expect(cuadreLineas(l, F.base)?.cuadra).toBe(false)
  })
  it('sin cuadro de impuestos, la base de la cabecera; sin nada, no se dice nada', () => {
    expect(baseDeLaCabecera({ document: { tax_base_total: 50 }, factura: { tax_breakdown: [] } })).toBe(50)
    expect(cuadreLineas(F.lineas, null)).toBeNull()
  })
})

describe('E10 · el estado de las líneas', () => {
  const desde = '2026-11-23T08:00:00.000Z'
  it('todas leídas y suman: completas', () => {
    const t = paginas().map((l, i) => ({ desde: i + 1, hasta: i + 1, lineas: l }))
    const { estado } = estadoLineas({ trozos: t, esperadas: 34, paginas: 5, base: F.base, desde })
    expect(estado).toMatchObject({ estado: 'completas', leidas: 34, esperadas: 34, sin_leer: [], cuadre: { cuadra: true } })
    expect(estado.por_pagina.map((p) => p.lineas)).toEqual(POR_PAGINA)
  })
  it('la cabecera dice 35 pero suman la base al céntimo: el recuento es de la cabecera, completas', () => {
    const t = paginas().map((l, i) => ({ desde: i + 1, hasta: i + 1, lineas: l }))
    expect(estadoLineas({ trozos: t, esperadas: 35, paginas: 5, base: F.base, desde }).estado.estado).toBe('completas')
  })
  it('una página sin leer: faltan, cuántas de cuántas, y no cuadra', () => {
    const t = paginas().map((l, i) => ({ desde: i + 1, hasta: i + 1, lineas: i === 2 ? null : l }))
    const { estado } = estadoLineas({ trozos: t, esperadas: 34, paginas: 5, base: F.base, desde })
    expect(estado).toMatchObject({ estado: 'faltan', leidas: 27, esperadas: 34, sin_leer: [3], cuadre: { cuadra: false } })
  })
  it('«leyendo» que se ha quedado parada más de diez minutos se ve como faltan', () => {
    const e = { estado: 'leyendo' as const, leidas: 0, esperadas: 34, paginas: 5, sin_leer: [], por_pagina: [], cuadre: null, desde }
    expect(estadoVisto(e, Date.parse(desde) + 60_000)?.estado).toBe('leyendo')
    expect(estadoVisto(e, Date.parse(desde) + 11 * 60_000)?.estado).toBe('faltan')
  })
})

// ── Con el modelo de mentira: lo que devuelve cada llamada ────────────────────

const respuesta = (parsed: unknown, stop = 'end_turn') => ({ parsed: parsed as never, raw: { stop_reason: stop, content: [] } })
/** Un PDF de mentira: «partirlo» da tantas páginas como se diga. */
const partir = (n: number) => async () => Array.from({ length: n }, (_, i) => new Uint8Array([i + 1]))
const aB64 = (b: Uint8Array) => String(b[0])
/** El modelo de mentira: cada página devuelve sus líneas (la página va en el bloque). */
function modelo(porPagina: LineaLeida[][], falla: number[] = [], llamadas: string[] = []): Llamar {
  return async (bloques, prompt) => {
    llamadas.push(prompt)
    const pag = Number((bloques[0] as { source: { data: string } }).source.data)
    if (falla.includes(pag)) return respuesta({ lines: [] }, 'max_tokens')
    return respuesta({ lines: porPagina[pag - 1] })
  }
}

describe('E10 · el orquestador, con un modelo de mentira', () => {
  const desde = '2026-11-23T08:00:00.000Z'
  const ficheros = [{ bytes: new Uint8Array([0]), mime: 'application/pdf' }]

  it('cinco páginas, una llamada por página, 34 líneas que suman la base', async () => {
    const llamadas: string[] = []
    const r = await leerLasLineas({ llamar: modelo(paginas(), [], llamadas), ficheros, partirPdf: partir(5), aB64, esperadas: 34, base: F.base, desde })
    expect(llamadas).toHaveLength(5)
    expect(llamadas[0]).toContain('te paso la página 1 de un documento de 5')
    expect(r.lineas).toHaveLength(34)
    expect(r.estado).toMatchObject({ estado: 'completas', leidas: 34, cuadre: { cuadra: true } })
  })

  it('la página 3 llega cortada: faltan 7; «Leer las que faltan» lee solo esa y quedan 34, ninguna repetida', async () => {
    const primera = await leerLasLineas({ llamar: modelo(paginas(), [3]), ficheros, partirPdf: partir(5), aB64, esperadas: 34, base: F.base, desde })
    expect(primera.estado).toMatchObject({ estado: 'faltan', leidas: 27, sin_leer: [3] })
    const llamadas: string[] = []
    const segunda = await leerLasLineas({
      llamar: modelo(paginas(), [], llamadas), ficheros, partirPdf: partir(5), aB64, esperadas: 34, base: F.base, desde,
      faltan: { paginas: primera.estado.sin_leer, lineas: primera.lineas, porPagina: primera.estado.por_pagina },
    })
    expect(llamadas).toHaveLength(1)
    expect(segunda.lineas.map((l) => l.lot_code)).toEqual(F.lineas.map((l) => l.lot_code))
    expect(segunda.estado).toMatchObject({ estado: 'completas', leidas: 34, sin_leer: [], cuadre: { cuadra: true } })
  })

  it('diez páginas, 68 líneas: no hay un tope nuevo', async () => {
    const G = facturaLarga({ albaranes: 40 }) as Fac
    const p: LineaLeida[][] = []
    for (let i = 0; i < 10; i++) p.push(G.lineas.slice(i * 7, i * 7 + 7))
    const r = await leerLasLineas({ llamar: modelo(p), ficheros, partirPdf: partir(10), aB64, esperadas: 68, base: G.base, desde })
    expect(r.lineas).toHaveLength(68)
    expect(r.estado).toMatchObject({ estado: 'completas', leidas: 68, cuadre: { cuadra: true } })
  })

  it('la cabecera: sin líneas, con cuántas trae y cuántas páginas (fuera de lo que se guarda)', async () => {
    const prompts: string[] = []
    const r = await leerCabecera(async (_b, prompt) => { prompts.push(prompt); return respuesta({ document: { doc_number: 'AV-2026-0000011' }, lines: [{ raw_text: 'x' }], lines_expected: 34, pages: 5, confidence: 0.9 }) }, [])
    expect(prompts[0]).toBe(promptCabecera())
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r).toMatchObject({ esperadas: 34, paginas: 5 })
    expect(r.parsed?.lines).toEqual([])
    expect(r.parsed && 'lines_expected' in r.parsed).toBe(false)
  })
})

describe('E10 · cuándo se lee por partes', () => {
  it('solo cuando la respuesta llega cortada (stop_reason max_tokens)', () => {
    expect(esCortada({ stop_reason: 'max_tokens' })).toBe(true)
    expect(esCortada({ stop_reason: 'end_turn' })).toBe(false)
    expect(esCortada(null)).toBe(false)
  })
  it('los dos prompts llevan el de siempre entero: las líneas se leen con la misma forma y las mismas reglas', () => {
    expect(promptCabecera().startsWith(buildPrompt())).toBe(true)
    expect(promptLineas({ desde: 2, hasta: 2 }, 5).startsWith(buildPrompt())).toBe(true)
  })
})
