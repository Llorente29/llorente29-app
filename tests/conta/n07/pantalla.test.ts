// tests/conta/n07/pantalla.test.ts
//
// N07 · Lo que decide la pantalla «Traer de ERP10», con el ejemplo inventado de ERP10
// (tests/conta/fixtures/importar/erp10): qué fila es cada fichero, el estado de cada una, qué
// avisos salen y cuándo se enciende cada botón. Y el camino de solo cuentas y proveedores.

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  abrirExcel, avisosPaso1, avisosPaso2, comprobacionesPaso1, filasPaso1, filasPaso2, filasPaso3, leerCarga, paraLaBase, puedeTraer,
  puedeVerLoQueEntra, soloCuentas, soltadosQueNoSeTraen, queSeTrajoSoloCuentas, conLoDeLaTabla, lineaDadoPorBueno, lineaDeshecho, type FicheroExcel,
} from '@/modules/conta/lib/traer'

const D = 'tests/conta/fixtures/importar/erp10'
const TODOS: readonly FicheroExcel[] = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort().map((f) => abrirExcel(f, readFileSync(`${D}/${f}`)))
const de = (...nombres: string[]) => TODOS.filter((f) => nombres.includes(f.nombre))
const entero = leerCarga(TODOS)
const soloPlan = leerCarga(de('plan_de_cuentas.xlsx', 'proveedores.xlsx', 'clientes.xlsx'))
const NADA = { cuentas: new Set<string>(), nifsProveedores: new Set<string>(), nifsClientes: new Set<string>() }

describe('N07 · paso 1: qué fila es cada fichero y cómo está', () => {
  it('el ejemplo entero: las siete filas que se traen, en el orden de la maqueta, leídas', () => {
    const f = filasPaso1(entero, 'nueva')
    expect(f.map((x) => [x.que, x.fichero, x.haLeido, x.estado, x.nota])).toEqual([
      ['Proveedores', 'proveedores.xlsx', '4 fichas', 'mira', '1 sin NIF'],
      ['Clientes', 'clientes.xlsx', '1 ficha', 'leido', 'Todos con NIF'],
      ['Plan de cuentas', 'plan_de_cuentas.xlsx', '16 cuentas', 'leido', 'De 8 cifras'],
      ['Diario', 'diario.xlsx', '10 asientos · 26 apuntes', 'leido', 'Todos cuadran'],
      ['Facturas emitidas', 'libro_expedidas.xlsx', '2 facturas', 'leido', 'Con su asiento'],
      ['Facturas recibidas', 'libro_recibidas.xlsx', '3 facturas', 'leido', 'Con su asiento'],
      ['Sumas y saldos', 'sumas_y_saldos.xlsx', '15 cuentas', 'leido', 'Cuadra con el diario'],
    ])
  })
  it('«Poner al día un ejercicio» no lleva las fichas de terceros', () => {
    expect(filasPaso1(entero, 'ejercicio').map((x) => x.tipo)).toEqual(['plan_cuentas', 'diario', 'expedidas', 'recibidas', 'sumas_saldos'])
  })
  it('el inmovilizado soltado no se pinta como si se trajera: se dice aparte', () => {
    expect(soltadosQueNoSeTraen(entero, 'nueva')).toEqual(['inmovilizado.xlsx (inmovilizado)'])
  })
  it('solo cuentas y proveedores: lo que no se ha subido sale «Falta» y no impide seguir', () => {
    const f = filasPaso1(soloPlan, 'nueva')
    expect(f.filter((x) => x.estado === 'falta').map((x) => [x.que, x.nota])).toEqual([
      ['Diario', 'Sin él, solo las cuentas y las fichas'], ['Facturas emitidas', 'No entran facturas'], ['Facturas recibidas', 'No entran facturas'],
      ['Sumas y saldos', 'Para comprobar al final'],
    ])
    expect(soloCuentas(soloPlan)).toBe(true)
    expect(soloCuentas(entero)).toBe(false)
    expect(puedeVerLoQueEntra(soloPlan, 'nueva')).toEqual({ puede: true, porque: null })
  })
})

