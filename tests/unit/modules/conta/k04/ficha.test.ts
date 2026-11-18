// tests/unit/modules/conta/k04/ficha.test.ts
//
// K04 · Lo que decide la ficha de la recibida del núcleo, sin pantalla: el orden
// de Intro, qué escribe «6001», las fechas como en ERP10, qué franja sale, las
// comprobaciones, la duda de la cuenta de gasto, cuándo cuadra el asiento, el
// nombre de la pestaña, cuándo se enciende «Guardar y siguiente» y de dónde
// sale cada dato.

import { describe, expect, it } from 'vitest'
import { codigoEscrito, cuentasQueEncajan, fechaEscrita, fechaVista, queHaceIntro } from '@/modules/conta/nucleo/ficha/teclas'
import { comprobacionesDe, dudaDelGasto, estadoDeLaFicha, etiquetaDelAsiento, nombreDePestana, periodoAbierto, puedeGuardar, trimestreDe } from '@/modules/conta/nucleo/recibida/estado'
import { origenes, type DatosOrigen } from '@/modules/conta/nucleo/recibida/origen'

describe('K04 · Intro (decisiones 11 y 12)', () => {
  it('dentro de una casilla, pasa a la siguiente', () => {
    expect(queHaceIntro({ orden: 5, actual: 0 })).toEqual({ que: 'siguiente', a: 1 })
    expect(queHaceIntro({ orden: 5, actual: 3 })).toEqual({ que: 'siguiente', a: 4 })
  })
  it('en la última casilla, o fuera de una, «Guardar y siguiente»', () => {
    expect(queHaceIntro({ orden: 5, actual: 4 })).toEqual({ que: 'guardar' })
    expect(queHaceIntro({ orden: 5, actual: -1 })).toEqual({ que: 'guardar' })
  })
  it('sobre un botón o un enlace, Intro es suyo (y en un área de texto, no se toca)', () => {
    expect(queHaceIntro({ orden: 5, actual: -1, sobre: 'boton' })).toBeNull()
    expect(queHaceIntro({ orden: 5, actual: -1, sobre: 'texto' })).toBeNull()
  })
})

describe('K04 · la cuenta, como se escribe en ERP10', () => {
  const plan = [
    { codigo: '60000000', nombre: 'Compras de mercaderías' },
    { codigo: '60000001', nombre: 'Compras de bebidas' },
    { codigo: '60200000', nombre: 'Compras de envases' },
    { codigo: '62800000', nombre: 'Suministros' },
  ]
  it('«6001» da la 60000001, y «600.1» también', () => {
    expect(codigoEscrito('6001', 8)).toBe('60000001')
    expect(codigoEscrito('600.1', 8)).toBe('60000001')
    expect(codigoEscrito('6021', 8)).toBe('60200001')
    expect(codigoEscrito('60000001', 8)).toBe('60000001')
    expect(cuentasQueEncajan('6001', plan, 8)).toEqual([plan[1]])
    expect(cuentasQueEncajan('600.1', plan, 8)).toEqual([plan[1]])
  })
  it('si el código no existe, las que empiezan por esas cifras', () => {
    expect(cuentasQueEncajan('602', plan, 8).map((c) => c.codigo)).toEqual(['60200000'])
    expect(cuentasQueEncajan('6009', plan, 8).map((c) => c.codigo)).toEqual([])
  })
  it('y si no es un número, parte del nombre (sin acentos ni mayúsculas)', () => {
    expect(cuentasQueEncajan('mercaderias', plan, 8)).toEqual([plan[0]])
    expect(cuentasQueEncajan('compras env', plan, 8)).toEqual([plan[2]])
  })
})

describe('K04 · las fechas, como en ERP10', () => {
  it('dd/mm/aaaa, d/m/aa, junta, o sin año (el de hoy)', () => {
    expect(fechaEscrita('01/07/2026', '2026-11-18')).toBe('2026-07-01')
    expect(fechaEscrita('1/7/26', '2026-11-18')).toBe('2026-07-01')
    expect(fechaEscrita('01072026', '2026-11-18')).toBe('2026-07-01')
    expect(fechaEscrita('1-7', '2026-11-18')).toBe('2026-07-01')
    expect(fechaVista('2026-07-01')).toBe('01/07/2026')
  })
  it('lo que no es una fecha que exista, null', () => {
    expect(fechaEscrita('31/02/2026', '2026-11-18')).toBeNull()
    expect(fechaEscrita('mañana', '2026-11-18')).toBeNull()
  })
})

