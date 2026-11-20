// tests/unit/modules/conta/q07/listado.test.ts
//
// Q07 · Lo nuevo del núcleo puro de los listados: el otro periodo de «Comparar
// con», sus columnas (diferencia en euros y en %), los niveles y el saldo
// inicial de sumas y saldos con las cifras de hoy (sumasYSaldos), el filtro de
// local y marca del mayor (el mismo que hoy) y los filtros del libro de IVA
// (`filtrar`, la misma función). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { arbolIva, arbolMayor, arbolSumas, columnasDe, filtroMayor, hayFiltroIva, otroPeriodo, sinMovimientos } from '@/modules/conta/nucleo/listado/arbol'
import { OPCIONES_POR_DEFECTO, sumasYSaldos, totales, type SaldoPartido } from '@/modules/conta/lib/sumasSaldos'
import { extracto } from '@/modules/conta/lib/extractos'
import { cifrasLibro, filtrar, type AnotacionLibro } from '@/modules/conta/lib/libroRegistro'

const saldo = (code: string, name: string, inicialDebe: number, debe: number, haber: number): SaldoPartido => ({
  code, name, templateCode: null, inicialDebe, inicialHaber: 0, aperturaDebe: 0, aperturaHaber: 0, periodoDebe: debe, periodoHaber: haber,
  regularizacionDebe: 0, regularizacionHaber: 0, cierreDebe: 0, cierreHaber: 0,
})
const SALDOS = [saldo('43000001', 'Cliente de ejemplo', 100, 50, 20), saldo('43000002', 'Otro cliente de ejemplo', 0, 10, 40), saldo('70000000', 'Ventas de ejemplo', 0, 0, 100)]

describe('Q07 · «Comparar con»: el otro periodo', () => {
  it('el año anterior: las mismas fechas, un año antes', () => {
    expect(otroPeriodo('2026-01-01', '2026-07-31', 'año')).toMatchObject({ desde: '2025-01-01', hasta: '2025-07-31', este: '2026', otro: '2025' })
    expect(otroPeriodo('2028-01-01', '2028-02-29', 'año')).toMatchObject({ desde: '2027-01-01', hasta: '2027-02-28' })
  })
  it('el periodo anterior: el trimestre de antes, el año de antes, o los mismos días justo antes', () => {
    expect(otroPeriodo('2026-07-01', '2026-09-30', 'periodo')).toMatchObject({ desde: '2026-04-01', hasta: '2026-06-30' })
    expect(otroPeriodo('2026-01-01', '2026-12-31', 'periodo')).toMatchObject({ desde: '2025-01-01', hasta: '2025-12-31' })
    expect(otroPeriodo('2026-03-10', '2026-03-19', 'periodo')).toMatchObject({ desde: '2026-02-28', hasta: '2026-03-09' })
  })
  it('sin movimientos en el otro periodo, lo dice (sus cifras salen a cero, nunca vacías)', () => {
    expect(sinMovimientos('2025', '2025-01-01', '2025-07-31')).toBe('2025: sin movimientos en Sumied.')
  })
  it('las columnas: el saldo de cada lado, la diferencia y el %; sin comparar, deudor y acreedor', () => {
    expect(columnasDe('sumas', { comparar: { este: '2026', otro: '2025' } }).map((c) => c.titulo)).toEqual(['Cuenta', 'Nombre', 'Debe', 'Haber', 'Saldo 2026', 'Saldo 2025', 'Diferencia', '%'])
    expect(columnasDe('sumas').map((c) => c.titulo)).toEqual(['Cuenta', 'Nombre', 'Debe', 'Haber', 'Saldo deudor', 'Saldo acreedor'])
    expect(columnasDe('sumas', { inicial: true }).map((c) => c.titulo)).toContain('Saldo inicial')
  })
})

describe('Q07 · sumas y saldos con sus niveles, sus opciones y comparando', () => {
  const o = { ...OPCIONES_POR_DEFECTO, soloPeriodo: true, saldoInicial: true }
  const filas = sumasYSaldos(SALDOS, ['grupo', 'cuenta'], o)
  it('a nivel de cuenta y con el saldo inicial, las cifras son las de hoy (sumasYSaldos, totales)', () => {
    const a = arbolSumas(filas, new Map(), { inicial: true })
    const t = totales(filas, 'grupo')
    const col = (k: string) => a.columnas.findIndex((c) => c.clave === k)
    expect(a.total[col('inicial')]).toBe(t.inicial)
    expect(a.total[col('debe')]).toBe(t.debe)
    expect(a.raiz).toEqual(['g:4', 'g:7'])
    expect(a.filas.get('g:4')!.hijos).toEqual(['t:430'])
    // La cuenta de 3 cifras: F5 abre el mayor de todas las suyas.
    expect(a.filas.get('t:430')!.cuenta).toBe('430')
  })
  it('comparando: el saldo del otro periodo, la diferencia en euros y en %', () => {
    const otro = new Map([['grupo:4', 50], ['cuenta:430', 50], ['grupo:7', 0]])
    const a = arbolSumas(sumasYSaldos(SALDOS, ['grupo', 'cuenta'], OPCIONES_POR_DEFECTO), new Map(), { comparar: { este: '2026', otro: '2025', saldos: otro } })
    const f = a.filas.get('t:430')!
    const i = (k: string) => a.columnas.findIndex((c) => c.clave === k)
    expect([f.celdas[i('saldo')], f.celdas[i('otro')], f.celdas[i('dif')], f.celdas[i('pct')]]).toEqual([100, 50, 50, 100])
    // Sin cifra en el otro periodo: a cero, y el % no se puede calcular.
    const v = a.filas.get('g:7')!
    expect([v.celdas[i('otro')], v.celdas[i('pct')]]).toEqual([0, null])
  })
})

