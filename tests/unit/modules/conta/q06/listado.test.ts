// tests/unit/modules/conta/q06/listado.test.ts
//
// Q06 · Lo que decide el listado del núcleo, sin pantalla: el árbol de cada
// listado (que lleva LAS MISMAS cifras que el listado de hoy, regla 31: se
// comparan con lo que da la función de hoy, no con un número escrito a mano),
// los saldos deudor y acreedor de un grupo, lo que Sumied mira, qué filas se
// ven con «Abrir: todo · a 3 cifras · a 1 cifra», y la hoja impresa con su
// «Suma y sigue» y sus páginas. Los datos son inventados (T11) y se ven
// inventados: cuentas de una empresa de ejemplo.

import { describe, expect, it } from 'vitest'
import {
  abrirHasta, arbolDiario, arbolIva, arbolMayor, arbolSumas, camino, colgar, deudorAcreedor, enRango, filasDeMovimientos, lineasDeLaHoja, mirarSaldo,
  paginar, periodosDe, queMirar, subtituloHoja, visibles,
} from '@/modules/conta/nucleo/listado/arbol'
import { hojaDe, textoPagina, textoSigue, LINEAS_POR_PAGINA } from '@/modules/conta/nucleo/listado/hoja'
import { queDeLaAccion } from '@/modules/conta/nucleo/listado/rutas'
import { OPCIONES_POR_DEFECTO, sumasYSaldos, totales, type SaldoPartido } from '@/modules/conta/lib/sumasSaldos'
import { extracto, resumir } from '@/modules/conta/lib/extractos'
import { cifrasLibro, type AnotacionLibro } from '@/modules/conta/lib/libroRegistro'

const saldo = (code: string, name: string, debe: number, haber: number, templateCode: string | null = null): SaldoPartido => ({
  code, name, templateCode, inicialDebe: 0, inicialHaber: 0, aperturaDebe: 0, aperturaHaber: 0, periodoDebe: debe, periodoHaber: haber,
  regularizacionDebe: 0, regularizacionHaber: 0, cierreDebe: 0, cierreHaber: 0,
})

// Una empresa de ejemplo, con los saldos de la maqueta nucleo_7.
const SALDOS: SaldoPartido[] = [
  saldo('40000007', 'Distribuciones Ejemplo, S.L.', 610.71, 2213.25),
  saldo('43000012', 'Restaurante Cliente Ejemplo, S.L.', 1602.54, 504.27),
  saldo('43000031', 'Cafetería Cliente Ejemplo, S.L.', 44, 88),
  saldo('47200000', 'Hacienda Pública, IVA soportado', 2310.55, 0),
  saldo('47700000', 'Hacienda Pública, IVA repercutido', 0, 4120),
  saldo('57000000', 'Caja', 3240, 3180),
  saldo('57200001', 'Banco principal', 48615.4, 36135.25),
  saldo('60000000', 'Compras de mercaderías', 18420.1, 0),
  saldo('70000000', 'Ventas de mercaderías', 0, 28602.53),
]
const NOMBRES = new Map([['4', 'Acreedores y deudores'], ['40', 'Proveedores'], ['43', 'Clientes'], ['47', 'Administraciones públicas'], ['5', 'Cuentas financieras']])
const filasDeHoy = sumasYSaldos(SALDOS, ['grupo', 'subgrupo', 'subcuenta'], OPCIONES_POR_DEFECTO)

