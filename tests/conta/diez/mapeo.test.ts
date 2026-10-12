// Núcleo puro del C04b · T3: asiento de Diez → Folvy, huella y comparación por
// día. Datos inventados con la FORMA medida en los runs 7–10 (Fecha AAAAMMDD,
// series 1/2/3/4/9, cuentas de 8 cifras, Contrapartida en casi todas las
// líneas, Tercero y Justificante vacíos).

import { describe, expect, it } from 'vitest'
import { compararDia, convertirAsiento, fechaIso, huellaDe, type AsientoFolvy } from '../../../supabase/functions/_shared/diezMapeo'
import type { Apunte } from '../../../supabase/functions/_shared/diezCliente'

const base = (o: Partial<Apunte> = {}): Apunte => ({
  Ejercicio: '2025', Serie: '2', Documento: 1043, TipoAsiento: 2, Fecha: 20250915, Descripcion: 'FRA. PRUEBA',
  Detalles: [
    { Linea: 1, Cuenta: '60000000', Debe: 100, Haber: 0, Contrapartida: '40000001' },
    { Linea: 2, Cuenta: '47200000', Debe: 10, Haber: 0, Contrapartida: '40000001' },
    { Linea: 3, Cuenta: '40000001', Debe: 0, Haber: 110, Contrapartida: '60000000' },
  ],
  ...o,
})
const ok = async (a: Apunte) => {
  const r = await convertirAsiento(a)
  if (!('ok' in r)) throw new Error(r.rechazo.motivo)
  return r.ok
}
const motivo = async (a: Apunte) => {
  const r = await convertirAsiento(a)
  return 'rechazo' in r ? r.rechazo.motivo : null
}

describe('convertirAsiento', () => {
  it('el caso normal: céntimos, fecha, posiciones y concepto', async () => {
    const a = await ok(base())
    expect(a).toMatchObject({ ejercicio: '2025', serie: 2, numero: 1043, fecha: '2025-09-15', concepto: 'FRA. PRUEBA', debe: 11000, haber: 11000 })
    expect(a.lineas.map((l) => [l.posicion, l.cuenta, l.debe, l.haber, l.contrapartida])).toEqual([
      [1, '60000000', 10000, 0, '40000001'], [2, '47200000', 1000, 0, '40000001'], [3, '40000001', 0, 11000, '60000000'],
    ])
    expect(a.huella).toMatch(/^[0-9a-f]{64}$/)
  })

  it('al céntimo, sin errores de coma flotante (0,1 + 0,2)', async () => {
    const a = await ok(base({ Detalles: [{ Cuenta: '62900000', Debe: 0.1 }, { Cuenta: '62900001', Debe: 0.2 }, { Cuenta: '57000000', Haber: 0.3 }] }))
    expect([a.debe, a.haber]).toEqual([30, 30])
  })

  it('descuadrado por un céntimo: no se trae, y dice cuánto', async () => {
    expect(await motivo(base({ Detalles: [{ Cuenta: '62900000', Debe: 10.01 }, { Cuenta: '57000000', Haber: 10 }] }))).toBe('descuadrado: debe 10.01 y haber 10.00')
  })

  it('lo que Folvy no admite se trae sin cambiar ningún saldo, y se cuenta', async () => {
    const a = await ok(base({ Detalles: [
      { Linea: 1, Cuenta: '62900000', Debe: 50, Haber: 0 },
      { Linea: 2, Cuenta: '62900001', Debe: 0, Haber: 0 }, // a cero
      { Linea: 3, Cuenta: '62900002', Debe: -5, Haber: 0 }, // negativo
      { Linea: 4, Cuenta: '57000000', Debe: 3, Haber: 48 }, // los dos lados
    ] }))
    expect(a.ajustes).toEqual({ lineasACero: 1, negativos: 1, partidas: 1 })
    const saldo = (c: string, x: AsientoFolvy) => x.lineas.filter((l) => l.cuenta === c).reduce((s, l) => s + l.debe - l.haber, 0)
    expect(saldo('62900000', a)).toBe(5000)
    expect(saldo('62900002', a)).toBe(-500)
    expect(saldo('57000000', a)).toBe(300 - 4800)
    expect(a.lineas.every((l) => (l.debe > 0) !== (l.haber > 0))).toBe(true)
    expect([a.debe, a.haber]).toEqual([5300, 5300])
  })

  it('cada línea pasada de lado dice en qué lado de Diez iba en negativo; las demás, nada', async () => {
    const a = await ok(base({ Detalles: [
      { Linea: 1, Cuenta: '62900000', Debe: 50, Haber: 0 },
      { Linea: 2, Cuenta: '70800000', Debe: 0, Haber: -10.25 }, // abono en negativo: pasa al debe
      { Linea: 3, Cuenta: '62900002', Debe: -5, Haber: 0 }, // pasa al haber
      { Linea: 4, Cuenta: '57000000', Debe: 0, Haber: 57.25 },
      { Linea: 5, Cuenta: '55100001', Debe: 2, Haber: -3 }, // 2 propios + 3 del negativo, al debe
      { Linea: 6, Cuenta: '55100002', Debe: -4, Haber: -1 }, // los dos negativos: dos líneas, cada una con su lado
    ] }))
    const m = a.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.negativoEnDiez])
    expect(m).toEqual([
      ['62900000', 5000, 0, null],
      ['70800000', 1025, 0, 'haber'],
      ['62900002', 0, 500, 'debe'],
      ['57000000', 0, 5725, null],
      ['55100001', 500, 0, 'haber'],
      ['55100002', 100, 0, 'haber'],
      ['55100002', 0, 400, 'debe'],
    ])
    expect(a.ajustes.negativos).toBe(5)
    // La marca no entra en la huella: lo que se compara con Diez son cuenta, debe y haber.
    const sin = await ok(base({ Detalles: [{ Cuenta: '62900000', Debe: 10 }, { Cuenta: '57000000', Haber: 10 }] }))
    expect(sin.lineas.every((l) => l.negativoEnDiez === null)).toBe(true)
  })

  it.each([
    [{ Serie: '7' }, /serie 7/],
    [{ Serie: 'FOLVY' }, /serie FOLVY/],
    [{ Documento: undefined }, /sin número/],
    [{ Fecha: 20250231 }, /Fecha de Diez no válida: 20250231/],
    [{ Fecha: undefined }, /Fecha/],
    [{ Ejercicio: '25' }, /ejercicio/],
    [{ Detalles: [{ Cuenta: '62900000', Debe: 1 }] }, /1 línea con importe/],
    [{ Detalles: [{ Cuenta: '', Debe: 1 }, { Cuenta: '57000000', Haber: 1 }] }, /cuenta no válida/],
  ] as [Partial<Apunte>, RegExp][])('rechaza %j', async (o, re) => {
    expect(await motivo(base(o))).toMatch(re)
  })

  it('las líneas van en el orden de Diez (Linea), no en el de llegada', async () => {
    const a = await ok(base({ Detalles: [{ Linea: 2, Cuenta: '57000000', Haber: 1 }, { Linea: 1, Cuenta: '62900000', Debe: 1 }] }))
    expect(a.lineas.map((l) => l.cuenta)).toEqual(['62900000', '57000000'])
  })

  it('sin descripción: la de la primera línea que la tenga, y si no, una que diga de dónde viene', async () => {
    expect((await ok(base({ Descripcion: '  ', Detalles: [{ Cuenta: '62900000', Debe: 1 }, { Cuenta: '57000000', Haber: 1, Descripcion: 'PAGO' }] }))).concepto).toBe('PAGO')
    expect((await ok(base({ Descripcion: undefined, Detalles: [{ Cuenta: '62900000', Debe: 1 }, { Cuenta: '57000000', Haber: 1 }] }))).concepto).toBe('Asiento 2/1043 traído de Diez')
  })
})

