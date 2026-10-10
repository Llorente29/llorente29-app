// C04 · El núcleo del libro diario (lib/libro.ts y lib/asientosPropuestos.ts).
//
// La fixture es INVENTADA y tiene la forma de la población real medida en el
// informe de comprobaciones (C04_comprobaciones_previas.md §1): dos locales,
// tres plataformas, marcas propias por HubRise (Uber con el tipo por línea;
// Glovo y Just Eat sin base) y una marca cedida por Last (con base y con la
// factura del socio). Las cifras son de juguete; las formas, las de verdad.

import { describe, expect, it } from 'vitest'
import {
  cuadre, cuotaIva, baseDeTotal, problemas, siguienteNumero, huecos, contraasiento, primerDiaAbierto, fechaPropuesta,
  resultadoPorLocal, validaSola, NOMBRE_SERIE, type LineaAsiento, type CalendarioEmpresa,
} from '@/modules/conta/lib/libro'
import {
  ventasDelDia, liquidacionPlataforma, facturaProveedor, finDeMesCompras, pagoFactura, liquidacionSocio, nomina, aplicarAprendizaje, cuentaDeBoe,
  type PedidoDia, type EntradaVentasDia, type CuentasLiquidacion, type EntradaLiquidacion,
} from '@/modules/conta/lib/asientosPropuestos'

const NORTE = 'loc-norte', SUR = 'loc-sur'
const GLOVO = 'canal-glovo', UBER = 'canal-uber', JE = 'canal-je'
const PROPIA_A = 'marca-a', PROPIA_B = 'marca-b', CEDIDA = 'marca-cedida'
const IVA10 = { id: 'tipo-10', porcentaje: 10 }
const esIva = (c: string) => /^47[27]/.test(c)
const esRet = (c: string) => c.startsWith('4751')

const pedido = (p: Partial<PedidoDia> & Pick<PedidoDia, 'id' | 'total'>): PedidoDia => ({
  codigo: p.id.toUpperCase(), canalId: GLOVO, marcaId: PROPIA_A, marcaPropia: true, estado: 'closed', base: null, cuota: null, tiposEnLineas: [], ...p,
})
const cuentasVentas = { cobroPorCanal: { [GLOVO]: '43000001', [UBER]: '43000002', [JE]: '43000003' }, ventas: '70000000', devoluciones: '70800000', ivaRepercutido: '47700010' }
const dia = (pedidos: PedidoDia[], extra: Partial<EntradaVentasDia> = {}): EntradaVentasDia => ({
  fecha: '2026-10-05', localId: NORTE, tipo: IVA10, pedidos, devoluciones: [], cuentas: cuentasVentas, porMarca: true,
  nombreCanal: (id) => ({ [GLOVO]: 'Glovo', [UBER]: 'Uber Eats', [JE]: 'Just Eat' } as Record<string, string>)[id ?? ''] ?? 'sin canal',
  nombreLocal: 'Local Norte', ...extra,
})
// Un día de Local Norte: Glovo y Just Eat sin base (HubRise), Uber con base y el 10 % en sus líneas, una cedida (Last) y un cancelado.
const PEDIDOS_NORTE: PedidoDia[] = [
  pedido({ id: 'g1', total: 22.4 }),
  pedido({ id: 'g2', total: 18.95, marcaId: PROPIA_B }),
  pedido({ id: 'u1', total: 31.9, canalId: UBER, base: 29, cuota: 2.9, tiposEnLineas: [10] }),
  pedido({ id: 'j1', total: 15.5, canalId: JE }),
  pedido({ id: 'c1', total: 24.2, marcaId: CEDIDA, marcaPropia: false, base: 22, cuota: 2.2 }),
  pedido({ id: 'x1', total: 12, estado: 'cancelled' }),
]