describe('Q06 · sumas y saldos: las cifras de hoy, en un árbol', () => {
  const a = arbolSumas(filasDeHoy, NOMBRES)
  it('grupo › subgrupo › subcuenta, con el nombre del cuadro de cuentas', () => {
    expect(a.raiz).toEqual(['g:4', 'g:5', 'g:6', 'g:7'])
    expect(a.filas.get('g:4')!.hijos).toEqual(['s:40', 's:43', 's:47'])
    expect(a.filas.get('s:43')!.hijos).toEqual(['c:43000012', 'c:43000031'])
    expect(a.filas.get('g:4')!.celdas[0]).toBe('4 · Acreedores y deudores')
    expect(a.filas.get('g:6')!.celdas[0]).toBe('6')
  })
  it('Debe y Haber de cada fila son los de sumasYSaldos de hoy, nivel a nivel', () => {
    for (const f of filasDeHoy) {
      const id = f.nivel === 'grupo' ? `g:${f.code}` : f.nivel === 'subgrupo' ? `s:${f.code}` : `c:${f.code}`
      expect(a.filas.get(id)!.celdas.slice(2, 4)).toEqual([f.debe, f.haber])
    }
  })
  it('el total es el de hoy, y cuadra', () => {
    const t = totales(filasDeHoy, 'grupo')
    expect(a.total[2]).toBe(t.debe)
    expect(a.total[3]).toBe(t.haber)
    expect(a.cuadra).toBe(true)
    expect(t.cuadra).toBe(true)
    expect(a.cuantas).toBe(9)
  })
  it('el saldo deudor y el acreedor de un grupo van cada uno por su lado (la maqueta: 43 lleva 1.098,27 y 44,00)', () => {
    expect(a.filas.get('s:43')!.celdas.slice(4)).toEqual([1098.27, 44])
    expect(a.filas.get('c:43000012')!.celdas.slice(4)).toEqual([1098.27, null])
    expect(a.filas.get('c:43000031')!.celdas.slice(4)).toEqual([null, 44])
  })
  it('las subcuentas llevan su cuenta (F5) y sus movimientos se leen al abrirlas', () => {
    expect(a.filas.get('c:40000007')).toMatchObject({ cuenta: '40000007', porLeer: true })
  })
  it('sin cuadrar, lo dice; con un rango de cuentas, no (no tiene por qué cuadrar)', () => {
    const mal = sumasYSaldos([...SALDOS, saldo('62600000', 'Servicios bancarios', 84, 0)], ['grupo', 'subgrupo', 'subcuenta'], OPCIONES_POR_DEFECTO)
    expect(arbolSumas(mal, NOMBRES).avisos).toEqual(['Debe y haber no cuadran: 84,00 de diferencia.'])
    expect(arbolSumas(mal, NOMBRES, true).avisos).toEqual([])
  })
})

describe('Q06 · lo que Sumied ha mirado', () => {
  it('un cliente con saldo a su favor (la frase de la maqueta)', () => {
    expect(mirarSaldo('43000031', -44)).toBe('Un cliente con saldo a su favor: suele ser un cobro apuntado dos veces.')
    expect(mirarSaldo('43000012', 1098.27)).toBeNull()
  })
  it('un proveedor con saldo a tu favor, y la caja en negativo', () => {
    expect(mirarSaldo('40000007', 10)).toMatch(/^Un proveedor con saldo a tu favor/)
    expect(mirarSaldo('41000001', 10)).toMatch(/^Un proveedor/)
    expect(mirarSaldo('57000000', -1)).toMatch(/^La caja en negativo/)
    expect(mirarSaldo('57200001', -1)).toBeNull()
  })
  it('marca la fila y no la quita (regla 7); «Qué mirar» las lista en el orden del listado', () => {
    const a = arbolSumas(filasDeHoy, NOMBRES)
    expect(a.filas.get('c:43000031')!.mirar).toMatch(/cliente/)
    expect(queMirar(a).map((m) => m.id)).toEqual(['c:43000031'])
    expect(camino(a, 'c:43000031')).toEqual(['g:4', 's:43'])
  })
})

describe('Q06 · qué se ve: «Abrir: todo · a 3 cifras · a 1 cifra»', () => {
  const a = arbolSumas(filasDeHoy, NOMBRES)
  it('a 1 cifra, los grupos', () => {
    expect(visibles(a, abrirHasta(a, 1)).map((v) => v.fila.id)).toEqual(['g:4', 'g:5', 'g:6', 'g:7'])
  })
  it('a 3 cifras, hasta las subcuentas', () => {
    const v = visibles(a, abrirHasta(a, 3))
    expect(v.filter((x) => x.fila.clase === 'cuenta')).toHaveLength(9)
  })
  it('todo: también las subcuentas (que piden leer sus movimientos)', () => {
    expect([...abrirHasta(a, 'todo')].filter((id) => id.startsWith('c:'))).toHaveLength(9)
  })
})

