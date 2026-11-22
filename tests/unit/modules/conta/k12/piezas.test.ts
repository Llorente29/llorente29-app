// tests/unit/modules/conta/k12/piezas.test.ts
//
// K12 · Las piezas comunes de ERP10 y el asiento general, sin navegador: la lupa, las líneas que se repiten, el
// teclado, el separador y el descuadre. Las cuentas son las del plan (PGC); los terceros y los importes, inventados.
import { describe, expect, it } from 'vitest'
import {
  ANCHO_MITAD, DOCUMENTO_MINIMO, PARTE_MAQUETA, PLEGADO, cuantasLineas, elegirConIntro, filtrarRegistros, parteDeSalida, parteQueCabe,
  repartoGuardado, seDesplaza, siguienteEscribible, sumaDeControl,
} from '@/modules/conta/nucleo/piezas/logica'
import { aLineas, apunteVacio, lineaVacia, porQueNoSeGraba, problemasDeLaLinea, subirLinea, totalesDe, type ApunteEd } from '@/modules/conta/nucleo/asiento/asientoGeneral'

const cuentas = [
  { id: 'a', codigo: '57200001', descripcion: 'Bancos · Cuenta principal' },
  { id: 'b', codigo: '41000013', descripcion: 'Acreedores · Telefonía de Prueba, S.L.' },
  { id: 'c', codigo: '62800001', descripcion: 'Electricidad' },
  { id: 'd', codigo: '62800000', descripcion: 'Suministros' },
]
const terceros = [
  { id: 't1', codigo: 'B00000001', descripcion: 'Telefonía de Prueba, S.L.', comercial: 'Telefonía Prueba', nif: 'B00000001' },
  { id: 't2', codigo: 'B00000002', descripcion: 'Árbol de Prueba, S.A.', comercial: null, nif: 'B00000002' },
]

describe('la lupa («Localización de registros»)', () => {
  it('sin nada escrito, todos, ordenados por la descripción', () => {
    expect(filtrarRegistros(cuentas, '').map((r) => r.codigo)).toEqual(['41000013', '57200001', '62800001', '62800000'])
  })
  it('por el principio del código, con o sin punto', () => {
    expect(filtrarRegistros(cuentas, '628').map((r) => r.codigo)).toEqual(['62800001', '62800000'])
    expect(filtrarRegistros(cuentas, '5720.0001').map((r) => r.codigo)).toEqual(['57200001'])
  })
  it('por la descripción, el nombre comercial o el N.I.F., sin acentos ni mayúsculas, y cada palabra en cualquier orden', () => {
    expect(filtrarRegistros(terceros, 'arbol').map((r) => r.id)).toEqual(['t2'])
    expect(filtrarRegistros(terceros, 'prueba telefonia').map((r) => r.id)).toEqual(['t1'])
    expect(filtrarRegistros(terceros, 'B00000002').map((r) => r.id)).toEqual(['t2'])
  })
  it('Intro elige si es el código exacto o solo encaja uno; si no, abre la lista', () => {
    expect(elegirConIntro(cuentas, '62800000')).toEqual({ registro: cuentas[3], abrir: false })
    expect(elegirConIntro(cuentas, 'electri').registro?.id).toBe('c')
    expect(elegirConIntro(cuentas, '628')).toEqual({ registro: null, abrir: true })
    expect(elegirConIntro(cuentas, '')).toEqual({ registro: null, abrir: false })
  })
})

describe('las líneas que se repiten', () => {
  it('desde la quinta se desplazan dentro de su bloque', () => {
    expect([1, 4, 5, 9].map(seDesplaza)).toEqual([false, false, true, true])
  })
  it('su número y su suma de control, al céntimo', () => {
    expect(cuantasLineas(1)).toBe('1 línea')
    expect(cuantasLineas(2)).toBe('2 líneas')
    expect(sumaDeControl([{ debe: 0.1, haber: 0 }, { debe: 0.2, haber: 0 }, { debe: 0, haber: 0.3 }])).toEqual({ debe: 0.3, haber: 0.3, descuadre: 0, cuadra: true })
    expect(sumaDeControl([{ debe: 63.6, haber: 0 }, { debe: 0, haber: 63.5 }]).descuadre).toBe(0.1)
    expect(sumaDeControl([]).cuadra).toBe(false)
  })
})

describe('el teclado', () => {
  it('Intro va a la siguiente casilla que se puede escribir, saltando las grises; al final, lo que diga la pantalla', () => {
    const fila = [{ escribible: true }, { escribible: false }, { escribible: false }, { escribible: true }]
    expect(siguienteEscribible(fila, 0)).toBe(3)
    expect(siguienteEscribible(fila, 3)).toBe('fin')
  })
})