describe('reglas 1 y 5 · cuadra, y la cuota es base × tipo', () => {
  it('cuadra al céntimo o dice cuánto y dónde', () => {
    expect(cuadre([{ debe: 121, haber: 0 }, { debe: 0, haber: 121 }])).toMatchObject({ cuadra: true, texto: 'Cuadra · 121,00 €' })
    expect(cuadre([{ debe: 100, haber: 0 }, { debe: 0, haber: 90 }]).texto).toBe('No cuadra: faltan 10,00 € en el Haber')
    expect(cuadre([{ debe: 0.1, haber: 0 }, { debe: 0.2, haber: 0 }, { debe: 0, haber: 0.3 }]).cuadra).toBe(true)
  })
  it('redondeo por línea, casos límite', () => {
    expect(cuotaIva(0.05, 10)).toBe(0.01)      // 0,005 → 0,01 (la mitad hacia fuera)
    expect(cuotaIva(0.04, 10)).toBe(0)
    expect(cuotaIva(100, 21)).toBe(21)
    expect(cuotaIva(-0.05, 10)).toBe(-0.01)
    expect(cuotaIva(1234.55, 21)).toBe(259.26)  // 259,2555
    expect(baseDeTotal(11, 10)).toEqual({ base: 10, cuota: 1 })
    expect(baseDeTotal(22.4, 10)).toEqual({ base: 20.36, cuota: 2.04 })
  })
  it('lo que la base no dejaría validar, dicho antes', () => {
    const mal: LineaAsiento[] = [
      { cuenta: '62900000', debe: 100, haber: 0, localId: NORTE },
      { cuenta: '47200021', debe: 20, haber: 0, localId: NORTE, iva: { tipoId: 't21', tipo: 21, base: 100, libro: 'received' } },
      { cuenta: '57200001', debe: 0, haber: 120, localId: null },
    ]
    expect(problemas(mal, esIva, esRet)).toEqual([
      'Apunte 2 (47200021): la cuota 20,00 € no es la base 100,00 € × 21 % = 21,00 €.',
      'Apunte 3 (57200001): falta el local (o marcarlo como común).',
    ])
    // Un asiento resumen de 9 facturas admite medio céntimo por factura (4 céntimos).
    const resumen: LineaAsiento = { cuenta: '47700010', debe: 0, haber: 10.04, localId: NORTE, iva: { tipoId: 't10', tipo: 10, base: 100, libro: 'issued', facturas: 9 } }
    expect(problemas([{ cuenta: '43000001', debe: 110.04, haber: 0, localId: NORTE }, { cuenta: '70000000', debe: 0, haber: 100, localId: NORTE }, resumen], esIva, esRet)).toEqual([])
  })
})

describe('reglas 2, 3 y 4 · número, contraasiento y fecha', () => {
  it('sin huecos', () => {
    expect(siguienteNumero([])).toBe(1)
    expect(siguienteNumero([1, 2, 3])).toBe(4)
    expect(huecos([1, 2, 4, 6])).toEqual([3, 5])
  })
  it('el contraasiento da la vuelta a cada apunte y conserva todo lo demás', () => {
    const l: LineaAsiento[] = [{ cuenta: '62900000', debe: 100, haber: 0, localId: NORTE }, { cuenta: '57200001', debe: 0, haber: 100, localId: NORTE }]
    expect(contraasiento(l)).toEqual([{ cuenta: '62900000', debe: 0, haber: 100, localId: NORTE }, { cuenta: '57200001', debe: 100, haber: 0, localId: NORTE }])
  })
  const cal: CalendarioEmpresa = {
    ejercicios: [{ code: '2026', inicio: '2026-01-01', fin: '2026-12-31', abierto: true, traidoHasta: '2026-09-30' }],
    mesesCerrados: ['2026-10'],
  }
  it('nunca se cuela: lo traído y el mes cerrado proponen el primer día abierto', () => {
    expect(primerDiaAbierto('2026-09-15', cal)).toBe('2026-11-01')
    expect(fechaPropuesta('2026-10-20', cal)).toEqual({ fecha: '2026-11-01', aviso: 'El documento es del 20/10/2026, pero el mes 10/2026 está cerrado: lo propongo el 01/11/2026.' })
    expect(fechaPropuesta('2026-09-15', cal).aviso).toBe('El documento es del 15/09/2026, pero hasta el 30/09/2026 el ejercicio es traído: lo propongo el 01/11/2026.')
    expect(fechaPropuesta('2026-11-03', cal)).toEqual({ fecha: '2026-11-03', aviso: null })
  })
  it('las series se dicen por su palabra', () => {
    expect([1, 2, 3, 9, 4].map((s) => NOMBRE_SERIE[s as 1])).toEqual(['Ventas', 'Compras', 'Banco', 'Nóminas', 'General'])
  })
})

