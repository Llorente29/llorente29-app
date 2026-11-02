// tests/unit/modules/conta/laboral/importarCabeceras.test.ts
//
// LAB1 · Tanda 1 del importador de Cegid: leer solo las cabeceras y compararlas
// con las que dio Julio el 29/10 (las nueve hojas del paquete, solo nombres de
// columna). El Excel es INVENTADO y se genera aquí: ningún dato real en el
// repositorio. Las cabeceras sí son las reales (regla 31): una prueba con
// cabeceras inventadas no diría nada del fichero de verdad.
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { HOJAS_CEGID, compararCabeceras, normalizar, resumenComparacion } from '@/modules/conta/laboral/importar/cegidCabeceras'
import { cabecerasDelLibro, leerCabeceras } from '@/modules/conta/laboral/importar/leerCabeceras'

// N1 · Respuesta 2 (01/11): la columna A de Empresa y Convenio COMO VIENE EN EL
// FICHERO REAL (medida por Julio en producción, solo nombres), con su fila de
// cabecera «campo | valor». Escrita aquí a mano, NO sacada de HOJAS_CEGID: si
// lo esperado vuelve a parafrasear un nombre, esta prueba lo caza.
const EMPRESA_REAL = ['campo', 'código ERP10', 'razón social', 'NIF', 'régimen SS', 'Código cuenta de cotización (CCC)', 'convenio',
  'dirección', 'teléfono', 'email', 'representante', 'calendario laboral', 'mutua AT/EP', 'CNAE', 'tipo de empresa',
  'pagas extraordinarias', 'cálculo IRPF', 'emisión de nómina', 'Banco nóminas', 'Banco Seguridad Social', 'Centro de trabajo 1']
const CONVENIO_REAL = ['campo', 'código ERP10', 'nombre', 'código oficial', 'horas anuales', 'horas día', 'fecha revisión', 'vacaciones',
  'paga 13', 'paga 14', 'observaciones']
const REAL: Record<string, string[]> = { Empresa: EMPRESA_REAL, Convenio: CONVENIO_REAL }

/** Un libro como el de Cegid: cada hoja con sus cabeceras y `filas` filas inventadas; Empresa y Convenio, como las reales. */
function libroInventado(cambiar: (nombre: string, columnas: string[]) => string[] = (_, c) => c, filas = 2): XLSX.WorkBook {
  const libro = XLSX.utils.book_new()
  for (const h of HOJAS_CEGID) {
    const columnas = cambiar(h.nombre, h.clase === 'campo_valor' ? [...REAL[h.nombre]] : [...h.columnas])
    const datos = h.clase === 'campo_valor'
      ? columnas.map((c, i) => [c, c === 'campo' ? 'valor' : `VALOR SECRETO ${i}`])
      : [columnas, ...Array.from({ length: filas }, (_, n) => columnas.map((_c, i) => `inventado ${n}-${i}`))]
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), h.nombre)
  }
  return libro
}

const bytes = (libro: XLSX.WorkBook) => XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

describe('las cabeceras que se esperan (las de Julio, 29/10)', () => {
  it('nueve hojas: dos «campo · valor» y siete tablas', () => {
    expect(HOJAS_CEGID.map((h) => h.nombre)).toEqual(['Empresa', 'Convenio', 'Tablas_salariales', 'Conceptos', 'Trabajadores',
      'Contratos', 'Nominas', 'Nominas_conceptos', 'Cuadre_contable'])
    expect(HOJAS_CEGID.filter((h) => h.clase === 'campo_valor').map((h) => h.id)).toEqual(['empresa', 'convenio'])
    expect(HOJAS_CEGID.map((h) => h.columnas.length)).toEqual([19, 10, 7, 4, 26, 12, 30, 9, 10])
    expect(HOJAS_CEGID[0].numerados).toEqual(['Centro de trabajo'])
  })
  it('ninguna hoja repite una columna (una vez normalizada)', () => {
    for (const h of HOJAS_CEGID) expect(new Set(h.columnas.map(normalizar)).size).toBe(h.columnas.length)
  })
})

