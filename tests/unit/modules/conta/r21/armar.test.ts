// R21 · De lo que calcula «Facturas del mes» a los casos del paso 2 (src/modules/conta/gestoria/r21/armar.ts). Datos
// inventados (T11).
import { describe, expect, it } from 'vitest'
import { armarCasos, mesesDelSelector, type EntradaArmar } from '../../../../../src/modules/conta/gestoria/r21/armar'
import type { CobroBanco, PlanCobro } from '../../../../../supabase/functions/_shared/cegidBanco'
import type { PlanMandar } from '../../../../../supabase/functions/_shared/cegidMandar'

const NOV = '2026-11'
const vacio: PlanMandar = { mes: NOV, vueltas: { '1': { serie: '1', listos: [], cent: 0, lineas: 0, frase: '' }, '3': { serie: '3', listos: [], cent: 0, lineas: 0, frase: '' } }, noSalen: [], yaMandados: 0 }
const cobro = (clave: string, x: Partial<CobroBanco> = {}): CobroBanco => ({ clave, tipo: 'banco', movementId: clave.slice(4), fecha: `${NOV}-10`, importe: 60, via: 'transferencia',
  estado: 'casado', texto: 'TRANSFERENCIA DE PRUEBA', codigo: null, recibos: [], decision: null, ...x })
const plan = (c: CobroBanco, estado: PlanCobro['estado'] = 'para_julio'): PlanCobro => ({ cobro: c, cliente: c.codigo, lineas: [], pagaFacturaCent: 0, noCobroCent: 0, estado, porque: 'No paga ningún recibo: decide qué es.' })
const entrada = (x: Partial<EntradaArmar> = {}): EntradaArmar => ({ mes: NOV, plan: vacio, cobrosGc: [], sinCodigo: [], sinNif: [], clientesCegid: [], planesBanco: [], facturasCegid: [], ...x })

describe('R21 · los casos del paso 2, con los botones de hoy', () => {
  it('paga una factura de antes: propone la factura del sistema de antes y «Sí» la apunta con decidirBancoCegid', () => {
    const c = cobro('mov:a1', { texto: 'PAGO FACTURA 1/2524', codigo: 1001 })
    const [x] = armarCasos(entrada({ planesBanco: [plan(c)], facturasCegid: [{ ejercicio: 2026, serie: '1', codigo: 2524, cliente: 1001, total: 60, nombre: 'Cliente de prueba', fecha: 20261007 } as never] }))
    expect([x.tipo, x.propuesta?.startsWith('es el pago de su factura 1/2524 del 07/10'), x.acciones[0].efecto]).toEqual(['paga_factura_antes', true,
      { que: 'paga_factura', clave: 'mov:a1', cliente: 1001, factura: '1/2524' }])
  })
  it('cliente que paga sin recibo: propone el concepto y «Sí, facturar» lo factura con su cliente', () => {
    const [x] = armarCasos(entrada({ planesBanco: [plan(cobro('mov:b1', { codigo: 1002, texto: 'GESTION LABORAL DE PRUEBA' }))] }))
    expect([x.tipo, x.acciones[0].efecto]).toEqual(['paga_sin_recibo', { que: 'facturar', clave: 'mov:b1', cliente: 1002, concepto: '0008' }])
  })
  it('no se sabe quién paga: sin propuesta, con lo que falta, y «Preguntar a QBO» lo deja para después', () => {
    const [x] = armarCasos(entrada({ planesBanco: [plan(cobro('mov:c1', { estado: 'sin_cliente', texto: '2DO PAGO DE PRUEBA' }))] }))
    expect([x.tipo, x.propuesta, !!x.falta, x.acciones.find((a) => a.principal)?.efecto.que]).toEqual(['no_se_sabe_quien', null, true, 'dejar'])
  })
  it('cliente sin unir a Cegid: propone el cliente de Cegid por su nombre y «Sí» lo ata', () => {
    const [x] = armarCasos(entrada({ cobrosGc: [{ gcId: 'PM1', partyId: 'p1', nombre: null, importe: 12.1, fecha: `${NOV}-04`, estado: 'paid_out' }],
      sinCodigo: [{ partyId: 'p1', nombre: 'Persona Inventada', nif: null, porque: 'Sin código.', propuestas: [{ codigo: 1001, nombre: 'Inventada, Persona', por: 'nombre', comunes: 2 }] }] }))
    expect([x.tipo, x.importeCent, x.acciones[0].efecto]).toEqual(['sin_unir_cegid', 1210, { que: 'atar', partyId: 'p1', codigo: 1001, como: 'nombre' }])
  })
  it('a la ficha de Cegid le falta el NIF: sale solo si se le manda algo, y nunca con un NIF válido', () => {
    const listos = { ...vacio, vueltas: { ...vacio.vueltas, '1': { ...vacio.vueltas['1'], listos: [{ codigo: 1269, nombre: 'Cliente', lineas: [], totalCent: 4840 }, { codigo: 1270, nombre: 'Otro', lineas: [], totalCent: 100 }] } } }
    const xs = armarCasos(entrada({ plan: listos, clientesCegid: [{ codigo: 1269, nombre: 'Cliente de prueba', nif: null }, { codigo: 1270, nombre: 'Con NIF', nif: 'B00000000' }, { codigo: 9, nombre: 'Sin cobro', nif: null }] }))
    expect(xs.map((x) => [x.tipo, x.clave, x.importeCent])).toEqual([['falta_dato_cegid', 'cegid:1269', 4840]])
  })
  it('cliente sin datos: una tarjeta por ficha, con lo cobrado del mes sumado', () => {
    const xs = armarCasos(entrada({ sinNif: [{ gcId: 'PM1', partyId: 'p6', nombre: 'Sin NIF de Prueba', importe: 36.3, fecha: `${NOV}-05` }, { gcId: 'PM2', partyId: 'p6', nombre: 'Sin NIF de Prueba', importe: 10, fecha: `${NOV}-06` }] }))
    expect(xs.map((x) => [x.tipo, x.importeCent])).toEqual([['sin_datos', 4630]])
  })
  it('lo decidido y lo de otro mes no sale', () => {
    const decidido = cobro('mov:d1', { decision: { decision: 'no_es_cobro', concepto: null, cliente: null, texto: null, quien: null, at: null } as never })
    expect(armarCasos(entrada({ planesBanco: [plan(decidido), plan(cobro('mov:d2', { fecha: '2026-10-30' })), plan(cobro('mov:d3'), 'listo')] }))).toEqual([])
  })
})

describe('R21 · el selector de meses', () => {
  it('noviembre y diciembre de 2026, y después hasta el mes siguiente al de hoy', () => {
    expect(mesesDelSelector('2026-11-27').map((m) => m.texto)).toEqual(['Noviembre 2026', 'Diciembre 2026'])
    expect(mesesDelSelector('2027-01-10').map((m) => m.valor)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})