describe('N07 · paso 1: avisos, comprobaciones y el botón', () => {
  it('el ejemplo entero: el proveedor sin NIF, y las comprobaciones que se pueden afirmar', () => {
    expect(avisosPaso1(entero, 'nueva').map((a) => [a.tono, a.titulo])).toEqual([['ambar', '40000000 · Proveedores varios: no trae NIF.']])
    expect(comprobacionesPaso1(entero)).toEqual({
      verdes: ['Todos los asientos cuadran', 'Cada factura encuentra su asiento', 'El diario da el sumas y saldos, cuenta a cuenta', 'El IVA del diario es el de los libros'],
      gris: 'El IVA de cada trimestre: sin los 303 no se puede comprobar con lo presentado',
    })
  })
  it('sin el sumas y saldos: la nota en blanco del paso 3', () => {
    const sin = leerCarga(TODOS.filter((f) => f.nombre !== 'sumas_y_saldos.xlsx'))
    expect(avisosPaso1(sin, 'nueva').find((a) => a.id === 'sin-sumas')).toMatchObject({ tono: 'nota', titulo: 'Falta el sumas y saldos.' })
  })
  it('solo cuentas: la nota de que lo de antes se trae después, y sin comprobaciones del diario', () => {
    expect(avisosPaso1(soloPlan, 'nueva').map((a) => a.id)).toEqual(['proveedores', 'solo-cuentas'])
    expect(comprobacionesPaso1(soloPlan)).toEqual({ verdes: [], gris: null })
  })
  it('«Ver lo que entra»: apagado sin nada leído, y para poner al día un ejercicio hace falta el diario', () => {
    expect(puedeVerLoQueEntra(leerCarga([]), 'nueva').puede).toBe(false)
    expect(puedeVerLoQueEntra(soloPlan, 'ejercicio')).toEqual({ puede: false, porque: 'Para poner al día un ejercicio hace falta su diario.' })
    expect(puedeVerLoQueEntra(entero, 'ejercicio').puede).toBe(true)
  })
})

describe('N07 · paso 2: lo que entra', () => {
  it('el ejemplo entero en una empresa vacía: cuentas, fichas, asientos, facturas y lo pendiente (céntimos)', () => {
    const { filas, fuera } = filasPaso2(paraLaBase(entero), NADA, null, null)
    expect(filas.map((f) => [f.que, f.cuantos, f.importe, f.como])).toEqual([
      ['Cuentas', '16 nuevas', null, 'Con sus números de ERP10'],
      ['Proveedores', '4', null, 'Cada uno con su NIF y su cuenta. 1 sin NIF'],
      ['Clientes', '1', null, 'Cada uno con su NIF y su cuenta'],
      ['Asientos', '10', 1149900, 'Debe igual a haber, con su número de ERP10'],
      ['Facturas emitidas', '2', 165000, 'Como facturas, cada una con su asiento'],
      ['Facturas recibidas', '3', 203500, 'Como facturas, cada una con su asiento'],
      ['Por pagar y por cobrar', '3 facturas', 191100, 'Lo propone Sumied con el saldo de cada uno.'],
    ])
    expect(fuera).toEqual({ asientos: 0, facturas: 0 })
  })
  it('con lo que ya está en Sumied: «Las otras N ya estaban», y lo que se completa', () => {
    const ya = { cuentas: new Set(['60000000', '47200000', '57200001']), nifsProveedores: new Set(['B00000000']), nifsClientes: new Set<string>() }
    const f = filasPaso2(paraLaBase(soloPlan), ya, null, null).filas
    expect(f.map((x) => [x.que, x.cuantos, x.como])).toEqual([
      ['Cuentas', '13 nuevas', 'Las otras 3 ya estaban en Sumied'],
      ['Proveedores', '4', '1 ya estaba en Sumied: se completa. 1 sin NIF'],
      ['Clientes', '1', 'Cada uno con su NIF y su cuenta'],
    ])
  })
  it('con día de inicio: lo de ese día en adelante se queda fuera, y se dice', () => {
    const d = paraLaBase(entero)
    const { filas, fuera } = filasPaso2(d, NADA, null, '2026-02-01')
    expect(filas.find((f) => f.id === 'asientos')?.cuantos).toBe('5')
    expect(fuera).toEqual({ asientos: 5, facturas: 3 })
    expect(avisosPaso2(d, null, fuera, '2026-02-01').map((a) => a.titulo)).toContain('Del 01/02/2026 en adelante lo lleva ya Sumied.')
  })
  it('asientos ya apuntados en el periodo: el aviso, y «Traerlo» apagado', () => {
    const d = paraLaBase(entero)
    const { filas, fuera } = filasPaso2(d, NADA, null, null)
    const aMano = { n: 2, desde: '2026-01-10', hasta: '2026-02-03' }
    expect(avisosPaso2(d, aMano, fuera, null)[0]).toMatchObject({ tono: 'ambar', titulo: 'En Sumied ya hay 2 asientos apuntados entre el 10/01/2026 y el 03/02/2026.' })
    expect(puedeTraer(filas, aMano)).toBe(false)
    expect(puedeTraer(filas, { n: 0 })).toBe(true)
  })
})

