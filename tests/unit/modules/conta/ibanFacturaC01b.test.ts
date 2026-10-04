// C01b, respuesta 2, punto 1 · IBAN distinto en una factura = aviso y freno.
//
// Población real: NO hay. Hoy ninguna lectura de factura trae el IBAN
// (supplier_invoice.read_iban nace con 20261006T0135) y en producción hay 1
// factura de proveedor en toda la base. Así que estos casos están escritos a
// mano, y va dicho aquí (regla 31): cuando la lectura de facturas (C02) lo
// rellene, la prueba se rehace contra lo leído de verdad.
// Los IBAN son los de ejemplo de la documentación bancaria, válidos (módulo 97).
import { describe, expect, it } from 'vitest'
import {
  certificadoVale, estadoIbanFactura, facturaFrenada, frenaElPago, puedeSerElNuevo,
} from '@/modules/conta/lib/ibanFactura'
import { validarIban } from '@/modules/conta/lib/iban'

const FICHA = 'ES9121000418450200051332'
const OTRO = 'ES7921000813610123456789'

describe('IBAN distinto · la regla', () => {
  it('los dos de ejemplo son IBAN válidos', () => {
    expect(validarIban(FICHA).ok).toBe(true)
    expect(validarIban(OTRO).ok).toBe(true)
  })
  it('distinto y sin decidir: frena', () => {
    expect(estadoIbanFactura({ ibanFicha: FICHA, ibanLeido: OTRO, decision: null })).toBe('distinto')
    expect(frenaElPago({ ibanFicha: FICHA, ibanLeido: OTRO, decision: null })).toBe(true)
  })
  it('el mismo con espacios y en minúsculas: coincide, no frena', () => {
    expect(estadoIbanFactura({ ibanFicha: FICHA, ibanLeido: 'es91 2100 0418 4502 0005 1332', decision: null })).toBe('coincide')
  })
  it('sin IBAN leído, o con la ficha sin IBAN: no hay con qué comparar, no frena', () => {
    expect(estadoIbanFactura({ ibanFicha: FICHA, ibanLeido: null, decision: null })).toBe('sin_dato')
    expect(estadoIbanFactura({ ibanFicha: FICHA, ibanLeido: '  ', decision: null })).toBe('sin_dato')
    expect(estadoIbanFactura({ ibanFicha: null, ibanLeido: OTRO, decision: null })).toBe('ficha_sin_iban')
    expect(frenaElPago({ ibanFicha: null, ibanLeido: OTRO, decision: null })).toBe(false)
  })
  it('decidido, en cualquier sentido: ya no frena', () => {
    expect(estadoIbanFactura({ ibanFicha: FICHA, ibanLeido: OTRO, decision: 'es_el_nuevo' })).toBe('decidido_nuevo')
    expect(estadoIbanFactura({ ibanFicha: FICHA, ibanLeido: OTRO, decision: 'no_es_suyo' })).toBe('decidido_no_suyo')
    expect(frenaElPago({ ibanFicha: FICHA, ibanLeido: OTRO, decision: 'no_es_suyo' })).toBe(false)
  })
  it('una factura ya pagada no se frena: ya está hecha', () => {
    expect(facturaFrenada({ status: 'aprobada', readIban: OTRO, ibanDecision: null }, FICHA)).toBe(true)
    expect(facturaFrenada({ status: 'pagada', readIban: OTRO, ibanDecision: null }, FICHA)).toBe(false)
  })
})

describe('IBAN distinto · lo que se puede decidir', () => {
  it('«Es el nuevo IBAN» solo con un IBAN válido: uno mal leído no llega a la ficha', () => {
    expect(puedeSerElNuevo(OTRO)).toEqual({ ok: true })
    const malo = puedeSerElNuevo('ES7921000813610123456780')
    expect(malo.ok).toBe(false)
    if (!malo.ok) expect(malo.motivo).toMatch(/^El IBAN leído no es válido .*puede estar mal leído\. Compruébalo en el papel\.$/)
    expect(puedeSerElNuevo(null)).toEqual({ ok: false, motivo: 'La factura no trae IBAN.' })
  })
})

describe('certificado del banco tras cambiar el IBAN', () => {
  it('sin cambio de IBAN, vale cualquiera', () => {
    expect(certificadoVale('2026-01-01T10:00:00Z', null)).toBe(true)
  })
  it('el de antes del cambio ya no vale; el de después sí', () => {
    expect(certificadoVale('2026-09-01T10:00:00Z', '2026-10-04T12:00:00Z')).toBe(false)
    expect(certificadoVale('2026-10-04T12:30:00Z', '2026-10-04T12:00:00Z')).toBe(true)
  })
})
