// tests/unit/modules/conta/q10/cegidBanco.test.ts
//
// Q10 · respuesta 7 (27/11) · Lo cobrado por el banco y con tarjeta, a Cegid, con las reglas de Julio. Los casos son los
// de noviembre de QBO (regla 31: un recibo de un mes ya facturado, uno de un mes sin factura, los recargos de 1,60 €,
// 5,20 € y 6,00 €, transferencias sin recibo, la tarjeta), con clientes y recibos inventados (T11).

import { describe, expect, it } from 'vitest'
import { claveTarjeta, cuadreVias, esCobroDeCliente, nombreMes, planCobro, proponerFactura, type CobroBanco } from '../../../../../supabase/functions/_shared/cegidBanco'

const cobro = (o: Partial<CobroBanco> & { clave: string }): CobroBanco => ({
  tipo: 'banco', movementId: o.clave.replace('mov:', ''), fecha: '2026-11-12', importe: 84.7, via: 'transferencia', estado: 'casado', texto: 'TRANSFER INMEDIATA', codigo: 900001,
  recibos: [], decision: null, ...o,
})
const recibo = (gcId: string, importe: number, fecha: string, texto = 'GESTORIA MENSUAL') => ({ gcId, importe, fecha, texto, elegido: null })
const facturas = (x: Record<number, string[]>) => (c: number, m: string) => (x[c] ?? []).includes(m)
const nada = facturas({})

describe('Q10 · respuesta 7 · los recibos de GoCardless pagados por el banco', () => {
  it('regla 1: el recibo de un mes ya facturado no sale; es el cobro de una factura que ya existe', () => {
    const p = planCobro('2026-11', cobro({ clave: 'mov:A', recibos: [recibo('PM0A', 84.7, '2026-05-04')] }), facturas({ 900001: ['2026-05'] }), new Set())
    expect([p.estado, p.pagaFacturaCent, p.lineas.length]).toEqual(['paga_factura', 8470, 0])
    expect(p.porque).toBe('Los recibos de mayo 2026 ya están facturados en Cegid: no salen (regla 1). Paga una factura que ya existe.')
  })
  it('regla 2: el de un mes sin factura va en noviembre, con el mes en la descripción', () => {
    const p = planCobro('2026-11', cobro({ clave: 'mov:B', recibos: [recibo('PM0B', 84.7, '2026-08-04')] }), nada, new Set())
    expect(p.estado).toBe('listo')
    expect(p.lineas.map((l) => [l.clave, l.concepto.codigo, l.texto, l.baseCent, l.totalCent])).toEqual([['PM0B', '00001', 'GESTORIA MENSUAL · Cuota agosto 2026', 7000, 8470]])
  })
  it('regla 3: el recargo es lo que pagó de verdad, como 0018 con el IVA incluido (2,00, 1,60, 6,00 y 5,20 €)', () => {
    const linea = (importe: number, recibos: number[]) => planCobro('2026-11', cobro({ clave: 'mov:R', importe, recibos: recibos.map((r, i) => recibo(`PM${i}`, r, '2026-11-04')) }), nada, new Set())
      .lineas.filter((l) => l.parte === 'recargo').map((l) => [l.clave, l.concepto.codigo, l.baseCent, l.totalCent])
    expect(linea(62.5, [60.5])).toEqual([['mov:R:recargo', '0018', 165, 200]])
    expect(linea(74.2, [72.6])).toEqual([['mov:R:recargo', '0018', 132, 160]])
    expect(linea(66.5, [60.5])).toEqual([['mov:R:recargo', '0018', 496, 600]])
    expect(linea(537.6, [145.2, 96.8, 193.6, 96.8])).toEqual([['mov:R:recargo', '0018', 430, 520]])
    expect(linea(84.7, [84.7])).toEqual([])
  })
  it('con todos sus meses facturados, tampoco sale el recargo; con alguno sin factura, sí, y lo facturado cuenta como «paga factura»', () => {
    const c = cobro({ clave: 'mov:C', importe: 537.6, recibos: [recibo('PM1', 145.2, '2026-10-29'), recibo('PM2', 96.8, '2026-10-05'), recibo('PM3', 193.6, '2026-10-05'), recibo('PM4', 96.8, '2026-11-04')] })
    const todo = planCobro('2026-11', c, facturas({ 900001: ['2026-10', '2026-11'] }), new Set())
    expect([todo.estado, todo.pagaFacturaCent]).toEqual(['paga_factura', 53760])
    const parte = planCobro('2026-11', c, facturas({ 900001: ['2026-10'] }), new Set())
    expect([parte.estado, parte.pagaFacturaCent, parte.lineas.map((l) => l.totalCent)]).toEqual(['listo', 43560, [9680, 520]])
  })
  it('para, con su porqué: sin código de Cegid, recibos que suman más que lo cobrado, cuota fuera de la tabla', () => {
    expect(planCobro('2026-11', cobro({ clave: 'mov:D', codigo: null, recibos: [recibo('PM5', 84.7, '2026-11-04')] }), nada, new Set()).porque).toBe('Su ficha no tiene código de Cegid.')
    expect(planCobro('2026-11', cobro({ clave: 'mov:E', importe: 50, recibos: [recibo('PM6', 84.7, '2026-11-04')] }), nada, new Set()).porque).toBe('Cobró 50,00 € y sus recibos suman más: míralo.')
    expect(planCobro('2026-11', cobro({ clave: 'mov:F', recibos: [recibo('PM7', 84.7, '2026-11-04', 'ALGO SIN TABLA')] }), nada, new Set()).estado).toBe('parar')
  })
  it('lo ya mandado no vuelve a salir', () => {
    const c = cobro({ clave: 'mov:G', importe: 62.5, recibos: [recibo('PM8', 60.5, '2026-11-04')] })
    expect(planCobro('2026-11', c, nada, new Set(['PM8', 'mov:G:recargo'])).estado).toBe('ya_mandado')
    expect(planCobro('2026-11', c, nada, new Set(['PM8'])).lineas.map((l) => l.clave)).toEqual(['mov:G:recargo'])
  })
})

