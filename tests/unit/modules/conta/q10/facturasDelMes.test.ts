// tests/unit/modules/conta/q10/facturasDelMes.test.ts
//
// Q10 · Las facturas de noviembre desde los cobros de GoCardless. Datos
// inventados (T11). Los importes son de los que hay de verdad en noviembre
// (121, 60,50, 24,20, 12,10 sin retención; 53, 21,20 con el 15 %), para que la
// prueba lleve la contraria si el desglose no da (regla 31).

import { describe, expect, it } from 'vitest'
import {
  comprobarFecha, comprobarSerie, desglose, facturasDelMes, numerar, partirNumero, retencionesDeErp10, textoDeLaCuota,
  type CobroQ10, type EntradaQ10, type FichaQ10,
} from '@/modules/conta/gestoria/q10/facturasDelMes'

const cobro = (gcId: string, importe: number, o: Partial<CobroQ10> = {}): CobroQ10 =>
  ({ gcId, estado: 'paid_out', fecha: '2026-11-04', importe, suscripcionId: `SB-${gcId}`, mandatoId: `MD-${gcId}`, motivo: null, ...o })
const ficha = (partyId: string, nif: string | null = '00000000T'): FichaQ10 => ({ partyId, nombre: `Cliente ${partyId}`, nif, direccion: null })

function entrada(cobros: CobroQ10[], o: Partial<EntradaQ10> = {}): EntradaQ10 {
  return {
    mes: '2026-11',
    empresa: { id: 'e1', nombre: 'Gestoría de Prueba, S.L.', retiene: false },
    cobros,
    suscripciones: cobros.map((c) => ({ gcId: `SB-${c.gcId}`, nombre: 'GESTORIA MENSUAL', gcClienteId: `CU-${c.gcId}` })),
    mandatos: cobros.map((c) => ({ gcId: `MD-${c.gcId}`, gcClienteId: `CU-${c.gcId}` })),
    enlaces: cobros.map((c) => ({ gcClienteId: `CU-${c.gcId}`, partyId: `p-${c.gcId}`, estado: 'atado' })),
    fichas: cobros.map((c) => ficha(`p-${c.gcId}`)),
    retenciones: new Map(),
    ...o,
  }
}

describe('Q10 · el desglose: el total igual al cobro, al céntimo', () => {
  it('sin retención, los importes de noviembre', () => {
    for (const [total, base] of [[12100, 10000], [6050, 5000], [2420, 2000], [1210, 1000], [14520, 12000], [3630, 3000]]) {
      const d = desglose(total, 0)!
      expect(d.baseCent).toBe(base)
      expect(d.baseCent + d.ivaCent - d.retCent).toBe(total)
      expect(d.retCent).toBe(0)
    }
  })
  it('con el 15 % de la autónoma: 53 € son 50 de base, 10,50 de IVA y 7,50 de retención', () => {
    expect(desglose(5300, 15)).toEqual({ baseCent: 5000, ivaCent: 1050, retCent: 750 })
    expect(desglose(2120, 15)).toEqual({ baseCent: 2000, ivaCent: 420, retCent: 300 })
  })
  it('cualquier total de 1 a 500 € sin retención cuadra con alguna base, o dice que no', () => {
    for (let t = 1; t <= 50000; t++) {
      const d = desglose(t, 0)
      if (d) expect(d.baseCent + d.ivaCent).toBe(t)
    }
  })
  it('si ninguna base da el total, null: nunca a ojo', () => {
    // 0,01 €: la base de 0,01 da 0,01 + 0 de IVA… cuadra; 0,02 con el 15 % no tiene base.
    const malos = Array.from({ length: 2000 }, (_, i) => i + 1).filter((t) => desglose(t, 15) === null)
    expect(malos.length).toBeGreaterThan(0)
    for (const t of malos) expect(desglose(t, 15)).toBeNull()
  })
})