describe('reglas 6 y 13 · el resumen de ventas del día', () => {
  const r = ventasDelDia(dia(PEDIDOS_NORTE))
  it('solo marcas propias; cedidas y canceladas fuera, y lo dice', () => {
    expect(r.resumen.tickets).toBe(4)
    expect(r.resumen.total).toBe(88.75)
    expect(r.resumen.cedidasFuera).toEqual({ pedidos: 1, total: 24.2 })
    expect(r.resumen.canceladosFuera).toBe(1)
    expect(r.propuesta!.lineas.some((l) => l.marcaId === CEDIDA)).toBe(false)
    expect(r.propuesta!.razones.map((x) => x.decision)).toContain('Fuera: 1 pedidos de marcas cedidas (24,20 €)')
  })
  it('cobro por plataforma, venta por marca, IVA con base, cuota y número de facturas', () => {
    const p = r.propuesta!
    expect(p.serie).toBe(1)
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.lineas.filter((l) => l.cuenta.startsWith('430')).map((l) => [l.cuenta, l.debe])).toEqual([['43000001', 41.35], ['43000002', 31.9], ['43000003', 15.5]])
    const iva = p.lineas.find((l) => l.cuenta === '47700010')!
    expect(iva.iva).toMatchObject({ tipo: 10, libro: 'issued', facturas: 4 })
    // Uber trae su base (29 + 2,90); el resto se calcula al 10 %.
    expect(iva.iva!.base + iva.haber).toBe(88.75)
    expect(problemas(p.lineas, esIva, esRet)).toEqual([])
    expect(p.lineas.filter((l) => l.cuenta === '70000000').map((l) => l.marcaId)).toEqual([PROPIA_A, PROPIA_B])
  })
  it('regla 13: sin base en el pedido se calcula y se dice; la confianza baja a Probable', () => {
    expect(r.resumen.baseCalculada).toBe(true)
    expect(r.propuesta!.confianza).toBe('probable')
    expect(r.propuesta!.razones.find((x) => x.decision === 'Base calculada')).toBeTruthy()
    const todosConBase = ventasDelDia(dia([pedido({ id: 'u2', total: 11, canalId: UBER, base: 10, cuota: 1, tiposEnLineas: [10] })]))
    expect(todosConBase.propuesta!.confianza).toBe('seguro')
  })
  it('un pedido con otro tipo: si trae su cuota al 21 %, no se propone; si solo lo dicen sus líneas, duda', () => {
    const conCuota = ventasDelDia(dia([pedido({ id: 'u3', total: 12.1, canalId: UBER, base: 10, cuota: 2.1, tiposEnLineas: [21] })]))
    expect(conCuota.propuesta).toBeNull()
    expect(conCuota.sinPropuesta).toContain('hay pedidos con otro tipo')
    const soloLineas = ventasDelDia(dia([pedido({ id: 'u4', total: 11, canalId: UBER, tiposEnLineas: [21] })]))
    expect(soloLineas.propuesta!.confianza).toBe('duda')
    expect(soloLineas.propuesta!.avisos[0]).toContain('tipo distinto del 10 %')
  })
  it('pedidos abiertos o una plataforma sin 430: no se propone, y dice por qué', () => {
    expect(ventasDelDia(dia([...PEDIDOS_NORTE, pedido({ id: 'o1', total: 9, estado: 'open' })])).sinPropuesta).toContain('El cierre del día aún no ha pasado por este día: 1 pedido de tus marcas sigue abierto')
    // Y lleva sus pedidos, para «Ver el pedido».
    expect(ventasDelDia(dia([...PEDIDOS_NORTE, pedido({ id: 'o1', total: 9, estado: 'open' })])).pedidosDelPorque?.map((p) => p.id)).toEqual(['o1'])
    expect(ventasDelDia(dia(PEDIDOS_NORTE, { cuentas: { ...cuentasVentas, cobroPorCanal: { [GLOVO]: '43000001' } } })).sinPropuesta).toContain('Uber Eats, Just Eat')
  })
  it('los no confirmados del cierre del día no son venta, pero se cuentan aparte (el 02/10 de Alcalá: 3 · 71,70 €)', () => {
    // Los tres importes reales del 02/10 en Alcalá que cerraría el atraso (PR #171).
    const nc = [21.9, 22.4, 27.4].map((total, i) => pedido({ id: `nc${i}`, total, estado: 'unconfirmed' }))
    const conNc = ventasDelDia(dia([...PEDIDOS_NORTE, ...nc]))
    const sinNc = ventasDelDia(dia(PEDIDOS_NORTE))
    expect(conNc.resumen.noConfirmados).toEqual({ pedidos: 3, total: 71.7, ids: ['nc0', 'nc1', 'nc2'] })
    // Las mismas ventas, la misma propuesta y los mismos tickets que sin ellos.
    expect(conNc.resumen.total).toBe(sinNc.resumen.total)
    expect(conNc.resumen.tickets).toBe(sinNc.resumen.tickets)
    expect(conNc.propuesta!.lineas).toEqual(sinNc.propuesta!.lineas)
    expect(conNc.resumen.canceladosFuera).toBe(sinNc.resumen.canceladosFuera)
    expect(sinNc.resumen.noConfirmados).toEqual({ pedidos: 0, total: 0, ids: [] })
  })
  it('un día de UN ticket con la base calculada se propone (20,40 € → 18,55 + 1,85), y uno al 21 % sigue sin pasar', () => {
    // Antes la tolerancia era floor(n/2) céntimos: 0 con un ticket, y 18,55 × 10 % = 1,855 → 1,86 no es 1,85.
    const uno = ventasDelDia(dia([pedido({ id: 'g234', total: 20.4 })]))
    expect(uno.propuesta!.lineas.map((l) => [l.debe, l.haber])).toEqual([[20.4, 0], [0, 18.55], [0, 1.85]])
    const al21 = ventasDelDia(dia([pedido({ id: 'g21', total: 24.2, base: 20, cuota: 4.2 })]))
    expect(al21.propuesta).toBeNull()
    expect(al21.sinPropuesta).toContain('hay pedidos con otro tipo')
  })
  it('solo cedidas ese día: no hay asiento de ventas', () => {
    expect(ventasDelDia(dia([PEDIDOS_NORTE[4]])).sinPropuesta).toBe('Ese día solo hubo ventas de marcas cedidas: van en la liquidación del socio.')
  })
  it('dos locales: cada uno su asiento, y entre los dos el total del día', () => {
    const sur = ventasDelDia(dia([pedido({ id: 's1', total: 30.8, canalId: UBER, base: 28, cuota: 2.8, tiposEnLineas: [10] })], { localId: SUR, nombreLocal: 'Local Sur' }))
    expect(sur.propuesta!.lineas.every((l) => l.localId === SUR)).toBe(true)
    expect(r.resumen.total + sur.resumen.total).toBe(119.55)
  })
})

