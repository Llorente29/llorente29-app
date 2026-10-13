// D01 · R2 punto 2 · Las facturas inventadas y su comparador. Lo que el modelo
// lee de verdad lo mide el workflow (leer-con-modelo-d01.yml); aquí, que la
// especificación es coherente y que el comparador no es un espejo.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { CAMPOS, compararLectura } from '../../../scripts/conta/d01/compararLectura.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { FACTURAS, HOY, cifras, html, ideal } from '../../../scripts/conta/d01/facturasInventadas.mjs'
import { leerFactura, type LecturaModelo } from '../../../supabase/functions/_shared/lecturaFactura'

type F = { id: string; papel: string; numero: string; emisor: { nif: string } }
const leer = (f: F) => leerFactura(ideal(f) as LecturaModelo, { hoy: HOY })

describe('las facturas inventadas', () => {
  it('once: los ocho formatos, una torcida, una borrosa y una escaneada, y cada una tiene su fichero', () => {
    expect(FACTURAS.length).toBe(11)
    expect((FACTURAS as F[]).map((f) => f.papel).filter((p) => p !== 'pdf')).toEqual(['torcida', 'borrosa', 'escaneada'])
    for (const f of FACTURAS as F[]) expect(existsSync(`tests/conta/d01/facturas-inventadas/${f.id}.${f.papel === 'torcida' || f.papel === 'borrosa' ? 'jpg' : 'pdf'}`)).toBe(true)
  })
  it('el papel dice lo que espera la prueba: número, NIF y total están escritos en él', () => {
    for (const f of FACTURAS as F[]) {
      const h = html(f)
      expect(h).toContain(f.numero)
      expect(h).toContain(f.emisor.nif)
      expect(h).toContain(new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cifras(f).total))
    }
  })
  it('un lector perfecto: todas seguras salvo el ticket (probable, como manda la norma)', () => {
    const conf = Object.fromEntries((FACTURAS as F[]).map((f) => [f.id, leer(f).confianza]))
    expect(Object.entries(conf).filter(([, c]) => c !== 'seguro')).toEqual([['f06-ticket', 'probable']])
  })
})

describe('el comparador', () => {
  it('lo esperado contra sí mismo: todo 1', () => {
    for (const f of FACTURAS as F[]) expect(Object.values(compararLectura(leer(f), leer(f)))).toEqual(CAMPOS.map(() => 1))
  })
  it('no es un espejo: un número, un total o un tipo mal leídos salen a 0, y solo esos', () => {
    const f = (FACTURAS as F[])[0]
    const m = ideal(f) as LecturaModelo
    const mal = leerFactura({ ...m, document: { ...m.document, doc_number: 'F-2026/1023', grand_total: 400 } }, { hoy: HOY })
    const r = compararLectura(mal, leer(f))
    expect(Object.entries(r).filter(([, v]) => v === 0).map(([k]) => k)).toEqual(['numero', 'total', 'confianza'])
  })
  it('sin lectura (el modelo no contestó): todo 0 salvo lo que es vacío a los dos lados', () => {
    const r = compararLectura(null, leer((FACTURAS as F[])[0]))
    expect(r.numero + r.total + r.nif + r.confianza).toBe(0)
  })
})