describe('el separador', () => {
  it('la parte del documento cabe entre su mínimo y lo que deja el mínimo de la pantalla', () => {
    expect(parteQueCabe(500, 1356, 820)).toBeCloseTo(500 / 1356)
    expect(parteQueCabe(900, 1356, 820)).toBeCloseTo((1356 - 820) / 1356)
    expect(parteQueCabe(100, 1356, 820)).toBeCloseTo(DOCUMENTO_MINIMO / 1356)
  })
  it('al abrir: la guardada; sin ella, la mitad desde 1600 px y, por debajo, la de la maqueta', () => {
    expect(parteDeSalida(0.62, 1366)).toBe(0.62)
    expect(parteDeSalida(null, ANCHO_MITAD)).toBe(0.5)
    expect(parteDeSalida(null, 1366)).toBe(PARTE_MAQUETA)
  })
  it('de la base solo vale una parte entre 0 y 1; 1 es la pantalla plegada con «‹»', () => {
    expect(repartoGuardado('0.62')).toBe(0.62)
    expect(repartoGuardado(PLEGADO)).toBe(1)
    expect([null, undefined, 0, 1.5, 'x', -0.2].map(repartoGuardado)).toEqual([null, null, null, null, null, null])
  })
})

describe('el asiento general', () => {
  const pago = (o: Partial<ApunteEd>): ApunteEd => ({ ...apunteVacio('Pago de la factura de prueba'), ...o })
  const proveedor = pago({ cuentaId: 'b', codigo: '41000013', debe: '63,60' })
  it('una línea sube con su subcuenta y un importe, a un solo lado', () => {
    expect(problemasDeLaLinea(proveedor)).toEqual([])
    expect(problemasDeLaLinea(pago({ debe: '1' }))).toEqual(['la subcuenta'])
    expect(problemasDeLaLinea(pago({ cuentaId: 'a', debe: '1', haber: '1' }))).toEqual(['un importe, al debe o al haber'])
    expect(problemasDeLaLinea(pago({ cuentaId: 'a', debe: 'x' }))).toEqual(['un importe que sea un número'])
  })
  it('al subir, la nueva trae el concepto, el local, la marca y la plataforma, y en su lado lo que falta para cuadrar', () => {
    const r = subirLinea([], { ...proveedor, local: 'l1', marca: 'm1', plataforma: 'p1' }, null)
    expect(r.apuntes).toHaveLength(1)
    expect(r.propuesto).toBe('haber')
    expect(r.nueva).toEqual({ ...apunteVacio('Pago de la factura de prueba'), local: 'l1', marca: 'm1', plataforma: 'p1', haber: '63,60' })
    expect(lineaVacia(r.nueva, r.propuesto)).toBe(true)
    const dos = subirLinea(r.apuntes, { ...r.nueva, cuentaId: 'a', codigo: '57200001' }, null)
    expect(dos.propuesto).toBe(null)
    expect(totalesDe(dos.apuntes)).toEqual({ debe: 63.6, haber: 63.6, descuadre: 0, cuadra: true })
    expect(aLineas(dos.apuntes).map((l) => [l.codigo, l.debe, l.haber, l.plataforma])).toEqual([['41000013', 63.6, 0, 'p1'], ['57200001', 0, 63.6, 'p1']])
  })
  it('cambiar una línea elegida la deja en su sitio', () => {
    const lista = [proveedor, pago({ cuentaId: 'a', codigo: '57200001', haber: '63,60' })]
    const r = subirLinea(lista, { ...lista[1], cuentaId: 'd', codigo: '62800000' }, 1)
    expect(r.apuntes.map((a) => a.codigo)).toEqual(['41000013', '62800000'])
  })
  it('con descuadre no se graba (y no lleva frase: lo dice la casilla en ámbar)', () => {
    const descuadrado = [proveedor, pago({ cuentaId: 'a', codigo: '57200001', haber: '63,50' })]
    expect(porQueNoSeGraba({ fecha: '2026-11-12', concepto: 'Pago' }, descuadrado)).toEqual(['descuadre'])
    expect(totalesDe(descuadrado).descuadre).toBe(0.1)
    const cuadrado = [proveedor, pago({ cuentaId: 'a', codigo: '57200001', haber: '63,60' })]
    expect(porQueNoSeGraba({ fecha: '2026-11-12', concepto: 'Pago' }, cuadrado)).toEqual([])
    expect(porQueNoSeGraba({ fecha: '', concepto: ' ' }, [proveedor])).toEqual(['fecha', 'concepto', 'apuntes', 'descuadre'])
  })
})