describe('Q10 · respuesta 7 · lo que decide Julio', () => {
  it('sin recibo, para Julio; con su decisión: facturar con un concepto, pagar una factura que ya existe o no ser un cobro', () => {
    const c = cobro({ clave: 'mov:H', importe: 242, codigo: null })
    expect(planCobro('2026-11', c, nada, new Set()).estado).toBe('para_julio')
    expect(planCobro('2026-11', cobro({ clave: 'mov:P', estado: 'por_confirmar', recibos: [recibo('PM20', 84.7, '2026-11-04')] }), nada, new Set()).porque).toBe('Su cliente está por confirmar: decide qué es.')
    const d = (decision: 'paga_factura' | 'facturar' | 'no_es_cobro', concepto: string | null = null, cliente: number | null = null) =>
      planCobro('2026-11', { ...c, decision: { decision, concepto, cliente, texto: null, quien: 'Julio', at: '2026-11-27T09:00:00Z' } }, nada, new Set())
    const f = d('facturar', '0039', 900002)
    expect([f.estado, f.cliente, f.lineas.map((l) => [l.clave, l.concepto.codigo, l.texto, l.baseCent, l.totalCent])]).toEqual(['listo', 900002, [['mov:H', '0039', 'Otros trámites y gestiones', 20000, 24200]]])
    expect([d('paga_factura').estado, d('paga_factura').pagaFacturaCent, d('paga_factura').porque]).toEqual(['paga_factura', 24200, 'Paga una factura que ya existe (Julio, 27/11).'])
    expect([d('no_es_cobro').estado, d('no_es_cobro').noCobroCent]).toEqual(['no_es_cobro', 24200])
    expect(planCobro('2026-11', { ...c, importe: 0.03, decision: { decision: 'facturar', concepto: '0039', cliente: 900002, texto: null, quien: null, at: null } }, nada, new Set()).porque)
      .toBe('No se puede facturar: ninguna base al 21 % da 0,03 €.')
  })
})

