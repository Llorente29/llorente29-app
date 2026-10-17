// tests/conta/cumplimiento/libro-igic.test.ts
//
// Aviso #176 · El agente «Libro diario» da por «ya sabido» que una empresa en
// IGIC (Canarias) no tiene asiento de ventas: el cierre del día solo busca
// tipos de IVA, y construir el IGIC está aparcado (CONTEXTO_CLAUDE.md, «C06b ·
// 16/10 — APARCADO: el IGIC en el cierre del día»). Se enseña, con su porqué,
// pero no abre aviso. Una empresa en IVA con el mismo hueco sigue en rojo.
//
// La fila es la REAL (regla 31): la parte dia_sin_asiento de
// scripts/conta/agente-libro.sql, ya con la columna igic, contra staging-conta
// el 17/10. Es la del aviso #176: la empresa B (Canarias), el 04/10.

import { describe, expect, it } from 'vitest'
import { informeLibro, revisarLibro } from '../../../scripts/conta/lib/libro.mjs'
import { anonimizar, informeAnonimo } from '../../../scripts/conta/lib/anonimo.mjs'

const REAL_20261017 = {
  account_id: 'c01b0000-0000-4000-8000-00000000000b',
  company_id: '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6',
  local: 'c01b0000-0000-4000-8000-0000000000b2',
  dia: '2026-10-04',
  pedidos: 1,
  horas: 306,
  resumen: false,
  igic: true,
  resultado: 'sin_propuesta',
  porque: 'Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.',
}

describe('agente «Libro diario» · el IGIC, ya sabido (#176)', () => {
  it('la empresa en IGIC: «sabido», con su porqué y su pendiente, y ni un rojo', () => {
    const h = revisarLibro({ dia_sin_asiento: [REAL_20261017] })
    expect(h).toHaveLength(1)
    expect(h[0].nivel).toBe('sabido')
    expect(h[0].tipo).toBe('dia_sin_asiento_igic')
    expect(h[0].donde).toBe('cuenta c01b0000 · empresa 7e35fa0e')
    expect(h[0].detalle).toBe('2026-10-04 local c01b0000: 1 pedido de tus marcas, sin resumen ni asiento, 306 h después de su cierre: la empresa está en IGIC y el cierre del día aún no sabe proponer su asiento de ventas (pendiente de construir): la última vez, sin propuesta — «Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.»')
    expect(h[0].norma).toContain('el IGIC en el cierre del día')
    expect(h[0].norma).toContain('#176')
    // Lo que decide el aviso en agente-libro.mjs: hay rojo o no.
    expect(h.some((x) => x.nivel === 'rojo')).toBe(false)
  })

  it('el mismo hueco en una empresa en IVA sigue en rojo, como antes', () => {
    const h = revisarLibro({ dia_sin_asiento: [{ ...REAL_20261017, igic: false }] })
    expect(h.map((x) => `${x.tipo}:${x.nivel}`)).toEqual(['dia_sin_asiento:rojo'])
    expect(h[0].detalle).toContain('el cierre del día no lo ha propuesto: la última vez, sin propuesta')
    // Un volcado de antes de este cambio (sin la columna) tampoco se calla.
    const sinColumna: Record<string, unknown> = { ...REAL_20261017 }
    delete sinColumna.igic
    expect(revisarLibro({ dia_sin_asiento: [sinColumna] })[0].nivel).toBe('rojo')
  })

  it('el informe lo enseña aparte, en verde: la regla 7, un umbral ordena y no esconde', () => {
    const t = informeLibro(revisarLibro({ dia_sin_asiento: [REAL_20261017] }), { donde: 'staging-conta', hoy: '2026-10-17', contado: {} })
    expect(t).toContain('**En verde**')
    expect(t).toContain('### Ya sabido (pendiente de construir; no abre aviso)')
    expect(t).toContain('| dia_sin_asiento_igic | cuenta c01b0000 · empresa 7e35fa0e |')
    expect(t).not.toContain('### Rojo')
  })

  it('el informe anónimo de producción lo cuenta aparte, no como ámbar', () => {
    const filas = anonimizar('libro diario', revisarLibro({ dia_sin_asiento: [REAL_20261017] }))
    const t = informeAnonimo('Agente «Libro diario»', filas, { donde: 'producción', hoy: '2026-10-17', mirado: 'Leído.' })
    expect(t).toContain('**En verde.**')
    expect(t).not.toContain('en ámbar')
    expect(t).toContain('Ya sabido: 1 (pendiente de construir; no abre aviso).')
    expect(t).toContain('| libro diario | sabido | dia_sin_asiento_igic | c01b0000 |')
  })
})
