// tests/unit/modules/conta/bancosVistaB01.test.ts
//
// B01 · tarea 5: lo que pintan las pantallas de Bancos. Los porqués y los
// títulos son los LITERALES que el motor escribió en staging en el run 190
// (docs/conta/capturas/b01/motor.md), no inventados (regla 31).

import { describe, expect, it } from 'vitest'
import {
  TEXTO_BOTON, cierreBanco, estadoBanco, filaDe, ibanLegible, limitesMes, mesesElegibles, nombreConCodigo, resumenFilas, tarjetaPorAclarar, ultimosIban,
  type MovimientoBanco,
} from '@/modules/conta/lib/bancosVista'
import { buscarEnBancos, pestanaDe, resolverVista } from '@/modules/conta/bancos/navegacion'

const base: MovimientoBanco = {
  id: 'm', cuentaId: 'b1', fecha: '2026-10-08', importeCent: -1250, conceptoBanco: 'COMISION MANTENIMIENTO', conceptoLimpio: 'Comision mantenimiento',
  estado: 'pendiente', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null,
}
const mov = (x: Partial<MovimientoBanco>): MovimientoBanco => ({ ...base, ...x })

describe('filaDe: una fila por movimiento, como N17', () => {
  it('casado solo: verde, «Casado solo: …» sin repetirlo, Ver y Deshacer', () => {
    const f = filaDe(mov({
      estado: 'casado', importeCent: 341218,
      casado: { id: 'c', tipo: 'liquidacion', porQuien: 'folvy', asientoId: 'e', asientoConcepto: 'Cobro de Glovo · liquidación 01/10–07/10',
        porque: 'Casado solo: cuadra con su liquidación 01/10–07/10 (neto 3.412,18 €).' },
    }))
    expect(f.tono).toBe('verde')
    expect(f.titulo).toBe('Cobro de Glovo · liquidación 01/10–07/10')
    expect(f.porque).toBe('Casado solo: cuadra con su liquidación 01/10–07/10 (neto 3.412,18 €)')
    expect(f.botones).toEqual(['ver', 'deshacer'])
  })

  it('casado solo sin «Casado solo» en el porqué (traspaso): se le pone', () => {
    const f = filaDe(mov({ estado: 'casado', casado: { id: 'c', tipo: 'traspaso', porQuien: 'folvy', asientoId: 'e', asientoConcepto: 'Traspaso entre tus cuentas',
      porque: 'Sale de Banco B01 · Norte y entra en Banco B01 · Sur el mismo día, mismo importe.' } }))
    expect(f.porque).toBe('Casado solo: sale de Banco B01 · Norte y entra en Banco B01 · Sur el mismo día, mismo importe')
  })

  it('para confirmar: ámbar, el título del motor, Sí y Otra cosa', () => {
    const f = filaDe(mov({ estado: 'propuesto', confianza: 'probable', importeCent: -25000,
      porque: 'Paga 250,00 € de los 600,00 € que quedan; seguirán pendientes 350,00 €.',
      propuesta: { que: 'Pago en parte de la factura B01-0478 de Suministros B01 del Norte', destino: { tipo: 'factura_recibida' } } }))
    expect([f.tono, f.estado, f.titulo]).toEqual(['ambar', 'Para confirmar', 'Pago en parte de la factura B01-0478 de Suministros B01 del Norte'])
    expect(f.botones.map((b) => TEXTO_BOTON[b])).toEqual(['Sí', 'Otra cosa'])
  })

  it('pago con tarjeta que pide ticket: «¿ticket?», Subir foto y Sí, sin ticket; con el ticket ya subido, Sí', () => {
    const p = { estado: 'propuesto' as const, porque: 'Tarjeta de Ana (···4821): pídele el ticket.', propuesta: { que: 'Compra de comida y bebida', pideTicket: true, destino: { tipo: 'cuenta' } } }
    const sin = filaDe(mov(p))
    expect(sin.titulo).toBe('Compra de comida y bebida · ¿ticket?')
    expect(sin.botones.map((b) => TEXTO_BOTON[b])).toEqual(['Subir foto', 'Sí, sin ticket'])
    expect(filaDe(mov({ ...p, ticket: 'a/m/x.jpg' })).botones).toEqual(['si', 'otra-cosa'])
  })

  it('por aclarar: gris; un pago ofrece Buscar factura, un cobro no', () => {
    const pago = filaDe(mov({ estado: 'por_aclarar', importeCent: -4530, porque: 'No hay factura de 45,30 €: ¿la subes o es un pago sin factura?', propuesta: { que: 'No sé qué es' } }))
    expect([pago.tono, pago.titulo]).toEqual(['gris', 'No sé qué es'])
    expect(pago.botones.map((b) => TEXTO_BOTON[b])).toEqual(['Buscar factura', 'Decirlo yo'])
    const cobro = filaDe(mov({ estado: 'por_aclarar', importeCent: 127817, porque: 'Sin factura ni liquidación de ese importe. ¿De quién es?', propuesta: { que: 'No sé qué es' } }))
    expect(cobro.botones).toEqual(['decirlo-yo'])
  })

  it('tarjeta desconocida (respuesta 3): «Dar de alta la tarjeta» con sus 4 dígitos', () => {
    const porque = 'Por aclarar: tarjeta acabada en 1234, ¿de quién es? Dala de alta en Cuentas y extractos y sabré a quién pedirle el ticket.'
    const f = filaDe(mov({ estado: 'por_aclarar', importeCent: -6000, porque }))
    expect(f.botones.map((b) => TEXTO_BOTON[b])).toEqual(['Dar de alta la tarjeta', 'Decirlo yo'])
    expect(tarjetaPorAclarar(porque)).toBe('1234')
    expect(tarjetaPorAclarar('No hay factura de 60,00 €')).toBeNull()
  })

  it('B02 · la tarjeta que anota el motor (tarjetaDesconocida): el botón y «tarjeta ···3085 sin dar de alta»', () => {
    const propuesta = { que: 'Pago con tarjeta · ¿ticket?', pideTicket: true, tarjetaDesconocida: '3085' }
    const f = filaDe(mov({ estado: 'por_aclarar', importeCent: -10000, porque: 'Pago con tarjeta que aún no conozco: sube la foto del ticket y lo aprendo.', propuesta }))
    expect(f.botones.map((b) => TEXTO_BOTON[b])).toEqual(['Dar de alta la tarjeta', 'Decirlo yo'])
    expect(f.porque).toBe('Pago con tarjeta que aún no conozco: sube la foto del ticket y lo aprendo · tarjeta ···3085 sin dar de alta')
    expect(tarjetaPorAclarar(null, propuesta)).toBe('3085')
  })

  it('tarjeta dada de alta sin historial (run del 13/10): Subir foto y Decirlo yo', () => {
    const f = filaDe(mov({ estado: 'por_aclarar', importeCent: -8640, porque: 'Pago con la tarjeta de Ana Prueba (···0937) en MERCADO CENTRAL que aún no conozco: pídele el ticket a Ana Prueba y lo aprendo.',
      propuesta: { que: 'Pago con tarjeta · ¿ticket?', pideTicket: true, destino: null } }))
    expect(f.botones.map((b) => TEXTO_BOTON[b])).toEqual(['Subir foto', 'Decirlo yo'])
  })

  it('pendiente sin mirar: cuenta como por aclarar y lo dice (regla 7: no desaparece)', () => {
    const f = filaDe(mov({ estado: 'pendiente' }))
    expect([f.grupo, f.titulo]).toEqual(['aclarar', 'Aún no lo he mirado'])
  })
})

