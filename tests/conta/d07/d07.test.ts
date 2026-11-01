// tests/conta/d07/d07.test.ts
//
// D07 + D07b · El IVA no deducible con su motivo, la recibida de un periodo
// cerrado, la cuenta nueva del proveedor, las liquidaciones de plataforma y
// «Comprobando…». Los importes de Uber son los de las 8 liquidaciones de
// Foodint que tenían factura provisional (medidos el 23/10, solo lectura).

import { describe, expect, it } from 'vitest'
import { facturaProveedor } from '../../../src/modules/conta/lib/asientosPropuestos'
import { avisoPeriodoCerrado, fechaPropuesta, type CalendarioEmpresa } from '../../../src/modules/conta/lib/libro'
import { hojaDelProveedor } from '../../../src/modules/conta/lib/planEmpresa'
import { faltaParaGuardar, porQueNoDeducible } from '../../../src/modules/conta/lib/ivaNoDeducible'
import { estadoPlataforma, filaPlataforma, fraseSemanaSinFactura, semanasSinFactura, type LiquidacionPlataforma } from '../../../src/modules/conta/compras/liquidaciones'
import { cuadreConDiario, esNoDeducible, type AnotacionLibro } from '../../../src/modules/conta/lib/libroRegistro'
import { veredictoFactura, TITULO_PREPARANDO } from '../../../src/modules/conta/documentos/veredicto'

const cuentas = { proveedor: '41000177', ivaSoportado: (p: number) => ({ cuenta: `472000${p}`, tipoId: `t${p}` }), retencion: '47510000' }

describe('D07 · el IVA no deducible de Orange (S11/0177416578 del 05/10, 34,95 €)', () => {
  const orange = (motivo?: string | null) => facturaProveedor({
    id: 'orange', numero: 'S11/0177416578', fecha: '2026-10-05', proveedor: 'Orange Espagne S.A. Sociedad Unipersonal', terceroId: null, esSocio: false, tieneNif: true,
    localId: null, lineas: [{ base: 28.88, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62800000' }], total: 34.95, retencion: null, ivaNoDeducible: true, motivoNoDeducible: motivo,
  }, cuentas).propuesta!
  it('la cuota va a su gasto en su propia línea, al libro de recibidas como no deducible; nada a la 472', () => {
    const p = orange('no está a nombre de la empresa')
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['62800000', 28.88, 0], ['62800000', 6.06, 0], ['41000177', 0, 34.94]])
    expect(p.lineas[1].iva).toEqual({ tipoId: 't21', tipo: 21, base: 28.88, libro: 'received', deducible: 'no' })
    expect(p.lineas.some((l) => /^472/.test(l.cuenta))).toBe(false)
  })
  it('su porqué dice el motivo y que no entra en el 303', () => {
    const p = orange('es un ticket sin NIF')
    expect(p.razones.find((r) => r.decision === 'IVA no deducible: más gasto')?.porque)
      .toBe('es un ticket sin NIF: su IVA no se descuenta. Va a su gasto, no a la 472; sale en el libro de recibidas como no deducible y no entra en el 303')
    expect(orange(null).porque).toBe('Gasto con su IVA dentro y el total a su cuenta: la factura no va a nombre de tu empresa.')
  })
  it('los motivos, en palabras; lo que falta para guardar', () => {
    expect(porQueNoDeducible('no_a_nombre')).toBe('no está a nombre de la empresa')
    expect(porQueNoDeducible('ticket_sin_nif')).toBe('es un ticket sin NIF')
    expect(porQueNoDeducible('otro', ' Factura a nombre del gerente ')).toBe('Factura a nombre del gerente')
    expect(faltaParaGuardar(true, null, null)).toBe('Di por qué no se deduce.')
    expect(faltaParaGuardar(true, 'otro', '  ')).toBe('Con «Otro motivo», escribe cuál.')
    expect(faltaParaGuardar(true, 'ticket_sin_nif', null)).toBeNull()
    expect(faltaParaGuardar(false, null, null)).toBeNull()
  })
})

describe('D07 · el libro de recibidas: la no deducible sale, y no descuadra con la 472', () => {
  const a = (o: Partial<AnotacionLibro>): AnotacionLibro => ({ book: 'received', taxAmount: 6.06, deductibleAmount: 6.06, reverseCharge: false, voidedAt: null, ...o } as AnotacionLibro)
  it('es no deducible la recibida con deducible 0 y cuota; la de inversión del sujeto pasivo, no', () => {
    expect(esNoDeducible(a({ deductibleAmount: 0 }))).toBe(true)
    expect(esNoDeducible(a({}))).toBe(false)
    expect(esNoDeducible(a({ deductibleAmount: 0, reverseCharge: true }))).toBe(false)
    expect(esNoDeducible(a({ book: 'issued', deductibleAmount: null }))).toBe(false)
  })
  it('el cuadre con la 472 no cuenta su cuota (va al gasto)', () => {
    const c = cuadreConDiario([a({ taxAmount: 21 }), a({ deductibleAmount: 0 })], 'received', 21)
    expect(c.cuadra).toBe(true)
  })
})

