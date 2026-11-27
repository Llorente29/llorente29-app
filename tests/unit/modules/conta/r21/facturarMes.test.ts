// R21 · «Facturar el mes», paso a paso (_shared/factura/facturarMes.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { casosDelMes, cuadreDelMes, pasoCinco, pasoCuatro, pasosDelMes, tipoEnPalabras,
  type CasoEntrada, type EstadoDelMes, type MandadoCegid, type PendienteGuardado } from '../../../../../supabase/functions/_shared/factura/facturarMes'

const NOV = '2026-11'
const DIC = '2026-12'
const caso = (clave: string, x: Partial<CasoEntrada> = {}): CasoEntrada => ({
  clave, tipo: 'no_se_sabe_quien', cliente: null, importeCent: 14000, fecha: '2026-11-10', frase: 'Entró un traspaso de 140,00 € el 10/11.',
  propuesta: null, falta: 'El banco no dice quién lo manda.', decidido: false, ...x,
})
const pendiente = (clave: string, mes: string, importeCent = 14000, id = `p-${clave}`): PendienteGuardado => ({
  id, clave, tipo: 'no_se_sabe_quien', mes, cliente: null, importeCent, motivo: 'Preguntado a QBO.', dejadoPor: 'Persona de prueba', dejadoAt: `${mes}-20T10:00:00Z`,
})
const cuadre0 = cuadreDelMes(NOV, { cobradoCent: 100000, noEsCobroCent: 0, mandadoCent: 90000, pagaFacturasCent: 10000 }, [])
const mandado: MandadoCegid[] = [
  { cliente: 1001, nombre: 'Cliente uno de prueba', serie: '1', totalCent: 6050, estado: 'mandada' },
  { cliente: 1001, nombre: 'Cliente uno de prueba', serie: '1', totalCent: 2420, estado: 'mandada' },
  { cliente: 1002, nombre: 'Cliente dos de prueba', serie: '1', totalCent: 7260, estado: 'mandada' },
  { cliente: 1003, nombre: 'Cliente tres de prueba', serie: '3', totalCent: 4840, estado: 'mandada' },
  { cliente: 1004, nombre: 'Cliente cuatro de prueba', serie: '1', totalCent: 9999, estado: 'deshecha' },
]
const estado = (x: Partial<EstadoDelMes> = {}): EstadoDelMes => ({
  preparado: { cobradoCent: 100000, listos: 10, casos: 0 }, casos: [], cuadre: cuadre0, porMandar: 0, mandados: 10,
  paso4: pasoCuatro(mandado), vistoBueno: null, paso5: null, ...x,
})

describe('R21 · los pasos: cada uno se abre solo con el anterior hecho', () => {
  it('sin preparar, solo el paso 1 está activo', () => {
    const p = pasosDelMes(estado({ preparado: null }))
    expect([p.actual, p.pasos.map((x) => [x.hecho, x.activo])]).toEqual([1, [[false, true], [false, false], [false, false], [false, false], [false, false]]])
  })
  it('con un caso por resolver, el paso 2 está activo y el 3 no, aunque el cuadre dé 0', () => {
    const casos = casosDelMes(NOV, [caso('mov:1')], [])
    const p = pasosDelMes(estado({ casos }))
    expect([p.actual, p.porResolver, p.pasos[2].activo]).toEqual([2, 1, false])
  })
  it('noviembre como hoy: los pasos 1 a 3 hechos y abre en el 4, con su cifra', () => {
    const p = pasosDelMes(estado())
    expect([p.actual, p.pasos.map((x) => x.hecho)]).toEqual([4, [true, true, true, false, false]])
    expect(p.pasos[0].resultado).toBe('Cobrado a clientes: 1.000,00 €. Listo para mandar: 10 cobros. Pendiente de decidir: 0 casos.')
  })
  it('ya mandado, un cuadre que no da 0,00 € no esconde nada: el resultado del paso 3 dice cuánto falta por explicar', () => {
    const uno = cuadreDelMes(NOV, { cobradoCent: 100001, noEsCobroCent: 0, mandadoCent: 90000, pagaFacturasCent: 10000 }, [])
    const p = pasosDelMes(estado({ cuadre: uno }))
    expect([p.actual, p.pasos[2].resultado]).toEqual([4, 'Mandados 10 cobros (900,00 €). El cuadre no da 0,00 €: 0,01 € de diferencia.'])
    expect(pasosDelMes(estado()).pasos[2].resultado).toBe('Mandados 10 cobros (900,00 €). El cuadre da 0,00 €.')
  })
  it('el visto bueno vale solo si es de lo mandado (mismo total y mismo número de facturas)', () => {
    const p4 = pasoCuatro(mandado)
    expect(pasosDelMes(estado({ vistoBueno: { serie: '1', totalCent: p4.serie1.totalCent, facturas: p4.serie1.facturas, quien: 'Persona de prueba', at: '2026-11-28T10:00:00Z' } })).actual).toBe(5)
    expect(pasosDelMes(estado({ vistoBueno: { serie: '1', totalCent: p4.serie1.totalCent + 1, facturas: p4.serie1.facturas, quien: null, at: '2026-11-28T10:00:00Z' } })).actual).toBe(4)
  })
  it('el paso 5 está hecho cuando no falta ninguna factura; si no, dice cuáles', () => {
    const p4 = pasoCuatro(mandado)
    const vb = { serie: '1', totalCent: p4.serie1.totalCent, facturas: p4.serie1.facturas, quien: null, at: '2026-11-28T10:00:00Z' }
    const faltaUna = pasoCinco(NOV, p4, [{ serie: '1', codigo: 1, cliente: 1001, totalCent: 8470, mes: NOV }, { serie: '3', codigo: 1, cliente: 1003, totalCent: 4840, mes: NOV }])
    expect(faltaUna.faltan).toEqual([{ cliente: 1002, nombre: 'Cliente dos de prueba', serie: '1', totalCent: 7260 }])
    expect(pasosDelMes(estado({ vistoBueno: vb, paso5: faltaUna })).actual).toBe(5)
    const todas = pasoCinco(NOV, p4, [{ serie: '1', codigo: 1, cliente: 1001, totalCent: 8470, mes: NOV }, { serie: '1', codigo: 2, cliente: 1002, totalCent: 7260, mes: NOV },
      { serie: '3', codigo: 1, cliente: 1003, totalCent: 4840, mes: NOV }])
    expect([todas.estan, pasosDelMes(estado({ vistoBueno: vb, paso5: todas })).actual]).toEqual([3, 6])
  })
})