describe('N07 · paso 3: cuenta a cuenta', () => {
  const sumas = paraLaBase(entero).sumas
  it('cuadra: ninguna distinta, todas iguales, total con sus cifras', () => {
    const r = filasPaso3(sumas, [])
    expect(r.distintas).toEqual([])
    expect(r.iguales).toHaveLength(15)
    expect(r.iguales[0]).toEqual({ cuenta: '10000000', nombre: 'Capital social', erp10: -5000, sumied: -5000, diferencia: 0 })
    expect(r.total.diferencia).toBe(0)
  })
  it('no cuadra en la 57200001: va primero, con lo de allí, lo traído y la diferencia', () => {
    const r = filasPaso3(sumas, [{ cuenta: '57200001', nombre: 'Banco de ejemplo', alli_debe: 6110, alli_haber: 1684, traido_debe: 6100, traido_haber: 1684 }])
    expect(r.distintas).toEqual([{ cuenta: '57200001', nombre: 'Banco de ejemplo', erp10: 4426, sumied: 4416, diferencia: -10 }])
    expect(r.iguales).toHaveLength(14)
    expect(r.total.diferencia).toBe(-10)
  })
})

describe('N07 · solo cuentas: la frase dice lo mismo que la tabla', () => {
  const base = 'He traído 16 cuentas, 4 proveedores y 1 cliente. Lo de antes sigue sin traer.'
  it('todas ya estaban, algunas nuevas, todas nuevas', () => {
    expect(queSeTrajoSoloCuentas({ cuentas_nuevas: 0, cuentas_estaban: 16 }, base)).toBe('0 cuentas nuevas (las 16 ya estaban), 4 proveedores y 1 cliente')
    expect(queSeTrajoSoloCuentas({ cuentas_nuevas: 13, cuentas_estaban: 3 }, base)).toBe('13 cuentas nuevas (las otras 3 ya estaban), 4 proveedores y 1 cliente')
    expect(queSeTrajoSoloCuentas({ cuentas_nuevas: 16, cuentas_estaban: 0 }, base)).toBe('16 cuentas nuevas, 4 proveedores y 1 cliente')
    expect(queSeTrajoSoloCuentas({ cuentas_nuevas: 1, cuentas_estaban: 1 }, 'He traído 2 cuentas y 1 proveedor. Lo de antes sigue sin traer.')).toBe('1 cuenta nueva (la otra ya estaba), 1 proveedor')
  })
  it('en las frases de la base: al traer, antes de darlo por bueno y al darlo por bueno', () => {
    const que = '0 cuentas nuevas (las 16 ya estaban), 4 proveedores y 1 cliente'
    expect(conLoDeLaTabla(base, que)).toBe('He traído 0 cuentas nuevas (las 16 ya estaban), 4 proveedores y 1 cliente. Lo de antes sigue sin traer.')
    expect(conLoDeLaTabla('Vas a dar por bueno lo traído de ERP10: 16 cuentas, 4 proveedores y 1 cliente. Después ya no se podrá deshacer.', que))
      .toBe('Vas a dar por bueno lo traído de ERP10: 0 cuentas nuevas (las 16 ya estaban), 4 proveedores y 1 cliente. Después ya no se podrá deshacer.')
    expect(conLoDeLaTabla('Hecho. Lo traído de ERP10 ya es parte de tu contabilidad: 16 cuentas, 4 proveedores y 1 cliente. 1 factura que había entrado sin proveedor ya lo tiene.', que))
      .toBe('Hecho. Lo traído de ERP10 ya es parte de tu contabilidad: 0 cuentas nuevas (las 16 ya estaban), 4 proveedores y 1 cliente. 1 factura que había entrado sin proveedor ya lo tiene.')
  })
})

describe('N07 · las confirmaciones de «Darlo por bueno» y «Deshacer», leídas de la base', () => {
  const el = new Date('2026-11-18T17:40:00Z')
  it('darlo por bueno: quién, cuándo y el texto que guardó la base, sin su «Hecho.»', () => {
    expect(lineaDadoPorBueno('Admin Norte', el, 'Hecho. 10 asientos de antes del 01/04/2026 ya están en tu contabilidad, y 3 facturas pendientes han pasado: 2 a Pagos y 1 a Cobros.'))
      .toBe('Dado por bueno el 18/11 a las 18:40 por Admin Norte. 10 asientos de antes del 01/04/2026 ya están en tu contabilidad, y 3 facturas pendientes han pasado: 2 a Pagos y 1 a Cobros.')
  })
  it('deshacer: lo que se quitó, sin decir «carga»', () => {
    const t = lineaDeshecho('Admin Norte', el, { asientos: 10, recibidas: 3, emitidas: 0, cuentas: 0, proveedores: 4, clientes: 1 })
    expect(t).toBe('Deshecho el 18/11 a las 18:40 por Admin Norte: se ha quitado todo lo traído (10 asientos, 3 facturas, 0 cuentas, 4 proveedores y 1 cliente). La empresa queda como estaba antes de traerlo.')
    expect(t).not.toMatch(/carga/)
  })
})
