// tests/unit/modules/conta/x27/fichaTercero.test.ts — X27 · La ficha de proveedor y la de cliente: qué ha cambiado, por
// qué no se guarda, la retención que encaja con el porcentaje guardado, los países, los movimientos con su saldo y los
// saldos por mes (como la captura 07 de ERP10); y el «Pago directo» en la fecha del pago de la recibida.
// Cifras y nombres inventados (T11).

import { describe, expect, it } from 'vitest'
import {
  PAISES, borradorVacio, cambios, conSaldo, nombrePais, porQueNoSeGuarda, retencionQueEncaja, saldosPorMes, type Movimiento,
} from '@/modules/conta/nucleo/terceros/fichaTercero'
import { fechaDelPago } from '@/modules/conta/nucleo/recibida/pago'

describe('X27 · el borrador de la ficha', () => {
  it('qué ha cambiado, casilla a casilla', () => {
    const a = { ...borradorVacio(), nombre: 'Proveedor Inventado, S.L.', deducible: '' }
    expect(cambios(a, a)).toEqual([])
    expect(cambios(a, { ...a, deducible: '50', marca: 'm1' }).sort()).toEqual(['deducible', 'marca'])
  })
  it('sin nombre no se guarda; el % deducible, la retención y los días, en su rango; el país, sus dos letras', () => {
    const b = { ...borradorVacio(), nombre: 'Proveedor Inventado' }
    expect(porQueNoSeGuarda(b)).toBeNull()
    expect(porQueNoSeGuarda({ ...b, nombre: '  ' })?.casilla).toBe('nombre')
    expect(porQueNoSeGuarda({ ...b, deducible: '150' })?.casilla).toBe('deducible')
    expect(porQueNoSeGuarda({ ...b, deducible: '50,5' })).toBeNull()
    expect(porQueNoSeGuarda({ ...b, dias: '30' })).toBeNull()
    expect(porQueNoSeGuarda({ ...b, dias: '400' })?.casilla).toBe('dias')
    expect(porQueNoSeGuarda({ ...b, pais: 'España' })?.casilla).toBe('pais')
    // Una retención elegida en la lupa es su id (no un número): no es un rango.
    expect(porQueNoSeGuarda({ ...b, retencion: 'c0e00000-0000-4000-8000-000000000001' })).toBeNull()
  })
})

describe('X27 · la retención que encaja con el porcentaje guardado', () => {
  const lista = [{ id: 'r7', rate: 7 }, { id: 'r15', rate: 15 }, { id: 'r19', rate: 19 }]
  it('el 15 % encaja con la del 15; el 0 o sin nada, ninguna; uno que no está, ninguna (la casilla lo enseña en %)', () => {
    expect(retencionQueEncaja(15, lista)?.id).toBe('r15')
    expect(retencionQueEncaja(0, lista)).toBeNull()
    expect(retencionQueEncaja(null, lista)).toBeNull()
    expect(retencionQueEncaja(2, lista)).toBeNull()
  })
})

describe('X27 · los países', () => {
  it('España primero, con su nombre en mayúsculas, como ERP10; Grecia con su código de IVA (EL)', () => {
    expect(PAISES[0]).toMatchObject({ codigo: 'ES', descripcion: 'ESPAÑA' })
    expect(nombrePais('es')).toBe('ESPAÑA')
    expect(nombrePais('EL')).toBe('GRECIA')
    expect(nombrePais('Españ')).toBe('')
  })
})

const M = (fecha: string, debe: number, haber: number, anulado = false): Movimiento => ({ fecha, documento: 'X', concepto: 'c', debe, haber, asiento: null, anulado })

describe('X27 · Movimientos y Saldos', () => {
  const movs = [M('2025-12-20', 0, 50), M('2026-01-10', 0, 121), M('2026-01-30', 121, 0), M('2026-03-05', 0, 242.5), M('2026-03-06', 0, 999, true)]
  it('el proveedor, en su naturaleza acreedora (lo que le debes); sin los anulados', () => {
    expect(conSaldo(movs, 'proveedor').map((m) => m.saldo)).toEqual([50, 171, 50, 292.5])
  })
  it('el cliente, en la deudora (lo que te debe)', () => {
    expect(conSaldo([M('2026-01-01', 100, 0), M('2026-02-01', 0, 40)], 'cliente').map((m) => m.saldo)).toEqual([100, 60])
  })
  it('los doce meses del ejercicio, con la apertura de antes y el saldo acumulado al final de cada mes', () => {
    const s = saldosPorMes(movs, { inicio: '2026-01-01', fin: '2026-12-31' }, 'proveedor')
    expect(s.apertura).toBe(50)
    expect(s.meses).toHaveLength(12)
    expect(s.meses[0]).toEqual({ mes: '2026-01', nombre: 'Enero 2026', debe: 121, haber: 121, saldo: 50 })
    expect(s.meses[1]).toMatchObject({ mes: '2026-02', debe: 0, haber: 0, saldo: 50 })
    expect(s.meses[2]).toMatchObject({ mes: '2026-03', haber: 242.5, saldo: 292.5 })
    expect(s.meses[11]).toMatchObject({ mes: '2026-12', saldo: 292.5 })
  })
  it('un ejercicio que no empieza en enero: sus doce meses, cruzando el año', () => {
    const s = saldosPorMes([], { inicio: '2025-07-01', fin: '2026-06-30' }, 'cliente')
    expect(s.meses.map((m) => m.mes)).toEqual(['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
  })
})

describe('X27 · «Pago directo al contabilizar la factura»', () => {
  it('sin él, el pago se propone al vencimiento (lo de siempre); con él, en la fecha de la factura', () => {
    expect(fechaDelPago('2026-11-10', '2026-12-10')).toBe('2026-12-10')
    expect(fechaDelPago('2026-11-10', '2026-12-10', true)).toBe('2026-11-10')
    expect(fechaDelPago('2026-11-10', '', true)).toBe('2026-11-10')
  })
})