describe('Q10 · una factura por cada cobro cobrado', () => {
  it('cuadra: N facturas, el total de GoCardless y «Cuadra»', () => {
    const m = facturasDelMes(entrada([cobro('A', 121), cobro('B', 60.5, { estado: 'confirmed', fecha: '2026-11-24' })]))
    expect(m.facturas).toHaveLength(2)
    expect(m.pendientes).toEqual([])
    expect(m.cobradoCent).toBe(18150)
    expect(m.facturasCent).toBe(18150)
    expect(m.frase).toBe('Noviembre: 2 facturas, 181,50 €. GoCardless cobró 181,50 €. Cuadra.')
    expect(m.cuadra).toBe(true)
  })
  it('cada una dice la cuota y el día real del cobro, y la línea es la suscripción', () => {
    const m = facturasDelMes(entrada([cobro('A', 24.2, { fecha: '2026-11-03' })], {
      suscripciones: [{ gcId: 'SB-A', nombre: 'GESTION LABORAL  TRABAJADOR INVENTADO', gcClienteId: 'CU-A' }],
    }))
    expect(m.facturas[0].texto).toBe('Cuota de noviembre de 2026 · cobrada el 03/11/2026')
    expect(m.facturas[0].concepto).toBe('GESTION LABORAL TRABAJADOR INVENTADO')
    expect(textoDeLaCuota('2026-12', '2026-12-04')).toBe('Cuota de diciembre de 2026 · cobrada el 04/12/2026')
  })
  it('los fallidos, devueltos y pendientes no llevan factura: salen aparte, con su motivo', () => {
    const m = facturasDelMes(entrada([
      cobro('A', 121), cobro('B', 121, { estado: 'failed', motivo: 'Fondos insuficientes' }),
      cobro('C', 53, { estado: 'charged_back' }), cobro('D', 10, { estado: 'pending_submission' }),
    ]))
    expect(m.facturas.map((f) => f.cobro.gcId)).toEqual(['A'])
    expect(m.sinFactura.map((x) => x.cobro.gcId)).toEqual(['B', 'C', 'D'])
    expect(m.sinFactura[0].porque).toBe('Fallido: GoCardless no lo pudo cobrar (Fondos insuficientes). No lleva factura.')
    expect(m.sinFactura[1].porque).toMatch(/^Devuelto por el banco/)
    expect(m.sinFactura[2].porque).toMatch(/^Pendiente/)
    // Lo que no se cobró no cuenta en «GoCardless cobró».
    expect(m.cobradoCent).toBe(12100)
    expect(m.cuadra).toBe(true)
  })
  it('solo el mes que se pide', () => {
    const m = facturasDelMes(entrada([cobro('A', 121), cobro('B', 121, { fecha: '2026-10-31' }), cobro('C', 121, { fecha: '2026-12-01' })]))
    expect(m.facturas.map((f) => f.cobro.gcId)).toEqual(['A'])
  })
})

describe('Q10 · lo que no se puede facturar va a «Pendiente de revisar», con su motivo', () => {
  it('sin cliente atado, sin NIF y cobro suelto sin suscripción', () => {
    const cs = [cobro('A', 121), cobro('B', 121), cobro('C', 121), cobro('D', 121, { suscripcionId: null })]
    const e = entrada(cs)
    const m = facturasDelMes({
      ...e,
      enlaces: e.enlaces.map((x) => (x.gcClienteId === 'CU-A' ? { ...x, estado: 'propuesto' } : x)),
      fichas: e.fichas.map((f) => (f.partyId === 'p-B' ? { ...f, nif: ' ' } : f)),
    })
    expect(m.facturas.map((f) => f.cobro.gcId)).toEqual(['C'])
    expect(m.pendientes.map((p) => [p.cobro.gcId, p.motivo])).toEqual([['A', 'sin_cliente'], ['B', 'sin_nif'], ['D', 'sin_suscripcion']])
    expect(m.pendientes[0].porque).toMatch(/«Cobros de GoCardless sin cliente»/)
    expect(m.frase).toBe('Noviembre: 1 factura, 121,00 €. GoCardless cobró 484,00 €. Faltan 3 (363,00 €): mira abajo.')
    expect(m.cuadra).toBe(false)
  })
  it('un cobro suelto sin suscripción encuentra su cliente por el mandato, y aun así no se adivina el servicio', () => {
    const m = facturasDelMes(entrada([cobro('A', 121, { suscripcionId: null })]))
    expect(m.pendientes[0]).toMatchObject({ motivo: 'sin_suscripcion', gcClienteId: 'CU-A', ficha: { partyId: 'p-A' } })
  })
})

describe('Q10 · la retención de la autónoma', () => {
  const autonoma = { id: 'e2', nombre: 'Autónoma de Prueba', retiene: true }
  it('con el 15 % de su última factura: base, IVA y retención', () => {
    const m = facturasDelMes(entrada([cobro('A', 53)], { empresa: autonoma, retenciones: new Map([['p-A', 15]]) }))
    expect(m.facturas[0]).toMatchObject({ baseCent: 5000, ivaCent: 1050, retencion: { pct: 15, cent: 750 }, totalCent: 5300 })
  })
  it('a un particular (su última factura sin retención), sin retención', () => {
    const m = facturasDelMes(entrada([cobro('A', 12.1)], { empresa: autonoma, retenciones: new Map([['p-A', 0]]) }))
    expect(m.facturas[0]).toMatchObject({ baseCent: 1000, ivaCent: 210, retencion: null, totalCent: 1210 })
  })
  it('si no se sabe, «Pendiente de revisar»', () => {
    const m = facturasDelMes(entrada([cobro('A', 53)], { empresa: autonoma }))
    expect(m.pendientes.map((p) => p.motivo)).toEqual(['sin_retencion'])
  })
  it('QBO no retiene: el mapa no cuenta', () => {
    const m = facturasDelMes(entrada([cobro('A', 121)], { retenciones: new Map([['p-A', 15]]) }))
    expect(m.facturas[0].retencion).toBeNull()
    expect(m.facturas[0].baseCent).toBe(10000)
  })
  it('con el 15 % y un importe sin retención (60,50), no cuadra: a revisar', () => {
    const m = facturasDelMes(entrada([cobro('A', 60.5)], { empresa: autonoma, retenciones: new Map([['p-A', 15]]) }))
    expect(desglose(6050, 15)).toBeNull()
    expect(m.pendientes.map((p) => p.motivo)).toEqual(['no_cuadra'])
  })
  it('de ERP10: la última factura emitida de cada NIF manda', () => {
    const fichas = [ficha('p1', '00000000T'), ficha('p2', 'B00000000'), ficha('p3', 'X0000000T')]
    const r = retencionesDeErp10([
      { cuenta: '43000001', nif: '00000000T', numero: '2026/1/500', fecha: 20260905, retencion: { tipo: 15, importe: 750 } },
      { cuenta: '43000001', nif: '00000000-T', numero: '2026/1/560', fecha: 20261006, retencion: null },
      { cuenta: '43000002', nif: 'ESB00000000', numero: '2026/1/561', fecha: 20261006, retencion: { tipo: 15, importe: 300 } },
      // Una recibida (la cuenta no es de cliente): no cuenta.
      { cuenta: '40000009', nif: 'X0000000T', numero: 'F-1', fecha: 20261010, retencion: { tipo: 15, importe: 100 } },
    ], fichas)
    expect([...r.entries()]).toEqual([['p1', 0], ['p2', 15]])
  })
})

