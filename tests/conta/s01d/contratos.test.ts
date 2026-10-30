// S01d · Préstamos y aplazamientos (tablero 3): leer el cuadro de un Excel,
// comprobar que el capital suma lo aplazado, la cabecera y cómo casa cada
// cuota. Cuadros inventados (nada del real de ningún banco ni de la TGSS).
import { describe, expect, it } from 'vitest'
import { comoSeCasa, conPendiente, cuadraConLoAplazado, leerCuadro, leerFecha, proximaCuota, quedaPorPagar, resumen, type ContratoVista } from '@/modules/conta/lib/contratos'
import { decidir, type Contexto, type Contrato, type Movimiento } from '@/modules/conta/lib/conciliacion'

const hoja = [
  ['Cuadro de amortización', '', '', '', ''],
  ['', '', '', '', ''],
  ['Fecha', 'Cuota', 'Amortización', 'Intereses', 'Capital pendiente'],
  ['05/11/2026', '300,00', '250,00', '50,00', '750,00'],
  ['05/12/2026', '300,00', '260,00', '40,00', '490,00'],
  ['05/01/2027', '300,00', '490,00', '10,00', '0,00'],
  ['Total', '', '', '', ''],
]

describe('leer el cuadro', () => {
  it('fechas: dd/mm/aaaa, aaaa-mm-dd y el formato corto de Excel (mes delante)', () => {
    expect(leerFecha('05/11/2026')).toBe('2026-11-05')
    expect(leerFecha('2026-11-05')).toBe('2026-11-05')
    expect(leerFecha('11/5/26')).toBe('2026-11-05')
    expect(leerFecha('Total')).toBeNull()
  })
  it('encuentra los títulos, toma «Amortización» como capital y no el «Capital pendiente»', () => {
    const r = leerCuadro(hoja)
    expect('cuadro' in r && r.cuadro).toEqual([
      { fecha: '2026-11-05', cuotaCent: 30000, capitalCent: 25000, interesesCent: 5000 },
      { fecha: '2026-12-05', cuotaCent: 30000, capitalCent: 26000, interesesCent: 4000 },
      { fecha: '2027-01-05', cuotaCent: 30000, capitalCent: 49000, interesesCent: 1000 },
    ])
  })
  it('sin títulos, dice qué le falta', () => {
    expect(leerCuadro([['a', 'b'], ['1', '2']])).toEqual({ error: 'No encuentro el cuadro: hace falta una fila con «Fecha», «Capital» (o «Amortización») e «Intereses».' })
  })
})

describe('el capital tiene que sumar lo aplazado', () => {
  const cuadro = (leerCuadro(hoja) as { cuadro: ContratoVista['cuadro'] & object }).cuadro
  it('cuadra con 1.000,00; no con 1.000,01', () => {
    expect(cuadraConLoAplazado(cuadro, 100000)).toEqual({ cuadra: true, sumaCent: 100000 })
    expect(cuadraConLoAplazado(cuadro, 100001).cuadra).toBe(false)
  })
  it('lo pendiente tras cada fila', () => {
    expect(conPendiente(cuadro, 100000).map((f) => f.pendienteCent)).toEqual([75000, 49000, 0])
  })
  const c: ContratoVista = { id: 'c', tipo: 'prestamo', nombre: 'Préstamo', contiene: 'AMORTIZACION', importeCent: 30000, principalCent: 100000, cuotas: 3, cuadro,
    bancoId: null, cuentaCorto: '52000001', cuentaLargo: '17000001', cuentaIntereses: '66230000', documento: 'cuadro.xlsx' }
  it('la cabecera del tablero: cuotas del mes, la próxima y lo que queda', () => {
    expect(quedaPorPagar(c, '2026-11-01')).toBe(100000)
    expect(quedaPorPagar(c, '2026-11-20')).toBe(75000)
    expect(proximaCuota(c, '2026-11-20')?.fecha).toBe('2026-12-05')
    expect(resumen([c], '2026-11-01')).toEqual({ mes: { totalCent: 30000, cuotas: 1 }, proxima: { fila: cuadro[0], nombre: 'Préstamo' }, quedaCent: 100000, contratos: 1 })
  })
  it('cómo se casa: con cuadro, sola; la póliza, con la liquidación', () => {
    expect(comoSeCasa(c)).toEqual({ texto: 'Sola, con su cuadro', sola: true })
    expect(comoSeCasa({ ...c, tipo: 'aplazamiento', documento: 'resolucion-tgss.pdf' })).toEqual({ texto: 'Sola, con su resolución', sola: true })
    expect(comoSeCasa({ ...c, tipo: 'poliza', cuadro: null })).toEqual({ texto: 'Con la liquidación del banco', sola: false })
  })
})

