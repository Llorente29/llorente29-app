// tests/conta/n04/traerErp10.test.ts
//
// N04 · Traer de ERP10: reconocer y leer sus ficheros, contra el ejemplo inventado
// (tests/conta/fixtures/importar/erp10: ocho Excel con la forma exacta de los de ERP10 y
// un LEEME con lo que tiene que salir). Cada cifra del LEEME, una a una; lo que tiene que
// cuadrar entre ficheros, todo; y las variantes, hechas aquí tocando celdas del ejemplo.

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { abrirExcel, leerCarga, NoEsExcel, reconocer, type Celda, type FicheroExcel } from '@/modules/conta/lib/traer'

const D = 'tests/conta/fixtures/importar/erp10'
const EJEMPLO: readonly FicheroExcel[] = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort().map((f) => abrirExcel(f, readFileSync(`${D}/${f}`)))
const copia = (): FicheroExcel[] => structuredClone(EJEMPLO) as FicheroExcel[]
const fichero = (fs: FicheroExcel[], nombre: string) => fs.find((f) => f.nombre === nombre)!
/** La celda de la fila (1, como en Excel) y la columna (A = 0) de la primera hoja. */
const poner = (f: FicheroExcel, fila: number, col: number, c: Celda) => { f.hojas[0].filas[fila - 1][col] = c }
const s = (v: string): Celda => ({ t: 's', v })
const n = (v: number): Celda => ({ t: 'n', v })
const carga = leerCarga(EJEMPLO)