const ap = (entryId: string, fecha: string, debe: number, haber: number, localId: string | null, comun = false) => ({
  entryId, fecha, cuenta: '43000001', nombreCuenta: 'Cliente de ejemplo', debe, haber, localId, marcaId: null, comun, concepto: 'Movimiento de ejemplo', serie: 4, numero: 1,
})
const APUNTES = [ap('a1', '2026-01-10', 100, 0, 'local-norte'), ap('a2', '2026-02-10', 30, 0, 'local-sur'), ap('a3', '2026-03-10', 0, 20, null, true)]

describe('Q07 · el mayor filtrado por local, como hoy', () => {
  it('el filtro de hoy: «» todos, «comun» solo lo común, un local el suyo', () => {
    expect(filtroMayor('', '')).toEqual({ localId: undefined, marcaId: undefined, soloComun: false })
    expect(filtroMayor('comun', 'sin')).toEqual({ localId: null, marcaId: null, soloComun: true })
  })
  it('las cifras del mayor filtrado son las de extracto() con el mismo filtro', () => {
    const f = filtroMayor('local-norte', '')
    const a = arbolMayor(APUNTES, '2026-01-01', '2026-12-31', { desde: '43000001', hasta: '43000001' }, { filtro: f })
    const hoy = extracto(APUNTES, { desde: '2026-01-01', hasta: '2026-12-31', ...f })
    const fila = a.filas.get('c:43000001')!
    expect(fila.celdas.slice(3, 5)).toEqual([hoy.debe, hoy.haber])
    expect(fila.hijos.length).toBe(1 + hoy.filas.length)
  })
})

const anot = (id: string, base: number, extra: Partial<AnotacionLibro> = {}): AnotacionLibro => ({
  id, entryId: `e-${id}`, book: 'issued', invoiceType: 'F1', series: 'A', number: id, numberTo: null, documentsCount: 1, issueDate: '2026-10-05', operationDate: null,
  receivedDate: null, receivedNumber: null, partyId: null, counterpartTaxId: 'B00000002', counterpartIdType: null, counterpartCountry: null,
  counterpartName: 'Cliente de ejemplo, S.L.', operationKey: '01', qualification: 'S1', exemptCause: null, taxBase: base, taxRate: 10, taxAmount: base / 10,
  surchargeRate: null, surchargeAmount: null, total: base * 1.1, deductibleAmount: null, deductibleLater: false, reverseCharge: false, investmentGood: false,
  withholdingRate: null, withholdingAmount: null, activityCode: null, activityType: null, activityIae: null, correctsRef: null, sourceType: 'manual', sourceId: null,
  voidedAt: null, deducidaEn: null, deducidaPorque: null, ...extra,
} as AnotacionLibro)

describe('Q07 · el libro de IVA con los filtros de hoy', () => {
  const lista = [anot('1', 100), anot('2', 500, { counterpartTaxId: 'B00000003' }), anot('3', 50, { voidedAt: '2026-10-06' })]
  it('filtrado por NIF: las mismas filas que filtrar() de hoy, y «1 de 2» (regla 7)', () => {
    const f = { nif: 'B00000003' }
    const a = arbolIva(lista, 'issued', null, { filtros: f })
    const hoy = filtrar(lista, f)
    expect(a.cuantas).toBe(hoy.length)
    expect(a.de).toBe(2)
    expect(a.total[4]).toBe(cifrasLibro(hoy).base)
    expect(a.cuadra).toBeNull()
    expect(hayFiltroIva(f)).toBe(true)
  })
  it('«Ver anuladas»: salen, dicen que lo están y no suman', () => {
    const a = arbolIva(lista, 'issued', null, { filtros: { verAnuladas: true } })
    const fila = a.filas.get('f:3')!
    expect(String(fila.celdas[3])).toMatch(/anulada$/)
    expect(a.total[4]).toBe(600)
  })
  it('«Agrupar por NIF»: un grupo por NIF', () => {
    const a = arbolIva(lista, 'issued', null, { porNif: true })
    expect(a.raiz).toEqual(['nif:B00000002', 'nif:B00000003'])
  })
})
