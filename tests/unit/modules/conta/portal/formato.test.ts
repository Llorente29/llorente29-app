// GP · Tarea 3 · Lo puro de las pantallas del portal del cliente (src/modules/conta/portal/formato.ts).
// Nombres, cifras y fechas inventados.
import { describe, expect, it } from 'vitest'
import {
  cuando, cuandoSeHizo, cuentaEnmascarada, diferencia, documentoLimpio, euros, eurosDe, fecha, fechaCorta, iniciales, laboralPorMes, lineasDelRecibo, mes, nombreDePila,
  cortado, gestoriaPrimero, motivoParaTi, nombreImpuesto, nombrePropio, nombreSeguro, peticionHecha, porQueCambia, puedeSubirse, queLleva, resultadoImpuesto, teLleva, telefono, tonoDe,
} from '../../../../../src/modules/conta/portal/formato'
import { motivoEnPalabras } from '../../../../../supabase/functions/conta-gocardless-leer/motivo'

const hoy = new Date('2026-11-09T12:00:00Z')

describe('cifras y fechas', () => {
  it('euros desde céntimos y desde euros', () => {
    expect(euros(15730)).toBe('157,30 €')
    expect(euros(145740)).toBe('1.457,40 €')
    expect(euros(null)).toBe('—')
    expect(eurosDe(1842.5)).toBe('1.842,50 €')
    expect(eurosDe('133.1')).toBe('133,10 €')
  })
  it('fechas en palabras, con el año solo si no es este', () => {
    expect(fecha('2026-12-04', hoy)).toBe('4 de diciembre')
    expect(fecha('2025-07-24', hoy)).toBe('24 de julio de 2025')
    expect(fecha('2026-11-07T23:30:00Z', hoy)).toBe('8 de noviembre')
    expect(fecha(null, hoy)).toBe('—')
    expect(fechaCorta('2026-12-04')).toBe('4 dic')
  })
  it('la hora de un mensaje: hoy, ayer o el día', () => {
    expect(cuando('2026-11-09T08:14:00Z', hoy)).toBe('hoy 9:14')
    expect(cuando('2026-11-08T16:02:00Z', hoy)).toBe('ayer 17:02')
    expect(cuando('2026-11-03T16:02:00Z', hoy)).toBe('3 de noviembre 17:02')
  })
  it('el mes del recibo', () => {
    expect(mes('2026-11', hoy)).toBe('Noviembre')
    expect(mes('2025-12', hoy)).toBe('Diciembre de 2025')
  })
})

describe('nombres', () => {
  it('iniciales y nombre de pila', () => {
    expect(iniciales('Gestoría Demo')).toBe('GD')
    expect(iniciales('Talleres Ejemplo, S.L.')).toBe('TE')
    expect(iniciales('')).toBe('·')
    expect(nombreDePila('Persona Ejemplo')).toBe('Persona')
    expect(nombreDePila('persona@ejemplo.example')).toBe('')
  })
  it('los impuestos, en palabras, como en la maqueta', () => {
    expect(nombreImpuesto('303', '3T', 2026, hoy)).toBe('IVA del 3.er trimestre (modelo 303)')
    expect(nombreImpuesto('303', '4T', 2025, hoy)).toBe('IVA del 4.º trimestre de 2025 (modelo 303)')
    expect(nombreImpuesto('200', '0A', 2025, hoy)).toBe('Impuesto de sociedades 2025')
    expect(nombreImpuesto('111', '10', 2026, hoy)).toBe('Retenciones de octubre (modelo 111)')
    expect(nombreImpuesto('202', '2P', 2026, hoy)).toBe('Pago a cuenta de sociedades, 2.º pago (modelo 202)')
    expect(nombreImpuesto('999', '1T', 2026, hoy)).toBe('Modelo 999 del 1.er trimestre')
  })
})

