// D01 · Liquidaciones por correo · Los asientos: la factura de comisión (serie 2)
// con su comisión y sus anuncios a cuentas distintas, el IVA tal como lo dice la
// factura y «falta el número»; y la liquidación, que ya no repite la comisión
// cuando su factura va aparte. Cifras inventadas con la regla del céntimo real
// (comisión 10,00 + anuncios 10,00 = base 16,53 e IVA 3,47).
import { describe, expect, it } from 'vitest'
import { cuadre } from '@/modules/conta/lib/libro'
import { facturaProveedor } from '@/modules/conta/lib/asientosPropuestos'

const NORTE = 'loc-norte'
const IVA = { cuenta: '47200021', tipoId: 't21' }
const cf = { proveedor: '41000003', retencion: '47510000', ivaSoportado: (p: number) => (p === 21 ? IVA : null) }
const comision = {
  id: 'fc1', numero: null, fecha: '2026-09-29', proveedor: 'Plataforma inventada', terceroId: 't-uber', esSocio: false, tieneNif: true, localId: NORTE,
  lineas: [{ base: 8.27, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62300002' }, { base: 8.26, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62700002' }],
  total: 20, retencion: null, cuotas: [{ porcentaje: 21, base: 16.53, cuota: 3.47 }], marcaId: 'marca-1', faltaNumero: true,
}

describe('la factura de comisión de una liquidación (serie 2)', () => {
  it('comisión y anuncios a sus cuentas, el IVA de la factura (no base × 21 % redondeado) y el total a la 410; cuadra', () => {
    const p = facturaProveedor(comision, cf).propuesta!
    expect(p.serie).toBe(2)
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['62300002', 8.27, 0], ['62700002', 8.26, 0], ['47200021', 3.47, 0], ['41000003', 0, 20]])
    expect(p.lineas.find((l) => l.cuenta === '47200021')!.iva).toMatchObject({ base: 16.53, tipo: 21, libro: 'received' })
    expect(cuadre(p.lineas).cuadra).toBe(true)
    // 16,53 × 21 % = 3,4713 → 3,47 aquí; el caso de Diez (186,93 → 39,25, no 39,26) es el que obliga a usar la cuota dicha.
    expect(p.lineas.every((l) => l.marcaId === 'marca-1' && l.localId === NORTE)).toBe(true)
  })
  it('sin número: se propone, en duda, y dice que no se valida ni va a Diez', () => {
    const p = facturaProveedor(comision, cf).propuesta!
    expect(p.confianza).toBe('duda')
    expect(p.avisos).toContain('Falta el número de la factura: la plataforma no lo manda en el correo. Sin él no se valida ni va a Diez.')
    const con = facturaProveedor({ ...comision, numero: 'INVENTADA-1', faltaNumero: false }, cf).propuesta!
    expect([con.confianza, con.avisos]).toEqual(['seguro', []])
  })
  it('la cuota dicha manda aunque base × tipo diera otro céntimo (186,93 → 39,25)', () => {
    const p = facturaProveedor({ ...comision, numero: 'X', faltaNumero: false, total: 226.18,
      lineas: [{ base: 131.94, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62300002' }, { base: 54.99, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62700002' }],
      cuotas: [{ porcentaje: 21, base: 186.93, cuota: 39.25 }] }, cf).propuesta!
    expect(p.lineas.find((l) => l.cuenta === '47200021')!.debe).toBe(39.25)
    expect([cuadre(p.lineas).cuadra, p.avisos]).toEqual([true, []])
    // Sin la cuota dicha, el redondeo de siempre da 39,26 y no llega al total: lo avisa.
    const sin = facturaProveedor({ ...comision, numero: 'X', faltaNumero: false, total: 226.18, cuotas: undefined,
      lineas: [{ base: 131.94, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62300002' }, { base: 54.99, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62700002' }] }, cf).propuesta!
    expect(sin.avisos.join(' ')).toContain('226,19')
  })
  it('una base dicha que no es la de sus líneas: duda, con las dos cifras', () => {
    const p = facturaProveedor({ ...comision, cuotas: [{ porcentaje: 21, base: 16.5, cuota: 3.47 }] }, cf).propuesta!
    expect(p.avisos[0]).toBe('La base del 21 % de la factura (16,50 €) no es la de sus líneas (16,53 €).')
  })
})

// (Sus casos de liquidacionPlataforma viven en el paso 0 de supabase/staging/sql/20261028_s01_propuestas_plataforma_prueba.sql: la regla está en SQL desde el S01 · PR 3.)

describe('por aclarar (Julio, 16/10): nunca se suma doble', () => {
  it('la factura de una liquidación que se solapa o no cuadra no se propone, y dice por qué', () => {
    const r = facturaProveedor({ ...comision, porAclarar: ['Por aclarar: Se solapa con la liquidación del 31/08 al 27/09/2026: esta factura puede repetir cargos ya facturados.'] }, cf)
    expect(r).toEqual({ propuesta: null, sinPropuesta: 'Por aclarar: Se solapa con la liquidación del 31/08 al 27/09/2026: esta factura puede repetir cargos ya facturados.' })
  })
})
