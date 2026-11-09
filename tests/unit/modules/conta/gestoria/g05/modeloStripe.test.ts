// G05 · nº 61 · «Pagos con tarjeta» (maqueta Stripe.dc.html, v23): los textos
// de Ajustes › Cobros y de la ficha, con lo que da la base. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  avisoFicha, bloqueHecho, botonTodos, detallePago, filasAsiento, mensajeCuenta, porQue, referenciaCorta, tituloLista, vale,
  type EstadoCuenta, type PagoApuntado, type PagoTarjeta,
} from '../../../../../../src/modules/conta/gestoria/g05/modeloStripe'

const sin: EstadoCuenta = { cuenta: null, nombre: null, motivo: 'sin_cuenta', banco: null }
const bien: EstadoCuenta = { cuenta: '57200003', nombre: 'Plataforma Stripe', motivo: null, banco: null }
const otro: EstadoCuenta = { cuenta: '57200001', nombre: 'Tarjeta de crédito', motivo: 'otro_nombre', banco: null }
const banco: EstadoCuenta = { cuenta: '57200000', nombre: 'Banco de Pruebas 9999', motivo: 'de_banco', banco: 'Banco de Pruebas' }
const pago: PagoTarjeta = {
  id: 'd1', recibo: 'r1', cliente: 'Talleres Prueba, S.L.', mes: '2026-11', importe: 181.5, referencia: 'ch_0000000000004F2A',
  pagadoEl: '2026-12-09T10:00:00Z', numero: null,
}

describe('G05 · nº 61 · Ajustes › Cobros: la cuenta de las tarjetas', () => {
  it('los cuatro mensajes de la maqueta: sin poner, bien (y guardada), otro nombre y de un banco', () => {
    expect(mensajeCuenta(sin)).toEqual({ tono: 'ambar', titulo: 'Falta la cuenta',
      texto: 'Mientras no la pongas, los pagos con tarjeta no se apuntan: esperan aquí y en la ficha de cada cliente. Puedes usar una nueva, por ejemplo la 57200003: la creamos con el nombre «Plataforma Stripe».' })
    expect(mensajeCuenta(bien)).toMatchObject({ tono: 'ok', titulo: '57200003 «Plataforma Stripe»' })
    expect(mensajeCuenta(bien, true).titulo).toBe('Guardada · 57200003 «Plataforma Stripe»')
    expect(mensajeCuenta(otro)).toEqual({ tono: 'mal', titulo: 'Esa cuenta ya existe y se llama «Tarjeta de crédito»',
      texto: 'No la usamos para no mezclar dinero distinto. Elige otra 572, por ejemplo la 57200003.' })
    expect(mensajeCuenta(banco)).toEqual({ tono: 'mal', titulo: 'La 57200000 es tu banco (Banco de Pruebas)',
      texto: 'El dinero de las tarjetas no entra directo en el banco: pasa antes por Stripe. Elige otra 572, por ejemplo la 57200003.' })
    expect([vale(sin), vale(bien), vale(otro), vale(banco)]).toEqual([false, true, false, false])
  })

  it('la lista: su título con cuántos y cuánto, cada pago con su mes, el día que pagó y la referencia corta, y su botón', () => {
    const dos = [pago, { ...pago, id: 'd2', recibo: 'r2', cliente: 'Librería Prueba, S.L.', mes: '2026-10', importe: 90 }]
    expect(tituloLista({ pendientes: dos, apuntadosHoy: [] })).toBe('Pagos con tarjeta que esperan · 2 · 271,50 €')
    expect(tituloLista({ pendientes: [], apuntadosHoy: dos })).toBe('Pagos con tarjeta · apuntados hoy')
    expect(detallePago(pago)).toBe('Recibo de noviembre · pagó el 9 de diciembre · ch_000…4F2A')
    expect(referenciaCorta('pi_PRUEBA1')).toBe('pi_PRUEBA1')
    expect([botonTodos(2), botonTodos(1)]).toEqual(['Apuntar los 2 pagos', 'Apuntar el pago'])
    expect(tituloLista({ pendientes: [{ ...pago, importe: 1234.5 }], apuntadosHoy: [] })).toBe('Pagos con tarjeta que esperan · 1 · 1.234,50 €')
  })
})

