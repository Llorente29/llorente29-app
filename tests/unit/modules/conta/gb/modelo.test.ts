// GB · El modelo de la pestaña «Sumied» en Bitrix24 (src/publicas/bitrixPestanaModelo.ts).
// Lo que llega del servidor tiene la forma de conta_pantalla_clientes y
// conta_pantalla_ficha (en snake_case, como las devuelve la base). Pasa por
// el MISMO modelo de la ficha del G04: se comprueba que dice lo mismo.
// Clientes, NIF de ceros e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import { datosDeClientes, datosDeFicha, FRASE_DE, leerAlmohadilla, modeloPestana } from '@/publicas/bitrixPestanaModelo'
import { modeloFicha } from '@/modules/conta/gestoria/g04/modelo'

import { reciboPrevisto } from '@/publicas/bitrixPestanaModelo'
import { clientes, ficha, Q, respuesta } from '../../../../e2e/conta/gb/respuesta'

const HOY = '2026-11-09'

describe('GB · la pestaña dice lo mismo que la ficha de Sumied', () => {
  it('el recibo de diciembre línea a línea, con el mismo total que el G04', () => {
    const p = modeloPestana(respuesta(), HOY)!
    const g04 = modeloFicha(datosDeClientes(clientes), datosDeFicha(ficha), [{ id: Q, nombre: 'QBO Prueba' }], '1', null, HOY,
      [{ id: 'd1', tipo: 'totales_distintos', porque: ficha.pendientes[0].porque }])!
    expect([p.mesRecibo, p.totalRecibo]).toEqual(['diciembre de 2026', '496,10 €'])
    expect(p.totalRecibo).toBe(g04.totalRecibo)
    expect(p.recibo.map((l) => [l.texto, l.importe])).toEqual(g04.recibo.map((l) => [l.texto, l.importe]))
    expect(p.recibo[1].detalle).toBe('18 × 24,20 € · este mes: ninguna alta, ninguna baja')
  })
  it('el cliente, su situación y quién le factura', () => {
    const p = modeloPestana(respuesta(), HOY)!
    expect([p.cliente, p.situacion, p.emisora, p.desde, p.personaDeContacto]).toEqual(['Cliente Prueba, S.L.', { texto: 'Activo', tono: 'bien' }, 'QBO Prueba', 'Cobra desde enero de 2020', false])
    expect(modeloPestana(respuesta({ de_empresa: '99001' }), HOY)!.personaDeContacto).toBe(true)
  })
  it('los últimos cobros (cuatro a la vista), el devuelto y el mandato', () => {
    const p = modeloPestana(respuesta(), HOY)!
    expect(p.cobros.map((c) => [c.fecha, c.estado])).toEqual([['4 nov. 2026', 'Cobrado'], ['4 oct. 2026', 'Devuelto'], ['4 sept. 2026', 'Cobrado'], ['4 ago. 2026', 'Cobrado']])
    expect(p.hayMasCobros).toBe(1)
    expect(p.mandato).toEqual({ texto: 'firmado', tono: 'bien' })
  })
  it('sus servicios, sus trabajadores y lo pendiente de revisar', () => {
    const p = modeloPestana(respuesta(), HOY)!
    expect(p.servicios.map((s) => [s.texto, s.importe])).toEqual([['Gestoría mensual', '60,50 €'], ['Gestión laboral', '435,60 €']])
    expect(p.trabajadores.length).toBe(18)
    expect(p.trabajadores[0]).toEqual({ nombre: 'Persona Prueba 00', desde: 'Desde enero de 2024', importe: '24,20 €', lineaId: 'w0' })
    expect(p.serviciosPorTrabajador).toEqual([{ id: 'lab', nombre: 'Gestión laboral' }])
    expect(p.pendientes).toEqual([{ porque: 'GoCardless cobra 496,10 € y Sumied calcula otra cifra.' }])
  })
  it('un cliente con un recibo devuelto lo dice arriba', () => {
    const p = modeloPestana(respuesta({ cliente: '2', cliente_nombre: 'Cliente Dos' }), HOY)!
    expect(p.aviso?.tono).toBe('mal')
    expect(p.aviso?.texto).toMatch(/^Tiene un recibo devuelto sin cobrar: 108,90 €\.$/)
  })
  it('un cliente que no sale en Clientes: nada', () => {
    expect(modeloPestana(respuesta({ cliente: '99' }), HOY)).toBeNull()
    expect(modeloPestana(respuesta({ cliente: '' }), HOY)).toBeNull()
  })
})