describe('Q10 · respuesta 7 · la tarjeta (la ata K)', () => {
  const t = (o: Partial<CobroBanco>) => cobro({ clave: claveTarjeta('2026-11-05T08:37:18+00:00', 1000), tipo: 'tarjeta', via: 'tarjeta', importe: 1000, etapa: 'enlace_pago', falta: null, ...o })
  it('la clave de un pago: su momento en UTC y su importe', () => {
    expect(claveTarjeta('2026-11-05 09:37:18+01', 1000)).toBe('tpv:2026-11-05T08:37:18Z|1000.00')
  })
  it('ya facturado en el CRM: paga una factura que ya existe; casado y con código: Julio elige el concepto; lo demás espera a K', () => {
    expect(planCobro('2026-11', t({ etapa: 'factura_final' }), nada, new Set()).estado).toBe('paga_factura')
    expect(planCobro('2026-11', t({}), nada, new Set()).estado).toBe('para_julio')
    expect(planCobro('2026-11', t({ falta: 'falta su NIE' }), nada, new Set()).porque).toBe('Falta algo para facturarlo: falta su NIE.')
    expect(planCobro('2026-11', t({ estado: 'por_confirmar' }), nada, new Set()).estado).toBe('espera')
    expect(planCobro('2026-11', t({ codigo: null }), nada, new Set()).estado).toBe('espera')
  })
})

describe('Q10 · respuesta 7 · el cuadre por vía y cliente a cliente', () => {
  it('cobrado = mandado + paga facturas que ya existen + no es cobro: 0 € de diferencia', () => {
    const gc = [{ gcId: 'PM10', estado: 'paid_out', fecha: '2026-11-04', importe: 84.7, concepto: 'GESTORIA MENSUAL', partyId: 'p', nombre: 'x', codigoCegid: 900003 }]
    const planes = [
      planCobro('2026-11', cobro({ clave: 'mov:I', importe: 62.5, recibos: [recibo('PM11', 60.5, '2026-11-04')] }), nada, new Set()),
      planCobro('2026-11', cobro({ clave: 'mov:J', recibos: [recibo('PM12', 84.7, '2026-05-04')] }), facturas({ 900001: ['2026-05'] }), new Set()),
      planCobro('2026-11', cobro({ clave: 'mov:K', importe: 34.99, codigo: null, decision: { decision: 'no_es_cobro', concepto: null, cliente: null, texto: null, quien: null, at: null } }), nada, new Set()),
    ]
    const mandadas = [{ clave: 'PM10', cliente: 900003, totalCent: 8470 }, { clave: 'PM11', cliente: 900001, totalCent: 6050 }, { clave: 'mov:I:recargo', cliente: 900001, totalCent: 200 }]
    const c = cuadreVias('2026-11', gc, planes, mandadas)
    expect(c.vias.map((f) => [f.via, f.cobradoCent, f.mandadoCent, f.pagaFacturaCent, f.noCobroCent, f.diferenciaCent])).toEqual([
      ['GoCardless', 8470, 8470, 0, 0, 0], ['Banco', 18219, 6250, 8470, 3499, 0]])
    expect(c.cuadra).toBe(true)
    expect(c.frase).toBe('Cobrado en noviembre 2026: 266,89 €. Mandado a Cegid 147,20 €, paga facturas que ya existen 84,70 €, no es cobro 34,99 €. Cuadra: 0,00 € de diferencia, cliente a cliente.')
  })
  it('lo que falta por mandar o por decidir es diferencia, cliente a cliente o sin cliente, y no cuadra', () => {
    const planes = [planCobro('2026-11', cobro({ clave: 'mov:L', importe: 242, codigo: null }), nada, new Set()), planCobro('2026-11', cobro({ clave: 'mov:M', recibos: [recibo('PM13', 84.7, '2026-11-04')] }), nada, new Set())]
    const c = cuadreVias('2026-11', [], planes, [])
    expect([c.cuadra, c.total.diferenciaCent, c.clientes.map((k) => [k.cliente, k.diferenciaCent]), c.sinCliente.map((x) => [x.clave, x.cent])])
      .toEqual([false, 32670, [[900001, 8470]], [['mov:L', 24200]]])
    expect(c.frase).toBe('Cobrado en noviembre 2026: 326,70 €. Mandado a Cegid 0,00 €, paga facturas que ya existen 0,00 €, no es cobro 0,00 €. Diferencia: 326,70 € (1 cliente con diferencia). Hasta que dé 0,00 €, no se genera nada en Cegid.')
  })
  it('el nombre del mes', () => { expect(nombreMes('2026-08')).toBe('agosto 2026') })
})

