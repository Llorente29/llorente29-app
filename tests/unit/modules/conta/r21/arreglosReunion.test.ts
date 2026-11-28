// R21c · Lo que ve QBO: nombres y no números, el concepto del que paga y no el texto del banco en bruto, y un cuadre que
// dice qué es cada euro. Nombres inventados (T11).
import { describe, expect, it } from 'vitest'
import { arreglarTildes, conceptoDelBanco, explicarDiferencia, quienEs } from '../../../../../src/modules/conta/gestoria/r21/armar'
import { cuadreDelMes } from '../../../../../supabase/functions/_shared/factura/facturarMes'
import type { PlanCobro } from '../../../../../supabase/functions/_shared/cegidBanco'

const NOV = '2026-11'

describe('R21c · el texto del banco', () => {
  it('se queda con lo que escribió el que paga y arregla las tildes', () => {
    expect(conceptoDelBanco('TRANSFER INMEDIATA, PERSONA INVENTADA UNO, PERSONA INVENTADA UNO, 000001020261106, PERSONA INVENTADA UNO BSCHESMMXXX, baja aut**nomo', 'transferencia'))
      .toBe('baja autónomo')
    expect(conceptoDelBanco('TRASPASO, , 2do pago gestor**a', 'traspaso')).toBe('2do pago gestoría')
    expect(conceptoDelBanco('TRASPASO, , Balance Econ**mico', 'traspaso')).toBe('Balance Económico')
  })
  it('si el último trozo es el nombre, el BIC o el ORIGEN, no hay concepto', () => {
    expect(conceptoDelBanco('TRANSF. A SU FAVOR, 00000000-PERSONA INVENTADA, 020261125018252, 00000000-PERSONA INVENTADA ORIGEN: 00000000', 'transferencia')).toBeNull()
    expect(conceptoDelBanco('TRANSFER INMEDIATA, PERSONA INVENTADA, PERSONA INVENTADA, 000001, PERSONA INVENTADA BSCHESMMXXX', 'transferencia')).toBeNull()
    expect(conceptoDelBanco('TRANSFER INMEDIATA, PERSONA INVENTADA, 000001, PERSONA INVENTADA', 'transferencia')).toBeNull()
  })
  it('con tarjeta, el texto es de Sumied (técnico) y no se enseña', () => {
    expect(conceptoDelBanco('hay tres pagos de 96,80 €', 'tarjeta')).toBeNull()
  })
  it('las tildes que no conoce se quedan sin los asteriscos', () => {
    expect(arreglarTildes('regularizaci**n y cami**n')).toBe('regularización y camin')
  })
})

describe('R21c · nombres, no números', () => {
  it('«Nombre (código)»; sin nombre, «El cliente N»', () => {
    const n = new Map<number, string | null>([[122, 'Persona Inventada'], [9, null]])
    expect([quienEs(122, n), quienEs(9, n), quienEs(null, n)]).toEqual(['Persona Inventada (122)', 'El cliente 9', null])
  })
})

const plan = (clave: string, importe: number, o: Partial<PlanCobro> & { tarjetaSinAbono?: boolean } = {}): PlanCobro => ({
  cobro: { clave, tipo: o.tarjetaSinAbono ? 'tarjeta' : 'banco', movementId: o.tarjetaSinAbono ? null : 'm', fecha: '2026-11-10', importe, via: o.tarjetaSinAbono ? 'tarjeta' : 'transferencia',
    estado: 'x', texto: null, codigo: 5, recibos: [], decision: null },
  estado: o.estado ?? 'para_julio', cliente: o.cliente ?? 5, lineas: [], porque: '', pagaFacturaCent: o.pagaFacturaCent ?? 0, noCobroCent: o.noCobroCent ?? 0,
})

describe('R21c · el cuadre dice qué es cada euro', () => {
  const gc = [
    { gcId: 'PM1', estado: 'paid_out', fecha: '2026-11-04', importe: 100, nombre: 'Uno', codigoCegid: 1, partyId: 'p1' },
    { gcId: 'PM2', estado: 'paid_out', fecha: '2026-11-04', importe: 48.4, nombre: 'Dos', codigoCegid: 2, partyId: 'p2' },
    { gcId: 'PM3', estado: 'paid_out', fecha: '2026-11-04', importe: 12.1, nombre: null, codigoCegid: null, partyId: null },
    { gcId: 'PM4', estado: 'paid_out', fecha: '2026-11-04', importe: 20, nombre: null, codigoCegid: null, partyId: null },
    { gcId: 'PM5', estado: 'failed', fecha: '2026-11-04', importe: 99, nombre: null, codigoCegid: null, partyId: null },
  ]
  const planes = [plan('mov:a', 60, { pagaFacturaCent: 6000 }), plan('mov:b', 30), plan('tpv:c', 96.8, { tarjetaSinAbono: true }), plan('mov:d', 7, { noCobroCent: 700 })]
  const e = { mes: NOV, gc, planes, mandadas: new Map([['PM1', 10000]]), porMandarGc: new Set<string>(), serie3: new Map([['PM2', 4840]]),
    pendientes: [{ clave: 'gc:PM3' }, { clave: 'mov:b' }, { clave: 'tpv:c' }], nombresGc: new Map([['PM4', 'Cuatro de GoCardless']]), nombresCegid: new Map<number, string | null>() }

  it('cada cobro en una fila: serie 3 aparte, la tarjeta sin abono fuera de pendientes, y lo que falta con su nombre', () => {
    const x = explicarDiferencia(e)
    expect(x.despuesCent).toBe(4840)
    expect(x.pendientesCent).toBe(1210 + 3000)
    expect(x.sinExplicar).toEqual([{ clave: 'PM4', texto: 'Cuatro de GoCardless, GoCardless del 04/11', cent: 2000 }])
  })
  it('cobrado − mandado − paga facturas − serie 3 − pendientes = la suma de lo sin explicar', () => {
    const x = explicarDiferencia(e)
    // cobrado como cuadreVias: GoCardless 100 + 48,40 + 12,10 + 20; banco 60 + 30 + 7 (la tarjeta sin abono no cuenta); no es cobro 7.
    const c = cuadreDelMes(NOV, { cobradoCent: 18050 + 9700, noEsCobroCent: 700, mandadoCent: 10000, pagaFacturasCent: 6000, despuesCent: x.despuesCent, pendientesCent: x.pendientesCent, sinExplicar: x.sinExplicar }, [])
    expect(c.diferenciaCent).toBe(x.sinExplicar.reduce((s, p) => s + p.cent, 0))
    expect(c.sinExplicar).toHaveLength(1)
  })
  it('si se deja también el que faltaba, cuadra a 0,00 € y no queda nada sin explicar', () => {
    const x = explicarDiferencia({ ...e, pendientes: [...e.pendientes, { clave: 'gc:PM4' }] })
    const c = cuadreDelMes(NOV, { cobradoCent: 27750, noEsCobroCent: 700, mandadoCent: 10000, pagaFacturasCent: 6000, despuesCent: x.despuesCent, pendientesCent: x.pendientesCent, sinExplicar: x.sinExplicar }, [])
    expect([c.cuadra, c.sinExplicar]).toEqual([true, []])
  })
})