describe('N04 · lo que tiene que salir al leer cada fichero (LEEME)', () => {
  it('plan de cuentas: 16 subcuentas de 8 cifras', () => {
    expect(carga.plan!.subcuentas).toHaveLength(16)
    expect(carga.plan!.subcuentas.every((x) => /^\d{8}$/.test(x.codigo))).toBe(true)
    expect(carga.plan!.subcuentas[0]).toEqual({ codigo: '10000000', nombre: 'Capital social' })
  })
  it('proveedores: 4 filas, 3 con NIF y 1 sin NIF (la 40000000, genérica)', () => {
    const t = carga.proveedores!.terceros
    expect(t).toHaveLength(4)
    expect(t.filter((x) => x.nif).length).toBe(3)
    expect(t.find((x) => !x.nif)?.codigo).toBe('40000000')
  })
  it('clientes: 1 fila, con NIF', () => {
    expect(carga.clientes!.terceros).toEqual([expect.objectContaining({ codigo: '43000001', nif: 'B12345678' })])
  })
  it('inmovilizado: 1 elemento (21600000, 1.200,00; amortizado 30,00; valor contable 1.170,00) y la fila de totales, que no es un elemento', () => {
    const i = carga.inmovilizado!
    expect(i.elementos).toHaveLength(1)
    expect(i.elementos[0]).toMatchObject({ subcuenta: '21600000', precio: 120000, amortizado: 3000, valorContable: 117000, compra: '2026-01-05' })
    expect(i.totales).toEqual({ precio: 120000, amortizado: 3000, valorContable: 117000, amortizacionFiscal: 3000 })
    expect(i.aFecha).toBe('2026-03-31')
  })
  it('diario: 10 asientos, 26 apuntes; debe 11.499,00 = haber 11.499,00; se agrupan por serie, documento y fecha', () => {
    const d = carga.diario!
    expect([d.asientos.length, d.apuntes, d.debe, d.haber]).toEqual([10, 26, 1149900, 1149900])
    expect(d.ejercicio).toBe('2026')
    expect(d.serieComoNumero).toBe(false)
    expect(d.asientos.map((a) => a.clave)).toEqual(['3.1', '3.2', '1.1', '2.1', '3.3', '2.2', '1.2', '3.4', '2.3', '3.5'])
    expect(d.asientos.every((a) => a.debe === a.haber)).toBe(true)
  })
  it('series: 1, expedidas (1.1 y 1.2); 2, recibidas (2.1, 2.2 y 2.3); 3, el resto', () => {
    const por = (s: string) => carga.diario!.asientos.filter((a) => a.serie === s).map((a) => a.clave)
    expect([por('1'), por('2'), por('3')]).toEqual([['1.1', '1.2'], ['2.1', '2.2', '2.3'], ['3.1', '3.2', '3.3', '3.4', '3.5']])
  })
  it('sumas y saldos: 15 subcuentas y «TOTALES:» 11.499,00 · 11.499,00 · 8.231,00 · 8.231,00; el importe con coma flotante, redondeado', () => {
    const s = carga.sumas!
    expect(s.filas).toHaveLength(15)
    expect(s.totales).toEqual({ debe: 1149900, haber: 1149900, deudor: 823100, acreedor: 823100 })
    expect(s.filas.find((x) => x.subcuenta === '21600000')!.debe).toBe(120000)
    expect(s.avisos).toEqual([])
  })
  it('recibidas: 3 facturas en 4 filas (la B-7 con dos tipos); bases 1.700,00; cuotas 335,00; una retención del 19 % (190,00)', () => {
    const r = carga.recibidas!
    expect([r.facturas.length, r.filas]).toEqual([3, 4])
    const b7 = r.facturas.find((f) => f.numero === 'B-7')!
    expect(b7.tramos.map((t) => [t.base, t.tipo, t.cuota])).toEqual([[10000, 21, 2100], [20000, 10, 2000]])
    expect(b7.total).toBe(34100)   // el «Total Factura» viene repartido por fila: 121,00 + 220,00
    expect(r.facturas.reduce((s, f) => s + f.base, 0)).toBe(170000)
    expect(r.facturas.reduce((s, f) => s + f.cuota, 0)).toBe(33500)
    expect(r.facturas.filter((f) => f.retencion)).toEqual([expect.objectContaining({ numero: 'ALQ-3', retencion: { tipo: 19, importe: 19000 } })])
  })
  it('expedidas: 2 facturas; bases 1.500,00; cuotas 150,00', () => {
    const e = carga.expedidas!
    expect(e.facturas.map((f) => f.numero)).toEqual(['F-1', 'F-2'])
    expect(e.facturas.reduce((s, f) => s + f.base, 0)).toBe(150000)
    expect(e.facturas.reduce((s, f) => s + f.cuota, 0)).toBe(15000)
  })
  it('lo que trae cada uno, como se lee en la pantalla', () => {
    expect(carga.ficheros.map((f) => [f.que, f.haLeido, f.estado])).toEqual([
      ['Proveedores', '4 fichas', 'mira'],   // la 40000000, sin NIF
      ['Clientes', '1 ficha', 'leido'],
      ['Inmovilizado', '1 elemento', 'leido'],
      ['Plan de cuentas', '16 cuentas', 'leido'],
      ['Diario', '10 asientos · 26 apuntes', 'leido'],
      ['Facturas emitidas', '2 facturas', 'leido'],
      ['Facturas recibidas', '3 facturas', 'leido'],
      ['Sumas y saldos', '15 cuentas', 'leido'],
    ])
    expect(carga.comprobado.frases).toEqual(['40000000 · Proveedores varios: no trae NIF.'])
  })
})

