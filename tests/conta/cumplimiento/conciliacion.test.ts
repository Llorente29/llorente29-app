// tests/conta/cumplimiento/conciliacion.test.ts
//
// B01 · El agente «Conciliación», la parte de cada noche
// (scripts/conta/lib/conciliacion.mjs). La fixture es el volcado REAL de
// scripts/conta/agente-conciliacion.sql contra staging-conta el 14/10 (regla
// 31), ya con la regla de la respuesta 5: 15 movimientos sin casar (las e2e
// del B01 los dejan pendientes al acabar), todos pasados por el agente (20
// pasadas en 48 h): nada que avisar. El 13/10, con la regla de antes («ninguna
// pasada en 48 h»), los mismos 15 salían en ámbar. Los casos en rojo y en
// ámbar se construyen sobre esta fixture, cambiando una lista cada vez.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NORMAS, informeConciliacion, revisarConciliacion } from '../../../scripts/conta/lib/conciliacion.mjs'

const real = JSON.parse(readFileSync('tests/conta/cumplimiento/datos/conciliacion_staging_20261014.json', 'utf8'))
const A = { account_id: 'c01a0000-0000-4000-8000-00000000000a', company_id: '3b34403a-a7d6-4a48-a8d7-737e8cababdc' }

describe('agente «Conciliación»', () => {
  it('sobre el volcado real de staging: 15 sin casar, todos pasados por el agente → nada que avisar', () => {
    const h = revisarConciliacion(real)
    expect(h).toEqual([])
    const t = informeConciliacion(h, { donde: 'staging-conta', hoy: '2026-10-14', contado: real.contado })
    expect(t).toContain('Mirados: 15 movimientos de 1 empresas (0 casados, 15 sin casar), 6 extractos, 0 reglas, 0 meses cerrados; 20 pasadas del agente en 48 h.')
    expect(t).toContain('**En verde**')
  })

  it('respuesta 5: solo avisa de los movimientos que el agente no ha pasado, con su última pasada', () => {
    const h = revisarConciliacion({ ...real, sin_pasada: [
      { ...A, sin_pasar: 4, ultima: '2026-10-13T23:10:00+00:00' },
      { account_id: 'c01b0000-0000-4000-8000-00000000000b', company_id: 'b0b0b0b0-0000-4000-8000-000000000001', sin_pasar: 2, ultima: null },
    ] })
    expect(h.map((x) => [x.nivel, x.detalle])).toEqual([
      ['ambar', '4 movimientos que el agente no ha pasado (entraron después de su última pasada, el 2026-10-13)'],
      ['ambar', '2 movimientos que el agente no ha pasado (nunca ha pasado)'],
    ])
    expect(h.every((x) => x.norma === NORMAS.sin_pasada)).toBe(true)
  })

  it('cada comprobación en rojo dice qué y dónde, sin nombres', () => {
    const roto = {
      ...real,
      casado_dos_veces: [{ ...A, id: 'aaaaaaaa-1', que: 'movimiento', n: 2 }],
      asiento_sin_movimiento: [{ ...A, id: 'bbbbbbbb-1', fecha: '2026-10-03', estado: 'propuesto' }],
      mes_cerrado: [{ ...A, banco: 'b0100000-3', mes: '2026-09', a_sabiendas: false, libro_al_cerrar: 2400, libro_hoy: 2500, diferencia: 0, sueltos: 0 }],
      regla_sin_registro: [{ ...A, id: 'cccccccc-1', estado: 'activa', ultimo: 'apagada' }],
      extracto: [{ ...A, id: 'dddddddd-1', banco: 'b', desde: '2026-10-01', hasta: '2026-10-13', motivo: 'sus cuentas no cuadran', hueco: null }],
      consentimiento: [{ ...A, id: 'eeeeeeee-1', proveedor: 'enable_banking', caduca: '2026-10-10', dias: -3 }],
    }
    const h = revisarConciliacion(roto).filter((x) => x.nivel === 'rojo')
    expect(h.map((x) => x.tipo)).toEqual(['casado_dos_veces', 'asiento_sin_movimiento', 'mes_cerrado', 'regla_sin_registro', 'extracto', 'consentimiento'])
    expect(h.find((x) => x.tipo === 'mes_cerrado')!.detalle).toBe('2026-09 del banco b0100000: al cerrar, contabilidad decía 2400,00 €; hoy, a esa fecha, 2500,00 €')
    expect(informeConciliacion(revisarConciliacion(roto), { donde: 'producción', hoy: '2026-10-14', contado: real.contado })).toContain('**6 en rojo.**')
  })

  it('lo que espera a una persona va en ámbar: a sabiendas, un hueco, un permiso que caduca', () => {
    const espera = {
      ...real,
      mes_cerrado: [{ ...A, banco: 'b0100000-3', mes: '2026-09', a_sabiendas: true, libro_al_cerrar: 2500, libro_hoy: 2500, diferencia: -100, sueltos: 1 }],
      extracto: [{ ...A, id: 'dddddddd-2', banco: 'b', desde: '2026-10-16', hasta: '2026-10-16', motivo: 'hueco', hueco: 49.5 }],
      consentimiento: [{ ...A, id: 'eeeeeeee-2', proveedor: 'simulado', caduca: '2026-10-18', dias: 5 }],
    }
    const h = revisarConciliacion(espera)
    expect(h.every((x) => x.nivel === 'ambar')).toBe(true)
    expect(h.map((x) => x.detalle)).toEqual([
      '2026-09 del banco b0100000 se cerró a sabiendas: diferencia -100,00 €, 1 sin casar',
      'extracto dddddddd del 2026-10-16 al 2026-10-16: falta un trozo con el anterior (49,50 €)',
      'el permiso eeeeeeee (simulado) caduca el 2026-10-18, en 5 días',
    ])
  })
})
