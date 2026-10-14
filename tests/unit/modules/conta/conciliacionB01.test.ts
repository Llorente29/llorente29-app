// B01 · El motor de conciliación (tarea 4): una prueba por caso del encargo,
// y la de que nada se casa dos veces. Datos inventados (repositorio público).
import { describe, expect, it } from 'vitest'
import {
  conciliar, contraparte, decidir, nombra, nombreCuenta, refEn, reglasNuevas, resumenMes, subconjunto,
  type Contexto, type Movimiento,
} from '@/modules/conta/lib/conciliacion'

const NORTE = 'cta-norte', SUR = 'cta-sur'

function ctx(p: Partial<Contexto> = {}): Contexto {
  return {
    cuentas: [{ id: NORTE, nombre: 'Cuenta Norte', cuenta: '57200001' }, { id: SUR, nombre: 'Cuenta Sur', cuenta: '57200002' }],
    sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [],
    nombres: { '57000000': 'Caja.', '62800000': 'Luz y agua', '60000000': 'Comida y bebida', '62600000': 'Comisiones del banco', '47600000': 'Seguridad Social a pagar',
      '40700000': 'Anticipos a proveedores', '17000000': 'Préstamo a largo plazo', '66200000': 'Intereses del préstamo' },
    cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
    ...p,
  }
}
let n = 0
function mov(p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento {
  return { id: `m${++n}`, cuentaId: NORTE, fecha: '2026-10-12', conceptoComun: null, referencias: [], antesDelCorte: false, ...p }
}

const SUMINISTROS = { id: 'f477', numero: '2026/0477', fecha: '2026-09-28', totalCent: 49_888, pagadoCent: 0, proveedor: 'Suministros Eléctricos del Norte',
  alias: ['SUMINISTROS ELECTRICOS DEL NORTE'], terceroId: 't-sum', cuentaTercero: '41000007' }

describe('Seguro: solo los cuatro casos, y solo con candidato único', () => {
  it('1 · mismo importe y misma referencia que una factura pendiente', () => {
    const d = decidir(mov({ importeCent: -49_888, concepto: 'RECIBO SUMINISTROS ELECTRICOS DEL NORTE FRA 477', referencias: ['000000000477'] }), ctx({ facturas: [SUMINISTROS] }))
    expect(d.confianza).toBe('seguro')
    expect(d.porque).toBe('Casado solo: mismo importe y misma referencia (2026/0477) que la factura pendiente del 28/09.')
    expect(d.destino).toEqual({ tipo: 'factura_recibida', facturas: [{ id: 'f477', importe: 498.88 }], cuenta_tercero: '41000007', tercero_id: 't-sum',
      concepto: 'Pago a Suministros Eléctricos del Norte · 2026/0477', metodo: 'direct_debit' })
  })

  it('1 · un pago ya apuntado (asiento con esta 572) se enlaza, no se crea otro (P2)', () => {
    const d = decidir(mov({ importeCent: -8_740, concepto: 'TRANSFERENCIA A PANADERIA', fecha: '2026-10-08' }),
      ctx({ asientos: [{ id: 'e-pago', cuentaId: NORTE, fecha: '2026-10-08', importeCent: -8_740, concepto: 'Pago a Panadería · L-0412', origen: 'pago_factura' }] }))
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toEqual({ tipo: 'asiento', entry_id: 'e-pago' })
  })

  it('2 · traspaso entre dos cuentas propias el mismo día', () => {
    const sale = mov({ importeCent: -200_000, concepto: 'TRANSFERENCIA A CUENTA SUR', fecha: '2026-10-11' })
    const entra = mov({ importeCent: 200_000, concepto: 'TRANSFERENCIA DE CUENTA NORTE', fecha: '2026-10-11', cuentaId: SUR })
    const d = decidir(sale, ctx({ sinCasar: [sale, entra] }))
    expect(d.confianza).toBe('seguro')
    expect(d.que).toBe('Traspaso entre tus cuentas')
    expect(d.porque).toBe('Sale de Cuenta Norte y entra en Cuenta Sur el mismo día, mismo importe.')
    expect(d.destino).toMatchObject({ tipo: 'traspaso', otro_movimiento_id: entra.id })
  })

  it('2 · con un día de diferencia, probable; con dos candidatos el mismo día, ninguno seguro', () => {
    const sale = mov({ importeCent: -50_000, concepto: 'TRASPASO', fecha: '2026-10-11' })
    const entra = mov({ importeCent: 50_000, concepto: 'TRASPASO', fecha: '2026-10-12', cuentaId: SUR })
    expect(decidir(sale, ctx({ sinCasar: [sale, entra] })).confianza).toBe('probable')
    const otra = mov({ importeCent: 50_000, concepto: 'TRASPASO', fecha: '2026-10-11', cuentaId: SUR })
    const otra2 = mov({ importeCent: 50_000, concepto: 'TRASPASO', fecha: '2026-10-11', cuentaId: 'cta-tres' })
    expect(decidir(sale, ctx({ sinCasar: [sale, otra, otra2] })).confianza).not.toBe('seguro')
  })

  it('3 · cobro de plataforma que cuadra con su liquidación', () => {
    const d = decidir(mov({ importeCent: 341_218, concepto: 'TRANSFERENCIA DE PLATAFORMA NORTE SL LIQUIDACION 1-7 OCT', fecha: '2026-10-13' }), ctx({
      plataformas: [{ nombre: 'Plataforma Norte', alias: ['PLATAFORMA NORTE SL'], cuenta430: '43000001', terceroId: 't-pn', comisionHabitual: 0.17, pendiente: [] }],
      liquidaciones: [{ id: 'l1', plataforma: 'Plataforma Norte', fecha: '2026-10-08', desde: '2026-10-01', hasta: '2026-10-07', netoCent: 341_218, cuenta430: '43000001', terceroId: 't-pn' }],
    }))
    expect(d.confianza).toBe('seguro')
    expect(d.que).toBe('Cobro de Plataforma Norte · liquidación 01/10–07/10')
    expect(d.porque).toBe('Casado solo: cuadra con su liquidación 01/10–07/10 (neto 3.412,18 €).')
    expect(d.destino).toMatchObject({ tipo: 'liquidacion', liquidacion_id: 'l1', cuenta_cliente: '43000001' })
  })

  it('4 · cuota de un contrato: segura a la tercera confirmación, probable antes', () => {
    const alquiler = { id: 'c1', tipo: 'alquiler' as const, nombre: 'Alquiler del local', contiene: 'LOCALES DEL NORTE', importeCent: 150_000, confirmaciones: 3,
      terceroId: 't-loc', cuadro: null, cuentaCapital: null, cuentaIntereses: null, cuentaGasto: '62100000' }
    const m = mov({ importeCent: -150_000, concepto: 'RECIBO LOCALES DEL NORTE ALQUILER' })
    expect(decidir(m, ctx({ contratos: [alquiler] })).confianza).toBe('seguro')
    expect(decidir(m, ctx({ contratos: [{ ...alquiler, confirmaciones: 2 }] })).confianza).toBe('probable')
  })

  it('4 · préstamo: la cuota se parte en capital e intereses con su cuadro; sin cuadro, por aclarar', () => {
    const prestamo = { id: 'p1', tipo: 'prestamo' as const, nombre: 'Préstamo ICO', contiene: 'PRESTAMO', importeCent: 80_000, confirmaciones: 3, terceroId: null,
      cuadro: [{ fecha: '2026-10-02', cuotaCent: 80_000, capitalCent: 72_350, interesesCent: 7_650 }], cuentaCapital: '17000000', cuentaIntereses: '66200000', cuentaGasto: null }
    const m = mov({ importeCent: -80_000, concepto: 'CUOTA PRESTAMO', fecha: '2026-10-02', conceptoComun: '05' })
    const d = decidir(m, ctx({ contratos: [prestamo] }))
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toMatchObject({ tipo: 'contrato', lineas: [{ cuenta: '17000000', importe: 723.5 }, { cuenta: '66200000', importe: 76.5 }] })
    expect(d.porque).toContain('723,50 € de capital (Préstamo a largo plazo · 17000000) y 76,50 € de intereses (Intereses del préstamo · 66200000)')
    const sin = decidir(m, ctx({ contratos: [{ ...prestamo, cuadro: null }] }))
    expect(sin.confianza).toBe('duda')
    expect(sin.falta).toBe('el cuadro de amortización de este mes')
  })
})

describe('Probable: una línea con el porqué', () => {
  it('mismo importe y proveedor, sin referencia (la fila de N17)', () => {
    const d = decidir(mov({ importeCent: -49_888, concepto: 'RECIBO SUMINISTROS ELECTRICOS DEL NORTE' }), ctx({ facturas: [SUMINISTROS] }))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toBe('Mismo importe y proveedor que la factura pendiente del 28/09; la referencia del recibo no viene.')
  })

  it('varias facturas en un pago', () => {
    const f = (id: string, numero: string, total: number) => ({ ...SUMINISTROS, id, numero, totalCent: total })
    const d = decidir(mov({ importeCent: -(10_000 + 25_050), concepto: 'TRANSFERENCIA A SUMINISTROS ELECTRICOS DEL NORTE' }),
      ctx({ facturas: [f('a', 'A-1', 10_000), f('b', 'A-2', 7_000), f('c', 'A-3', 25_050)] }))
    expect(d.que).toBe('Pago de 2 facturas de Suministros Eléctricos del Norte')
    expect(d.destino).toMatchObject({ tipo: 'factura_recibida', facturas: [{ id: 'a', importe: 100 }, { id: 'c', importe: 250.5 }] })
  })

  it('varias iguales del mismo proveedor: la más antigua, y lo dice', () => {
    const d = decidir(mov({ importeCent: -49_888, concepto: 'RECIBO SUMINISTROS ELECTRICOS DEL NORTE' }),
      ctx({ facturas: [{ ...SUMINISTROS, id: 'nueva', fecha: '2026-10-05' }, SUMINISTROS] }))
    expect(d.porque).toBe('Hay 2 facturas pendientes de Suministros Eléctricos del Norte por este importe: propongo la más antigua, del 28/09.')
    expect(d.destino).toMatchObject({ facturas: [{ id: 'f477' }] })
  })

  it('un pago en partes: dice cuánto queda', () => {
    const d = decidir(mov({ importeCent: -20_000, concepto: 'TRANSFERENCIA A SUMINISTROS ELECTRICOS DEL NORTE' }), ctx({ facturas: [SUMINISTROS] }))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toBe('Paga 200,00 € de los 498,88 € que quedan; seguirán pendientes 298,88 €.')
  })

  it('P5 · proveedor del libro traído, sin factura en Folvy: contra su saldo', () => {
    const d = decidir(mov({ importeCent: -141_147, concepto: 'TRANSFERENCIA A MAYORISTA ALFA' }), ctx({
      saldosTraidos: [{ terceroId: 't-ma', proveedor: 'Mayorista Alfa', alias: ['MAYORISTA ALFA'], cuenta: '40000009', pendienteCent: 141_147 }] }))
    expect(d.porque).toBe('Pago a Mayorista Alfa · su saldo pendiente en el libro era 1.411,47.')
    expect(d.destino).toMatchObject({ tipo: 'cuenta', lineas: [{ cuenta: '40000009', importe: 1411.47 }] })
  })

  it('P6 · proveedor conocido sin nada pendiente: anticipo (407)', () => {
    const d = decidir(mov({ importeCent: -30_000, concepto: 'TRANSFERENCIA A HERMANOS RUIZ' }), ctx({
      proveedores: [{ terceroId: 't-hr', proveedor: 'Hermanos Ruiz', alias: ['HERMANOS RUIZ'], cuentaTercero: '40000002', cuentaAnticipo: '40700000' }] }))
    expect(d.que).toBe('Anticipo a Hermanos Ruiz')
    expect(d.porque).toContain('Anticipos a proveedores · 40700000')
    expect(d.destino).toMatchObject({ tipo: 'anticipo', lineas: [{ cuenta: '40700000', importe: 300 }] })
  })

  it('P7 · cobro de plataforma SIN liquidación: probable contra su 430, nunca seguro', () => {
    const d = decidir(mov({ importeCent: 340_000, concepto: 'TRANSFERENCIA DE PLATAFORMA NORTE SL', fecha: '2026-10-09' }), ctx({
      plataformas: [{ nombre: 'Plataforma Norte', alias: ['PLATAFORMA NORTE'], cuenta430: '43000001', terceroId: 't-pn', comisionHabitual: 0.17,
        pendiente: [{ desde: '2026-10-01', hasta: '2026-10-07', ventasCent: 412_040 }] }] }))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toBe('Sin liquidación: cuadra con las ventas de 01/10–07/10 menos un 17 % de comisión (su comisión habitual es 17 %). La diferencia queda pendiente en su 430 hasta que llegue la liquidación.')
    expect(d.destino).toMatchObject({ tipo: 'cuenta', lineas: [{ cuenta: '43000001', importe: 3400 }] })
  })

  it('seguros sociales que cuadran con la nómina del mes (476)', () => {
    const d = decidir(mov({ importeCent: -310_477, concepto: 'ADEUDO TGSS CUOTAS SEPTIEMBRE', conceptoComun: '15' }), ctx({
      nominas: [{ mes: '2026-09', ssPendienteCent: 310_477, netoPendienteCent: 900_000, cuenta476: '47600000', cuenta465: '46500000' }] }))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toBe('Cuadra con las nóminas de septiembre (476 a pagar 3.104,77).')
  })

  it('reglas y lo aprendido por contraparte; la tarjeta pide el ticket', () => {
    const regla = { id: 'r1', palabras: 'Cuando el concepto tenga «PLENITUDE» → Luz y agua · 62800000', contiene: 'PLENITUDE', signo: -1 as const, cuenta: '62800000', terceroId: null }
    const d = decidir(mov({ importeCent: -12_345, concepto: 'RECIBO PLENITUDE ENERGIA' }), ctx({ reglas: [regla] }))
    expect(d).toMatchObject({ confianza: 'probable', reglaId: 'r1', que: 'Luz y agua · 62800000', porque: `Regla: ${regla.palabras}.` })
    const t = decidir(mov({ importeCent: -8_640, concepto: 'PAGO CON TARJETA MERCADO CENTRAL 0937', conceptoComun: '12' }),
      ctx({ aprendido: [{ contraparte: 'MERCADO CENTRAL', cuenta: '60000000', terceroId: null, veces: 6 }] }))
    expect(t).toMatchObject({ confianza: 'probable', pideTicket: true, que: 'Comida y bebida · 60000000 · ¿ticket?' })
    // La tarjeta (···0937) no está dada de alta: lo aprendido se sigue proponiendo, y además pregunta de quién es (respuesta 3).
    expect(t.porque).toBe('Las 6 anteriores de este comercio fueron Comida y bebida · 60000000. Falta el ticket. Y la tarjeta acabada en 0937, ¿de quién es? Dala de alta en Cuentas y extractos y sabré a quién pedirle el ticket.')
  })

  it('comisiones del banco (concepto común 17) a la 626', () => {
    const d = decidir(mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO', conceptoComun: '17' }), ctx())
    expect(d.destino).toMatchObject({ tipo: 'cuenta', lineas: [{ cuenta: '62600000', importe: 12.5 }] })
    expect(d.porque).toContain('Comisiones del banco · 62600000')
  })
})

describe('Por aclarar: dice qué falta', () => {
  it('un cobro sin nada que cuadre (la última fila de N17)', () => {
    const d = decidir(mov({ importeCent: 127_817, concepto: 'TRANSFERENCIA RECIBIDA REF 88213' }), ctx())
    expect(d).toMatchObject({ confianza: 'duda', que: 'No sé qué es', falta: 'de quién es', porque: 'Sin factura ni liquidación de ese importe. ¿De quién es?' })
  })

  it('un pago sin factura, con la frase del encargo', () => {
    expect(decidir(mov({ importeCent: -127_817, concepto: 'TRANSFERENCIA EMITIDA' }), ctx()).porque).toBe('No hay factura de 1.278,17 €: ¿la subes o es un pago sin factura?')
  })

  it('TGSS sin nómina del mes: «Por aclarar» con la 476 propuesta (respuesta 2.4)', () => {
    const d = decidir(mov({ importeCent: -310_477, concepto: 'ADEUDO TGSS', conceptoComun: '15' }), ctx())
    expect(d.confianza).toBe('duda')
    expect(d.destino).toMatchObject({ tipo: 'cuenta', lineas: [{ cuenta: '47600000' }] })
    expect(d.porque).toContain('Seguridad Social a pagar · 47600000')
  })

  it('551 y 521 no tienen cruce propio: con una sola vez antes, por aclarar con la cuenta propuesta', () => {
    const d = decidir(mov({ importeCent: -50_000, concepto: 'TRANSFERENCIA A JUAN SOCIO' }),
      ctx({ aprendido: [{ contraparte: 'JUAN SOCIO', cuenta: '55100000', terceroId: null, veces: 1 }] }))
    expect(d).toMatchObject({ confianza: 'duda', falta: 'confirmarlo una vez más' })
  })

  it('un pago a Hacienda sin modelo pendiente pregunta modelo y periodo', () => {
    expect(decidir(mov({ importeCent: -90_000, concepto: 'ADEUDO AEAT MODELO 303' }), ctx()).falta).toBe('el modelo y el periodo')
  })
})

describe('Lo que enseñó la demostración de staging (run 190)', () => {
  it('el otro lado de un traspaso lleva su pareja y no se propone aparte', () => {
    const entra = mov({ importeCent: 150_000, concepto: 'TRASPASO DE CUENTA NORTE', fecha: '2026-10-06', cuentaId: SUR })
    const sale = mov({ importeCent: -150_000, concepto: 'TRASPASO A CUENTA SUR', fecha: '2026-10-06' })
    const ds = conciliar([sale, entra], ctx({ sinCasar: [sale, entra] }))
    const conDestino = ds.filter((d) => d.destino?.tipo === 'traspaso')
    const pareja = ds.filter((d) => d.otroLadoDe)
    expect(conDestino).toHaveLength(1)
    expect(pareja).toHaveLength(1)
    expect(pareja[0].otroLadoDe).toBe(conDestino[0].movimientoId)
  })
  it('el nombre de la cuenta sin el punto final («Caja. · 57000000» no)', () => {
    expect(nombreCuenta(ctx(), '57000000')).toBe('Caja · 57000000')
  })
  it('tarjeta sin historial: pide el ticket, no una factura (y con dígitos, de quién es la tarjeta)', () => {
    const d = decidir(mov({ importeCent: -6_000, concepto: 'PAGO CON TARJETA GASOLINERA', conceptoComun: '12' }), ctx())
    expect(d).toMatchObject({ confianza: 'duda', pideTicket: true, que: 'Pago con tarjeta · ¿ticket?', falta: 'el ticket' })
    expect(d.porque).toBe('Pago con tarjeta en GASOLINERA que aún no conozco: sube la foto del ticket y lo aprendo.')
    const conDigitos = decidir(mov({ importeCent: -8_640, concepto: 'PAGO CON TARJETA MERCADO CENTRAL 0937', conceptoComun: '12' }), ctx())
    expect(conDigitos).toMatchObject({ confianza: 'duda', pideTicket: true, que: 'Tarjeta acabada en 0937', falta: 'de quién es la tarjeta' })
  })
  it('ingreso de efectivo: probable desde la caja (570)', () => {
    const d = decidir(mov({ importeCent: 200_000, concepto: 'INGRESO EFECTIVO', conceptoComun: '02' }), ctx())
    expect(d).toMatchObject({ confianza: 'probable', que: 'Ingreso de efectivo · Caja · 57000000', destino: { lineas: [{ cuenta: '57000000', importe: 2000 }] } })
  })
})

describe('Antes del corte (P4): solo se enlaza', () => {
  const traido = { id: 'diez-1', cuentaId: NORTE, fecha: '2026-09-28', importeCent: -12_000, concepto: 'Recibo luz septiembre', origen: 'traido' as const }
  it('con pareja en el libro traído, se enlaza; sin pareja, informativo', () => {
    const d = decidir(mov({ importeCent: -12_000, concepto: 'RECIBO', fecha: '2026-09-28', antesDelCorte: true }), ctx({ asientos: [traido] }))
    expect(d).toMatchObject({ confianza: 'seguro', destino: { tipo: 'asiento', entry_id: 'diez-1' } })
    const sin = decidir(mov({ importeCent: -99_900, concepto: 'RECIBO', fecha: '2026-09-28', antesDelCorte: true }), ctx({ asientos: [traido] }))
    expect(sin).toMatchObject({ que: 'Antes del corte · sin pareja en el libro', antesDelCorteSinPareja: true, destino: null })
  })
})

describe('Nada se casa dos veces', () => {
  it('dos pagos iguales para una sola factura: solo uno se la lleva', () => {
    const a = mov({ importeCent: -49_888, concepto: 'RECIBO SUMINISTROS ELECTRICOS DEL NORTE', fecha: '2026-10-12' })
    const b = mov({ importeCent: -49_888, concepto: 'RECIBO SUMINISTROS ELECTRICOS DEL NORTE', fecha: '2026-10-13' })
    const ds = conciliar([a, b], ctx({ facturas: [SUMINISTROS] }))
    expect(ds.filter((d) => d.destino?.tipo === 'factura_recibida')).toHaveLength(1)
    expect(ds[1].confianza).toBe('duda')
  })

  it('una liquidación, un asiento traído y el otro lado de un traspaso se gastan al usarse', () => {
    const c = ctx({
      plataformas: [{ nombre: 'Plataforma Norte', alias: ['PLATAFORMA NORTE'], cuenta430: '43000001', terceroId: null, comisionHabitual: null, pendiente: [] }],
      liquidaciones: [{ id: 'l1', plataforma: 'Plataforma Norte', fecha: '2026-10-08', desde: null, hasta: null, netoCent: 1_000, cuenta430: '43000001', terceroId: null }],
    })
    const ds = conciliar([mov({ importeCent: 1_000, concepto: 'TRANSF PLATAFORMA NORTE' }), mov({ importeCent: 1_000, concepto: 'TRANSF PLATAFORMA NORTE' })], c)
    expect(ds.filter((d) => d.destino?.tipo === 'liquidacion')).toHaveLength(1)
    const sale = mov({ importeCent: -500, concepto: 'TRASPASO', fecha: '2026-10-11' })
    const entra = mov({ importeCent: 500, concepto: 'TRASPASO', fecha: '2026-10-11', cuentaId: SUR })
    const sale2 = mov({ importeCent: -500, concepto: 'TRASPASO', fecha: '2026-10-11' })
    const ts = conciliar([sale, entra, sale2], ctx({ sinCasar: [sale, entra, sale2] }))
    expect(ts.filter((d) => d.destino?.tipo === 'traspaso')).toHaveLength(1)
    expect(ts.find((d) => d.movimientoId === sale2.id)!.destino?.tipo).not.toBe('traspaso')
  })

  it('cien movimientos al azar contra diez facturas: ninguna factura pagada por encima de su total', () => {
    let semilla = 7
    const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648
    const facturas = Array.from({ length: 10 }, (_, i) => ({ ...SUMINISTROS, id: `f${i}`, numero: `N-${i}`, totalCent: 1000 * (1 + (i % 4)) }))
    const movs = Array.from({ length: 100 }, (_, i) => mov({ importeCent: -1000 * (1 + Math.floor(azar() * 4)), concepto: 'RECIBO SUMINISTROS ELECTRICOS DEL NORTE', fecha: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}` }))
    const pagado = new Map<string, number>()
    for (const d of conciliar(movs, ctx({ facturas }))) {
      if (d.destino?.tipo === 'factura_recibida') for (const f of d.destino.facturas) pagado.set(f.id, (pagado.get(f.id) ?? 0) + Math.round(f.importe * 100))
    }
    for (const f of facturas) expect(pagado.get(f.id) ?? 0).toBeLessThanOrEqual(f.totalCent)
    // Hay pagos de sobra para todas: todas acaban pagadas, ninguna dos veces.
    expect(facturas.every((f) => pagado.get(f.id) === f.totalCent)).toBe(true)
  })
})

describe('Piezas', () => {
  it('nombre de cuenta: nombre de uso · código, nunca el código a secas si hay nombre', () => {
    expect(nombreCuenta(ctx(), '62800000')).toBe('Luz y agua · 62800000')
    expect(nombreCuenta(ctx(), '99999999')).toBe('99999999')
  })
  it('referencias: «2026/0477» está en «… 000000000477»; «12» no basta', () => {
    expect(refEn('RECIBO 000000000477', '2026/0477')).toBe(true)
    expect(refEn('FRA A-2026-031', 'A-2026-031')).toBe(true)
    expect(refEn('RECIBO 4770', '2026/0477')).toBe(false)
    expect(refEn('RECIBO 12', 'F-12')).toBe(false)
  })
  it('nombra sin acentos ni forma social; contraparte sin la operación', () => {
    expect(nombra('RECIBO SUMINISTROS ELECTRICOS DEL NORTE SL', ['Suministros Eléctricos del Norte, S.L.'])).toBe(true)
    expect(nombra('RECIBO SUMINISTROS', ['Suministros Eléctricos del Norte'])).toBe(false)
    expect(contraparte('PAGO CON TARJETA MERCADO CENTRAL 0937')).toBe('MERCADO CENTRAL')
    expect(contraparte('TRANSFERENCIA DE PLATAFORMA NORTE SL LIQUIDACION 1-7 OCT')).toBe('PLATAFORMA NORTE')
  })
  it('subconjunto: el de menos facturas', () => {
    expect(subconjunto([100, 250, 350, 600], 600)).toEqual([3])
    expect(subconjunto([100, 250, 70], 350)).toEqual([0, 1])
    expect(subconjunto([100, 250], 999)).toBeNull()
  })
  it('regla nueva cuando lo aprendido llega a 2 y no hay regla que lo diga', () => {
    const r = reglasNuevas({ aprendido: [{ contraparte: 'PLENITUDE', cuenta: '62800000', terceroId: null, veces: 2 }], reglas: [], nombres: ctx().nombres })
    expect(r).toEqual([{ palabras: 'Cuando el concepto tenga «PLENITUDE» → Luz y agua · 62800000', contiene: 'PLENITUDE', cuenta: '62800000', terceroId: null }])
  })
  it('la banda: «He casado yo 142 de 158…»', () => {
    const ds = [...Array(142).fill({ confianza: 'seguro', antesDelCorteSinPareja: false }), ...Array(11).fill({ confianza: 'probable', antesDelCorteSinPareja: false }),
      ...Array(5).fill({ confianza: 'duda', antesDelCorteSinPareja: false })]
    expect(resumenMes(ds, '2026-10').frase).toBe('He casado yo 142 de 158 movimientos de octubre. Te quedan 11 por confirmar y 5 por aclarar.')
  })
})

describe('P2 · un pago por dos caminos, un asiento (el lado del libro)', () => {
  it('la liquidación cuyo cobro ya casó Bancos no vuelve a llevar el cobro', async () => {
    const { liquidacionPlataforma } = await import('@/modules/conta/lib/asientosPropuestos')
    const c = { cliente430: '43000001', proveedor410: '41000002', comision: '62300000', otrosCargos: '62900000', iva21: { cuenta: '47200021', tipoId: 't21' }, banco: '57200001', pendienteSocio: null }
    const base = { id: 'liq1', fecha: '2026-10-08', ref: '1–7 oct', plataforma: 'Plataforma Norte', flujo: 'own' as const, ventas: 4120.4, comision: 585.31, cargos: [],
      devoluciones: 0, neto: 3412.18, cobrado: null, cobroEnBancos: true, pedidos: { total: 0, asentados: 0 }, localId: null }
    const p = liquidacionPlataforma(base, c).propuesta!
    expect(p.lineas.some((l) => l.cuenta === '57200001')).toBe(false)
    expect(p.razones.map((r) => r.decision)).toContain('Cobro en Bancos')
    // Sin Bancos y con «cobrada» a mano, el cobro sigue yendo en la liquidación (como hoy).
    const q = liquidacionPlataforma({ ...base, cobroEnBancos: false, cobrado: { fecha: '2026-10-09', importe: 3412.18 } }, c).propuesta!
    expect(q.lineas.filter((l) => l.cuenta === '57200001')).toHaveLength(1)
  })
})

describe('P3 · el cobro y el pago en la serie de tesorería de la empresa (respuesta 3)', () => {
  it('«Pago a…» y la liquidación van a la serie que diga la empresa; sin decirlo, la 3 de siempre', async () => {
    const { liquidacionPlataforma, pagoFactura } = await import('@/modules/conta/lib/asientosPropuestos')
    const c = { cliente430: '43000001', proveedor410: '41000002', comision: '62300000', otrosCargos: '62900000', iva21: { cuenta: '47200021', tipoId: 't21' }, banco: '57200001', pendienteSocio: null }
    const l = { id: 'liq1', fecha: '2026-10-08', ref: '1–7 oct', plataforma: 'Plataforma Norte', flujo: 'own' as const, ventas: 4120.4, comision: 585.31, cargos: [],
      devoluciones: 0, neto: 3412.18, cobrado: { fecha: '2026-10-09', importe: 3412.18 }, pedidos: { total: 0, asentados: 0 }, localId: null }
    expect(liquidacionPlataforma(l, c).propuesta!.serie).toBe(3)
    expect(liquidacionPlataforma(l, { ...c, serieTesoreria: 4 }).propuesta!.serie).toBe(4)
    const f = { facturaId: 'f1', fecha: '2026-10-09', proveedor: 'Mayorista Alfa', numero: 'A-1', importe: 100, localId: null, terceroId: null }
    expect(pagoFactura(f, { proveedor: '40000001', banco: '57200001' }).propuesta!.serie).toBe(3)
    expect(pagoFactura(f, { proveedor: '40000001', banco: '57200001', serieTesoreria: 4 }).propuesta!.serie).toBe(4)
  })
})

describe('Tarjetas de débito (respuesta 3): qué tarjeta pagó y a quién pedirle el ticket', () => {
  const tarjetas = [
    { id: 'tj-ana', cuentaId: NORTE, ultimos4: '4821', titular: 'Ana', localId: 'loc-norte' },
    { id: 'tj-luis', cuentaId: NORTE, ultimos4: '0937', titular: 'Luis', localId: null },
  ]
  const aprendido = [{ contraparte: 'MERCADO CENTRAL', cuenta: '60000000', terceroId: null, veces: 6 }]

  it('dos tarjetas en la misma cuenta: cada pago a su titular, con el local de la tarjeta', () => {
    const a = decidir(mov({ importeCent: -8_640, concepto: 'COMPRA TARJ. ****4821 MERCADO CENTRAL', conceptoComun: '12' }), ctx({ tarjetas, aprendido }))
    expect(a).toMatchObject({ tarjetaId: 'tj-ana', confianza: 'probable', pideTicket: true, destino: { local_id: 'loc-norte' } })
    expect(a.porque).toBe('Las 6 anteriores de este comercio fueron Comida y bebida · 60000000. Tarjeta de Ana (···4821): pídele el ticket.')
    const l = decidir(mov({ importeCent: -2_000, concepto: 'PAGO CON TARJETA 0937 GASOLINERA SUR', conceptoComun: '12' }), ctx({ tarjetas }))
    expect(l).toMatchObject({ tarjetaId: 'tj-luis', confianza: 'duda', que: 'Pago con tarjeta · ¿ticket?' })
    expect(l.porque).toBe('Pago con la tarjeta de Luis (···0937) en GASOLINERA SUR que aún no conozco: pídele el ticket a Luis y lo aprendo.')
  })

  it('una tarjeta no dada de alta: «Por aclarar: tarjeta acabada en 1234, ¿de quién es?»', () => {
    const d = decidir(mov({ importeCent: -1_500, concepto: 'COMPRA TARJ. ****1234 FERRETERIA', conceptoComun: '12' }), ctx({ tarjetas }))
    expect(d).toMatchObject({ confianza: 'duda', tarjetaId: null, que: 'Tarjeta acabada en 1234', falta: 'de quién es la tarjeta' })
    expect(d.porque.startsWith('Por aclarar: tarjeta acabada en 1234, ¿de quién es?')).toBe(true)
  })

  it('la tarjeta de otra cuenta no vale; sin ninguna dada de alta, también pregunta de quién es (e2e del 13/10)', () => {
    const otra = decidir(mov({ importeCent: -1_500, concepto: 'COMPRA TARJ. ****4821 FERRETERIA', conceptoComun: '12', cuentaId: SUR }), ctx({ tarjetas }))
    expect(otra.tarjetaId).toBeNull()
    const sin = decidir(mov({ importeCent: -1_500, concepto: 'COMPRA TARJ. ****1234 FERRETERIA', conceptoComun: '12' }), ctx())
    expect(sin).toMatchObject({ confianza: 'duda', que: 'Tarjeta acabada en 1234' })
    // Un año no es una tarjeta.
    const anio = decidir(mov({ importeCent: -1_500, concepto: 'COMPRA TARJ. FERRETERIA 2026', conceptoComun: '12' }), ctx())
    expect(anio.que).toBe('Pago con tarjeta · ¿ticket?')
  })

  it('los dígitos: enmascarados primero, y nunca el número entero', async () => {
    const { digitosTarjeta } = await import('@/modules/conta/lib/conciliacion')
    expect(digitosTarjeta('COMPRA TARJ. XXXX XXXX XXXX 4821 MERCADO 0937')).toEqual(['4821', '0937'])
    expect(digitosTarjeta('PAGO 12/10 1234')).toEqual(['1234'])
  })
})