const ap = (entryId: string, fecha: string, cuenta: string, debe: number, haber: number, concepto = 'Movimiento de ejemplo', numero = 1) => ({
  entryId, fecha, cuenta, nombreCuenta: `Cuenta ${cuenta}`, debe, haber, localId: null, marcaId: null, comun: false, concepto, serie: 4, numero,
})
const APUNTES = [
  ap('a1', '2026-01-01', '43000012', 100, 0, 'Apertura'),
  ap('a2', '2026-06-03', '43000012', 504.27, 0, 'Factura A-2026/0131', 131),
  ap('a3', '2026-06-10', '43000012', 0, 504.27, 'Cobro por banco', 7),
  ap('a3', '2026-06-10', '57200001', 504.27, 0, 'Cobro por banco', 7),
  ap('a4', '2026-07-01', '43000012', 357.44, 0, 'Factura A-2026/0158', 158),
  ap('a5', '2026-07-02', '43000031', 0, 44, 'Cobro repetido', 9),
]

describe('Q06 · el mayor: el extracto de hoy, cuenta a cuenta', () => {
  it('saldo inicial, movimientos y saldo arrastrado: los de extracto()', () => {
    const a = arbolMayor(APUNTES, '2026-06-01', '2026-07-31', { desde: '43000012', hasta: '43000012' })
    const hoy = extracto(APUNTES.filter((m) => m.cuenta === '43000012'), { desde: '2026-06-01', hasta: '2026-07-31' })
    expect(a.raiz).toEqual(['c:43000012'])
    const cuenta = a.filas.get('c:43000012')!
    expect(cuenta.celdas.slice(3)).toEqual([hoy.debe, hoy.haber, hoy.final, null])
    const hijas = cuenta.hijos.map((id) => a.filas.get(id)!)
    expect(hijas[0]).toMatchObject({ clase: 'inicial', celdas: ['01/06', '', 'Saldo inicial', null, null, 100, null] })
    expect(hijas.slice(1).map((h) => h.celdas[5])).toEqual(hoy.filas.map((m) => m.saldo))
    expect(hijas[1]).toMatchObject({ entryId: 'a2', cuenta: '43000012', celdas: ['03/06', '4/131', 'Factura A-2026/0131', 504.27, null, 604.27, null] })
  })
  it('un saldo acreedor va a su columna (y Sumied lo mira si es de un cliente)', () => {
    const a = arbolMayor(APUNTES, '2026-01-01', '2026-12-31', { desde: '43000031', hasta: '43000031' })
    expect(a.filas.get('c:43000031')).toMatchObject({ celdas: ['43000031', '', 'Cuenta 43000031', 0, 44, null, 44] })
    expect(a.filas.get('c:43000031')!.mirar).toMatch(/cliente/)
  })
  it('el rango «de la cuenta … a la …», el de sumas y saldos de hoy', () => {
    expect(enRango('43000012', '43', '43')).toBe(true)
    expect(enRango('57200001', '43', '47')).toBe(false)
    expect(arbolMayor(APUNTES, '2026-01-01', '2026-12-31', { desde: '', hasta: '' }).raiz).toEqual(['c:43000012', 'c:43000031', 'c:57200001'])
  })
})

describe('Q06 · sumas y saldos: los movimientos de una subcuenta, al abrirla', () => {
  it('cuelgan de su fila con su saldo arrastrado; desde el primer día del ejercicio suman lo de la fila', () => {
    const a = arbolSumas(filasDeHoy, NOMBRES)
    const fila = a.filas.get('c:43000012')!
    const hijas = filasDeMovimientos(fila, APUNTES.filter((m) => m.cuenta === '43000012'), '2026-01-01', '2026-07-31', 'sumas')
    const b = colgar(a, fila.id, hijas)
    expect(b.filas.get(fila.id)!.porLeer).toBe(false)
    expect(b.filas.get(fila.id)!.hijos).toHaveLength(4)
    expect(b.filas.get(hijas[3].id)!.celdas).toEqual(['01/07', 'Factura A-2026/0158', 357.44, null, 457.44, null])
    expect(a.filas.get(fila.id)!.porLeer).toBe(true) // el árbol de antes no cambia
  })
})