describe('el recibo de Code 1', () => {
  it('las líneas: su texto, su importe y sus trabajadores', () => {
    expect(lineasDelRecibo([
      { texto: 'Gestoría Estándar', importeCent: 6050, cuenta: '1 × 60,50 €', trabajadores: null },
      { texto: 'Gestión laboral', importeCent: 9680, cuenta: '4 × 24,20 €', trabajadores: [{ nombre: 'TRABAJADOR UNO' }, { nombre: 'TRABAJADOR DOS' }] },
      { texto: 'Sin tarifa', importeCent: null, cuenta: '' },
    ])).toEqual([
      { texto: 'Gestoría Estándar', importe: '60,50 €', detalle: '1 × 60,50 €' },
      { texto: 'Gestión laboral', importe: '96,80 €', detalle: 'Trabajador Uno, Trabajador Dos' },
      { texto: 'Sin tarifa', importe: 'Sin precio', detalle: null },
    ])
    expect(lineasDelRecibo(null)).toEqual([])
  })
  it('por qué cambia y cuánto', () => {
    expect(porQueCambia([{ tipo: 'alta', texto: '+1 trabajador: TRABAJADOR DOS' }, { tipo: 'precio', texto: 'Sube la tarifa' }])).toBe('+1 trabajador: TRABAJADOR DOS · Sube la tarifa')
    expect(porQueCambia([])).toBeNull()
    expect(diferencia(15730, 13310)).toEqual({ texto: 'Sube 24,20 €', tono: 'aviso' })
    expect(diferencia(13310, 15730)).toEqual({ texto: 'Baja 24,20 €', tono: 'ok' })
    expect(diferencia(100, 100)).toBeNull()
    expect(diferencia(100, null)).toBeNull()
  })
  it('la cuenta de cargo, enmascarada como en la maqueta', () => {
    expect(cuentaEnmascarada('ES', '4821')).toBe('ES•• •••• •••• •••• •••• 4821')
    expect(cuentaEnmascarada(null, '00')).toBe('ES•• •••• •••• •••• •••• 00')
    expect(cuentaEnmascarada('ES', null)).toBeNull()
  })
  it('el tono de cada estado', () => {
    expect(tonoDe('Pagada')).toBe('ok')
    expect(tonoDe('Devuelto')).toBe('mal')
    expect(tonoDe('Próximo')).toBe('info')
    expect(tonoDe('Anulado')).toBe('gris')
  })
})

describe('lo que se sube y se pide', () => {
  it('solo PDF y fotos, de hasta 15 MB', () => {
    expect(puedeSubirse({ type: 'application/pdf', size: 1000, name: 'f.pdf' })).toBeNull()
    expect(puedeSubirse({ type: '', size: 1000, name: 'foto.HEIC' })).toBeNull()
    expect(puedeSubirse({ type: 'application/zip', size: 1000, name: 'x.zip' })).toMatch(/solo PDF y fotos/)
    expect(puedeSubirse({ type: 'image/jpeg', size: 16 * 1024 * 1024, name: 'g.jpg' })).toMatch(/15 MB/)
    expect(nombreSeguro('../Ticket gasóleo.jpg')).toBe('Ticket gasoleo.jpg')
  })
  it('el DNI o NIE, limpio o nada', () => {
    expect(documentoLimpio('00000000-t')).toBe('00000000T')
    expect(documentoLimpio('x 0000000 t')).toBe('X0000000T')
    expect(documentoLimpio('1234')).toBeNull()
  })
})

describe('Documentos · nóminas y seguros sociales, por mes', () => {
  const hoy = new Date('2026-11-09T10:00:00Z')
  const doc = (id: string, carpeta: string, fecha: string) => ({ id, nombre: `${id}.pdf`, carpeta, trabajador: 'Persona Ejemplo', fecha })
  it('una fila por mes y tipo, la más reciente primero y las nóminas antes que los seguros sociales', () => {
    const g = laboralPorMes([
      doc('n1', 'nominas', '2026-10-30T09:00:00Z'), doc('n2', 'nominas', '2026-10-30T09:01:00Z'), doc('n3', 'nominas', '2026-10-29T09:00:00Z'), doc('n4', 'nominas', '2026-10-30T10:00:00Z'),
      doc('s1', 'ss_sepe', '2026-10-31T08:00:00Z'), doc('n5', 'nominas', '2026-09-30T09:00:00Z'), doc('n6', 'nominas', '2026-09-30T09:00:00Z'), doc('n7', 'nominas', '2026-09-30T09:00:00Z'),
    ], hoy)
    expect(g.map((x) => [x.titulo, x.detalle, x.ids.length])).toEqual([
      ['Nóminas de octubre', '4 nóminas · listas el 30 de octubre', 4],
      ['Seguros sociales de octubre', 'Cargados el 31 de octubre', 1],
      ['Nóminas de septiembre', '3 nóminas · listas el 30 de septiembre', 3],
    ])
  })
  it('el mes, en la hora de Madrid; ninguno se queda fuera', () => {
    // 31/10 a las 23:30 UTC ya es 1 de noviembre en Madrid.
    const g = laboralPorMes([doc('a', 'nominas', '2026-10-31T23:30:00Z'), doc('b', 'nominas', '2025-12-30T09:00:00Z')], hoy)
    expect(g.map((x) => x.titulo)).toEqual(['Nóminas de noviembre', 'Nóminas de diciembre de 2025'])
    expect(g.flatMap((x) => x.ids).sort()).toEqual(['a', 'b'])
    expect(laboralPorMes([], hoy)).toEqual([])
  })
})

