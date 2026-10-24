// tests/conta/n2/loQueDejaElCierre.test.ts
//
// N2 · Lo que deja el cierre del día. La población real (medida el 24/10 en
// solo lectura, Foodint): 32 pedidos de HubRise «cerrado_sin_confirmar»
// (833,79 €), 0 «revisar», y 1 que su liquidación cubre y no cobra
// (conta_sin_confirmar_no_cobrados). Los códigos y los importes de cada
// pedido aquí son inventados; los totales, los medidos.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ETIQUETA, cifras, esperaDecision, estadoDe, ordenar, porqueDe, tituloDe, type FilaCierre } from '../../../src/modules/conta/lib/loQueDejaElCierre'
import { devolucionSinCobrar } from '../../../src/modules/conta/lib/asientosPropuestos'

const base: FilaCierre = {
  saleId: 's', dia: '2026-10-06', codigo: 'X1', total: 25.9, accion: 'cerrado_sin_confirmar', estadoVenta: 'closed', origen: 'hubrise',
  canal: 'Uber Eats', local: 'Alcalá', liquidacion: null, cobrado: false, descartado: false, devolucion: false,
}
const f = (o: Partial<FilaCierre>): FilaCierre => ({ ...base, ...o })

describe('N2 · el estado de cada pedido', () => {
  it.each([
    [f({ accion: 'revisar', estadoVenta: 'open', origen: 'folvy_pos', canal: 'el TPV' }), 'revisar'],
    [f({ accion: 'revisar', estadoVenta: 'closed', origen: 'folvy_pos' }), 'revisar_resuelto'],
    [f({ liquidacion: { ref: 'UB-1', fecha: '2026-10-13' } }), 'sin_cobrar'],
    [f({ liquidacion: { ref: 'UB-1', fecha: '2026-10-13' }, devolucion: true }), 'devolucion_propuesta'],
    [f({ liquidacion: { ref: 'UB-1', fecha: '2026-10-13' }, descartado: true }), 'descartado'],
    [f({ cobrado: true }), 'cobrado'],
    [f({}), 'sin_liquidacion'],
  ] as const)('%#', (x, e) => expect(estadoDe(x)).toBe(e))

  it('solo esperan decisión «para revisar» y «sin cobrar»', () => {
    expect((Object.keys(ETIQUETA) as (keyof typeof ETIQUETA)[]).filter(esperaDecision)).toEqual(['revisar', 'sin_cobrar'])
  })
})