describe('Q10 · respuesta 7 · ¿paga una factura que ya existe? (el cruce con las facturas de Cegid)', () => {
  const fra = (codigo: number, cliente: number, total: number, nombre: string) => ({ ejercicio: 2026, serie: '1', codigo, cliente, total, nombre })
  const facturas = [fra(2745, 900010, 1089, 'EMPRESA DE PRUEBA ASESORIA S.L.'), fra(1100, 900011, 211.38, 'LIMPIEZAS DE PRUEBA SL'), fra(1200, 900012, 338.8, 'UNO SL'),
    fra(1201, 900013, 338.8, 'DOS SL'), fra(1300, 900014, 730, 'TRES SL'), fra(1400, 900015, 60, 'CUATRO SL')]
  const sin = (o: Partial<CobroBanco>) => cobro({ clave: 'mov:X', estado: 'sin_cliente', codigo: null, ...o })
  it('por el número de factura que trae el concepto, aunque el banco lo corte', () => {
    expect(proponerFactura(sin({ importe: 1089, via: 'traspaso', texto: 'TRASPASO, , PGO. FRA-2026/1/274 EMPRESA DE PRUEBA, S.L.' }), facturas)?.frase)
      .toBe('Propuesta: paga la factura 1/2745 del cliente 900010, de 1.089,00 € (por su número en el concepto).')
  })
  it('por importe y por el nombre del que paga', () => {
    expect(proponerFactura(sin({ importe: 211.38, texto: 'TRANSFER INMEDIATA, Limpiezas de Prueba S.L., Limpiezas de Prueba S.L.' }), facturas)?.factura).toBe('1/1100')
  })
  it('por importe y por el cliente de su ficha', () => {
    expect(proponerFactura(sin({ importe: 338.8, codigo: 900013, texto: 'TRANSFER INMEDIATA, PERSONA DE PRUEBA' }), facturas)?.por).toBe('cliente')
  })
  it('solo por importe, si el concepto no dice quién paga; con dos facturas del mismo importe, ninguna', () => {
    expect(proponerFactura(sin({ importe: 730, via: 'traspaso', texto: 'TRASPASO, , pago de septiembre' }), facturas)?.frase)
      .toBe('Propuesta: paga la factura 1/1300 del cliente 900014, de 730,00 € (solo por importe: el concepto no dice quién paga).')
    expect(proponerFactura(sin({ importe: 338.8, via: 'traspaso', texto: 'TRASPASO, , PAGO MES DE Octubre' }), facturas)).toBeNull()
  })
  it('con un nombre que no es el de la factura, no se propone; ni a un cobro que paga recibos', () => {
    expect(proponerFactura(sin({ importe: 60, texto: 'TRANSFER INMEDIATA, OTRA PERSONA DISTINTA' }), facturas)).toBeNull()
    expect(proponerFactura(cobro({ clave: 'mov:Y', importe: 730, recibos: [recibo('PM30', 730, '2026-11-04')] }), facturas)).toBeNull()
  })
  it('lo decidido con su factura lo dice', () => {
    const p = planCobro('2026-11', sin({ importe: 1089, decision: { decision: 'paga_factura', concepto: null, cliente: null, texto: null, quien: 'Julio', at: '2026-11-27T09:00:00Z', factura: '1/2745' } }), nada, new Set())
    expect(p.porque).toBe('Paga la factura 1/2745, que ya existe (Julio, 27/11).')
  })
})