describe('cada cuota, con su fila', () => {
  const base = { confirmaciones: 0, terceroId: null, cuentaGasto: null, cuentaCapital: '52000001', cuentaIntereses: '66230000' }
  const prestamo: Contrato = { ...base, id: 'p', tipo: 'prestamo', nombre: 'Préstamo', contiene: 'AMORTIZACION DE PRESTAMO', importeCent: 30000,
    cuadro: [{ fecha: '2026-11-05', cuotaCent: 30000, capitalCent: 25000, interesesCent: 5000 }] }
  // Comparte concepto del banco con el préstamo (pasa en BBVA): lo separan el importe y la fila.
  const aplazado: Contrato = { ...base, id: 'a', tipo: 'prestamo', nombre: 'Pago aplazado', contiene: 'AMORTIZACION DE PRESTAMO', importeCent: 12000,
    cuadro: [{ fecha: '2026-11-08', cuotaCent: 12000, capitalCent: 11500, interesesCent: 500 }] }
  const poliza: Contrato = { ...base, id: 'z', tipo: 'poliza', nombre: 'Póliza', contiene: 'LIQUIDACION POLIZA', importeCent: null, cuadro: null }
  const ctx = {
    cuentas: [{ id: 'cta', nombre: 'Cuenta', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], reglas: [], aprendido: [], asientos: [], impuestos: [], cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
    nombres: { '52000001': 'Deudas a corto', '66230000': 'Intereses' }, contratos: [prestamo, aplazado, poliza],
  } as unknown as Contexto
  const mov = (importeCent: number, concepto: string, fecha = '2026-11-05'): Movimiento => ({ id: 'm', cuentaId: 'cta', fecha, conceptoComun: null, referencias: [], antesDelCorte: false, importeCent, concepto })

  it('mismo concepto, dos contratos: casa sola con el de esa cuota en ese mes, en capital a corto e intereses', () => {
    const d = decidir(mov(-12000, 'CARGO POR AMORTIZACION DE PRESTAMO', '2026-11-08'), ctx)
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toMatchObject({ tipo: 'contrato', contrato_id: 'a', lineas: [{ cuenta: '52000001', importe: 115 }, { cuenta: '66230000', importe: 5 }] })
  })
  it('la póliza: por aclarar, con capital e intereses para repartir', () => {
    const d = decidir(mov(-133334, 'LIQUIDACION POLIZA'), ctx)
    expect(d.confianza).toBe('duda')
    expect(d.falta).toBe('repartir el importe')
    expect(d.reparto).toEqual([{ cuenta: '52000001', importeCent: null, concepto: 'Capital' }, { cuenta: '66230000', importeCent: null, concepto: 'Intereses' }])
  })
})

describe('el PDF en modo «cuadro» (ocr-albaran): lo leído, comprobado', () => {
  it('la resolución de un aplazamiento: filas en orden y cuadra con lo aplazado', async () => {
    const { comprobarCuadro } = await import('../../../supabase/functions/_shared/lecturaCuadro')
    const r = comprobarCuadro({ tipo: 'aplazamiento', organismo: 'Seguridad Social', importe_aplazado: 1000,
      filas: [{ fecha: '2026-12-30', cuota: 510, capital: 500, intereses: 10 }, { fecha: '2026-11-30', cuota: 520, capital: 500, intereses: 20 }, { fecha: 'pronto', capital: 1 }] })
    expect(r).toEqual({ tipo: 'aplazamiento', organismo: 'Seguridad Social', importeAplazado: 1000, sumaCapital: 1000, cuadra: true,
      filas: [{ fecha: '2026-11-30', cuota: 520, capital: 500, intereses: 20 }, { fecha: '2026-12-30', cuota: 510, capital: 500, intereses: 10 }] })
  })
  it('no cuadra si falta un céntimo; sin lo aplazado en el papel, lo dice la persona; sin filas, error', async () => {
    const { comprobarCuadro } = await import('../../../supabase/functions/_shared/lecturaCuadro')
    expect(comprobarCuadro({ importe_aplazado: 1000.01, filas: [{ fecha: '2026-11-30', capital: 1000, intereses: 0 }] })).toMatchObject({ cuadra: false, tipo: 'prestamo' })
    expect(comprobarCuadro({ filas: [{ fecha: '2026-11-30', capital: '1000,00' }] })).toMatchObject({ cuadra: null, sumaCapital: 1000, filas: [{ cuota: 1000, intereses: 0 }] })
    expect(comprobarCuadro({ filas: [] })).toEqual({ error: 'No he encontrado ninguna fila del cuadro (fecha, cuota, capital e intereses) en el documento.' })
  })
})