describe('resumenFilas: las cifras y la frase con la misma vara que la tabla', () => {
  it('cuenta lo que la tabla enseña', () => {
    const filas = [
      filaDe(mov({ id: '1', estado: 'casado', casado: { id: 'c', tipo: 'cuenta', porQuien: 'folvy', asientoId: 'e', asientoConcepto: 'x', porque: 'y' } })),
      filaDe(mov({ id: '2', estado: 'propuesto', porque: 'p', propuesta: { que: 'q' } })),
      filaDe(mov({ id: '3', estado: 'por_aclarar', porque: 'p' })),
      filaDe(mov({ id: '4', estado: 'pendiente' })),
    ]
    const r = resumenFilas(filas, '2026-10', 1)
    expect(r).toMatchObject({ total: 4, casadoSolo: 1, paraConfirmar: 1, porAclarar: 2 })
    expect(r.frase).toBe('He casado yo 1 de 4 movimientos de octubre. Te quedan 1 por confirmar y 2 por aclarar.')
    expect(resumenFilas([], '2026-10', 0).frase).toBe('No hay movimientos de octubre: sube el extracto y los miro.')
  })
})

describe('meses, IBAN y nombres', () => {
  it('meses del primero con movimientos a hoy, el más reciente primero', () => {
    expect(mesesElegibles('2026-08-14', '2026-10-13')).toEqual(['2026-10', '2026-09', '2026-08'])
    expect(mesesElegibles(null, '2026-10-13')).toEqual(['2026-10'])
    expect(limitesMes('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
  })
  it('IBAN: los 4 últimos para la barra, y en grupos de 4 para leerlo', () => {
    expect(ultimosIban('ES0201829101320000000011')).toBe('0011')
    expect(ibanLegible('ES0201829101320000000011')).toBe('ES02 0182 9101 3200 0000 0011')
    expect(ultimosIban(null)).toBeNull()
  })
  it('las cuentas siempre nombre · código, sin el punto final', () => {
    expect(nombreConCodigo('Bancos · Banco B01 Norte.', '57200911')).toBe('Bancos · Banco B01 Norte · 57200911')
  })
  it('estado del banco en la barra', () => {
    expect(estadoBanco(0, true)).toEqual({ texto: 'al día', tono: 'verde' })
    expect(estadoBanco(3, true)).toEqual({ texto: '3 dudas', tono: 'ambar' })
    expect(estadoBanco(0, false).texto).toBe('sin extracto')
  })
})

describe('cierreBanco: cuadra al céntimo o explica la diferencia', () => {
  it('igual, diferencia explicada por lo sin casar, y diferencia sin explicar', () => {
    expect(cierreBanco(4_821_540, 4_821_540, 0).cuadra).toBe(true)
    const a = cierreBanco(1_000_000, 1_012_500, -12_500)
    expect([a.cuadra, a.diferenciaCent]).toEqual([false, -12_500])
    expect(a.frase).toMatch(/exactamente los movimientos que aún no están casados/)
    expect(cierreBanco(1_000_000, 990_000, 0).frase).toMatch(/no se explica/)
    expect(cierreBanco(null, 0, 0).cuadra).toBeNull()
  })
})

describe('navegación de Bancos', () => {
  it('cada ruta a su vista; lo desconocido a Movimientos', () => {
    expect(resolverVista(undefined)).toBe('movimientos')
    expect(resolverVista('reglas')).toBe('reglas')
    expect(resolverVista('por-correo')).toBe('movimientos')
    expect(pestanaDe('subir')).toBe('movimientos')
  })
  it('el buscador encuentra las tarjetas y el extracto; no hay «Por correo»', () => {
    expect(buscarEnBancos('tarjeta').map((b) => b.nombre)).toContain('Tarjetas')
    expect(buscarEnBancos('norma 43').map((b) => b.vista)).toEqual(['subir'])
    expect(buscarEnBancos('correo')).toEqual([])
  })
})