describe('GB · lo que llega detrás del «#» y las frases', () => {
  it('el token, el portal y la ficha', () => {
    expect(leerAlmohadilla('#a=abcdef0123456789&p=b24-s3mr2y.bitrix24.es&t=empresa&id=123'))
      .toEqual({ a: 'abcdef0123456789', p: 'b24-s3mr2y.bitrix24.es', t: 'empresa', id: '123', instalar: null, que: null })
  })
  it('sin acceso, lo dice el encargo, palabra por palabra; y ningún código interno', () => {
    expect(FRASE_DE.sin_acceso).toBe('Pide acceso a Sumied a tu administrador.')
    for (const f of Object.values(FRASE_DE)) expect(f).not.toMatch(/_|rpc|jwt|token|uuid|placement/i)
  })
})

describe('GB (nº 9) · el recibo nuevo antes de guardar, con la cuenta de la ficha del G04', () => {
  it('un alta desde diciembre: +24,20 €', () => {
    expect(reciboPrevisto(respuesta(), '2026-11-09', Q, { accion: 'alta', servicio: 'lab', nombre: 'Luis Prueba Soto', desde: '2026-12-01' }))
      .toEqual({ mes: '2026-12', antes: 49610, despues: 52030, frase: 'El recibo de diciembre pasa de 496,10 € a 520,30 € (+24,20 €).' })
  })
  it('una baja en noviembre (noviembre se cobra entero): −24,20 € en diciembre', () => {
    expect(reciboPrevisto(respuesta(), '2026-11-09', Q, { accion: 'baja', linea: 'w0', mes: '2026-11-01' }).frase)
      .toBe('El recibo de diciembre pasa de 496,10 € a 471,90 € (−24,20 €).')
  })
  it('un alta desde enero no cambia el de diciembre', () => {
    expect(reciboPrevisto(respuesta(), '2026-11-09', Q, { accion: 'alta', servicio: 'lab', nombre: 'X', desde: '2027-01-01' }).frase)
      .toBe('El recibo de diciembre no cambia: 496,10 €.')
  })
})

describe('GB (nº 9, punto 2) · el nivel y el precio especial antes de guardar', () => {
  it('el servicio con sus niveles, el de ahora y si es por trabajador', async () => {
    const { conNiveles } = await import('../../../../e2e/conta/gb/respuesta')
    const p = modeloPestana(conNiveles(), '2026-11-09')!
    expect(p.servicios.map((s) => [s.texto, s.importe, s.nivelId, s.niveles.map((n) => n.nombre), s.porTrabajador]))
      .toEqual([['Gestoría mensual · Premium', '150,00 €', 'premium', ['Básica', 'Premium'], false], ['Gestión laboral', '435,60 €', null, [], true]])
  })
  it('de Premium a Básica: −60,00 €; precio especial de 135 € en Premium: −15,00 €; 22 € por trabajador: −39,60 €', async () => {
    const { conNiveles } = await import('../../../../e2e/conta/gb/respuesta')
    const r = conNiveles()
    const base = { accion: 'tarifa' as const, linea: 'l1', servicio: 'ges', porTrabajador: false, motivo: 'Cliente desde 2015', desde: '2026-12-01' }
    expect(reciboPrevisto(r, '2026-11-09', Q, { ...base, nivel: 'basica', precio: null }).frase).toBe('El recibo de diciembre pasa de 585,60 € a 525,60 € (−60,00 €).')
    expect(reciboPrevisto(r, '2026-11-09', Q, { ...base, nivel: 'premium', precio: 135 }).frase).toBe('El recibo de diciembre pasa de 585,60 € a 570,60 € (−15,00 €).')
    expect(reciboPrevisto(r, '2026-11-09', Q, { ...base, linea: 'w0', servicio: 'lab', nivel: null, precio: 22, porTrabajador: true }).frase)
      .toBe('El recibo de diciembre pasa de 585,60 € a 546,00 € (−39,60 €).')
  })
})