describe('D07b · la recibida de un periodo cerrado (CARREFOUR 2026FBFN01634861 del 06/08)', () => {
  const cal: CalendarioEmpresa = { ejercicios: [{ code: '2026', inicio: '2026-01-01', fin: '2026-12-31', abierto: true, traidoHasta: '2026-09-30' }], mesesCerrados: [] }
  it('se asienta el primer día abierto, y el aviso dice las dos fechas y el periodo de su IVA', () => {
    const fp = fechaPropuesta('2026-08-06', cal)
    expect(fp.fecha).toBe('2026-10-01')
    expect(avisoPeriodoCerrado('2026-08-06', fp.fecha!))
      .toBe('La factura es del 06/08/2026, en un periodo ya cerrado: se asienta el 01/10/2026, el primer día abierto. Conserva su fecha de factura en el libro de IVA y su IVA va al 4T 2026.')
  })
})

describe('D07b · la cuenta del proveedor que no la tiene (Orange)', () => {
  it('compras (grupo 60) en la 4000; servicios, suministros y telefonía en la 4100; sin gasto, 4100', () => {
    expect(hojaDelProveedor('60000000')).toBe('4000')
    expect(hojaDelProveedor('62800000')).toBe('4100')
    expect(hojaDelProveedor(null)).toBe('4100')
  })
})

describe('D07 · Uber: las liquidaciones de plataforma, fuera de recibidas', () => {
  const l = (o: Partial<LiquidacionPlataforma>): LiquidacionPlataforma => ({
    id: 'x', canal: 'Uber Eats', tienda: 'FoodInt Camichi', desde: '2026-10-12', hasta: '2026-10-18', ventas: 1000, comision: 153.17, neto: 782.16,
    cobrado: null, aFacturar: 280.75, facturas: [], deReferencia: false, porAclarar: null, ...o,
  })
  // Las 8 de Foodint: 7 de la semana 12–18/10 (una de ellas, 07/09–18/10) y una del 05–11/10.
  const ocho = [
    l({ id: 'a', desde: '2026-10-05', hasta: '2026-10-11', aFacturar: 56.98 }),
    ...[82.72, 37.6, 21.98, 53.79, 63.66, 280.75].map((t, i) => l({ id: `s${i}`, aFacturar: t })),
    l({ id: 'larga', desde: '2026-09-07', hasta: '2026-10-18', aFacturar: 2.31 }),
  ]
  it('una liquidación de plataforma no es una factura: ventas, comisión y neto, sin PDF', () => {
    const f = filaPlataforma(l({ cobrado: { fecha: '2026-10-20', importe: 782.16 } }))
    expect(f.tipo).toBe('plataforma')
    expect(f.periodo).toBe('del 12/10 al 18/10/2026')
    expect(f.apoyoImporte).toBe('Ventas 1.000,00 € · comisión 153,17 € · cobrado 782,16 € el 20/10')
    expect(f.abrir).toMatchObject({ a: 'sin-ficha' })
    expect(estadoPlataforma(l({})).texto).toBe('Falta la factura de comisión')
    expect(estadoPlataforma(l({ facturas: [{ id: 'f', numero: 'UBER-W42', total: 280.75 }] })).texto).toBe('Factura de comisión · recibida')
    expect(estadoPlataforma(l({ deReferencia: true })).texto).toBe('De referencia')
    expect(estadoPlataforma(l({ aFacturar: 0, comision: 40 })).texto).toBe('Sin factura aparte')
  })
  it('Inicio: las semanas sin su factura, siete días después de acabar', () => {
    const s = semanasSinFactura(ocho, '2026-10-26')
    expect(s.map((x) => [x.hasta, x.n, x.importe])).toEqual([['2026-10-18', 7, 542.81], ['2026-10-11', 1, 56.98]])
    expect(fraseSemanaSinFactura(s[0])).toBe('Falta la factura de comisión de Uber Eats de la semana del 12/10 al 18/10/2026: 7 liquidaciones la esperan (542,81 €).')
    // El 23/10 la del 12–18/10 aún puede llegar: solo la del 05–11/10.
    expect(semanasSinFactura(ocho, '2026-10-23').map((x) => x.hasta)).toEqual(['2026-10-11'])
    // Enlazada su factura, ya no se avisa.
    expect(semanasSinFactura(ocho.map((x) => ({ ...x, facturas: [{ id: 'f', numero: null, total: x.aFacturar }] })), '2026-10-26')).toEqual([])
  })
})

describe('D07b · «Comprobando…», no «No está lista», mientras se prepara su asiento (COHELDI T0626/657)', () => {
  it('sin propuesta todavía, el veredicto es el de preparando', () => {
    const v = veredictoFactura({
      validada: false, numeroAsiento: null, descartada: false, motivoDescarte: null, proveedor: { nombre: 'COHELDI, S.L.', nif: 'B00000000' }, nifFactura: null,
      fecha: '2026-10-07', comprobaciones: [], propuesta: undefined, porqueSinPropuesta: null, origenGasto: null, pagada: { fecha: '2026-10-09' },
      cuadraConElPdf: null, faltaDocumento: null, duplicada: null,
    } as Parameters<typeof veredictoFactura>[0])
    expect(v.titulo).toBe(TITULO_PREPARANDO)
  })
})