describe('huella (idempotencia)', () => {
  it('la misma lectura dos veces da la misma huella; un céntimo o una cuenta la cambian; el texto no', async () => {
    const h = (await ok(base())).huella
    expect((await ok(base())).huella).toBe(h)
    expect((await ok(base({ Descripcion: 'OTRO TEXTO' }))).huella).toBe(h)
    const d = base().Detalles!
    expect((await ok(base({ Detalles: [{ ...d[0], Debe: 100.01 }, d[1], { ...d[2], Haber: 110.01 }] }))).huella).not.toBe(h)
    expect((await ok(base({ Detalles: [{ ...d[0], Cuenta: '60000001' }, d[1], d[2]] }))).huella).not.toBe(h)
    expect((await ok(base({ Fecha: 20250916 }))).huella).not.toBe(h)
  })
  it('es la misma función que usa quien compara', async () => {
    const a = await ok(base())
    expect(await huellaDe(a)).toBe(a.huella)
  })
})

describe('compararDia', () => {
  const r = (clave: string, huella = 'h', debe = 100) => ({ clave, huella, debe, haber: debe })
  it('igual', () => {
    const c = compararDia('2026-10-01', [r('2026/1/1'), r('2026/1/2')], [r('2026/1/2'), r('2026/1/1')])
    expect(c).toMatchObject({ estado: 'igual', diferencias: [], folvy: { n: 2, debe: 200 }, diez: { n: 2, debe: 200 } })
  })
  it('un día sin asientos en ninguno de los dos es igual', () => {
    expect(compararDia('2026-10-04', [], []).estado).toBe('igual')
  })
  it('distinto: cada diferencia con su clave', () => {
    const c = compararDia('2026-10-01', [r('2026/1/1'), r('2026/1/2', 'x', 150), r('2026/1/3')], [r('2026/1/1'), r('2026/1/2'), r('2026/1/4')])
    expect(c.estado).toBe('distinto')
    expect(c.diferencias).toEqual([
      { tipo: 'distinto', clave: '2026/1/2', folvy: { debe: 150, haber: 150 }, diez: { debe: 100, haber: 100 } },
      { tipo: 'solo_folvy', clave: '2026/1/3' },
      { tipo: 'solo_diez', clave: '2026/1/4' },
    ])
  })
  it('solo de un lado', () => {
    expect(compararDia('d', [r('a')], []).estado).toBe('solo_folvy')
    expect(compararDia('d', [], [r('a')]).estado).toBe('solo_diez')
  })
  it('una clave repetida es un error, no una comparación', () => {
    expect(() => compararDia('d', [r('a'), r('a')], [])).toThrow(/repetida/)
  })
})

describe('fechaIso', () => {
  it.each([[20240229, '2024-02-29'], ['20231001', '2023-10-01']])('%s', (x, y) => expect(fechaIso(x)).toBe(y))
  it.each([20230229, 2023101, 'abc', null])('%s no', (x) => expect(() => fechaIso(x)).toThrow())
})