describe('GB (nº 9, punto 5) · su portal', () => {
  it('quién entra, lo que pide y los mensajes sin leer; si no se ha podido leer, nada', async () => {
    const { modeloPortal } = await import('@/publicas/bitrixPestanaModelo')
    expect(modeloPortal({ estado: 'ok', accesos: [{ nombre: 'Persona Prueba', permiso: 'facturas_documentos', entro: null }],
      solicitudes: [{ id: 's1', tipo: 'baja', nombre: 'Ana Prueba', fecha: '2026-11-30' }], mensajes_sin_leer: 2 })).toEqual({
      accesos: [{ nombre: 'Persona Prueba', permiso: 'Solo facturas y documentos', entro: false }],
      solicitudes: [{ id: 's1', tipo: 'baja', nombre: 'Ana Prueba', fecha: '2026-11-30', texto: 'Pide una baja: Ana Prueba, el 30/11' }],
      mensajesSinLeer: 2 })
    expect(modeloPortal({ estado: 'sin_permiso' })).toBeNull()
  })
})

describe('GB (nº 10) · las pestañas por área y «Lo pendiente con este cliente»', () => {
  const portal = { accesos: [], solicitudes: [{ id: 's1', tipo: 'alta' as const, nombre: 'Ana Prueba', fecha: '2026-11-16', texto: 'Pide un alta: Ana Prueba, desde el 16/11' }], mensajesSinLeer: 1 }
  it('solo las cuatro que existen hoy, en su orden, con su aviso', async () => {
    const { areasDe } = await import('@/publicas/bitrixPestanaModelo')
    const p = modeloPestana(respuesta(), HOY)!
    expect(areasDe(p, portal)).toEqual([
      { id: 'resumen', nombre: 'Resumen', chip: '', tono: null },
      { id: 'cobros', nombre: 'Cuotas y cobros', chip: '2', tono: 'mal' },
      { id: 'laboral', nombre: 'Laboral', chip: '18', tono: 'neutro' },
      { id: 'portal', nombre: 'Portal', chip: '2', tono: 'aviso' },
    ])
    // Sin portal leído todavía, «Portal» no lleva aviso (no se inventa).
    expect(areasDe(p, null)[3]).toEqual({ id: 'portal', nombre: 'Portal', chip: '', tono: null })
  })
  it('lo pendiente: el devuelto y lo de revisar van a «Cuotas y cobros»; lo que pide y los mensajes, a «Portal»', async () => {
    const { pendientesDe } = await import('@/publicas/bitrixPestanaModelo')
    const p = modeloPestana(respuesta(), HOY)!
    expect(pendientesDe(p, portal).map((x) => [x.area, x.etiqueta, x.texto, x.boton])).toEqual([
      ['cobros', 'Cobros', 'Recibo del 4 oct. 2026 devuelto · 496,10 €', 'Resolver'],
      ['cobros', 'Revisar', ficha.pendientes[0].porque, 'Ver'],
      ['portal', 'Portal', 'Pide un alta: Ana Prueba, desde el 16/11', 'Ver'],
      ['portal', 'Portal', '1 mensaje sin contestar', 'Contestar'],
    ])
  })
  it('cada formulario abre en su pestaña', async () => {
    const { AREA_DE } = await import('@/publicas/bitrixPestanaModelo')
    expect(AREA_DE).toEqual({ alta: 'laboral', baja: 'laboral', tarifa: 'cobros', solicitud: 'portal' })
  })
})

describe('GB (nº 17, A) · el recibo devuelto en la pestaña', () => {
  it('lo que se puede hacer con cada uno y, si no, por qué; si no llega, nada', async () => {
    const { modeloDevueltos } = await import('@/publicas/bitrixPestanaModelo')
    expect(modeloDevueltos({ puede: true, lista: [
      { recibo: 'r1', mes: '2026-10', importe_cent: 22500, estado: 'devuelto', enlace: { puede: false, porque: 'Nadie de este cliente puede pagar en su espacio: invítalo primero.' }, pasar: { puede: true, porque: null } },
      { recibo: 'r2', mes: '2026-09', importe_cent: 9900, estado: 'retrocedido', enlace: { puede: true, porque: null }, pasar: { puede: false, porque: 'Lo reclamó el cliente a su banco.' } },
    ] })).toEqual({ puede: true, lista: [
      { recibo: 'r1', texto: 'Octubre de 2026 · 225,00 € · devuelto', enlace: { puede: false, porque: 'Nadie de este cliente puede pagar en su espacio: invítalo primero.' }, pasar: { puede: true, porque: null } },
      { recibo: 'r2', texto: 'Septiembre de 2026 · 99,00 € · reclamado al banco por el cliente', enlace: { puede: true, porque: null }, pasar: { puede: false, porque: 'Lo reclamó el cliente a su banco.' } },
    ] })
    expect(modeloDevueltos(null)).toBeNull()
  })
})