describe('N04 · lo que tiene que cuadrar entre ficheros (LEEME), todo', () => {
  it('el diario, sumado por subcuenta, da el sumas y saldos, cuenta a cuenta', () => {
    expect(carga.comprobado.sumas).toHaveLength(15)
    expect(carga.comprobado.sumas!.every((c) => c.cuadra)).toBe(true)
  })
  it('la 472 del diario (335,00) es la cuota de las recibidas; la 477 (150,00), la de las emitidas', () => {
    expect(carga.comprobado.iva.map((x) => [x.libro, x.trimestre, x.diario, x.libroCuotas, x.cuadra])).toEqual([
      ['recibidas', '1T 2026', 33500, 33500, true], ['expedidas', '1T 2026', 15000, 15000, true],
    ])
  })
  it('cada factura del libro casa con su asiento por fecha, NIF y cuota; ningún asiento con IVA se queda sin factura', () => {
    const f = carga.comprobado.facturas!
    expect(f.casadas.map((x) => `${x.factura.numero}→${x.asiento.clave}`)).toEqual(['A-10→2.1', 'B-7→2.2', 'ALQ-3→2.3', 'F-1→1.1', 'F-2→1.2'])
    expect(f.sinCasar).toEqual([])
    expect(f.asientosConIvaSinFactura).toEqual([])
  })
  it('saldos al 31/03: 43000001 debe 550,00 (la F-2); 40000001 a cero; 40000002, 341,00 (la B-7); 41000001, 1.020,00 (la ALQ-3)', () => {
    const p = new Map(carga.aprendido.pendientes.map((x) => [x.codigo, x]))
    expect([p.get('43000001')!.saldo, p.get('43000001')!.facturas.map((x) => x.numero)]).toEqual([55000, ['F-2']])
    expect(p.get('40000001')!.saldo).toBe(0)
    expect([p.get('40000002')!.saldo, p.get('40000002')!.facturas.map((x) => x.numero)]).toEqual([34100, ['B-7']])
    expect([p.get('41000001')!.saldo, p.get('41000001')!.facturas]).toEqual([102000, [{ numero: 'ALQ-3', fecha: '2026-03-01', pendiente: 102000 }]])
    expect([...p.values()].every((x) => x.cuadraExacto)).toBe(true)
    expect(p.get('43000001')!.frase).toBe('43000001 · Cliente Ejemplo Uno, S.L.: nos debe 550,00, de la factura F-2.')
  })
  it('la 40000000 está en el plan y en los proveedores, sin NIF y sin movimientos', () => {
    expect(carga.plan!.subcuentas.some((x) => x.codigo === '40000000')).toBe(true)
    expect(carga.comprobado.tercerosRaros).toEqual([expect.objectContaining({ que: 'sin_nif', cuentas: ['40000000'] })])
    expect(carga.aprendido.pendientes.find((x) => x.codigo === '40000000')!.frase).toBe('40000000 · Proveedores varios: sin movimientos en el diario.')
  })
  it('las subcuentas, de 8 cifras en todos; ninguna del diario fuera del plan ni ningún tercero fuera de los listados', () => {
    expect(carga.comprobado.largos).toEqual({ largos: [8], frase: null })
    expect(carga.comprobado.fueraDelPlan).toEqual([])
    expect(carga.comprobado.tercerosFueraDeListados).toEqual([])
  })
  it('lo que Sumied aprende de cada proveedor: su cuenta de gasto, sus tipos de IVA y su retención', () => {
    expect(carga.aprendido.proveedores.map((a) => [a.codigo, a.gasto?.cuenta, a.tiposIva, a.retencion])).toEqual([
      ['40000001', '60000000', [21], null], ['40000002', '60000000', [10, 21], null], ['41000001', '62100000', [21], 19],
    ])
  })
})