describe('R21 · el cuadre y «Mandar»', () => {
  it('a 0,00 € se activa «Mandar»; con un céntimo, no', () => {
    const hecho = estado({ mandados: 0, porMandar: 5 })
    expect(pasosDelMes(hecho).puedeMandar).toBe(true)
    const uno = cuadreDelMes(NOV, { cobradoCent: 100001, noEsCobroCent: 0, mandadoCent: 90000, pagaFacturasCent: 10000 }, [])
    expect([uno.diferenciaCent, uno.cuadra]).toEqual([1, false])
    expect(pasosDelMes(estado({ mandados: 0, porMandar: 5, cuadre: uno })).puedeMandar).toBe(false)
  })
  it('lo que no es un cobro no cuenta como cobrado', () => {
    expect(cuadreDelMes(NOV, { cobradoCent: 173460, noEsCobroCent: 73460, mandadoCent: 90000, pagaFacturasCent: 10000 }, []).diferenciaCent).toBe(0)
  })
  it('lo dejado para después cuenta en «Pendientes» y el cuadre sigue a 0,00 €', () => {
    const c = cuadreDelMes(NOV, { cobradoCent: 114000, noEsCobroCent: 0, mandadoCent: 90000, pagaFacturasCent: 10000 }, [pendiente('mov:1', NOV)])
    expect([c.pendientesCent, c.diferenciaCent]).toEqual([14000, 0])
  })
  it('un pendiente de antes resuelto este mes cuenta como cobrado ahora (se factura ahora)', () => {
    const c = cuadreDelMes(DIC, { cobradoCent: 100000, noEsCobroCent: 0, mandadoCent: 104000, pagaFacturasCent: 10000, deAntesResueltosCent: 14000 }, [])
    expect(c.diferenciaCent).toBe(0)
  })
})

describe('R21 · los casos y «Dejar para después»', () => {
  it('dejar para después: sale de «por resolver», cuenta en Pendientes y deja avanzar', () => {
    const casos = casosDelMes(NOV, [caso('mov:1'), caso('ficha:a', { tipo: 'sin_unir_cegid' })], [pendiente('mov:1', NOV)])
    expect(casos.map((c) => [c.clave, c.estado])).toEqual([['ficha:a', 'por_resolver'], ['mov:1', 'pendiente']])
    const p = pasosDelMes(estado({ casos }))
    expect([p.porResolver, p.pendientes, p.actual]).toEqual([1, 1, 2])
  })
  it('«Deshacer» lo devuelve: sin el pendiente vivo, el caso vuelve a estar por resolver', () => {
    expect(casosDelMes(NOV, [caso('mov:1')], []).map((c) => c.estado)).toEqual(['por_resolver'])
  })
  it('lo decidido no vuelve a salir', () => {
    expect(casosDelMes(NOV, [caso('mov:1', { decidido: true }), caso('mov:2')], []).map((c) => c.clave)).toEqual(['mov:2'])
  })
  it('un pendiente de noviembre sale el primero en diciembre, aunque su caso ya no llegue', () => {
    const casos = casosDelMes(DIC, [caso('mov:9', { fecha: '2026-12-02' })], [pendiente('mov:1', NOV)])
    expect(casos.map((c) => [c.clave, c.estado, c.deMesAnterior])).toEqual([['mov:1', 'pendiente', true], ['mov:9', 'por_resolver', false]])
    expect(casos[0].tipoTexto).toBe('No se sabe quién paga')
    expect(tipoEnPalabras('paga_factura_antes', NOV)).toBe('Paga una factura de antes de noviembre')
  })
  it('un pendiente de noviembre no cuenta en el cuadre de diciembre (no es cobrado de diciembre)', () => {
    expect(cuadreDelMes(DIC, { cobradoCent: 0, noEsCobroCent: 0, mandadoCent: 0, pagaFacturasCent: 0 }, [pendiente('mov:1', NOV)]).pendientesCent).toBe(0)
  })
})

describe('R21 · el paso 4: lo que Cegid tiene que dar', () => {
  it('una factura por cliente y serie; lo deshecho no cuenta', () => {
    const p = pasoCuatro(mandado)
    expect([p.serie1.totalCent, p.serie1.facturas, p.serie3.totalCent, p.serie3.facturas]).toEqual([15730, 2, 4840, 1])
    expect(p.serie1.porCliente.map((c) => [c.cliente, c.totalCent, c.lineas])).toEqual([[1001, 8470, 2], [1002, 7260, 1]])
  })
})
