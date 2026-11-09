// GP · Tarea 3 · Lo puro de las pantallas del portal del cliente (src/portal/formato.ts).
// Nombres, cifras y fechas inventados.
import { describe, expect, it } from 'vitest'
import {
  cuando, cuentaEnmascarada, diferencia, documentoLimpio, euros, eurosDe, fecha, fechaCorta, iniciales, lineasDelRecibo, mes, nombreDePila,
  nombreImpuesto, nombreSeguro, porQueCambia, puedeSubirse, tonoDe,
} from '../../../src/portal/formato'

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
  it('los impuestos, en palabras', () => {
    expect(nombreImpuesto('303', '3T', 2026)).toBe('IVA del 3.º trimestre de 2026 (modelo 303)')
    expect(nombreImpuesto('200', '0A', 2025)).toBe('Impuesto de sociedades 2025 (modelo 200)')
    expect(nombreImpuesto('111', '10', 2026)).toBe('Retenciones de octubre de 2026 (modelo 111)')
    expect(nombreImpuesto('202', '2P', 2026)).toBe('Modelo, 2.º pago de 2026 (modelo 202)')
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
      { texto: 'Gestión laboral', importe: '96,80 €', detalle: 'TRABAJADOR UNO, TRABAJADOR DOS' },
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