describe('K04 · la franja de la cabecera', () => {
  const bien = (id: string) => ({ id, tono: 'bien' as const, texto: id })
  it('la escrita a mano: «La escribes tú.» en gris', () => {
    expect(estadoDeLaFicha({ aMano: true, leida: false, comprobaciones: [], hayDudaGasto: false }))
      .toEqual({ tono: 'gris', fuerte: 'La escribes tú.', resto: 'Se comprueba mientras escribes.' })
  })
  it('rellenada con una duda: en ámbar, y dice que se mire lo ámbar', () => {
    expect(estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: ['a', 'b', 'c', 'd'].map(bien), hayDudaGasto: true }))
      .toEqual({ tono: 'ambar', fuerte: 'Rellenada por Sumied, con 1 duda.', resto: '4 comprobaciones bien · mira lo ámbar y pulsa Intro.' })
  })
  it('todo bien: nada ámbar, basta Intro', () => {
    const e = estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: ['a', 'b', 'c', 'd'].map(bien), hayDudaGasto: false })
    expect(e.tono).toBe('verde')
    expect(e.resto).toBe('4 comprobaciones bien · pulsa Intro.')
  })
})

describe('K04 · las comprobaciones de la línea', () => {
  const base = {
    aMano: false, duplicada: null, noRepetida: true, fecha: '2026-07-01',
    calendario: { mesesCerrados: [], ejercicios: [{ inicio: '2026-01-01', fin: '2026-12-31', abierto: true }] },
    nifFicha: 'B00000000', nifLeido: 'B00000000', total: 357.44, totalDocumento: 357.44, lectura: [], avisos: [],
  }
  it('las cuatro de la maqueta, con su visto', () => {
    expect(comprobacionesDe(base).map((c) => [c.tono, c.texto])).toEqual([
      ['bien', 'No está repetida'], ['bien', 'El 3T está abierto'], ['bien', 'NIF correcto'], ['bien', 'Bases y cuotas suman el total'],
    ])
  })
  it('lo que falla, en ámbar o en rojo, con su frase', () => {
    const l = comprobacionesDe({ ...base, nifLeido: 'B11111111', totalDocumento: 360.44, avisos: ['Falta el número de la factura: sin él no se valida ni va a Diez.'] })
    expect(l.find((c) => c.id === 'nif')).toMatchObject({ tono: 'rojo' })
    expect(l.find((c) => c.id === 'suma')).toMatchObject({ tono: 'ambar', texto: 'Base + IVA = 357,44, y la factura dice 360,44' })
    expect(l.find((c) => c.id === 'aviso-0')).toMatchObject({ tono: 'ambar', texto: 'Falta el número de la factura: sin él no se valida ni va a Diez' })
  })
  it('repetida: la dice duplicadaDe; si alguien confirmó que no lo es, no', () => {
    const dup = 'Puede estar repetida: la F-1 de este proveedor tiene el mismo número.'
    expect(comprobacionesDe({ ...base, duplicada: dup, noRepetida: false })[0]).toMatchObject({ tono: 'ambar', texto: dup })
    expect(comprobacionesDe({ ...base, duplicada: dup, noRepetida: true })[0]).toMatchObject({ tono: 'bien', texto: 'No está repetida' })
    expect(comprobacionesDe({ ...base, duplicada: null, noRepetida: false })[0]).toMatchObject({ tono: 'bien' })
  })
  it('un mes cerrado: el asiento va al primer día abierto (ámbar, no rojo)', () => {
    expect(periodoAbierto('2026-07-01', { mesesCerrados: ['2026-07'], ejercicios: [] })).toEqual({ abierto: false, texto: 'El mes de la factura está cerrado: el asiento irá al primer día abierto.' })
    expect(trimestreDe('2026-07-01')).toBe('3T de 2026')
  })
})

