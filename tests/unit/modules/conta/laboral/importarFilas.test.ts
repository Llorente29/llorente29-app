// tests/unit/modules/conta/laboral/importarFilas.test.ts
//
// LAB2 · Tanda 2 del importador de Cegid: las filas de las nueve hojas, tal
// cual. El Excel es INVENTADO y se genera aquí (ningún dato real en el
// repositorio); las cabeceras son las reales de Julio (regla 31). Lo que más
// importa: las filas que se cargan son exactamente las que contó la tanda 1,
// con la misma vara, hoja a hoja.
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { HOJAS_CEGID } from '@/modules/conta/laboral/importar/cegidCabeceras'
import { cabecerasDelLibro } from '@/modules/conta/laboral/importar/leerCabeceras'
import { enTrozos, filasDelLibro, leerFilas, resumenFilas, valorDeCelda } from '@/modules/conta/laboral/importar/leerFilas'

/** El paquete inventado: cada hoja con sus cabeceras y `n` filas de mentira, con una fila vacía por medio. */
function paquete(n = 3): XLSX.WorkBook {
  const libro = XLSX.utils.book_new()
  for (const h of HOJAS_CEGID) {
    const datos = h.clase === 'campo_valor'
      ? h.columnas.map((c, i) => [c, i % 3 === 0 ? '' : `valor inventado ${i}`])
      : [[...h.columnas], ...Array.from({ length: n }, (_, k) => h.columnas.map((_c, i) => (i === 0 ? k + 1 : `inventado ${k}-${i}`))), h.columnas.map(() => '')]
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), h.nombre)
  }
  return libro
}
const ida = (libro: XLSX.WorkBook) => XLSX.read(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true })

describe('las filas, contadas con la misma vara que las cabeceras de la tanda 1', () => {
  it('hoja a hoja, las filas que se cargan son las que dijo la tanda 1', () => {
    const libro = ida(paquete(4))
    const cabeceras = new Map(cabecerasDelLibro(libro).map((h) => [h.nombre, h.filas]))
    const filas = filasDelLibro(libro)
    expect(filas.map((h) => h.id)).toEqual(HOJAS_CEGID.map((h) => h.id))
    for (const h of filas) expect(h.filas.length, h.nombre).toBe(cabeceras.get(h.nombre))
  })
})

describe('cómo se guarda cada fila', () => {
  it('las tablas, con las cabeceras de Cegid como claves; los números como números', () => {
    const contratos = filasDelLibro(ida(paquete(2))).find((h) => h.id === 'contratos')!
    expect(contratos.filas).toHaveLength(2)
    expect(Object.keys(contratos.filas[0])).toEqual(HOJAS_CEGID.find((h) => h.id === 'contratos')!.columnas)
    expect(contratos.filas[1].trabajador).toBe(2)
    expect(contratos.filas[1].fecha_alta).toBe('inventado 1-3')
  })
  it('«campo · valor»: {campo, valor}; un campo sin valor va sin valor', () => {
    const empresa = filasDelLibro(ida(paquete())).find((h) => h.id === 'empresa')!
    expect(empresa.filas[0]).toEqual({ campo: 'código ERP10' })
    expect(empresa.filas[1]).toEqual({ campo: 'razón social', valor: 'valor inventado 1' })
  })
  it('las fechas, como AAAA-MM-DD; una cabecera repetida no pisa a la otra', () => {
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
      ['trabajador', 'fecha_alta', 'puesto', 'puesto'],
      [7, new Date(2025, 5, 17), 'Ayudante', 'Cocina'],
    ], { cellDates: true }), 'Contratos')
    const [h] = filasDelLibro(ida(libro))
    expect(h.filas).toEqual([{ trabajador: 7, fecha_alta: '2025-06-17', puesto: 'Ayudante', 'puesto (2)': 'Cocina' }])
  })
  it('una pestaña que no es de Cegid no se lee', () => {
    const libro = paquete(1)
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['x'], ['1']]), 'Hoja1')
    expect(leerFilas(XLSX.write(libro, { type: 'array', bookType: 'xlsx' })).map((h) => h.nombre)).not.toContain('Hoja1')
  })
  it('celdas vacías fuera', () => {
    expect(valorDeCelda('  ')).toBeUndefined()
    expect(valorDeCelda(null)).toBeUndefined()
    expect(valorDeCelda(' x ')).toBe('x')
    expect(valorDeCelda(0)).toBe(0)
  })
})

describe('los trozos y lo que dice el botón', () => {
  it('trozos de 500: 1.201 filas son 3 trozos y ninguna se pierde', () => {
    const t = enTrozos(Array.from({ length: 1201 }, (_, i) => i), 500)
    expect(t.map((x) => x.length)).toEqual([500, 500, 201])
  })
  it('con todo cargado, hoja a hoja y en números', () => {
    expect(resumenFilas({
      hojas: { trabajadores: { esperadas: 22, cargadas: 22 }, contratos: { esperadas: 31, cargadas: 31 } },
      cargadas: 53, nuevas: 53, cambiadas: 0, quitadas: 0, completo: true,
    })).toBe('Cargadas 53 filas de 2 hojas: Trabajadores 22 · Contratos 31. 53 nuevas.')
  })
  it('el mismo fichero otra vez: lo dice', () => {
    expect(resumenFilas({ hojas: { conceptos: { esperadas: 3, cargadas: 3 } }, cargadas: 3, nuevas: 0, cambiadas: 0, quitadas: 0, completo: true }))
      .toBe('Cargadas 3 filas de 1 hoja: Conceptos 3. Ninguna cambia: es lo mismo que ya estaba.')
  })
  it('si falta algo, lo dice y en qué hoja', () => {
    expect(resumenFilas({ hojas: { nominas: { esperadas: 1200, cargadas: 700 } }, cargadas: 700, nuevas: 700, cambiadas: 0, quitadas: 0, completo: false }))
      .toBe('Faltan filas: hay 700 cargadas y el fichero trae 1.200: Nominas 700 de 1.200. 700 nuevas.')
  })
})
