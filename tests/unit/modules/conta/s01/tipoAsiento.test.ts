import { describe, expect, it } from 'vitest'
import { lineasDePredefinido, predefinidoDeMano, tipoDeAsiento, TIPOS_ASIENTO } from '@/modules/conta/lib/tipoAsiento'
import { ORDENES } from '@/modules/conta/esqueleto/ordenes'
import { ventanaParaRevisar } from '@/modules/conta/documentos/documentos'

describe('S01 · ?tipo= del asiento a mano', () => {
  it('cada tipo pone su serie; lo desconocido es el asiento de siempre', () => {
    expect(tipoDeAsiento('expedida')?.serie).toBe(1)
    expect(tipoDeAsiento('tesoreria')?.serie).toBe(3)
    expect(tipoDeAsiento('predefinido')?.serie).toBe(4)
    expect(tipoDeAsiento(null)).toBeNull()
    expect(tipoDeAsiento('toString')).toBeNull()
    expect(tipoDeAsiento('otro')).toBeNull()
  })

  it('cada ?tipo= que abre la cinta tiene su tipo (y no hay tipos sin botón)', () => {
    const tipos = new Set<string>()
    for (const o of ORDENES) {
      const ruta = 'ruta' in o.a ? o.a.ruta : ''
      const m = /[?&]tipo=([^&]+)/.exec(ruta)
      if (m) tipos.add(m[1])
    }
    expect([...tipos].sort()).toEqual(Object.keys(TIPOS_ASIENTO).sort())
    for (const t of tipos) expect(tipoDeAsiento(t)).not.toBeNull()
  })

  it('un predefinido rellena los apuntes; lo que no es fijo se queda vacío y la cuenta que ya no está, también', () => {
    const { lineas, sinCuenta } = lineasDePredefinido({
      id: 't', nombre: 'Alquiler', serie: 4, concepto: 'Alquiler del local',
      lineas: [
        { cuentaId: 'c621', lado: 'debit', importe: 1200, concepto: null, localId: 'l1', comun: false },
        { cuentaId: 'c472', lado: 'debit', importe: null, concepto: 'IVA', localId: null, comun: true },
        { cuentaId: 'cerrada', lado: 'credit', importe: 1452.5, concepto: null, localId: null, comun: false },
      ],
    }, new Map([['c621', '62100000'], ['c472', '47200021']]))
    expect(sinCuenta).toBe(1)
    expect(lineas).toEqual([
      { cuenta: '62100000', debe: '1200,00', haber: '', localId: 'l1', comun: false, concepto: '' },
      { cuenta: '47200021', debe: '', haber: '', localId: null, comun: true, concepto: 'IVA' },
      { cuenta: '', debe: '', haber: '1452,50', localId: null, comun: false, concepto: '' },
    ])
  })

  it('guardar como predefinido: el lado del importe, el importe solo si se pide, y sin los apuntes sin cuenta', () => {
    const idDe = new Map([['62100000', 'c621'], ['57200001', 'c572']])
    const mano = [
      { cuenta: '62100000', debe: '1.200,00', haber: '', localId: 'l1', comun: false, concepto: ' Octubre ' },
      { cuenta: '57200001', debe: '', haber: '1200', localId: null, comun: true, concepto: '' },
      { cuenta: '', debe: '5', haber: '', localId: null, comun: false, concepto: '' },
      { cuenta: '99999999', debe: '5', haber: '', localId: null, comun: false, concepto: '' },
    ]
    expect(predefinidoDeMano(mano, idDe, true)).toEqual([
      { cuentaId: 'c621', lado: 'debit', importe: 1200, concepto: 'Octubre', localId: 'l1', comun: false },
      { cuentaId: 'c572', lado: 'credit', importe: 1200, concepto: null, localId: null, comun: true },
    ])
    expect(predefinidoDeMano(mano, idDe, false).map((l) => l.importe)).toEqual([null, null])
  })
})

describe('S01 · Recibidas desde Asientos', () => {
  it('para revisar: los últimos 12 meses, este incluido, hasta su último día', () => {
    expect(ventanaParaRevisar('2026-10-17')).toEqual({ desde: '2025-11-01', hasta: '2026-10-31' })
    expect(ventanaParaRevisar('2026-01-05')).toEqual({ desde: '2025-02-01', hasta: '2026-01-31' })
    expect(ventanaParaRevisar('2028-02-10').hasta).toBe('2028-02-29')
  })
})