describe('Q06 · el diario: el resumido de hoy, mes › cuenta › movimientos', () => {
  const meses = resumir(APUNTES, null)
  const a = arbolDiario(meses, APUNTES)
  it('cada mes con sus asientos y sus cifras de hoy', () => {
    expect(a.raiz).toEqual(meses.map((m) => `mes:${m.mes}`))
    const junio = a.filas.get('mes:2026-06')!
    expect(junio.celdas).toEqual(['Junio 2026 · 2 asientos', '', meses[1].debe, meses[1].haber])
    expect(junio.hijos.map((id) => a.filas.get(id)!.celdas[0])).toEqual(meses[1].filas.map((f) => f.cuenta))
  })
  it('los movimientos de la cuenta en el mes, con su asiento', () => {
    const c = a.filas.get('mes:2026-06:43000012')!
    expect(c.hijos.map((id) => a.filas.get(id)!.entryId)).toEqual(['a2', 'a3'])
  })
  it('el total es la suma de los meses, y cuenta los asientos', () => {
    expect(a.total[2]).toBe(meses.reduce((x, m) => x + Math.round(m.debe * 100), 0) / 100)
    expect(a.cuantas).toBe(meses.reduce((x, m) => x + m.asientos, 0))
  })
})

const anot = (id: string, fecha: string, base: number, cuota: number, extra: Partial<AnotacionLibro> = {}): AnotacionLibro => ({
  id, entryId: `e-${id}`, book: 'issued', invoiceType: 'F1', series: 'A', number: id, numberTo: null, documentsCount: 1, issueDate: fecha, operationDate: null,
  receivedDate: null, receivedNumber: null, partyId: null, counterpartTaxId: 'B00000002', counterpartIdType: null, counterpartCountry: null,
  counterpartName: 'Restaurante Cliente Ejemplo, S.L.', operationKey: '01', qualification: 'S1', exemptCause: null, taxBase: base, taxRate: 10, taxAmount: cuota,
  surchargeRate: null, surchargeAmount: null, total: base + cuota, deductibleAmount: null, deductibleLater: false, reverseCharge: false, investmentGood: false,
  withholdingRate: null, withholdingAmount: null, activityCode: null, activityType: null, activityIae: null, correctsRef: null, sourceType: 'manual', sourceId: null,
  voidedAt: null, deducidaEn: null, deducidaPorque: null, ...extra,
} as AnotacionLibro)

describe('Q06 · el libro de IVA: el de hoy, mes › factura', () => {
  const lista = [anot('0131', '2026-06-03', 458.43, 45.84), anot('0140', '2026-06-17', 673.48, 67.35), anot('0158', '2026-07-01', 333, 24.44),
    anot('0159', '2026-07-02', 100, 10, { voidedAt: '2026-07-03' }), anot('0160', '2026-07-05', 50, 5, { counterpartTaxId: null })]
  const a = arbolIva(lista, 'issued', 142.63)
  it('base y cuota son las de cifrasLibro (sin las anuladas)', () => {
    const hoy = cifrasLibro(lista)
    expect(a.total[4]).toBe(hoy.base)
    expect(a.total[6]).toBe(hoy.cuota)
    expect(a.cuantas).toBe(hoy.anotaciones)
  })
  it('mes › factura, con su asiento (Intro lo abre)', () => {
    expect(a.raiz).toEqual(['mes:2026-06', 'mes:2026-07'])
    expect(a.filas.get('mes:2026-07')!.celdas[0]).toBe('Julio 2026 · 2 facturas')
    expect(a.filas.get('f:0131')).toMatchObject({ entryId: 'e-0131', celdas: ['03/06', 'A-0131', 'B00000002', 'Restaurante Cliente Ejemplo, S.L.', 458.43, 10, 45.84, 504.27] })
  })
  it('lo que le falta para un requerimiento, y el cuadre con el diario, con las frases de hoy', () => {
    expect(a.filas.get('f:0160')!.mirar).toBe('Le falta para un requerimiento: NIF del destinatario.')
    expect(a.cuadra).toBe(true)
    const mal = arbolIva(lista, 'issued', 100)
    expect(mal.cuadra).toBe(false)
    expect(mal.avisos[0]).toMatch(/^No cuadra con el diario/)
  })
})