describe('G05 · nº 61 · La ficha: «Pagó con tarjeta y falta apuntarlo»', () => {
  it('el aviso, con el porqué de cómo está ahora la cuenta, «sin factura» hasta apuntarlo, y el botón apagado si no vale', () => {
    const a = avisoFicha(pago, sin)
    expect(a.titulo).toBe('Pagó con tarjeta y falta apuntarlo · 181,50 €')
    expect(a.texto).toBe('El 9 de diciembre pagó desde su portal el recibo de noviembre que se había devuelto. El dinero está en Stripe, pero')
    expect(a.porQue).toBe('falta decir en qué cuenta de tu contabilidad entra el dinero de las tarjetas.')
    expect(a.detalle).toBe('Recibo de noviembre · sin factura hasta que se apunte el pago · referencia ch_000…4F2A')
    expect([a.puede, a.enlace]).toEqual([false, 'Poner la cuenta en Ajustes › Cobros →'])
    expect([avisoFicha(pago, bien).puede, avisoFicha(pago, bien).enlace]).toEqual([true, 'Ver en Ajustes › Cobros'])
    expect([porQue(bien), porQue(otro), porQue(banco)]).toEqual([
      'ya está la cuenta de Stripe: puedes apuntarlo.', 'la cuenta que pusiste (57200001) ya existe con otro nombre.', 'la cuenta que pusiste (57200000) es tu banco.'])
    // Un retrocedido después de cobrarse ya tenía su factura: no se dice «sin factura».
    expect(avisoFicha({ ...pago, numero: '2026/1/141' }, bien).detalle).toBe('Recibo de noviembre · su factura 2026/1/141 ya estaba emitida · referencia ch_000…4F2A')
  })

  it('el bloque verde: la factura que sale y su correo, o por qué no salió; y sus dos asientos como en la maqueta', () => {
    const a: PagoApuntado = {
      recibo: 'r1', mes: '2026-11', importe: 181.5, factura: 'f1', numero: '2026/1/147', facturaNueva: true, quien: 'Persona Prueba',
      cuando: '2026-12-10T19:52:00Z', cuenta: '57200003', frase: 'Apuntado…',
      asientos: [
        { tipo: 'factura', id: 'e1', apuntes: [
          { codigo: '43000034', nombre: 'Talleres Prueba, S.L.', debe: 181.5, haber: 0 },
          { codigo: '70500000', nombre: 'Prestaciones de servicios', debe: 0, haber: 150 },
          { codigo: '47700021', nombre: 'IVA', debe: 0, haber: 31.5 }] },
        { tipo: 'cobro', id: 'e2', apuntes: [
          { codigo: '43000034', nombre: 'Talleres Prueba, S.L.', debe: 0, haber: 181.5 },
          { codigo: '57200003', nombre: 'Plataforma Stripe', debe: 181.5, haber: 0 }] },
      ],
    }
    const b = bloqueHecho(a, { enviadas: 1, sinEnviar: [], fallos: [] }, '2026-12-10')
    expect(b.titulo).toBe('Apuntado: el recibo de noviembre está pagado · 181,50 €')
    expect(b.texto).toBe('Lo apuntaste tú, hoy a las 20:52. Ha salido la factura 2026/1/147 y se le ha enviado por correo. Ya no está en «Te deben» ni en «Pendiente de revisar».')
    const sinCorreo = bloqueHecho(a, { enviadas: 0, sinEnviar: ['No se ha mandado la 2026/1/147: su cliente no tiene correo.'], fallos: [] }, '2026-12-10')
    expect(sinCorreo.texto).toContain('Ha salido la factura 2026/1/147. Ya no está')
    expect(sinCorreo.noSalio).toEqual(['No se ha mandado la 2026/1/147: su cliente no tiene correo.'])
    expect(bloqueHecho({ ...a, facturaNueva: false }, null, '2026-12-10').texto).toContain('Su factura 2026/1/147 ya estaba emitida.')
    expect(filasAsiento(a.asientos[0], a.numero)).toEqual({ titulo: 'Factura 2026/1/147', filas: [
      { lado: 'Debe', cuentas: [{ codigo: '43000034', nombre: 'Talleres Prueba, S.L.' }], importe: '181,50 €' },
      { lado: 'Haber', cuentas: [{ codigo: '70500000', nombre: 'Prestaciones de servicios' }, { codigo: '47700021', nombre: 'IVA' }], importe: '150,00 € · 31,50 €' }] })
    expect(filasAsiento(a.asientos[1], a.numero)).toEqual({ titulo: 'Cobro con tarjeta', filas: [
      { lado: 'Debe', cuentas: [{ codigo: '57200003', nombre: 'Plataforma Stripe' }], importe: '181,50 €' },
      { lado: 'Haber', cuentas: [{ codigo: '43000034', nombre: 'Talleres Prueba, S.L.' }], importe: '181,50 €' }] })
  })
})