describe('Julio, respuesta 1 · lo que deciden las plataformas', () => {
  it('cancelación antes de entregar: no hay venta', () => {
    const solo = ventasDelDia(dia([pedido({ id: 'x2', total: 20, estado: 'cancelled' })]))
    expect(solo.propuesta).toBeNull()
    expect(solo.resumen.canceladosFuera).toBe(1)
  })
  it('devolución: menos venta y menos IVA contra la plataforma, el día en que se produce, con su pedido (art. 80.Dos)', () => {
    const r = ventasDelDia(dia(PEDIDOS_NORTE, { devoluciones: [{ pedidoId: 'g0', codigo: 'G0', canalId: GLOVO, marcaId: PROPIA_A, marcaPropia: true, importe: 11, conFactura: false }] }))
    const dev = r.propuesta!.lineas.filter((l) => l.documento === 'G0')
    expect(dev.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['70800000', 10, 0], ['47700010', 1, 0], ['43000001', 0, 11]])
    expect(dev[1].iva).toMatchObject({ base: 10, libro: 'issued', facturas: 1 })
    expect(cuadre(r.propuesta!.lineas).cuadra).toBe(true)
    expect(r.propuesta!.razones.find((x) => x.decision.startsWith('1 devolución'))!.cita).toBe('Ley 37/1992, art. 80.Dos')
    expect(r.propuesta!.avisos.join(' ')).not.toContain('rectificativa')
  })
  it('la rectificativa solo si hubo factura emitida por nosotros (RD 1619/2012 art. 15)', () => {
    const r = ventasDelDia(dia(PEDIDOS_NORTE, { devoluciones: [{ pedidoId: 'g0', codigo: 'G0', canalId: GLOVO, marcaId: PROPIA_A, marcaPropia: true, importe: 11, conFactura: true }] }))
    expect(r.propuesta!.avisos.join(' ')).toContain('factura rectificativa (RD 1619/2012, art. 15.2)')
  })
  it('una devolución de una marca cedida no toca tus ventas', () => {
    const r = ventasDelDia(dia(PEDIDOS_NORTE, { devoluciones: [{ pedidoId: 'c0', codigo: 'C0', canalId: GLOVO, marcaId: CEDIDA, marcaPropia: false, importe: 11, conFactura: false }] }))
    expect(r.resumen.devoluciones.pedidos).toBe(0)
  })
})