describe('Inicio · lo hecho, como la maqueta (nº 24)', () => {
  const ahora = new Date('2026-11-10T10:00:00Z')
  it('cuándo se hizo: hoy, ayer o la fecha', () => {
    expect(cuandoSeHizo('2026-11-10T08:00:00Z', ahora)).toBe('hoy')
    expect(cuandoSeHizo('2026-11-09T08:00:00Z', ahora)).toBe('ayer')
    expect(cuandoSeHizo('2026-11-03T08:00:00Z', ahora)).toBe('el 3 de noviembre')
    expect(cuandoSeHizo(null, ahora)).toBe('')
  })
  it('lo que dice cada petición hecha', () => {
    expect(peticionHecha({ tipo: 'firmar', hecha: '2026-11-10T08:00:00Z' }, ahora)).toEqual({ detalle: 'Firmada hoy', boton: '✓ Firmada' })
    expect(peticionHecha({ tipo: 'subir', hecha: '2026-11-09T08:00:00Z', recibidas: 12 }, ahora)).toEqual({ detalle: 'Recibidos: 12 documentos', boton: '✓ Hecho' })
    expect(peticionHecha({ tipo: 'subir', hecha: '2026-11-09T08:00:00Z', recibidas: 1 }, ahora).detalle).toBe('Recibido: 1 documento')
    expect(peticionHecha({ tipo: 'subir', hecha: '2026-11-09T08:00:00Z', recibidas: 0 }, ahora).detalle).toBe('Hecho ayer')
    expect(peticionHecha({ tipo: 'contestar', hecha: '2026-11-03T08:00:00Z' }, ahora)).toEqual({ detalle: 'Contestada el 3 de noviembre', boton: '✓ Hecho' })
  })
})

describe('nº 24 · lo que lleva una factura o un recibo', () => {
  it('junta gestoría y laboral, con los trabajadores', () => {
    expect(queLleva(['Gestoría mensual · Estándar', 'Gestión laboral · 4 trabajadores'])).toBe('Gestoría y laboral (4 trabajadores)')
    expect(queLleva(['Gestión laboral · 1 trabajador', 'Gestoría mensual · Básica'])).toBe('Gestoría y laboral (1 trabajador)')
  })
  it('con algo más, lo pone detrás y no dice los trabajadores', () => {
    expect(queLleva(['Gestoría mensual · Estándar', 'Gestión laboral · 3 trabajadores', 'Cuentas anuales'])).toBe('Gestoría y laboral · Cuentas anuales')
  })
  it('solo una de las dos, o nada conocido', () => {
    expect(queLleva(['Gestoría mensual · Premium'])).toBe('Gestoría')
    expect(queLleva(['Gestión laboral · 2 trabajadores'])).toBe('Laboral (2 trabajadores)')
    expect(queLleva(['Alta de autónomo', ' '])).toBe('Alta de autónomo')
    expect(queLleva([])).toBe('')
  })
})

describe('nº 24 · 6 · el motivo del devuelto, dicho de tú', () => {
  it('como la maqueta: «no había saldo suficiente» en Inicio y «sin saldo» en Pagos', () => {
    expect(motivoParaTi('Sin saldo en la cuenta')).toEqual({ frase: 'no había saldo suficiente', corto: 'sin saldo' })
  })
  it('lo que no dice nada nuevo, o no hay, no se repite', () => {
    expect(motivoParaTi('El banco lo ha devuelto')).toBeNull()
    expect(motivoParaTi(null)).toBeNull()
    expect(motivoParaTi('  ')).toBeNull()
  })
  it('un texto que no se conoce se enseña tal cual, en minúscula', () => {
    expect(motivoParaTi('Motivo nuevo de prueba')).toEqual({ frase: 'motivo nuevo de prueba', corto: 'motivo nuevo de prueba' })
  })
  it('cada texto que guarda Code 1 tiene su versión de tú (nunca «el cliente» ni «su banco»)', () => {
    const causas = ['insufficient_funds', 'refer_to_payer', 'bank_account_closed', 'bank_account_disabled', 'account_blocked_for_any_financial_transaction',
      'mandate_cancelled', 'mandate_expired', 'invalid_bank_details', 'direct_debit_not_enabled', 'authorisation_disputed', 'refund_requested',
      'return_on_odfi_request', 'payment_cancelled', 'reason_not_specified', 'causa_que_no_existe']
    for (const c of causas) {
      const texto = motivoEnPalabras(c, null)
      const m = motivoParaTi(texto)
      if (m) {
        expect(`${m.frase} ${m.corto}`, `${c} → ${texto}`).not.toMatch(/el cliente|su banco/i)
        expect(m.frase, `${c} → ${texto}`).not.toBe(texto)
      }
    }
  })
})

