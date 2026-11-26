// tests/unit/modules/conta/k14/diezbank.test.ts
//
// K14 · El extracto de DiezBank («Extracto de movimientos de DiezBank»), como lo da la exportación: título arriba,
// títulos en la fila 6, lo más reciente arriba, fecha e importe como números de Excel. Todo inventado (T11).

import { describe, expect, it } from 'vitest'
import { leerCsvBanco, reconocerBanco } from '@/modules/conta/lib/lectorCsvBanco'

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
    // No trae IBAN: la cuenta se elige al subirlo, y se dice.
    expect(c.iban).toBeNull()
    expect(x.avisos).toContain('El fichero no dice de qué cuenta es: elige la cuenta al subirlo.')
  })

  it('leída como texto (como la lee la pantalla), la fecha viene con el mes delante y el importe con comas de miles', () => {
    const texto = filas.map((f, i) => (i < 7 ? f : [['11/25/26', '11/24/26', '11/23/26'][i - 7], f[1], f[2], f[3], { 0: '1,100.40', 1: '1,052.00', 2: '989.50' }[i - 7] as string, '']))
    const c = leerCsvBanco(texto, 'diezbank').cuentas[0]
    expect(c.movimientos.map((m) => [m.fecha, m.importeCent])).toEqual([['2026-11-23', -1050], ['2026-11-24', 6250], ['2026-11-25', 4840]])
    expect(c.saldoFinalCent).toBe(110040)
  })

  it('la misma exportación leída dos veces da los mismos movimientos (lo que repite, lo para la huella al subirlo)', () => {
    expect(leerCsvBanco(filas, 'diezbank')).toEqual(leerCsvBanco(filas, 'diezbank'))
  })
})