describe('Q10 · numeración seguida y sin huecos, y la serie que no cuadra', () => {
  it('desde la 2745, en el orden del cobro', () => {
    const m = facturasDelMes(entrada([cobro('B', 121, { fecha: '2026-11-05' }), cobro('A', 121, { fecha: '2026-11-03' }), cobro('C', 121, { fecha: '2026-11-05' })]))
    expect(m.facturas.map((f) => f.cobro.gcId)).toEqual(['A', 'B', 'C'])
    expect(numerar(m.facturas, 2026, '1', 2745)).toEqual(['2026/1/2745', '2026/1/2746', '2026/1/2747'])
  })
  it('el número de ERP10, con o sin ceros', () => {
    expect(partirNumero('2026/1/2744')).toEqual({ anio: 2026, serie: '1', numero: 2744 })
    expect(partirNumero(' 2026 / 1 / 002744 ')).toEqual({ anio: 2026, serie: '1', numero: 2744 })
    expect(partirNumero('F-2744')).toBeNull()
  })
  it('la última en ERP10 es la de antes: sigue', () => {
    const r = comprobarSerie(['2026/1/2738', '2026/1/2744', '2026/1/2740', '2025/1/9000'], { anio: 2026, serie: '1', desde: 2745 })
    expect(r).toEqual({ ok: true, ultimo: 2744, frase: 'La última factura en ERP10 es la 2026/1/2744: la primera de Sumied será la 2026/1/2745.' })
  })
  it('si no es la esperada, PARA y lo dice', () => {
    expect(comprobarSerie(['2026/1/2746'], { anio: 2026, serie: '1', desde: 2745 })).toMatchObject({ ok: false, ultimo: 2746,
      frase: 'La última factura de la serie en ERP10 es la 2026/1/2746, y se esperaba la 2026/1/2744. No se emite hasta que cuadre.' })
    expect(comprobarSerie([], { anio: 2026, serie: '1', desde: 574 }).ok).toBe(false)
  })
})

describe('Q10 · la fecha: el día en que se emiten, nunca futura', () => {
  it('hoy vale', () => expect(comprobarFecha('2026-11-26', '2026-11-26', '2026-11-06')).toBeNull())
  it('futura, no', () => expect(comprobarFecha('2026-11-27', '2026-11-26', null)).toMatch(/es futura/))
  it('otro día que no es hoy, no', () => expect(comprobarFecha('2026-11-24', '2026-11-26', null)).toMatch(/el día en que se emiten/))
  it('nunca antes de la última de la serie', () => expect(comprobarFecha('2026-11-05', '2026-11-05', '2026-11-06')).toMatch(/del 06\/11\/2026/))
})

describe('Q10 · quién factura con retención y por dónde sigue la serie', async () => {
  const { retieneQ10, SERIE_Q10 } = await import('@/modules/conta/gestoria/q10/serie')
  it('una persona física (DNI o NIE) sí; una sociedad no', () => {
    expect(retieneQ10('00000000T')).toBe(true)
    expect(retieneQ10('X0000000T')).toBe(true)
    expect(retieneQ10('ES00000000T')).toBe(true)
    expect(retieneQ10('B00000000')).toBe(false)
    expect(retieneQ10(null)).toBe(false)
  })
  it('las dos series siguen la de Cegid: 2745 y 574', () => {
    expect(Object.values(SERIE_Q10).map((x) => `${x.anio}/${x.serie}/${x.desde}`).sort()).toEqual(['2026/1/2745', '2026/1/574'])
  })
})