describe('regla 7 · liquidación de plataforma', () => {
  const c: CuentasLiquidacion = { cliente430: '43000001', proveedor410: '41000002', comision: '62300000', otrosCargos: '62900000', iva21: { cuenta: '47200021', tipoId: 't21' }, banco: '57200001', pendienteSocio: '55200001' }
  const base: EntradaLiquidacion = {
    id: 'liq1', fecha: '2026-10-15', ref: '1–15 oct', plataforma: 'Glovo', flujo: 'own', ventas: 1000, comision: 200,
    cargos: [{ concepto: 'Espera del repartidor', importe: 10 }], devoluciones: 11, neto: 734.9, cobrado: { fecha: '2026-10-20', importe: 734.9 },
    pedidos: { total: 40, asentados: 40 }, localId: NORTE,
  }
  it('comisión y cargos con IVA 21 %, compensados con su 430 y el cobro; sin ventas', () => {
    const p = liquidacionPlataforma(base, c).propuesta!
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.lineas.some((l) => l.cuenta.startsWith('70'))).toBe(false)
    expect(p.lineas.find((l) => l.cuenta === '47200021')).toMatchObject({ debe: 44.1, iva: { base: 210, tipo: 21, libro: 'received' } })
    expect(p.lineas.find((l) => l.concepto === 'Espera del repartidor')).toMatchObject({ cuenta: '62900000', debe: 10 })
    expect(p.confianza).toBe('seguro')
    expect(p.razones.map((x) => x.decision)).toContain('Sin ventas')
  })
  it('si quedan pedidos sin su resumen del día: no los asienta y duda', () => {
    const p = liquidacionPlataforma({ ...base, pedidos: { total: 40, asentados: 37 } }, c).propuesta!
    expect(p.confianza).toBe('duda')
    expect(p.avisos[0]).toContain('3 de 40 pedidos')
    expect(p.lineas.some((l) => l.cuenta.startsWith('70'))).toBe(false)
  })
  it('el neto no cuadra con ventas − devoluciones − factura: duda con la cifra', () => {
    expect(liquidacionPlataforma({ ...base, neto: 700 }, c).propuesta!.avisos.join(' ')).toContain('neto 700,00 €')
  })
  it('una marca cedida: lo cobrado es del socio, no ingreso tuyo (NRV 16.ª)', () => {
    const p = liquidacionPlataforma({ ...base, flujo: 'licensed' }, c).propuesta!
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['57200001', 734.9, 0], ['55200001', 0, 734.9]])
    expect(p.razones[0].cita).toBe('PGC de Pymes, NRV 16.ª')
  })
})

