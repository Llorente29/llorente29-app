// S01d · Las retenciones: la que nace y la que se paga. Importes de la
// respuesta de Julio (30/10), sin nombres ni cuentas reales de nadie.
import { describe, expect, it } from 'vitest'
import { modeloYPeriodo, periodoEnPalabras, problemas, type LineaAsiento } from '@/modules/conta/lib/libro'
import { opcionesDePeriodo, queQuedaPorPagar } from '@/modules/conta/lib/pagoDeModelo'
import { impuestosPorPagar } from '@/modules/conta/services/bancosNucleo'
import { decidir, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'

const es4751 = (c: string) => c.startsWith('4751')
const linea = (p: Partial<LineaAsiento>): LineaAsiento => ({ cuenta: '57200001', debe: 0, haber: 0, localId: null, comun: true, ...p })

describe('el periodo de un modelo', () => {
  it('en palabras: trimestre, mes y año', () => {
    expect(periodoEnPalabras('2026-3T')).toBe('3T 2026')
    expect(periodoEnPalabras('2026-01')).toBe('enero de 2026')
    expect(periodoEnPalabras('2026-0A')).toBe('año 2026')
    expect(modeloYPeriodo('111', '2026-3T')).toBe('111 · 3T 2026')
  })
  it('los que se pueden elegir: 4 trimestres, 12 meses y el año', () => {
    const o = opcionesDePeriodo()
    expect(o).toHaveLength(17)
    expect(o[2]).toEqual({ valor: '3T', texto: '3.º trimestre (3T)' })
    expect(o.at(-1)).toEqual({ valor: '0A', texto: 'El año entero' })
  })
})

describe('la regla de la 4751: la que nace o la que se paga', () => {
  it('el pago del 111 sin modelo ni periodo no valida, y dice qué le falta', () => {
    const p = problemas([linea({ cuenta: '47510000', debe: 578.01 }), linea({ haber: 578.01 })], () => false, es4751)
    expect(p).toEqual(['Apunte 1 (47510000): una retención lleva su tipo, su base y su modelo; el pago o la compensación de un modelo, su modelo y su periodo.'])
  })
  it('con su modelo y su periodo, sí; con un periodo mal escrito, no', () => {
    expect(problemas([linea({ cuenta: '47510000', debe: 578.01, retencion: { modelo: '111', periodo: '2026-3T' } }), linea({ haber: 578.01 })], () => false, es4751)).toEqual([])
    expect(problemas([linea({ cuenta: '47510000', debe: 578.01, retencion: { modelo: '111', periodo: '3T 2026' } }), linea({ haber: 578.01 })], () => false, es4751))
      .toEqual(['Apunte 1 (47510000): el periodo «3T 2026» no es un trimestre (3T), un mes ni el año.'])
  })
  it('la que nace sigue pidiendo tipo, base y modelo', () => {
    expect(problemas([linea({ cuenta: '62300000', debe: 100 }), linea({ cuenta: '47510000', haber: 15, retencion: { tipoId: 't', tipo: 15, base: 100, modelo: '111' } }), linea({ cuenta: '41000001', haber: 85 })], () => false, es4751)).toEqual([])
  })
})

describe('lo que queda por pagar de un modelo', () => {
  const p111 = { texto: '111 · 2T 2026', importe: 661.33, pagado: 0, pendiente: 661.33 }
  it('la compensación de 354,34: quedan 306,99', () => {
    expect(queQuedaPorPagar(p111, 354.34)).toBe('El 111 · 2T 2026 es de 661,33 €: al validar este asiento quedarán 306,99 € por pagar.')
  })
  it('el pago entero lo deja pagado; de más, lo dice', () => {
    expect(queQuedaPorPagar({ texto: '111 · 3T 2026', importe: 578.01, pagado: 0, pendiente: 578.01 }, 578.01)).toBe('El 111 · 3T 2026 es de 578,01 €: al validar este asiento queda pagado.')
    expect(queQuedaPorPagar({ texto: '111 · 3T 2026', importe: 578.01, pagado: 578.01, pendiente: 0 }, 10)).toBe('El 111 · 3T 2026 es de 578,01 €: con este asiento se habrán pagado 10,00 € de más.')
  })
  it('sin declaración en Sumied (el 115 del 4T de 2025): no inventa lo que queda', () => {
    expect(queQuedaPorPagar({ texto: '115 · 4T 2025', importe: null, pagado: 0, pendiente: null }, -995.42)).toBe('No tengo la declaración del 115 · 4T 2025 en Sumied: no puedo decir lo que queda.')
  })
})

describe('Bancos: los impuestos por pagar salen de las declaraciones', () => {
  const cuentas = [
    { code: '47500000', kind: 'own', withholding_model: null }, { code: '47510000', kind: 'own', withholding_model: '111' },
    { code: '47510019', kind: 'own', withholding_model: '115' },
  ]
  const declaraciones = [
    { id: 'd111', form_code: '111', fiscal_year: 2026, period: '3T', amount: 578.01, payment_entry_id: null },
    { id: 'd115', form_code: '115', fiscal_year: 2026, period: '3T', amount: 1069.02, payment_entry_id: null },
    { id: 'pagada', form_code: '111', fiscal_year: 2026, period: '2T', amount: 661.33, payment_entry_id: 'x' },
    { id: 'vieja', form_code: '111', fiscal_year: 2023, period: '4T', amount: 10, payment_entry_id: null },
  ]
  it('el 115 va a la 47510019 (no «todo lo que no es 4750 es 111»), con su periodo; la pagada y la vieja, no', () => {
    expect(impuestosPorPagar(declaraciones, cuentas, [], '2026-10-30')).toEqual([
      { modelo: '111', periodo: '2026-3T', importeCent: 57801, cuenta: '47510000', declaracionId: 'd111' },
      { modelo: '115', periodo: '2026-3T', importeCent: 106902, cuenta: '47510019', declaracionId: 'd115' },
    ])
  })
  it('el pago del 115 propuesto desde Bancos lleva el modelo y el periodo en su línea', () => {
    const ctx = {
      cuentas: [{ id: 'cta', nombre: 'Cuenta', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
      nominas: [], contratos: [], reglas: [], aprendido: [], asientos: [], nombres: { '47510019': 'Retenciones de alquileres' },
      cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
      impuestos: impuestosPorPagar(declaraciones, cuentas, [], '2026-10-30'),
    } as unknown as Contexto
    const m: Movimiento = { id: 'm', cuentaId: 'cta', fecha: '2026-10-20', conceptoComun: null, referencias: [], antesDelCorte: false, importeCent: -106902, concepto: 'IMPUESTOS AEAT MODELO 115' }
    const d = decidir(m, ctx)
    expect(d.que).toBe('Modelo 115 · 3T 2026')
    expect(d.destino).toMatchObject({ tipo: 'cuenta', concepto: 'Pago del modelo 115 · 3T 2026', lineas: [{ cuenta: '47510019', importe: 1069.02, modelo: '115', periodo: '2026-3T' }] })
  })
})
