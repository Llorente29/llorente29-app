// D01 · Liquidaciones por correo · Los asientos: la factura de comisión (serie 2)
// con su comisión y sus anuncios a cuentas distintas, el IVA tal como lo dice la
// factura y «falta el número»; y la liquidación, que ya no repite la comisión
// cuando su factura va aparte. Cifras inventadas con la regla del céntimo real
// (comisión 10,00 + anuncios 10,00 = base 16,53 e IVA 3,47).
import { describe, expect, it } from 'vitest'
import { cuadre } from '@/modules/conta/lib/libro'
import { facturaProveedor, liquidacionPlataforma, type CuentasLiquidacion, type EntradaLiquidacion } from '@/modules/conta/lib/asientosPropuestos'

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

describe('la liquidación con su factura de comisión aparte', () => {
  const c: CuentasLiquidacion = { cliente430: '43000003', proveedor410: '41000003', comision: '62300000', otrosCargos: '62900000', iva21: IVA, banco: '57200001', pendienteSocio: null, serieTesoreria: 4 }
  const base: EntradaLiquidacion = {
    id: 'liq1', fecha: '2026-09-28', ref: null, plataforma: 'Uber Eats', flujo: 'own', ventas: 88, comision: 8, cargos: [{ concepto: 'Otros cargos', importe: 2 }],
    devoluciones: 0, neto: 53, cobrado: null, cobroEnBancos: true, pedidos: { total: 0, asentados: 0 }, localId: NORTE,
    facturaAparte: { total: 20, numero: null }, apartado: [{ concepto: 'Promociones en artículos', importe: 15 }, { concepto: 'Contracargos', importe: 0 }],
  }
  it('ni comisión ni cargos ni IVA (van en su factura): solo la compensación 410/430; lo apartado se dice', () => {
    const p = liquidacionPlataforma(base, c).propuesta!
    expect(p.serie).toBe(4)
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['41000003', 20, 0], ['43000003', 0, 20]])
    expect(p.lineas.some((l) => l.cuenta.startsWith('62') || l.cuenta.startsWith('472'))).toBe(false)
    expect(p.avisos).toEqual([
      'Su factura de comisión aún no tiene número: la compensación lo llevará cuando llegue.',
      'Queda en su 430 sin apuntar, hasta decidir cómo: Promociones en artículos 15,00 €.',
    ])
    expect(p.confianza).toBe('duda')
    expect(p.razones.map((x) => x.decision)).toEqual(['Comisión en su factura', 'Cobro en Bancos'])
  })
  it('con el cobro (sin Bancos): la compensación y el cobro; un neto negativo, «sin cobro»', () => {
    const p = liquidacionPlataforma({ ...base, cobroEnBancos: false, cobrado: { fecha: '2026-09-29', importe: 53 }, facturaAparte: { total: 20, numero: 'F-1' }, apartado: [] }, c).propuesta!
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['41000003', 20, 0], ['43000003', 0, 20], ['57200001', 53, 0], ['43000003', 0, 53]])
    expect([cuadre(p.lineas).cuadra, p.confianza, p.fecha]).toEqual([true, 'probable', '2026-09-29'])
    const neg = liquidacionPlataforma({ ...base, cobroEnBancos: false, neto: -4.5, facturaAparte: { total: 20, numero: 'F-2' }, apartado: [] }, c).propuesta!
    expect(neg.razones.map((x) => x.decision)).toContain('Sin cobro')
  })
  it('sin factura aparte, lo de siempre (las de los ficheros no cambian)', () => {
    const p = liquidacionPlataforma({ ...base, facturaAparte: null, apartado: undefined }, c).propuesta!
    expect(p.lineas.some((l) => l.cuenta === '47200021')).toBe(true)
  })
})