describe('regla 8 · factura de proveedor, pago y socio', () => {
  const c = { proveedor: '41000006', retencion: '47510000', ivaSoportado: (p: number) => ({ 4: { cuenta: '47200004', tipoId: 't4' }, 10: { cuenta: '47200010', tipoId: 't10' }, 21: { cuenta: '47200021', tipoId: 't21' } } as Record<number, { cuenta: string; tipoId: string }>)[p] ?? null }
  it('gasto por su cuenta, IVA por tipo, retención y lo que queda a pagar', () => {
    const p = facturaProveedor({
      id: 'f1', numero: 'F-12', fecha: '2026-10-02', proveedor: 'Asesoría de prueba', terceroId: 't', esSocio: false, tieneNif: true, localId: NORTE,
      lineas: [{ base: 180, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62300000' }], total: 217.8,
      retencion: { tipoId: 'r15', porcentaje: 15, base: 180, importe: 27, modelo: '111' },
    }, c).propuesta!
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['62300000', 180, 0], ['47200021', 37.8, 0], ['47510000', 0, 27], ['41000006', 0, 190.8]])
    expect(problemas(p.lineas, esIva, esRet)).toEqual([])
    expect(p.confianza).toBe('seguro')
  })
  it('lo comprado a nombre del socio no es gasto: no se propone', () => {
    const r = facturaProveedor({ id: 'f2', numero: null, fecha: '2026-10-02', proveedor: 'Socio de marca', terceroId: null, esSocio: true, tieneNif: true, localId: SUR, lineas: [], total: 100, retencion: null }, c)
    expect(r.propuesta).toBeNull()
    expect(r.sinPropuesta).toContain('no es gasto tuyo')
  })
  // Compras (10/10), aceptación 7: sin NIF o sin tipo de gasto no se propone,
  // y la frase dice qué falta. Antes, sin tipo de gasto se proponía «en duda».
  it('sin NIF no se propone, y dice qué falta', () => {
    const r = facturaProveedor({ id: 'f3', numero: 'B-1', fecha: '2026-10-07', proveedor: 'Distribuciones de prueba', terceroId: null, esSocio: false, tieneNif: false, localId: NORTE,
      lineas: [{ base: 100, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }], total: 110, retencion: null }, c)
    expect(r.propuesta).toBeNull()
    expect(r.sinPropuesta).toBe('A Distribuciones de prueba le falta el NIF: ponlo en su ficha. Sin él no se puede deducir el IVA.')
  })
  // Compras (repaso, 10/10): «Apuntarla sin descontar el IVA». El papel de la
  // semilla a nombre de «Contado»: 102,54 de base al 10 %, 112,79 de total.
  it('sin descontar el IVA: la cuota es más gasto, sin 472, y no pide NIF', () => {
    const p = facturaProveedor({ id: 'f5', numero: 'BR-77', fecha: '2026-09-25', proveedor: 'Bodega de prueba', terceroId: null, esSocio: false, tieneNif: false, localId: NORTE,
      lineas: [{ base: 102.54, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }], total: 112.79, retencion: null, ivaNoDeducible: true }, c).propuesta!
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['60000000', 112.79, 0], ['41000006', 0, 112.79]])
    expect(p.lineas.some((l) => l.iva)).toBe(false)
    expect(problemas(p.lineas, esIva, esRet)).toEqual([])
    expect(p.avisos).toEqual([])
    expect(p.concepto).toContain('sin descontar el IVA')
    // La misma factura, deducible: su IVA va a la 472 y al libro.
    const d = facturaProveedor({ id: 'f5', numero: 'BR-77', fecha: '2026-09-25', proveedor: 'Bodega de prueba', terceroId: null, esSocio: false, tieneNif: true, localId: NORTE,
      lineas: [{ base: 102.54, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }], total: 112.79, retencion: null }, c).propuesta!
    expect(d.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['60000000', 102.54, 0], ['47200010', 10.25, 0], ['41000006', 0, 112.79]])
  })
  it('sin tipo de gasto no cae a una cuenta genérica: no se propone', () => {
    const r = facturaProveedor({ id: 'f4', numero: 'B-2', fecha: '2026-10-07', proveedor: 'Distribuciones de prueba', terceroId: null, esSocio: false, tieneNif: true, localId: NORTE,
      lineas: [{ base: 60, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }, { base: 40, tipo: { id: 't4', porcentaje: 4 }, cuentaGasto: null }], total: 107.6, retencion: null }, c)
    expect(r.propuesta).toBeNull()
    expect(r.sinPropuesta).toContain('le falta el tipo de gasto')
  })
  it('el pago sale del banco del local; sin banco, lo pide', () => {
    expect(pagoFactura({ facturaId: 'f1', fecha: '2026-10-10', proveedor: 'X', numero: 'F-12', importe: 190.8, localId: NORTE, terceroId: null }, { proveedor: '41000006', banco: '57200001' }).propuesta!.lineas.map((l) => l.cuenta)).toEqual(['41000006', '57200001'])
    expect(pagoFactura({ facturaId: 'f1', fecha: '2026-10-10', proveedor: 'X', numero: null, importe: 1, localId: NORTE, terceroId: null }, { proveedor: '41000006', banco: null }).sinPropuesta).toContain('banco')
  })
  it('liquidación del socio: compras, comisión 705 con IVA, sus ventas cobradas y la compensación', () => {
    const p = liquidacionSocio({ id: 'ls', fecha: '2026-10-31', socio: 'Socio de marca', terceroId: 's', localId: SUR, compras: [{ base: 1000, tipo: { id: 't10', porcentaje: 10 } }], comision: 300, ventasCobradas: 2000 }, {
      proveedor: '40000002', cliente: '43000004', compras: '60000000', ingresosServicios: '70500000', iva21: { cuenta: '47700021', tipoId: 't21' }, ivaSoportado: c.ivaSoportado, pendienteSocio: '41000009',
    }).propuesta!
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.lineas.find((l) => l.cuenta === '70500000')!.haber).toBe(300)
    expect(p.porque).toContain('le pagas 2.737,00 €')
    // Respuesta 3, punto 4: lo cobrado por cuenta de él no pasa por su 400.
    const saldo = (cta: string) => p.lineas.filter((l) => l.cuenta === cta).reduce((t, l) => t + l.haber - l.debe, 0)
    expect(p.lineas.filter((l) => l.cuenta === '40000002').map((l) => [l.debe, l.haber])).toEqual([[0, 1100]])
    // La comisión con IVA (363 €) se cobra de lo cobrado por cuenta de él; su 430 queda a cero.
    expect(Math.round(saldo('43000004') * 100)).toBe(0)
    expect(p.lineas.filter((l) => l.cuenta === '41000009').map((l) => [l.debe, l.haber])).toEqual([[363, 0]])
  })
  it('liquidación del socio sin ventas cobradas: la comisión se compensa con sus compras', () => {
    const p = liquidacionSocio({ id: 'ls', fecha: '2026-10-31', socio: 'Socio de marca', terceroId: 's', localId: SUR, compras: [{ base: 1000, tipo: { id: 't10', porcentaje: 10 } }], comision: 300, ventasCobradas: 0 }, {
      proveedor: '40000002', cliente: '43000004', compras: '60000000', ingresosServicios: '70500000', iva21: { cuenta: '47700021', tipoId: 't21' }, ivaSoportado: c.ivaSoportado, pendienteSocio: '41000009',
    }).propuesta!
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.lineas.some((l) => l.cuenta === '41000009')).toBe(false)
    expect(p.lineas.filter((l) => l.cuenta === '40000002').map((l) => [l.debe, l.haber])).toEqual([[0, 1100], [363, 0]])
    expect(p.porque).toContain('le pagas 737,00 €')
  })
})