describe('N04 · reconocer por lo que llevan dentro', () => {
  it('los ocho, con los nombres cambiados y en cualquier orden', () => {
    const fs = copia().reverse().map((f, i) => ({ ...f, nombre: `export_${i}.xlsx` }))
    const c = leerCarga(fs)
    expect(c.ficheros.every((f) => f.estado !== 'falta')).toBe(true)
    expect(c.avisos).toEqual([])
    expect(c.diario!.apuntes).toBe(26)
    for (const f of fs) expect(reconocer(f)).not.toBeNull()
  })
  it('falta uno: no es un error, se dice cuáles hay', () => {
    const c = leerCarga(copia().filter((f) => f.nombre !== 'sumas_y_saldos.xlsx'))
    expect(c.ficheros.find((f) => f.tipo === 'sumas_saldos')).toMatchObject({ estado: 'falta', fichero: null })
    expect(c.ficheros.filter((f) => f.estado !== 'falta')).toHaveLength(7)
    expect(c.avisos).toEqual([])
    expect(c.comprobado.sumas).toBeNull()
  })
  it('sobra uno: dos del mismo tipo se dicen, y se queda el primero', () => {
    const fs = copia()
    const otro = { ...structuredClone(fichero(fs, 'diario.xlsx')), nombre: 'diario (1).xlsx' }
    const c = leerCarga([...fs, otro])
    expect(c.avisos).toEqual(['Hay dos ficheros de diario: «diario.xlsx» y «diario (1).xlsx». Me quedo con el primero; quita el que sobra.'])
  })
  it('uno ajeno, y uno que no es un Excel', () => {
    const ajeno: FicheroExcel = { nombre: 'lista de la compra.xlsx', hojas: [{ nombre: 'Hoja1', filas: [[s('Tomates'), n(3)], [s('Pan'), n(1)]] }] }
    const c = leerCarga([...copia(), ajeno, { nombre: 'foto.jpg', noSeAbre: 'no es una hoja de cálculo.' }])
    expect(c.avisos[0]).toMatch(/^No reconozco «lista de la compra\.xlsx»: no es ninguno de los listados de ERP10 que sé leer/)
    expect(c.avisos[1]).toBe('«foto.jpg» no es un Excel que se pueda abrir: no es una hoja de cálculo.')
    expect(() => abrirExcel('foto.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toThrow(NoEsExcel)
  })
})

describe('N04 · variantes del ejemplo', () => {
  it('la «Serie» del diario como número: avisa (2.1 y 2.10 ya no se distinguen)', () => {
    const fs = copia()
    const d = fichero(fs, 'diario.xlsx')
    for (let fila = 8; fila <= 33; fila++) poner(d, fila, 0, n(Number((d.hojas[0].filas[fila - 1][0] as { v: string }).v)))
    const c = leerCarga(fs)
    expect(c.diario!.serieComoNumero).toBe(true)
    expect(c.ficheros.find((f) => f.tipo === 'diario')!.avisos[0]).toMatch(/la «Serie» ha llegado como número, no como texto: «2\.1» y «2\.10» ya no se distinguen/)
  })
  it('un asiento descuadrado: se dice, con su serie y su documento', () => {
    const fs = copia()
    poner(fichero(fs, 'diario.xlsx'), 17, 8, n(483))   // la A-10: 484,00 al debe y 483,00 al haber
    const c = leerCarga(fs)
    expect(c.ficheros.find((f) => f.tipo === 'diario')!.avisos).toContain('El asiento 2.1 del 20/01/2026 no cuadra: 484,00 al debe y 483,00 al haber (1,00 de diferencia).')
  })
  it('una cuenta del diario que no está en el plan', () => {
    const fs = copia()
    poner(fichero(fs, 'diario.xlsx'), 32, 4, s('69900000'))
    const c = leerCarga(fs)
    expect(c.comprobado.fueraDelPlan).toEqual(['69900000'])
    expect(c.comprobado.frases).toContain('La cuenta 69900000 (Amortización del inmovilizado material) tiene apuntes en el diario y no está en el plan de cuentas.')
  })
  it('un sumas y saldos con una cuenta distinta en 82,10: lo dice, con las dos cifras', () => {
    const fs = copia()
    poner(fichero(fs, 'sumas_y_saldos.xlsx'), 12, 4, n(937.9))   // 41000001: 1.020,00 en el diario
    const c = leerCarga(fs)
    const x = c.comprobado.sumas!.find((k) => k.subcuenta === '41000001')!
    expect(x.cuadra).toBe(false)
    expect(x.frase).toBe('La cuenta 41000001 tiene 1.020,00 en el diario y 937,90 en el sumas y saldos, al haber: 82,10 de diferencia.')
    expect(c.comprobado.sumas!.filter((k) => !k.cuadra)).toHaveLength(1)
  })
  it('un título de columna con un espacio de más: se lee igual', () => {
    const fs = copia()
    const d = fichero(fs, 'diario.xlsx')
    poner(d, 6, 4, s('Subcuenta '))
    poner(d, 6, 7, s('  Debe'))
    const r = fichero(fs, 'libro_recibidas.xlsx')
    poner(r, 1, 28, s('Cuota IVA  Soportado'))
    const c = leerCarga(fs)
    expect([c.diario!.apuntes, c.diario!.debe]).toEqual([26, 1149900])
    expect(c.recibidas!.facturas.reduce((s, f) => s + f.cuota, 0)).toBe(33500)
    expect(c.comprobado.frases).toEqual(['40000000 · Proveedores varios: no trae NIF.'])
  })
})
