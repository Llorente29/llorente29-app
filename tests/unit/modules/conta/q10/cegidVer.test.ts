// tests/unit/modules/conta/q10/cegidVer.test.ts
//
// Q10 · respuesta 5 · Lo que la lectura de Cegid puede enseñar en el resumen del workflow (público): la incidencia
// entera; de la ficha, solo los nombres de sus campos y lo corto de cada concepto fijo. Nunca el nombre, el NIF ni el
// correo. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { ensenable, fichaSinPersonales, leerPares } from '../../../../../supabase/functions/conta-cegid-ver/ver'

describe('conta-cegid-ver · los pares', () => {
  it('lee «9/2 10/1» y sus separadores', () => {
    expect(leerPares('9/2 10/1')).toEqual([{ cliente: 9, incidencia: 2 }, { cliente: 10, incidencia: 1 }])
    expect(leerPares(' 9/2, 10/1;7/3 ')).toHaveLength(3)
  })
  it('nada, más de 5 o algo que no es cliente/incidencia: no', () => {
    expect(leerPares('')).toBeNull()
    expect(leerPares('1/1 2/1 3/1 4/1 5/1 6/1')).toBeNull()
    expect(leerPares('9-2')).toBeNull()
    expect(leerPares('9/2 /api/x')).toBeNull()
  })
})

describe('conta-cegid-ver · la ficha, sin lo personal', () => {
  const ficha = {
    codigo: 9, nombreComercial: 'EMPRESA INVENTADA', nombreFisCal: 'EMPRESA INVENTADA S.L.', nif: 'B00000000', email: 'nadie@ejemplo.test',
    detalleConceptos: [{ codigoConcepto: '00001', importe: 70, cantidad: 1, totalLinea: 70, descripcion: 'SERVICIOS CONTABLES MES', hasta: '10/2026', fin: 202610 }],
  }
  it('de la ficha, solo los nombres de sus campos', () => {
    const r = fichaSinPersonales(ficha)
    expect(r.campos).toEqual(['codigo', 'detalleConceptos', 'email', 'nif', 'nombreComercial', 'nombreFisCal'])
    expect(JSON.stringify(r)).not.toMatch(/B00000000|nadie@|INVENTADA/)
  })
  it('de cada concepto fijo, los números, las fechas y los códigos; un texto largo, solo su largo', () => {
    expect(fichaSinPersonales(ficha).conceptos).toEqual([{ codigoConcepto: '00001', importe: 70, cantidad: 1, totalLinea: 70, descripcion: '(texto de 23 caracteres)', hasta: '10/2026', fin: 202610 }])
  })
  it('una ficha rara no rompe', () => {
    expect(fichaSinPersonales(null)).toEqual({ campos: [], conceptos: [] })
    expect(ensenable('12345678901')).toBe(false)
    expect(ensenable(null)).toBe(true)
  })
})