describe('nº 28 · cómo se escriben las cosas en la pantalla', () => {
  it('nombres en mayúsculas, con mayúscula solo al principio (nombres inventados)', () => {
    expect(nombrePropio('PERSONA PRUEBA UNO')).toBe('Persona Prueba Uno')
    expect(nombrePropio('MARÍA DE LA PRUEBA DEL RÍO')).toBe('María de la Prueba del Río')
    expect(nombrePropio('BANCO DE PRUEBAS, S.A.')).toBe('Banco de Pruebas, S.A.')
    expect(nombrePropio('JOSÉ-LUIS PRUEBA')).toBe('José-Luis Prueba')
  })
  it('lo que ya viene bien escrito no se toca', () => {
    expect(nombrePropio('Persona Prueba de Uno')).toBe('Persona Prueba de Uno')
    expect(nombrePropio('Banco de Pruebas, S.A.')).toBe('Banco de Pruebas, S.A.')
    expect(nombrePropio('')).toBe('')
    expect(nombrePropio(null)).toBe('')
  })
  it('el teléfono, con espacios', () => {
    expect(telefono('910000000')).toBe('910 000 000')
    expect(telefono('+34910000000')).toBe('+34 910 000 000')
    expect(telefono('+34 600 000 101')).toBe('+34 600 000 101')
    expect(telefono('12345')).toBe('12345')
  })
  it('lo cortado a 120, con «…» y sin partir una palabra', () => {
    const largo = 'Hola, ya tienes aquí tu espacio. Ves tus facturas y tus recibos, nos subes los documentos y nos escribes por aquí y más cosas'.slice(0, 120)
    expect(largo.length).toBe(120)
    expect(cortado(largo)).toBe('Hola, ya tienes aquí tu espacio. Ves tus facturas y tus recibos, nos subes los documentos y nos escribes por aquí y más…')
    expect(cortado('Perfecto, recibido.')).toBe('Perfecto, recibido.')
    expect(cortado('a'.repeat(50) + ' ' + 'palabrota'.repeat(10))).toBe('a'.repeat(50) + '…')
  })
  it('el resultado de un impuesto, como lo guarda la base', () => {
    expect(resultadoImpuesto('to_pay')).toBe('a ingresar')
    expect(resultadoImpuesto('to_refund')).toBe('a devolver')
    expect(resultadoImpuesto(null)).toBe('')
  })
  it('lo contratado: la gestoría antes que la laboral', () => {
    expect(gestoriaPrimero([{ texto: 'Gestión laboral · 4 trabajadores' }, { texto: 'Gestoría mensual · Premium' }]).map((l) => l.texto))
      .toEqual(['Gestoría mensual · Premium', 'Gestión laboral · 4 trabajadores'])
  })
})

describe('nº 32 · quién lleva al cliente', () => {
  it('nombre y correo, como en la maqueta (inventados)', () => {
    expect(teLleva({ nombre: 'Persona Gestora', correo: 'gestora@ejemplo.invalid' })).toBe('Te lleva: Persona Gestora · gestora@ejemplo.invalid')
    expect(teLleva({ nombre: 'PERSONA GESTORA', correo: null })).toBe('Te lleva: Persona Gestora')
    expect(teLleva({ nombre: '', correo: 'gestora@ejemplo.invalid' })).toBe('Te lleva: gestora@ejemplo.invalid')
  })
  it('sin nadie, sin línea', () => {
    expect(teLleva(null)).toBeNull()
    expect(teLleva({ nombre: ' ', correo: '' })).toBeNull()
  })
})