describe('K04 · la duda de la cuenta de gasto (conta_gasto_aprendido)', () => {
  const reparto = [{ cuenta: '60000000', nombre: 'Compras de mercaderías', facturas: 4 }, { cuenta: '60200000', nombre: 'Compras de envases', facturas: 1 }]
  it('si fueron a varias, las dos salidas: dejar la última o cambiar a la otra', () => {
    const d = dudaDelGasto({ reparto, confianza: 'probable', cuentaAhora: '60000000', decidida: false })
    expect(d?.texto).toBe('Sus 5 facturas anteriores fueron 4 a la 60000000 (la última) y 1 a la 60200000.')
    expect([d?.dejar.cuenta, d?.cambiar.cuenta]).toEqual(['60000000', '60200000'])
  })
  it('«Dejar» es la cuenta que tiene ahora, aunque no sea la de la última', () => {
    const d = dudaDelGasto({ reparto, confianza: 'probable', cuentaAhora: '60200000', decidida: false })
    expect([d?.dejar.cuenta, d?.cambiar.cuenta]).toEqual(['60200000', '60000000'])
  })
  it('sin duda: si fueron todas a una, si ya se ha decidido, o si la cuenta es otra', () => {
    expect(dudaDelGasto({ reparto: reparto.slice(0, 1), confianza: 'seguro', cuentaAhora: '60000000', decidida: false })).toBeNull()
    expect(dudaDelGasto({ reparto, confianza: 'probable', cuentaAhora: '60000000', decidida: true })).toBeNull()
    expect(dudaDelGasto({ reparto, confianza: 'probable', cuentaAhora: '62800000', decidida: false })).toBeNull()
  })
})

describe('K04 · el asiento que sale', () => {
  it('cuadra: «Cuadra · 357,44» en verde', () => {
    expect(etiquetaDelAsiento({ debe: 357.44, haber: 357.44, cuadra: true, faltan: [], lineas: 4 })).toEqual({ texto: 'Cuadra · 357,44', tono: 'bien' })
  })
  it('sin escribir: «Se forma al escribir»', () => {
    expect(etiquetaDelAsiento({ debe: 0, haber: 0, cuadra: false, faltan: [], lineas: 0 })).toEqual({ texto: 'Se forma al escribir', tono: 'vacio' })
  })
  it('le falta una cuenta o no cuadra: en ámbar, diciendo qué', () => {
    expect(etiquetaDelAsiento({ debe: 100, haber: 100, cuadra: true, faltan: ['la cuenta de gasto'], lineas: 3 })).toEqual({ texto: 'Falta la cuenta de gasto', tono: 'ambar' })
    expect(etiquetaDelAsiento({ debe: 110, haber: 100, cuadra: false, faltan: [], lineas: 3 })).toEqual({ texto: 'Sobran 10,00 en el debe', tono: 'ambar' })
  })
})

describe('K04 · la pestaña y «Guardar y siguiente»', () => {
  it('«Factura recibida · <proveedor>»; sin proveedor, «nueva»', () => {
    expect(nombreDePestana('Distribuciones Ejemplo, S.L.')).toBe('Factura recibida · Distribuciones Ejemplo, S.L.')
    expect(nombreDePestana(null)).toBe('Factura recibida · nueva')
  })
  it('se enciende siempre que quede algo por hacer; se apaga guardando, y en una validada o descartada', () => {
    expect(puedeGuardar({ guardando: false, validada: false, descartada: false })).toBe(true)
    expect(puedeGuardar({ guardando: true, validada: false, descartada: false })).toBe(false)
    expect(puedeGuardar({ guardando: false, validada: true, descartada: false })).toBe(false)
    expect(puedeGuardar({ guardando: false, validada: false, descartada: true })).toBe(false)
  })
})

describe('K04 · de dónde sale cada dato (solo lo que la base sabe)', () => {
  const d: DatosOrigen = {
    leido: { nif: 'B00000000', numero: 'F-2026/0412', fecha: '2026-07-01' }, deRecepcion: false,
    proveedor: { id: 'p1', nif: 'B00000000', regimen: 'general' }, proveedorCambiado: false, numero: 'F-2026/0412', fecha: '2026-07-01', conceptoPropuesto: true,
  }
  it('leída y emparejada por su NIF: todo con su origen', () => {
    expect(origenes(d)).toEqual({ proveedor: 'por NIF', nif: 'PDF', nombre: 'de su ficha', tipoOperacion: 'de su ficha', numero: 'PDF', fecha: 'PDF', concepto: 'Sumied' })
  })
  it('lo cambiado a mano ya no es del PDF; la de una recepción no es «por NIF»', () => {
    const o = origenes({ ...d, numero: 'F-2026/0413', fecha: '2026-07-02', proveedorCambiado: true })
    expect(o.numero).toBeUndefined()
    expect(o.fecha).toBeUndefined()
    expect(o.proveedor).toBeUndefined()
    expect(origenes({ ...d, deRecepcion: true }).proveedor).toBeUndefined()
  })
  it('sin lectura (escrita a mano), nada del PDF', () => {
    const o = origenes({ ...d, leido: null, conceptoPropuesto: false })
    expect(o).toEqual({ nombre: 'de su ficha', tipoOperacion: 'de su ficha' })
  })
})
