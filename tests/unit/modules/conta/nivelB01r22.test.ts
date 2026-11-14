// tests/unit/modules/conta/nivelB01r22.test.ts
//
// B01·22 · El nivel de cada propuesta del banco, con los casos REALES de
// octubre en Foodint (regla 31) que salieron al medir la regla contra lo casado
// y validado (docs/conta/b01/b01r22_medida_niveles.sql):
//   · Europastry 13/10 (−110,87, la 24048027) y Amirsa 26/10 (−191,00, la
//     2026/17791): una factura, al céntimo → «Seguro · coincide al céntimo».
//   · Olimpo 26/10 (−363,67): el banco dice «FACT: 26A/10966» y la propuesta era
//     la 26/13028 (el albarán) → nunca «Seguro».
//   · Europastry 28/10 (−221,73): «Pago de 2 facturas» que suman el importe → no
//     es «coincide al céntimo».
//   · Coheldi 14/10 (−248,61, la T0626/657 en revisión) → «Míralo · factura sin aprobar».
//   · Un pago de factura no es «confirmado» aunque el proveedor lleve 4 pagos
//     contra su cuenta (Europastry 15/10).

import { describe, expect, it } from 'vitest'
import type { Decision, Destino, Movimiento } from '@/modules/conta/lib/conciliacion'
import { filaDe, propuestaDe, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { LIMITE_POR_DEFECTO_CENT, mismoDestino, nivelDe, rachasDe, type DatosNivel, type FacturaConTipo } from '../../../../supabase/functions/_shared/bancos/nivel'

const mov = (p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento =>
  ({ id: 'm', cuentaId: 'b6536', fecha: '2026-10-15', conceptoComun: null, referencias: [], antesDelCorte: false, contraparte: null, ...p })
const dec = (destino: Destino | null, p: Partial<Decision> = {}): Decision => ({
  movimientoId: 'm', confianza: 'probable', que: '', porque: 'Porque sí.', destino, falta: null, antesDelCorteSinPareja: false, pideTicket: false,
  reglaId: null, contraparte: null, otroLadoDe: null, tarjetaId: null, origen: 'factura', preseleccionar: false, tarjetaDesconocida: null,
  alternativas: [], quedaPorCasarCent: null, facturaSinAprobar: false, ...p,
})
const fac = (id: string, numero: string, totalCent: number, p: Partial<FacturaConTipo> = {}): FacturaConTipo =>
  ({ id, numero, fecha: '2026-10-10', totalCent, pagadoCent: 0, proveedor: 'EUROPASTRY, S.A.', alias: [], terceroId: null, cuentaTercero: '40000006', aprobada: true, esFactura: true, ...p })
const pagoDe = (...fs: { id: string; importe: number }[]): Destino => ({ tipo: 'factura_recibida', facturas: fs, cuenta_tercero: '40000006', tercero_id: null, concepto: 'Pago' })
const datos = (p: Partial<DatosNivel> = {}): DatosNivel =>
  ({ facturas: [], rachas: new Map(), limiteCent: LIMITE_POR_DEFECTO_CENT, mesesCerrados: new Set(), nombres: { '62800000': 'Luz y agua', '62900000': 'Otros servicios' }, ...p })

describe('Seguro · coincide al céntimo: UNA factura, de verdad factura, aprobada, al céntimo y la que nombra el banco', () => {
  it('Europastry 13/10 (−110,87): la 24048027', () => {
    const n = nivelDe(dec(pagoDe({ id: 'f1', importe: 110.87 })), mov({ importeCent: -11_087, concepto: 'PAGO CON TARJETA EN SUPERMERCADOS · ************3085 EUROPASTRY S.A.' }),
      datos({ facturas: [fac('f1', '24048027', 11_087)] }))
    expect(n).toMatchObject({ clave: 'centimo', seguro: true, etiqueta: 'Seguro · coincide al céntimo con la factura 24048027' })
    expect(n.porque).toBe('La factura 24048027 de EUROPASTRY, S.A. pide justo 110,87 €, lo mismo que dice el banco.')
  })
  it('Amirsa 26/10 (−191,00, «PAGO FACTURA AMIRSA»: nombra «factura» pero no un número)', () => {
    const n = nivelDe(dec(pagoDe({ id: 'f2', importe: 191 })), mov({ importeCent: -19_100, concepto: 'TRANSFERENCIAS // TRANSFERENCIA REALIZADA // PAGO FACTURA AMIRSA · AMIRSA HOSTELERIA S L' }),
      datos({ facturas: [fac('f2', '2026/17791', 19_100, { proveedor: 'AMIRSA HOSTELERIA, S.L.' })] }))
    expect(n.clave).toBe('centimo')
  })
  it('Olimpo 26/10 (−363,67): el banco dice «FACT: 26A/10966» y la propuesta es la 26/13028 → Míralo, nunca seguro', () => {
    const n = nivelDe(dec(pagoDe({ id: 'alb', importe: 363.67 })), mov({ importeCent: -36_367, concepto: 'TRANSFERENCIAS · OLIMPO GOURMET S L · FACT: 26A/10966' }),
      datos({ facturas: [fac('alb', '26/13028', 36_367, { proveedor: 'OLIMPO GOURMET, S.L' })] }))
    expect(n).toMatchObject({ clave: 'camino', seguro: false, etiqueta: 'Míralo · el banco dice la factura 26A/10966' })
    expect(n.porque).toBe('El banco nombra la factura 26A/10966 y propongo la 26/13028: confirma cuál es.')
  })
  it('y con el número que nombra el banco, sí', () => {
    const n = nivelDe(dec(pagoDe({ id: 'f', importe: 363.67 })), mov({ importeCent: -36_367, concepto: 'TRANSFERENCIAS · OLIMPO GOURMET S L · FACT: 26A/10966' }),
      datos({ facturas: [fac('f', '26A/10966', 36_367, { proveedor: 'OLIMPO GOURMET, S.L' })] }))
    expect(n.clave).toBe('centimo')
  })
  it('un albarán (o un abono) nunca cuenta como factura', () => {
    const n = nivelDe(dec(pagoDe({ id: 'alb', importe: 363.67 })), mov({ importeCent: -36_367, concepto: 'TRANSFERENCIAS · OLIMPO GOURMET S L' }),
      datos({ facturas: [fac('alb', '26/13028', 36_367, { esFactura: false })] }))
    expect(n).toMatchObject({ clave: 'camino', etiqueta: 'Míralo · no es una factura' })
  })
  it('Europastry 28/10 (−221,73): dos facturas que suman el importe no son «coincide al céntimo»', () => {
    const n = nivelDe(dec(pagoDe({ id: 'a', importe: 175.47 }, { id: 'b', importe: 46.26 })), mov({ importeCent: -22_173, concepto: 'Pago con tarjeta en SUPERMERCADOS // pago con tarjeta // EUROPASTRY S.' }),
      datos({ facturas: [fac('a', '24093211', 17_547), fac('b', '24056932', 4_626)] }))
    expect(n).toMatchObject({ clave: 'camino', seguro: false, etiqueta: 'Míralo · son 2 facturas' })
  })
  it('Coheldi 14/10 (−248,61): la T0626/657 está en revisión → Míralo', () => {
    const n = nivelDe(dec(pagoDe({ id: 'c', importe: 248.61 })), mov({ importeCent: -24_861, concepto: 'TRANSFERENCIAS · COHELDI · pago fact coheldi' }),
      datos({ facturas: [fac('c', 'T0626/657', 24_861, { aprobada: false, proveedor: 'COHELDI, S.L.' })] }))
    expect(n).toMatchObject({ clave: 'camino', etiqueta: 'Míralo · factura sin aprobar' })
  })
  it('un céntimo de diferencia no es al céntimo (Europastry 15/10: 175,47 contra la 24056932 de 175,46)', () => {
    const d = pagoDe({ id: 'e', importe: 175.46 })
    const n = nivelDe(dec({ ...d, diferencia: { cuenta: '66900000', importe: 0.01, concepto: 'redondeo' } } as Destino), mov({ importeCent: -17_547, concepto: 'Pago con tarjeta en SUPERMERCADOS · 6300 EUROPASTRY S.A.' }),
      datos({ facturas: [fac('e', '24056932', 17_546)] }))
    expect(n).toMatchObject({ clave: 'camino', etiqueta: 'Míralo · no coincide al céntimo' })
  })
})

describe('Seguro · confirmado 3 veces: solo contra una cuenta, 3 seguidas sin corrección', () => {
  const luz: Destino = { tipo: 'cuenta', lineas: [{ cuenta: '62800000', importe: 80 }], concepto: 'Luz' }
  const iberdrola = mov({ importeCent: -8_000, concepto: 'ADEUDO RECIBO IBERDROLA CLIENTES', contraparte: 'Iberdrola Clientes' })
  const v = (validado: string, cuentas: string, corregido = false) => ({ concepto: 'ADEUDO RECIBO IBERDROLA CLIENTES', contraparte: 'Iberdrola Clientes', cuentas, validado, corregido })
  it('3 seguidas contra la misma cuenta → Seguro', () => {
    const rachas = rachasDe([v('2026-08-05', '62800000'), v('2026-09-05', '62800000'), v('2026-10-05', '62800000')])
    const n = nivelDe(dec(luz, { origen: 'historial' }), iberdrola, datos({ rachas }))
    expect(n).toMatchObject({ clave: 'confirmado', seguro: true, veces: 3, etiqueta: 'Seguro · confirmado 3 veces' })
    expect(n.porque).toBe('Las 3 últimas veces de IBERDROLA CLIENTES las validaste contra Luz y agua · 62800000 sin cambiarlas.')
  })
  it('una corrección por medio pone el contador a cero: cuenta solo lo de después', () => {
    const rachas = rachasDe([v('2026-07-05', '62800000'), v('2026-08-05', '62800000'), v('2026-09-05', '62800000', true), v('2026-10-05', '62800000'), v('2026-11-05', '62800000')])
    expect(nivelDe(dec(luz, { origen: 'historial' }), iberdrola, datos({ rachas }))).toMatchObject({ clave: 'camino', veces: 2, etiqueta: 'Míralo · 2 de 3' })
  })
  it('la última contra otra cuenta corta la racha', () => {
    const rachas = rachasDe([v('2026-08-05', '62800000'), v('2026-09-05', '62800000'), v('2026-10-05', '62800000'), v('2026-11-05', '62900000')])
    expect(nivelDe(dec(luz, { origen: 'historial' }), iberdrola, datos({ rachas }))).toMatchObject({ clave: 'camino', veces: 0, etiqueta: 'Míralo · 0 de 3' })
  })
  it('un pago de factura nunca es «confirmado», aunque el proveedor lleve 4 pagos contra su cuenta (Europastry 15/10)', () => {
    const rachas = new Map([['EUROPASTRY S A|40000006', 4]])
    const n = nivelDe(dec(pagoDe({ id: 'x', importe: 175.47 })), mov({ importeCent: -17_547, concepto: 'Pago con tarjeta en SUPERMERCADOS · 6300 EUROPASTRY S.A.', contraparte: 'Europastry S.A.' }),
      datos({ rachas, facturas: [fac('x', '24093211', 22_174)] }))
    expect(n.clave).not.toBe('confirmado')
  })
})

describe('Nunca sola y No lo sé', () => {
  it('la Seguridad Social del 30/10 (−3.308,46), aunque cuadre', () => {
    const d = dec({ tipo: 'cuenta', lineas: [{ cuenta: '47600000', importe: 3308.46 }], concepto: 'SS' }, { origen: 'nomina' })
    expect(nivelDe(d, mov({ importeCent: -330_846, concepto: 'Cuotas de LA SEGURIDAD SOCIAL // OTROS' }), datos())).toMatchObject({ clave: 'nunca', etiqueta: 'Nunca sola · nóminas' })
  })
  it('un socio (551), un préstamo (520) o más de 1.000 €', () => {
    const contra = (cuenta: string, cent: number) => nivelDe(dec({ tipo: 'cuenta', lineas: [{ cuenta, importe: cent / 100 }], concepto: 'x' }, { origen: 'regla' }), mov({ importeCent: -cent, concepto: 'X' }), datos())
    expect(contra('55100001', 50_000).etiqueta).toBe('Nunca sola · socios')
    expect(contra('52000001', 50_000).etiqueta).toBe('Nunca sola · préstamos')
    expect(contra('62900000', 120_000).etiqueta).toBe('Nunca sola · más de 1.000 €')
    expect(nivelDe(dec({ tipo: 'cuenta', lineas: [{ cuenta: '62900000', importe: 1200 }], concepto: 'x' }), mov({ importeCent: -120_000, concepto: 'X' }), datos({ limiteCent: 200_000 })).clave).not.toBe('nunca')
  })
  it('el mes cerrado de ese banco', () => {
    const n = nivelDe(dec(pagoDe({ id: 'f1', importe: 110.87 })), mov({ importeCent: -11_087, concepto: 'EUROPASTRY S.A.', fecha: '2026-10-13' }),
      datos({ facturas: [fac('f1', '24048027', 11_087)], mesesCerrados: new Set(['b6536|2026-10']) }))
    expect(n.etiqueta).toBe('Nunca sola · mes cerrado')
  })
  it('sin propuesta: «No lo sé», con lo que falta', () => {
    expect(nivelDe(dec(null, { confianza: 'duda', falta: 'su liquidación' }), mov({ importeCent: 12_000, concepto: 'STICH' }), datos()))
      .toEqual({ clave: 'nose', etiqueta: 'No lo sé', seguro: false, porque: 'Me falta su liquidación.' })
  })
})

describe('lo casado, ¿es lo propuesto?', () => {
  it('la misma factura sí; otra factura, otra cuenta u otro tipo, no', () => {
    expect(mismoDestino(pagoDe({ id: 'a', importe: 1 }), pagoDe({ id: 'a', importe: 1 }))).toBe(true)
    expect(mismoDestino(pagoDe({ id: 'a', importe: 1 }), pagoDe({ id: 'b', importe: 1 }))).toBe(false)
    const c = (cuenta: string): Destino => ({ tipo: 'cuenta', lineas: [{ cuenta, importe: 1 }], concepto: 'x' })
    expect(mismoDestino(c('62800000'), c('62800000'))).toBe(true)
    expect(mismoDestino(c('62800000'), c('62900000'))).toBe(false)
    expect(mismoDestino(c('62800000'), pagoDe({ id: 'a', importe: 1 }))).toBe(false)
    expect(mismoDestino(null, c('62800000'))).toBe(false)
  })
})

describe('la fila enseña el nivel, y «confirmar» recibe la propuesta para apuntar el veredicto', () => {
  const nivel = { clave: 'confirmado' as const, etiqueta: 'Seguro · confirmado 3 veces', porque: 'Las 3 últimas…', seguro: true, veces: 3 }
  const m = (estado: MovimientoBanco['estado'], conNivel = true): MovimientoBanco => ({
    id: 'm1', cuentaId: 'b1', fecha: '2026-11-10', importeCent: -8000, conceptoBanco: 'ADEUDO RECIBO IBERDROLA', conceptoLimpio: 'Adeudo recibo Iberdrola',
    contraparte: null, tipo: null, estado, confianza: 'probable', porque: 'Porque sí.', casado: null, tarjeta: null, ticket: null, motivoIgnorado: null,
    propuesta: { que: 'Luz y agua · 62800000', destino: { tipo: 'cuenta', lineas: [{ cuenta: '62800000', importe: 80 }] }, motor: '2026-11-12.1', ...(conNivel ? { nivel } : {}) },
  })
  it('en «Para confirmar», la etiqueta del nivel', () => {
    expect(filaDe(m('propuesto')).nivel).toEqual({ clave: 'confirmado', etiqueta: 'Seguro · confirmado 3 veces' })
  })
  it('sin nivel (una propuesta de antes del 13/11), nada', () => {
    expect(filaDe(m('propuesto', false)).nivel).toBeUndefined()
    expect(propuestaDe(m('propuesto', false))).toBeNull()
  })
  it('a «confirmar» le llega el nivel, el destino propuesto y el motor', () => {
    expect(propuestaDe(m('propuesto'))).toEqual({ nivel, destino: { tipo: 'cuenta', lineas: [{ cuenta: '62800000', importe: 80 }] }, motor: '2026-11-12.1' })
  })
})
