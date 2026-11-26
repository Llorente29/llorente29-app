// tests/unit/modules/conta/k14/diezbank.test.ts
//
// K14 · El extracto de DiezBank («Extracto de movimientos de DiezBank»), como lo da la exportación: título arriba,
// títulos en la fila 6, lo más reciente arriba, fecha e importe como números de Excel. Todo inventado (T11).

import { describe, expect, it } from 'vitest'
import { leerCsvBanco, reconocerBanco, subcuentaEnCabecera } from '@/modules/conta/lib/lectorCsvBanco'
import { emparejar, type BancoFolvy } from '../../../../../supabase/functions/_shared/bancos/nucleo.ts'
import { ibanSinBanco } from '@/modules/conta/bancos/bancoNuevo'

const excel = (iso: string) => String((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000)

const filas: string[][] = [
  ['', '', '', '', '', 'Cuenta: 57200000 BANCOS E INSTITUCIONES '],
  ['', '', '', '', '', 'Fecha:  desde 01/11/2026 hasta 30/11/2026'],
  [''],
  ['Extracto de movimientos de DiezBank'],
  [''],
  ['Fecha', 'Concepto original', 'Concepto', 'Importe', 'Saldo', 'Subcuenta', '', '', ''],
  [''],
  [excel('2026-11-25'), 'WEB000000001 2411, Pasarela de Pago Inventada', 'WEB000000001 2411, Pasarela de Pago Inventada', '48.4', '1100.4', ''],
  [excel('2026-11-24'), 'TRANSFER INMEDIATA, PERSONA INVENTADA UNO, 000001020261124, PERSONA INVENTADA UNO XXXXESMMXXX, gestoria',
    'TRANSFER INMEDIATA, PERSONA INVENTADA UNO, 000001020261124, PERSONA INVENTADA UNO XXXXESMMXXX, gestoria', '62.5', '1052', ''],
  [excel('2026-11-23'), 'UBER *TRIP', 'UBER *TRIP', '-10.5', '989.5', ''],
]

describe('K14 · DiezBank', () => {
  it('se reconoce por su título, aunque sus columnas encajen con las de otros bancos', () => {
    expect(reconocerBanco(filas)).toBe('diezbank')
  })

  it('lee fecha e importe de Excel, en orden del más antiguo al más reciente, con su saldo', () => {
    const x = leerCsvBanco(filas, 'diezbank')
    const c = x.cuentas[0]
    expect(c.movimientos.map((m) => [m.fecha, m.importeCent])).toEqual([['2026-11-23', -1050], ['2026-11-24', 6250], ['2026-11-25', 4840]])
    expect(c.saldoInicialCent).toBe(100000)
    expect(c.saldoFinalCent).toBe(110040)
    expect(c.movimientos[1].conceptoBanco).toBe('TRANSFER INMEDIATA, PERSONA INVENTADA UNO, 000001020261124, PERSONA INVENTADA UNO XXXXESMMXXX, gestoria')
    // No trae IBAN, pero dice su subcuenta (K14b): con ella se busca el banco, y no hay aviso.
    expect(c.iban).toBeNull()
    expect(c.subcuenta).toBe('57200000')
    expect(x.avisos).not.toContain('El fichero no dice de qué cuenta es: elige la cuenta al subirlo.')
  })

  it('K14b · leída como texto, la fecha va siempre día/mes/año; una fecha al estilo de EE. UU. («11/25/26») para la subida y lo dice', () => {
    const conFechas = (fs: string[]) => filas.map((f, i) => (i < 7 ? f : [fs[i - 7], f[1], f[2], f[3], { 0: '1,100.40', 1: '1,052.00', 2: '989.50' }[i - 7] as string, '']))
    const c = leerCsvBanco(conFechas(['25/11/2026', '24/11/2026', '23/11/2026']), 'diezbank', '2026-11-26').cuentas[0]
    expect(c.movimientos.map((m) => [m.fecha, m.importeCent])).toEqual([['2026-11-23', -1050], ['2026-11-24', 6250], ['2026-11-25', 4840]])
    expect(c.saldoFinalCent).toBe(110040)
    expect(() => leerCsvBanco(conFechas(['11/25/26', '11/24/26', '11/23/26']), 'diezbank', '2026-11-26'))
      .toThrow('Fila 8: «11/25/26» no es una fecha de día/mes/año (DiezBank). No se sube nada: revisa el fichero.')
  })

  it('K14b · una fecha posterior a hoy para la subida entera (la de la empresa dc43e21d: el 11/12/2026 era el 12/11)', () => {
    expect(() => leerCsvBanco(filas, 'diezbank', '2026-11-24'))
      .toThrow('Fila 8: la fecha 25/11/2026 es posterior a hoy. No se sube nada: revisa el fichero (las fechas se leen día/mes/año).')
  })

  it('K14b · un importe sin fecha no se salta: para la subida', () => {
    const sinFecha = filas.map((f, i) => (i === 8 ? ['', ...f.slice(1)] : f))
    expect(() => leerCsvBanco(sinFecha, 'diezbank', '2026-11-26')).toThrow(/^Fila 9: «sin fecha» no es una fecha de día\/mes\/año/)
  })

  it('la misma exportación leída dos veces da los mismos movimientos (lo que repite, lo para la huella al subirlo)', () => {
    expect(leerCsvBanco(filas, 'diezbank')).toEqual(leerCsvBanco(filas, 'diezbank'))
  })
})

describe('K14b · el extracto va al banco que ya existe: nunca otro', () => {
  const banco = (id: string, iban: string | null, cuenta: string | null): BancoFolvy =>
    ({ id, nombre: id, alias: null, iban, kind: 'bank', cuenta, localId: null, ibanRevision: null, ibanes: [] })
  const bancos = [banco('caixa', 'ES0099990000000000007181', '57200000'), banco('otro', 'ES0099990000000000000002', '57200009')]

  it('la subcuenta de la cabecera («Cuenta: 57200000 …»); sin ella, null', () => {
    expect(subcuentaEnCabecera([['', 'Cuenta: 57200000 BANCOS E INSTITUCIONES']])).toBe('57200000')
    expect(subcuentaEnCabecera([['Cuenta corriente'], ['Titular: Nadie']])).toBeNull()
  })

  it('sin IBAN, el banco que tiene esa subcuenta; y entonces no se ofrece «Nuevo banco»', () => {
    const x = leerCsvBanco(filas, 'diezbank')
    expect(emparejar(x, bancos)).toEqual(['caixa'])
    expect(ibanSinBanco(null, bancos, '57200000')).toBe(false)
  })

  it('el IBAN manda sobre la subcuenta; sin ninguno de los dos, no hay banco y sí se ofrece', () => {
    const x = leerCsvBanco(filas, 'diezbank')
    expect(emparejar({ ...x, cuentas: [{ ...x.cuentas[0], iban: 'ES0099990000000000000002' }] }, bancos)).toEqual(['otro'])
    expect(emparejar({ ...x, cuentas: [{ ...x.cuentas[0], subcuenta: '57200005' }] }, bancos)).toEqual([null])
    expect(ibanSinBanco(null, bancos, '57200005')).toBe(true)
  })

  it('subido dos veces, el mismo banco las dos (la base no mete ningún movimiento la segunda: prueba de staging K14b)', () => {
    expect(emparejar(leerCsvBanco(filas, 'diezbank'), bancos)).toEqual(emparejar(leerCsvBanco(filas, 'diezbank'), bancos))
  })
})
