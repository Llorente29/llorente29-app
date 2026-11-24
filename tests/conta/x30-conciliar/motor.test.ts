// tests/conta/x30-conciliar/motor.test.ts
//
// X30 · Lo seguro se concilia solo, y reglas de verdad (pieza 2 del conciliador): el porcentaje de seguridad, el umbral
// («Solo desde 95 %»), las condiciones de una regla (texto, signo, importe exacto o entre, banco, desde cuándo) y lo que
// pone (concepto y analítica). Datos inventados.
import { describe, expect, it } from 'vitest'
import {
  SEGURIDAD_SEGURO, UMBRAL_POR_DEFECTO, acierto, decidir, reglaCasa, seCasaSolo, seguridadDe,
  type Contexto, type Decision, type Movimiento, type Regla,
} from '../../../supabase/functions/_shared/bancos/conciliacion'

const mov = (x: Partial<Movimiento> = {}): Movimiento => ({ id: 'm', cuentaId: 'b1', fecha: '2026-11-20', importeCent: -4_235, concepto: 'RECIBO IBERDROLA CLIENTES 0001',
  conceptoComun: null, referencias: [], antesDelCorte: false, creado: '2026-11-20T08:00:00Z', ...x })
const regla = (x: Partial<Regla> = {}): Regla => ({ id: 'r', palabras: 'IBERDROLA', contiene: 'IBERDROLA', signo: -1, cuenta: '62800000', terceroId: null, confirmaciones: 0, ...x })
const ctx = (x: Partial<Contexto> = {}): Contexto => ({
  cuentas: [{ id: 'b1', nombre: 'Banco', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [],
  plataformas: [], nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [], nombres: { '62800000': 'Suministros' },
  cuentas626: '62600000', cuentas476: '47600000', ...x,
})

describe('las condiciones de una regla', () => {
  it('el texto y el signo: un pago de IBERDROLA sí; un ingreso con el mismo texto, no', () => {
    expect(reglaCasa(regla(), mov())).toBe(true)
    expect(reglaCasa(regla(), mov({ importeCent: 4_235 }))).toBe(false)
    expect(reglaCasa(regla(), mov({ concepto: 'RECIBO ENDESA' }))).toBe(false)
  })
  it('el importe, exacto o entre dos (sin signo)', () => {
    expect(reglaCasa(regla({ importe: { exactoCent: 4_235 } }), mov())).toBe(true)
    expect(reglaCasa(regla({ importe: { exactoCent: 4_236 } }), mov())).toBe(false)
    expect(reglaCasa(regla({ importe: { desdeCent: 4_000, hastaCent: 5_000 } }), mov())).toBe(true)
    expect(reglaCasa(regla({ importe: { desdeCent: 5_000, hastaCent: 6_000 } }), mov())).toBe(false)
  })
  it('el banco y desde cuándo mira: lo que entró antes de la regla, no', () => {
    expect(reglaCasa(regla({ bancoId: 'b2' }), mov())).toBe(false)
    expect(reglaCasa(regla({ desde: '2026-11-23T20:00:00Z' }), mov())).toBe(false)
    expect(reglaCasa(regla({ desde: '2026-11-19T00:00:00Z' }), mov())).toBe(true)
    expect(reglaCasa(regla({ desde: null }), mov({ creado: null })), 'sin fecha, también lo de antes (hacia atrás)').toBe(true)
  })
  it('lo que pone: la cuenta, el concepto del asiento y la analítica', () => {
    const d = decidir(mov(), ctx({ reglas: [regla({ concepto: 'Luz del local', analitica: { local_id: '00000000-0000-4000-8000-000000000001' } })] }))
    expect(d.destino).toMatchObject({ tipo: 'cuenta', concepto: 'Luz del local', local_id: '00000000-0000-4000-8000-000000000001', lineas: [{ cuenta: '62800000', importe: 42.35 }] })
  })
})

describe('el porcentaje', () => {
  it('el acierto con lo visto: sin nada, 50 %; 20 a favor, 95 %; 30, 96 %; nunca llega a lo seguro', () => {
    expect([acierto(0, 0), acierto(2, 0), acierto(20, 0), acierto(30, 0), acierto(10, 10), acierto(1000, 0)]).toEqual([50, 75, 95, 96, 50, SEGURIDAD_SEGURO - 1])
  })
  it('lo seguro de siempre, 99 %', () => {
    expect(seguridadDe({ confianza: 'seguro', origen: 'factura', reglaId: null, destino: null, contraparte: null, facturaSinAprobar: false }, ctx())).toBe(99)
  })
  it('una regla: por sus confirmaciones y correcciones', () => {
    const c = ctx({ reglas: [regla({ confirmaciones: 2, correcciones: 0 })] })
    expect(decidir(mov(), c).seguridad).toBe(75)
    expect(decidir(mov(), ctx({ reglas: [regla({ confirmaciones: 3 })] })).seguridad, 'confirmada 3 veces: seguro').toBe(99)
  })
  it('lo de antes: las veces que fue a esa cuenta frente a las que fue a otra', () => {
    const c = ctx({ aprendido: [{ contraparte: 'IBERDROLA CLIENTES', cuenta: '62800000', terceroId: null, veces: 30 }, { contraparte: 'IBERDROLA CLIENTES', cuenta: '62900000', terceroId: null, veces: 1 }] })
    const d = decidir(mov({ concepto: 'RECIBO', contraparte: 'IBERDROLA CLIENTES' }), c)
    expect(d.origen).toBe('historial')
    expect(d.seguridad).toBe(93)
  })
  it('lo que no tiene historial y no es seguro: por debajo del umbral', () => {
    expect(seguridadDe({ confianza: 'probable', origen: 'factura', reglaId: null, destino: null, contraparte: null, facturaSinAprobar: false }, ctx())).toBeLessThan(UMBRAL_POR_DEFECTO)
    expect(seguridadDe({ confianza: 'duda', origen: null, reglaId: null, destino: null, contraparte: null, facturaSinAprobar: false }, ctx())).toBe(0)
  })
})

describe('el umbral', () => {
  const base = (x: Partial<Decision>): Decision => ({ movimientoId: 'm', confianza: 'probable', que: '', porque: '', destino: { tipo: 'cuenta', concepto: 'x', lineas: [{ cuenta: '62800000', importe: 1 }] },
    falta: null, antesDelCorteSinPareja: false, pideTicket: false, reglaId: null, contraparte: null, otroLadoDe: null, tarjetaId: null, origen: 'historial',
    preseleccionar: false, tarjetaDesconocida: null, alternativas: [], quedaPorCasarCent: null, facturaSinAprobar: false, seguridad: 96, ...x })
  it('lo seguro se casa solo siempre (el agente no cambia)', () => {
    expect(seCasaSolo(base({ confianza: 'seguro', origen: 'factura', seguridad: 99 }), ctx({ umbral: 100 }))).toBe(true)
  })
  it('lo de antes con 96 %: con el umbral en 95 se casa solo; en 97, no', () => {
    expect(seCasaSolo(base({}), ctx({ umbral: 95 }))).toBe(true)
    expect(seCasaSolo(base({}), ctx({ umbral: 97 }))).toBe(false)
    expect(seCasaSolo(base({}), ctx()), 'sin umbral, el de por defecto (95)').toBe(true)
  })
  it('una factura, un traspaso o una comisión no se casan solos por el porcentaje', () => {
    expect(seCasaSolo(base({ origen: 'factura', seguridad: 99 }), ctx({ umbral: 80 }))).toBe(false)
    expect(seCasaSolo(base({ origen: 'banco', seguridad: 99 }), ctx({ umbral: 80 }))).toBe(false)
  })
  it('una regla de partida sin confirmar, nunca; confirmada una vez y por encima del umbral, sí', () => {
    const r = regla({ partida: true, confirmaciones: 0 })
    expect(seCasaSolo(base({ origen: 'regla', reglaId: 'r', seguridad: 99 }), ctx({ reglas: [r], umbral: 80 }))).toBe(false)
    expect(seCasaSolo(base({ origen: 'regla', reglaId: 'r', seguridad: 80 }), ctx({ reglas: [{ ...r, confirmaciones: 1 }], umbral: 80 }))).toBe(true)
  })
  it('sin destino o con varias opciones, nunca', () => {
    expect(seCasaSolo(base({ destino: null }), ctx())).toBe(false)
    expect(seCasaSolo(base({ alternativas: [{ etiqueta: 'a', destino: { tipo: 'traspaso', otro_movimiento_id: 'x', concepto: '' } }, { etiqueta: 'b', destino: { tipo: 'traspaso', otro_movimiento_id: 'y', concepto: '' } }] }), ctx())).toBe(false)
  })
})