describe('leer el fichero', () => {
  it('el paquete como se espera: todas «igual», con sus filas', () => {
    const hojas = leerCabeceras(bytes(libroInventado()))
    const c = compararCabeceras(hojas)
    expect(c.completa).toBe(true)
    expect(c.hojas.map((h) => h.estado)).toEqual(Array(9).fill('igual'))
    // Las tablas, 2 filas cada una; las «campo · valor», un campo por fila (sin la de cabecera).
    expect(c.hojas.map((h) => h.filas)).toEqual([20, 10, 2, 2, 2, 2, 2, 2, 2])
    expect(resumenComparacion(c)).toBe('Leídas 9 hojas y 44 filas · 9 de 9 como se esperaban')
  })

  it('de las hojas «campo · valor» sale solo la columna A, nunca los valores', () => {
    const hojas = cabecerasDelLibro(libroInventado())
    const empresa = hojas.find((h) => h.nombre === 'Empresa')!
    expect(empresa.columnas[0]).toBe('código ERP10')  // la fila «campo | valor» no es un campo
    expect(JSON.stringify(hojas)).not.toMatch(/VALOR SECRETO|inventado/)
  })

  it('una columna que falta, una nueva, una hoja que falta y otra que no se espera: todas se ven', () => {
    const libro = libroInventado((nombre, cols) => nombre === 'Contratos' ? [...cols.filter((c) => c !== 'coef_parcial'), 'observaciones'] : cols)
    delete libro.Sheets.Cuadre_contable
    libro.SheetNames = libro.SheetNames.filter((n) => n !== 'Cuadre_contable')
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['algo']]), 'Hoja1')
    const c = compararCabeceras(leerCabeceras(bytes(libro)))
    expect(c.completa).toBe(false)
    const de = (n: string) => c.hojas.find((h) => h.nombre === n)!
    expect(de('Contratos')).toMatchObject({ estado: 'diferente', faltan: ['coef_parcial'], nuevas: ['observaciones'] })
    expect(de('Cuadre_contable')).toMatchObject({ estado: 'falta', filas: 0 })
    expect(de('Hoja1')).toMatchObject({ id: null, estado: 'sobra', nuevas: ['algo'] })
    // Regla 7: las nueve esperadas y la que sobra, todas en la lista.
    expect(c.hojas).toHaveLength(10)
    expect(resumenComparacion(c)).toBe('Leídas 9 hojas y 42 filas · 7 de 9 como se esperaban · 1 con columnas distintas · 1 hoja que falta · 1 hoja que no se esperaba')
  })

  it('mayúsculas, tildes y guiones bajos no cuentan como diferencia', () => {
    const libro = libroInventado((nombre, cols) => nombre === 'Nominas' ? cols.map((c) => c.toUpperCase().replace('Í', 'I')) : cols)
    const c = compararCabeceras(leerCabeceras(bytes(libro)))
    expect(c.hojas.find((h) => h.id === 'nominas')!.estado).toBe('igual')
    expect(normalizar('Tablas_salariales')).toBe(normalizar('tablas salariales'))
  })

  it('una fila vacía al final no cuenta como fila', () => {
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['codigo', 'concepto', 'tipo', 'codigo_red'], ['1', 'x', 'D', ''], ['', '', '', '']]), 'Conceptos')
    expect(cabecerasDelLibro(libro)).toEqual([{ nombre: 'Conceptos', columnas: ['codigo', 'concepto', 'tipo', 'codigo_red'], filas: 1 }])
  })
})

describe('el paquete de verdad (N1 · respuesta 2, 01/11)', () => {
  it('la fila «campo | valor» de Empresa y Convenio no cuenta como campo', () => {
    const hojas = cabecerasDelLibro(libroInventado())
    for (const n of ['Empresa', 'Convenio']) expect(hojas.find((h) => h.nombre === n)!.columnas).not.toContain('campo')
    expect(compararCabeceras(hojas).hojas.find((h) => h.id === 'convenio')).toMatchObject({ estado: 'igual', nuevas: [] })
  })

  it('«Centro de trabajo N» vale para cualquier N ≥ 1, cada uno un centro; sin ninguno, falta el 1', () => {
    const tres = libroInventado((n, cols) => n === 'Empresa' ? [...cols, 'Centro de trabajo 2', 'Centro de trabajo 3'] : cols)
    expect(compararCabeceras(leerCabeceras(bytes(tres))).hojas.find((h) => h.id === 'empresa')).toMatchObject({ estado: 'igual', filas: 22 })
    const ninguno = libroInventado((n, cols) => n === 'Empresa' ? cols.filter((c) => !c.startsWith('Centro de trabajo')) : cols)
    expect(compararCabeceras(leerCabeceras(bytes(ninguno))).hojas.find((h) => h.id === 'empresa'))
      .toMatchObject({ estado: 'diferente', faltan: ['Centro de trabajo 1'], nuevas: [] })
    const cero = libroInventado((n, cols) => n === 'Empresa' ? cols.map((c) => c === 'Centro de trabajo 1' ? 'Centro de trabajo 0' : c) : cols)
    expect(compararCabeceras(leerCabeceras(bytes(cero))).hojas.find((h) => h.id === 'empresa'))
      .toMatchObject({ estado: 'diferente', nuevas: ['Centro de trabajo 0'] })
  })

  it('los nombres parafraseados de antes ya no valen: lo que manda es el fichero', () => {
    const viejo = libroInventado((n, cols) => n === 'Empresa'
      ? cols.map((c) => ({ 'Código cuenta de cotización (CCC)': 'CCC', 'Banco nóminas': 'banco de nóminas' } as Record<string, string>)[c] ?? c)
      : cols)
    expect(compararCabeceras(leerCabeceras(bytes(viejo))).hojas.find((h) => h.id === 'empresa'))
      .toMatchObject({ estado: 'diferente', faltan: ['Código cuenta de cotización (CCC)', 'Banco nóminas'], nuevas: ['CCC', 'banco de nóminas'] })
  })

  it('la hoja LEEME es la portada: se enseña lo que trae, no bloquea ni cuenta como «no se esperaba»', () => {
    const libro = libroInventado()
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Paquete de historial de personal'], ['Empresa', 'Empresa Inventada SL'], ['NIF', 'B00000000']]), 'LEEME')
    const hojas = leerCabeceras(bytes(libro))
    expect(hojas.find((h) => h.nombre === 'LEEME')).toMatchObject({ columnas: [], filas: 0,
      portada: ['Paquete de historial de personal', 'Empresa · Empresa Inventada SL', 'NIF · B00000000'] })
    const c = compararCabeceras(hojas)
    expect(c.completa).toBe(true)
    expect(c.hojas.find((h) => h.nombre === 'LEEME')).toMatchObject({ id: null, estado: 'portada', filas: 0 })
    expect(resumenComparacion(c)).toBe('Leídas 9 hojas y 44 filas · 9 de 9 como se esperaban · y su portada (LEEME)')
  })
})
