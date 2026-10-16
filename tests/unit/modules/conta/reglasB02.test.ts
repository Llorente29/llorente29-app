// tests/unit/modules/conta/reglasB02.test.ts
//
// B02 · Reglas que no hacen daño: en qué se basan, qué cambiarían, el freno de
// los textos genéricos y de dónde nacen. Datos INVENTADOS que copian la forma
// de los del banco de verdad (las etiquetas del banco son las del Excel de BBVA).

import { describe, expect, it } from 'vitest'
import { casaSola, esEtiquetaDelBanco, examinarRegla, reglaDesdeLinea, reglasQuePropongo, revisarReglas, type MovRegla } from '@/modules/conta/lib/reglasBanco'

let n = 0
const mov = (p: Partial<MovRegla> & { concepto: string; importeCent: number }): MovRegla =>
  ({ id: `m${++n}`, fecha: `2026-10-${String((n % 28) + 1).padStart(2, '0')}`, contraparte: null, sinCasar: true, ...p })
const MOVS: MovRegla[] = [
  ...[1, 2, 3].map(() => mov({ concepto: 'PAGO CON TARJETA EN DISCOS, LIBROS · ************3085 RECARGAS INVENTADAS', contraparte: 'Recargas Inventadas', importeCent: -10_000 })),
  mov({ concepto: 'PAGO CON TARJETA · ************3085 KIOSCO DE LA ESQUINA', contraparte: 'Kiosco de la Esquina', importeCent: -450 }),
  mov({ concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS · PAGO FACT', contraparte: 'Distribuciones Inventadas', importeCent: -24_861 }),
  mov({ concepto: 'TRANSFERENCIAS · ALQUILERES DEL NORTE', contraparte: 'Alquileres del Norte', importeCent: -120_000, sinCasar: false }),
]
const CASADOS = [
  { concepto: 'TRANSFERENCIAS DISTRIBUCIONES INVENTADAS', cuenta: '40000009' },
  { concepto: 'TRANSFERENCIAS ALQUILERES DEL NORTE', cuenta: '62100000' },
]
const nombres = { '40700001': 'Saldo prepago', '62100000': 'Arrendamientos', '40000009': 'Distribuciones Inventadas' }

describe('en qué se basa y qué cambiaría', () => {
  it('ejemplos (del más reciente al más antiguo) y cuántos pendientes pasarían a propuesta', () => {
    const ex = examinarRegla({ contiene: 'RECARGAS INVENTADAS', signo: -1 }, MOVS)
    expect(ex.ejemplos).toHaveLength(3)
    expect(ex.ejemplos.map((m) => m.fecha)).toEqual([...ex.ejemplos.map((m) => m.fecha)].sort().reverse())
    expect(ex).toMatchObject({ cambiaria: 3, contrapartes: ['RECARGAS INVENTADAS'], generica: null })
  })
  it('lo ya casado se cuenta en «se basa» pero no en «cambiaría»', () => {
    expect(examinarRegla({ contiene: 'ALQUILERES DEL NORTE' }, MOVS)).toMatchObject({ cambiaria: 0, generica: null })
    expect(examinarRegla({ contiene: 'ALQUILERES DEL NORTE' }, MOVS).ejemplos).toHaveLength(1)
  })
  it('el signo cuenta: una regla de pagos no casa cobros', () => {
    expect(examinarRegla({ contiene: 'RECARGAS INVENTADAS', signo: 1 }, MOVS).ejemplos).toHaveLength(0)
  })
})

describe('el freno: nunca una regla con un texto que comparten varias', () => {
  it('las etiquetas del banco no dicen de quién es («TRANSFERENCIAS», «PAGO CON TARJ», «LIQ OP TRANSFEREN»)', () => {
    for (const t of ['TRANSFERENCIAS', 'PAGO CON TARJ', 'LIQ OP TRANSFEREN', 'pago con tarjeta']) expect(esEtiquetaDelBanco(t), t).toBe(true)
    expect(examinarRegla({ contiene: 'LIQ OP TRANSFEREN' }, MOVS).generica).toBe('«LIQ OP TRANSFEREN» es lo que pone el banco en muchos movimientos distintos, no dice de quién es.')
  })
  it('un texto que comparten varias contrapartes', () => {
    expect(examinarRegla({ contiene: 'TARJETA' }, MOVS).generica).toMatch(/es lo que pone el banco/)
    expect(examinarRegla({ contiene: '3085' }, MOVS).generica).toBe('«3085» lo comparten 2 contrapartes distintas: casaría cosas que no van juntas.')
  })
  it('un texto cuyo pasado ha ido a varias cuentas', () => {
    const casados = [{ concepto: 'PAGO INVENTADO NORTE', cuenta: '62800000' }, { concepto: 'PAGO INVENTADO NORTE BIS', cuenta: '62900000' }]
    expect(examinarRegla({ contiene: 'INVENTADO NORTE' }, [], casados).generica).toBe('Lo que tiene «INVENTADO NORTE» ya ha ido a 2 cuentas distintas: no siempre va al mismo sitio.')
  })
  it('las guardadas también se revisan (el agente, cada noche): cuáles son genéricas y por qué', () => {
    const r = revisarReglas([{ id: 'a', contiene: 'TRANSFERENCIAS', signo: null }, { id: 'b', contiene: 'RECARGAS INVENTADAS', signo: -1 }], MOVS, CASADOS)
    expect(r).toEqual([{ id: 'a', contiene: 'TRANSFERENCIAS', porque: '«TRANSFERENCIAS» es lo que pone el banco en muchos movimientos distintos, no dice de quién es.' }])
  })
})

describe('de dónde nace una regla', () => {
  const ctx = (aprendido: { contraparte: string; cuenta: string; veces: number }[]) => ({ aprendido: aprendido.map((a) => ({ ...a, terceroId: null })), reglas: [], nombres })
  it('de lo hecho al menos 3 veces igual (con 2, todavía no)', () => {
    expect(reglasQuePropongo(ctx([{ contraparte: 'RECARGAS INVENTADAS', cuenta: '40700001', veces: 2 }]), MOVS).propongo).toEqual([])
    const r = reglasQuePropongo(ctx([{ contraparte: 'RECARGAS INVENTADAS', cuenta: '40700001', veces: 3 }]), MOVS)
    expect(r.propongo).toEqual([{ palabras: 'Cuando el concepto tenga «RECARGAS INVENTADAS» → Saldo prepago · 40700001', contiene: 'RECARGAS INVENTADAS', cuenta: '40700001', terceroId: null, veces: 3 }])
  })
  it('lo genérico va a «No la propongo», con el porqué; y lo que también fue a otra cuenta', () => {
    const r = reglasQuePropongo(ctx([{ contraparte: 'TRANSFERENCIAS', cuenta: '40000009', veces: 5 },
      { contraparte: 'ALQUILERES DEL NORTE', cuenta: '62100000', veces: 4 }, { contraparte: 'ALQUILERES DEL NORTE', cuenta: '62200000', veces: 1 }]), MOVS)
    expect(r.propongo).toEqual([])
    expect(r.noPropongo.map((x) => [x.contiene, x.porque])).toEqual([
      ['TRANSFERENCIAS', '«TRANSFERENCIAS» es lo que pone el banco en muchos movimientos distintos, no dice de quién es.'],
      ['ALQUILERES DEL NORTE', '«ALQUILERES DEL NORTE» ya ha ido también a 62200000: no siempre va al mismo sitio.'],
    ])
  })
  it('«Guárdalo como regla» desde una línea: precargada con su contraparte, su signo y si es genérica', () => {
    const r = reglaDesdeLinea(MOVS[0], '40700001', { nombres }, MOVS)
    expect(r).toEqual({ contiene: 'RECARGAS INVENTADAS', signo: -1, palabras: 'Cuando el concepto tenga «RECARGAS INVENTADAS» → Saldo prepago · 40700001', generica: null })
    const sinNombre = reglaDesdeLinea(mov({ concepto: 'TRANSFERENCIAS', importeCent: -100 }), '40000009', { nombres }, MOVS)
    expect(sinNombre.generica).toMatch(/es lo que pone el banco/)
  })
  it('casa sola a la 3.ª confirmación', () => {
    expect([0, 2, 3, 7].map(casaSola)).toEqual([false, false, true, true])
  })
})