// Compras (10/10), §2.4 y aceptación 4: lo recibido sin factura al cierre.
// La forma es la de D en Foodint: albaranes de un local, factura al mes.
describe('compras · lo recibido sin factura a fin de mes', () => {
  const e = {
    id: 'acc1', mes: '2026-10-01', proveedor: 'Carnes de prueba', terceroId: 'p1', localId: NORTE, nombreLocal: 'Norte',
    base: 150, recepciones: [{ codigo: 'ALB-1', fecha: '2026-10-05', base: 100 }, { codigo: 'ALB-2', fecha: '2026-10-20', base: 50 }], sinBase: 0,
  }
  it('un asiento el último día y su contrario el día 1, con el mismo origen', () => {
    const r = finDeMesCompras(e, { gasto: '60000000', pendiente: '40090000' })
    expect(r.sinPropuesta).toBeNull()
    const [fin, uno] = r.propuestas
    expect([fin.fecha, fin.origen, uno.fecha, uno.origen]).toEqual(['2026-10-31', { tipo: 'purchase_accrual', id: 'acc1' }, '2026-11-01', { tipo: 'purchase_accrual_reversal', id: 'acc1' }])
    expect(fin.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['60000000', 150, 0], ['40090000', 0, 150]])
    expect(uno.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['60000000', 0, 150], ['40090000', 150, 0]])
    expect(cuadre(fin.lineas).cuadra && cuadre(uno.lineas).cuadra).toBe(true)
    expect(fin.razones[0].porque).toBe('ALB-1 (05/10, 100,00 €), ALB-2 (20/10, 50,00 €)')
    expect(fin.concepto).toBe('Recibido sin factura · Carnes de prueba · Norte · octubre')
    expect(fin.confianza).toBe('seguro')
  })
  it('el último día de febrero de un bisiesto', () => {
    expect(finDeMesCompras({ ...e, mes: '2028-02-01' }, { gasto: '60000000', pendiente: '40090000' }).propuestas.map((p) => p.fecha)).toEqual(['2028-02-29', '2028-03-01'])
  })
  it('una recepción sin importe: se dice, y la confianza baja', () => {
    const r = finDeMesCompras({ ...e, recepciones: [...e.recepciones, { codigo: 'ALB-3', fecha: '2026-10-28', base: null }], sinBase: 1 }, { gasto: '60000000', pendiente: '40090000' })
    expect(r.propuestas[0].confianza).toBe('duda')
    expect(r.propuestas[0].avisos).toEqual(['1 recepción(es) sin importe no están en la cifra.'])
  })
  it('sin tipo de gasto no cae a una cuenta genérica: no se propone', () => {
    const r = finDeMesCompras(e, { gasto: null, pendiente: '40090000' })
    expect(r.propuestas).toEqual([])
    expect(r.sinPropuesta).toContain('le falta el tipo de gasto')
  })
})