describe('N2 · la cola: lo que espera decisión primero, y no se quita nada (regla 7)', () => {
  // 32 cerrados sin confirmar (833,79 €): 1 sin cobrar y 31 cobrados o esperando su liquidación.
  const importes = [...Array.from({ length: 31 }, () => 26.05), 26.24]
  const filas = importes.map((t, i) => f({ saleId: `s${i}`, codigo: `P${i}`, total: t, dia: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}`,
    liquidacion: i === 31 ? { ref: 'UB-1', fecha: '2026-10-13' } : null, cobrado: i % 2 === 0 && i !== 31 }))
  it('los totales medidos: 32 y 833,79 €; 1 sin cobrar', () => {
    const c = cifras(filas)
    expect(c.sinConfirmar).toEqual({ n: 32, total: 833.79 })
    expect(c.sinCobrar).toEqual({ n: 1, total: 26.24 })
    expect(c.revisar).toBe(0)
  })
  it('ordena sin quitar ninguna: la que espera decisión va primero', () => {
    const o = ordenar([...filas, f({ saleId: 'tpv', accion: 'revisar', estadoVenta: 'open', canal: 'el TPV', dia: '2026-10-20' })])
    expect(o).toHaveLength(33)
    expect(o.slice(0, 2).map((x) => x.saleId)).toEqual(['tpv', 's31'])
  })
})

describe('N2 · lo que dice cada fila', () => {
  it('el título y el porqué, con su liquidación', () => {
    const x = f({ liquidacion: { ref: 'UB-1', fecha: '2026-10-13' } })
    expect(tituloDe(x).replace(/\u00a0/g, ' ')).toBe('Pedido X1 de Uber Eats del 06/10/2026 · 25,90 €')
    expect(porqueDe(x)).toContain('la liquidación UB-1 del 13/10/2026 no lo trae cobrado')
  })
  it('el del TPV dice que se cierra o se anula donde se hizo, y que su día no se asienta', () => {
    expect(porqueDe(f({ accion: 'revisar', estadoVenta: 'open', canal: 'el TPV' }))).toMatch(/ciérralo .* o anúlalo donde se hizo\. Mientras siga abierto, su día no se asienta/)
  })
})

describe('N2 · la devolución de un pedido que su liquidación no cobra', () => {
  const e = {
    localId: 'L', tipo: { id: 't10', porcentaje: 10 }, porMarca: true, nombreLocal: 'Alcalá',
    nombreCanal: (id: string | null) => (id === 'uber' ? 'Uber Eats' : 'otro'),
    cuentas: { cobroPorCanal: { uber: '43000002' }, ventas: '70000000', devoluciones: '70800000', ivaRepercutido: '47700010' },
  }
  const x = { pedido: { id: 'sale-1', codigo: 'X1', canalId: 'uber', marcaId: null, total: 25.9 }, dia: '2026-10-06', fecha: '2026-10-06', liquidacion: { ref: 'UB-1', fecha: '2026-10-13' } }
  it('Debe la 708 y la 477, Haber el cobro de la plataforma; cuadra; origen la venta (sales_adjustment)', () => {
    const r = devolucionSinCobrar(x, e)
    expect(r.sinPropuesta).toBeNull()
    const p = r.propuesta!
    expect(p.origen).toEqual({ tipo: 'sales_adjustment', id: 'sale-1' })
    const debe = p.lineas.reduce((t, l) => t + Math.round(l.debe * 100), 0); const haber = p.lineas.reduce((t, l) => t + Math.round(l.haber * 100), 0)
    expect(debe).toBe(haber); expect(debe).toBe(2590)
    expect(p.lineas.find((l) => l.cuenta === '43000002')?.haber).toBe(25.9)
    expect(p.lineas.find((l) => l.cuenta === '70800000')?.debe).toBe(23.55)
    expect(p.lineas.find((l) => l.cuenta === '47700010')?.debe).toBe(2.35)
    expect(p.concepto).toBe('Devolución del 6 de octubre · Uber Eats · pedido X1, no cobrado')
    expect(p.razones[0].porque).toContain('la liquidación UB-1 del 13 de octubre cubre su día y no lo trae cobrado')
  })
  it('con su día cerrado, va el primer día abierto, y lo dice', () => {
    const p = devolucionSinCobrar({ ...x, fecha: '2026-11-01' }, e).propuesta!
    expect(p.fecha).toBe('2026-11-01')
    expect(p.razones[1].decision).toBe('Va el 1 de noviembre, el primer día abierto')
  })
  it('sin la 430 de la plataforma no se propone, y dice por qué', () => {
    const r = devolucionSinCobrar(x, { ...e, cuentas: { ...e.cuentas, cobroPorCanal: {} } })
    expect(r.propuesta).toBeNull()
    expect(r.sinPropuesta).toMatch(/enlaza su 430/)
  })
})

describe('N2 · la pantalla', () => {
  const p = readFileSync('src/modules/conta/ventas/LoQueDejaElCierre.tsx', 'utf8')
  it('usa la plantilla Bandeja, y cada acción dice lo que ha hecho (regla 8)', () => {
    expect(p).toContain('<Bandeja')
    expect(p).toContain('<CifrasBandeja')
    expect(p).toContain("'Proponer la devolución'")
    expect(p).toContain('Se cobró por otro lado')
    expect(p).toContain('role="status">{h.texto}')
  })
  it('sale en Ventas con hostelería', () => {
    expect(readFileSync('src/modules/conta/ventas/VentasPage.tsx', 'utf8')).toContain('{hosteleria && <LoQueDejaElCierre conPlataformas={vende} />}')
  })
})
