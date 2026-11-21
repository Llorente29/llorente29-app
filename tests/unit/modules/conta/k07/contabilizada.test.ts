// tests/unit/modules/conta/k07/contabilizada.test.ts
//
// K07 · Una factura, una sola ficha (src/modules/conta/nucleo/recibida/contabilizada.ts):
// qué ficha se abre en cada estado, la franja, qué se puede hacer con el documento antes
// y después de validar, «Más», el historial (el de antes queda) y ‹ después de validar.
import { describe, expect, it } from 'vitest'
import {
  CONFIRMAR_CAMBIO, accionDocumento, etiquetaValidado, franjaContabilizada, franjaDescartada, laAnterior, lineasDelHistorial,
  modoDeLaRecibida, opcionesDeMas, queFichaSeAbre, textoCambioAlGuardar,
} from '@/modules/conta/nucleo/recibida/contabilizada'

describe('qué ficha se abre en cada estado', () => {
  it('por revisar, validada y descartada: la nueva', () => {
    for (const [validada, descartada] of [[false, false], [true, false], [false, true]] as const) {
      expect(queFichaSeAbre({ aMano: false, completa: false, abono: false }), `${validada}/${descartada}`).toBe('nueva')
    }
  })
  it('la de antes, solo para un abono y para «La ficha completa» pedida', () => {
    expect(queFichaSeAbre({ aMano: false, completa: false, abono: true })).toBe('completa')
    expect(queFichaSeAbre({ aMano: false, completa: true, abono: false })).toBe('completa')
    expect(queFichaSeAbre({ aMano: true, completa: true, abono: true })).toBe('nueva')
  })
  it('en qué está: escribir, contabilizada o descartada', () => {
    expect(modoDeLaRecibida({ aMano: false, validada: false, descartada: false })).toBe('escribir')
    expect(modoDeLaRecibida({ aMano: false, validada: true, descartada: false })).toBe('contabilizada')
    expect(modoDeLaRecibida({ aMano: false, validada: false, descartada: true })).toBe('descartada')
    expect(modoDeLaRecibida({ aMano: true, validada: true, descartada: true })).toBe('escribir')
  })
})

describe('la franja', () => {
  it('contabilizada: el número del asiento, pagada o por pagar y en ERP10 si ya salió', () => {
    expect(franjaContabilizada({ numero: 12, pagada: false, enErp10: false })).toEqual({ tono: 'verde', fuerte: 'Contabilizada · asiento 12.', resto: 'Por pagar.' })
    expect(franjaContabilizada({ numero: 12, pagada: true, enErp10: true })).toEqual({ tono: 'verde', fuerte: 'Contabilizada · asiento 12.', resto: 'Pagada · en ERP10.' })
  })
  it('descartada, en gris, con su motivo', () => {
    expect(franjaDescartada({ motivo: 'Es un albarán.', quien: 'Persona' })).toEqual({ tono: 'gris', fuerte: 'Descartada.', resto: 'No es una factura: Es un albarán (Persona).' })
    expect(franjaDescartada({ motivo: null, quien: null }).resto).toBe('No es una factura.')
  })
  it('el asiento validado con su número', () => {
    expect(etiquetaValidado(1)).toBe('Validado · asiento 1')
  })
})

describe('el documento, antes y después de validar', () => {
  it('sin documento se pone; con documento, por revisar, se cambia al guardar', () => {
    expect(accionDocumento({ modo: 'escribir', hayDocumento: false })).toEqual({ que: 'poner' })
    expect(accionDocumento({ modo: 'escribir', hayDocumento: true })).toEqual({ que: 'cambiar' })
    expect(textoCambioAlGuardar('nuevo.pdf')).toBe('Documento nuevo: «nuevo.pdf». Se pone al guardar, sin perder lo escrito; el de antes queda en su historial.')
  })
  it('contabilizada: se cambia confirmando, y el de antes queda en su historial', () => {
    expect(accionDocumento({ modo: 'contabilizada', hayDocumento: true })).toEqual({ que: 'cambiar_contabilizada', confirmar: CONFIRMAR_CAMBIO })
    expect(CONFIRMAR_CAMBIO).toBe('Cambias el documento de una factura contabilizada. El de antes queda en su historial.')
  })
  it('descartada: no se toca', () => {
    expect(accionDocumento({ modo: 'descartada', hayDocumento: true })).toBeNull()
  })
})