describe('nómina, aprendizaje y cuentas traídas', () => {
  it('nómina: 640, 642, 476, 4751 (111) y 465; si no cuadra, lo dice', () => {
    const c = { sueldos: '64000000', ssEmpresa: '64200000', ssAcreedora: '47600000', irpf: '47510000', remuneraciones: '46500000' }
    const p = nomina({ id: 'n', mes: '2026-10-01', localId: NORTE, bruto: 7734.03, ssEmpresa: 2180.51, ssTrabajador: 440.57, irpf: 206.3, otras: 0, neto: 7087.16, retencionTipoId: 'rt' }, c).propuesta!
    expect(p.fecha).toBe('2026-10-31')
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.lineas.find((l) => l.cuenta === '47510000')!.retencion!.modelo).toBe('111')
    expect(nomina({ id: 'n', mes: '2026-10-01', localId: NORTE, bruto: 100, ssEmpresa: 0, ssTrabajador: 0, irpf: 0, otras: 0, neto: 90, retencionTipoId: null }, c).sinPropuesta).toContain('Bruto')
  })
  it('regla 11: una corrección cambia la siguiente del mismo origen, y lo dice', () => {
    const p = liquidacionPlataforma({ id: 'l', fecha: '2026-10-15', ref: null, plataforma: 'Glovo', flujo: 'own', ventas: 0, comision: 100, cargos: [], devoluciones: 0, neto: null, cobrado: null, pedidos: { total: 0, asentados: 0 }, localId: NORTE },
      { cliente430: '43000001', proveedor410: '41000002', comision: '62300000', otrosCargos: '62900000', iva21: { cuenta: '47200021', tipoId: 't' }, banco: null, pendienteSocio: null }).propuesta!
    const q = aplicarAprendizaje(p, 'channel_settlement:glovo', [{ clave: 'channel_settlement:glovo', propuesta: '62300000', elegida: '62700000', quien: 'Julio', cuando: '2026-10-01' }])
    expect(q.lineas[0].cuenta).toBe('62700000')
    expect(q.razones.at(-1)!.decision).toBe('Lo has corregido antes')
    expect(aplicarAprendizaje(p, 'channel_settlement:uber', [{ clave: 'channel_settlement:glovo', propuesta: '62300000', elegida: '62700000', quien: null, cuando: 'x' }])).toBe(p)
  })
  it('regla 12: la 47200000 de Diez propone la 472 del tipo; la común, la subcuenta del tercero', () => {
    const ivaPorTipo = (p: '472' | '477', t: number) => `${p}000${String(t).padStart(2, '0')}`
    expect(cuentaDeBoe('47200000', { tipo: 21, ivaPorTipo })).toEqual({ cuenta: '47200021', porque: 'La 47200000 de Diez junta todos los tipos; en tu plan hay una 472 por tipo: la del 21 % es la 47200021.' })
    expect(cuentaDeBoe('40000000', { ivaPorTipo, subcuentaDelTercero: '40000002' })!.cuenta).toBe('40000002')
    expect(cuentaDeBoe('62100000', { ivaPorTipo })).toBeNull()
  })
})

describe('reglas 9 y 10 · resultado por local y quién valida', () => {
  it('el resultado por local suma el total, también repartiendo lo común', () => {
    const ap = [
      { cuenta: '70000000', debe: 0, haber: 1000, localId: NORTE }, { cuenta: '70000000', debe: 0, haber: 500, localId: SUR },
      { cuenta: '62900000', debe: 300, haber: 0, localId: NORTE }, { cuenta: '66200000', debe: 100.01, haber: 0, localId: null },
      { cuenta: '57200001', debe: 1500, haber: 0, localId: NORTE },
    ]
    const sin = resultadoPorLocal(ap)
    expect(sin.total).toBe(1099.99)
    expect([...sin.porLocal.values()].reduce((t, x) => t + x, 0)).toBeCloseTo(1099.99, 6)
    const con = resultadoPorLocal(ap, [{ localId: NORTE, pct: 33.33 }, { localId: SUR, pct: 66.67 }])
    expect(con.porLocal.has(null)).toBe(false)
    expect(Math.round([...con.porLocal.values()].reduce((t, x) => t + x * 100, 0))).toBe(109999)
  })
  it('nunca valida sola, salvo la opción de la empresa para los Seguros de ventas del día', () => {
    const p = { origen: { tipo: 'sales_day' as const, id: null }, confianza: 'seguro' as const, avisos: [] }
    expect(validaSola(p, false)).toBe(false)
    expect(validaSola(p, true)).toBe(true)
    expect(validaSola({ ...p, confianza: 'probable' }, true)).toBe(false)
    expect(validaSola({ ...p, origen: { tipo: 'supplier_invoice', id: 'f' } }, true)).toBe(false)
  })
})