describe('Q06 · la hoja impresa (maqueta 8)', () => {
  const a = arbolSumas(filasDeHoy, NOMBRES)
  it('sumas y saldos imprime las subcuentas, en su orden', () => {
    expect(lineasDeLaHoja(a, 'sumas').map((l) => l.celdas[0])).toEqual(SALDOS.map((s) => s.code))
  })
  it('«Suma y sigue» acumula Debe y Haber hasta el pie de cada página; la última no lo lleva', () => {
    const p = paginar(lineasDeLaHoja(a, 'sumas'), 4, [2, 3])
    expect(p.map((x) => x.lineas.length)).toEqual([4, 4, 1])
    expect(p[0].sigue).toEqual([610.71 + 1602.54 + 44 + 2310.55, 2213.25 + 504.27 + 88].map((x) => Math.round(x * 100) / 100))
    expect(p[2].sigue).toBeNull()
  })
  it('la cabecera y el pie, como la maqueta', () => {
    const h = hojaDe(a, 'sumas', { empresa: 'Empresa de ejemplo, S.L.', nif: 'B00000001', subtitulo: subtituloHoja('2026-01-01', '2026-07-31', { desde: '', hasta: '' }, 'sumas'), hoy: '2026-11-17' })
    expect(h.titulo).toBe('Balance de sumas y saldos')
    expect(h.cabecera.subtitulo).toBe('Del 01/01/2026 al 31/07/2026 · todas las cuentas')
    expect(textoPagina(h, h.paginas[0])).toBe('Listado del 17/11/2026 · Página 1 de 1')
    expect(textoSigue(h.paginas[0])).toBe('')
    expect(LINEAS_POR_PAGINA('sumas')).toBe(40)
  })
  it('el mayor imprime cada cuenta con su saldo inicial, sus movimientos y su suma', () => {
    const m = arbolMayor(APUNTES, '2026-06-01', '2026-07-31', { desde: '43000012', hasta: '43000012' })
    expect(lineasDeLaHoja(m, 'mayor').map((l) => l.clase)).toEqual(['cabecera', 'suma', 'linea', 'linea', 'linea', 'suma'])
  })
  it('un rango de cuentas, en el subtítulo', () => {
    expect(subtituloHoja('2026-01-01', '2026-03-31', { desde: '430', hasta: '' }, 'mayor')).toBe('Del 01/01/2026 al 31/03/2026 · de la 430 a la última')
  })
})

describe('Q06 · lo de arriba y las direcciones', () => {
  it('«Este año, hasta hoy», el ejercicio y sus trimestres', () => {
    expect(periodosDe('2026-01-01', '2026-12-31', '2026-07-31').map((p) => `${p.nombre}: ${p.desde}–${p.hasta}`)).toEqual([
      'Este año, hasta hoy: 2026-01-01–2026-07-31', 'Todo el ejercicio: 2026-01-01–2026-12-31',
      '1T 2026: 2026-01-01–2026-03-31', '2T 2026: 2026-04-01–2026-06-30', '3T 2026: 2026-07-01–2026-09-30', '4T 2026: 2026-10-01–2026-12-31',
    ])
    expect(periodosDe('2025-01-01', '2025-12-31', '2026-07-31')[0].id).toBe('ejercicio')
  })
  it('un saldo en sus dos columnas', () => {
    expect(deudorAcreedor(10)).toEqual([10, null])
    expect(deudorAcreedor(-10)).toEqual([null, 10])
    expect(deudorAcreedor(0)).toEqual([0, null])
  })
  it('qué acción de Libros es un listado del núcleo; las demás, las de hoy', () => {
    expect(['libro-mayor', 'sumas-saldos', 'diario-resumido', 'expedidas', 'recibidas'].map(queDeLaAccion)).toEqual(['mayor', 'sumas', 'diario', 'emitidas', 'recibidas'])
    expect(queDeLaAccion('balance')).toBeNull()
    expect(queDeLaAccion('intracomunitarias')).toBeNull()
  })
})