describe('«Más», cada cosa con su nombre', () => {
  it('contabilizada por pagar: cambiar, abrir, historial aquí; pagar y lo demás en la ficha completa', () => {
    const o = opcionesDeMas({ modo: 'contabilizada', aMano: false, hayDocumento: true, porPagar: true })
    expect(o.map((x) => [x.id, x.hace])).toEqual([['documento', 'aqui'], ['abrir', 'aqui'], ['historial', 'aqui'], ['pagar', 'completa'],
      ['duplicada', 'completa'], ['descartar', 'completa'], ['iva', 'completa'], ['comision', 'completa']])
    expect(o[0].texto).toBe('Cambiar el documento')
  })
  it('descartada: «Recuperarla», sin cambiar el documento', () => {
    const o = opcionesDeMas({ modo: 'descartada', aMano: false, hayDocumento: true, porPagar: false })
    expect(o.map((x) => x.id)).toEqual(['abrir', 'historial', 'recuperar'])
  })
  it('a mano: nada (no hay factura todavía)', () => {
    expect(opcionesDeMas({ modo: 'escribir', aMano: true, hayDocumento: false, porPagar: false })).toEqual([])
  })
})

describe('el historial: el de antes queda', () => {
  it('el cambio del documento en una contabilizada, con quién y cuándo, y el asiento', () => {
    const l = lineasDelHistorial([
      { at: '2026-11-20T20:05:00Z', quien: 'Persona', que: 'papel', cambios: [{ campo: 'documento', antes: 'c/k07/antes.pdf', ahora: 'c/k07/nuevo.pdf', nombre: 'nuevo.pdf', contabilizada: true }] },
      { at: '2026-11-20T19:00:00Z', quien: 'Persona', que: 'guardar', cambios: [{ campo: 'numero' }, { campo: 'fecha' }] },
    ], { numero: 1, cuando: '2026-11-20T19:30:00Z', quien: 'Persona' })
    expect(l).toEqual([
      { cuando: '20/11/2026 21:05', quien: 'Persona', texto: 'Documento cambiado: «antes.pdf» → «nuevo.pdf» (ya contabilizada; el asiento no cambió). El de antes sigue guardado.' },
      { cuando: '20/11/2026 20:30', quien: 'Persona', texto: 'Contabilizada: asiento 1.' },
      { cuando: '20/11/2026 20:00', quien: 'Persona', texto: 'Cambió: numero, fecha.' },
    ])
  })
  it('el primero que se pone no tiene «de antes»', () => {
    const [x] = lineasDelHistorial([{ at: '2026-11-20T20:05:00Z', quien: null, que: 'papel', cambios: [{ campo: 'documento', antes: null, ahora: 'c/a.pdf' }] }], null)
    expect(x).toEqual({ cuando: '20/11/2026 21:05', quien: 'alguien', texto: 'Documento puesto: «a.pdf».' })
  })
})

describe('‹ después de validar', () => {
  it('vuelve a la que se acaba de validar; si no, la de antes en la cola', () => {
    expect(laAnterior({ vieneDe: 'validada', actual: 'siguiente', enLaCola: 'otra' })).toBe('validada')
    expect(laAnterior({ vieneDe: null, actual: 'siguiente', enLaCola: 'otra' })).toBe('otra')
    expect(laAnterior({ vieneDe: 'siguiente', actual: 'siguiente', enLaCola: null })).toBeNull()
  })
})