describe('Q10 · respuesta 8 · la lista de Julio: solo facturación', () => {
  it('la vía «otra» (devoluciones y abonos de tarjeta) no es cobro de un cliente y no cuenta en el cuadre', () => {
    expect(['otra', 'transferencia', 'traspaso', 'tarjeta'].map(esCobroDeCliente)).toEqual([false, true, true, true])
    const p = planCobro('2026-11', cobro({ clave: 'mov:O', via: 'otra', estado: 'sin_cliente', importe: 28.99, codigo: null }), nada, new Set())
    expect(cuadreVias('2026-11', [], [p], []).vias).toEqual([])
  })
  it('las decisiones de tarjeta de Julio: 0022 a 48,40 € (base 40,00) y 0039 a 1.000,00 € (base 826,45) y a 121,00 € (base 100,00)', () => {
    const t = (importe: number, concepto: string, cliente: number) => planCobro('2026-11', cobro({ clave: claveTarjeta('2026-11-19T12:41:55Z', importe), tipo: 'tarjeta', via: 'tarjeta',
      importe, etapa: 'enlace_pago', falta: null, codigo: cliente, decision: { decision: 'facturar', concepto, cliente, texto: null, quien: 'Julio (27/11)', at: null } }), nada, new Set())
    expect([t(48.4, '0022', 900020), t(1000, '0039', 900021), t(121, '0039', 900022)].map((p) => [p.estado, p.lineas.map((l) => [l.concepto.codigo, l.texto, l.baseCent, l.totalCent])])).toEqual([
      ['listo', [['0022', 'Consulta y alta de autónomo', 4000, 4840]]], ['listo', [['0039', 'Otros trámites y gestiones', 82645, 100000]]], ['listo', [['0039', 'Otros trámites y gestiones', 10000, 12100]]]])
  })
})

describe('Q10 · respuesta 9 · las respuestas de QBO', () => {
  it('«paga la 4/12» con el cliente que dice QBO, no el de la ficha; el cuadre lo cuenta en ese cliente', () => {
    const p = planCobro('2026-11', cobro({ clave: 'mov:Q', estado: 'por_confirmar', importe: 244.38, codigo: 900030,
      decision: { decision: 'paga_factura', concepto: null, cliente: 900031, texto: null, quien: 'QBO vía Julio (27/11)', at: '2026-11-27T10:00:00Z', factura: '4/12' } }), nada, new Set())
    expect([p.estado, p.cliente, p.porque]).toEqual(['paga_factura', 900031, 'Paga la factura 4/12, que ya existe (QBO vía Julio (27/11), 27/11).'])
    expect(cuadreVias('2026-11', [], [p], []).cuadra).toBe(true)
  })
  it('0035 a 60,00 € (base 49,59) y 0017 a 18,22 € (base 15,06)', () => {
    const f = (importe: number, concepto: string) => planCobro('2026-11', cobro({ clave: 'mov:R', estado: 'sin_cliente', importe, codigo: null,
      decision: { decision: 'facturar', concepto, cliente: 900032, texto: null, quien: null, at: null } }), nada, new Set()).lineas.map((l) => [l.concepto.codigo, l.baseCent, l.totalCent])
    expect([f(60, '0035'), f(18.22, '0017')]).toEqual([[['0035', 4959, 6000]], [['0017', 1506, 1822]]])
  })
})
