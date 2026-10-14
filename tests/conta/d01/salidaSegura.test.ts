// D01 · R2 punto 1 · La puerta de salida de los workflows que leen producción
// o Diez: solo recuentos y huellas. Probada con lo que de verdad se escapó el
// 13/10 (run 60), reescrito con nombres inventados de la misma forma.
import { describe, expect, it } from 'vitest'
import { enMarkdown, filtrar } from '../../../scripts/conta/lib/salidaSegura.mjs'

describe('la puerta de salida', () => {
  it('pasan recuentos, documentos y huellas, con su clave', () => {
    const r = filtrar('@@ # recibidas\n@@ recibidas.total 1432\n@@ recibidas.tipos_2 19\n@@ documento 3175\n@@ envio.huella 9accd52e9e6116224c4a12ec00f7dc18\n@@ cuadra 1')
    expect(r.retenidas).toBe(0)
    expect(enMarkdown(r)).toBe([
      '', '### recibidas', '', '| clave | valor |', '|---|---:|',
      '| recibidas.total | 1432 |', '| recibidas.tipos_2 | 19 |', '| documento | 3175 |', '| envio.huella | 9accd52e9e6116224c4a12ec00f7dc18 |', '| cuadra | 1 |',
      '', 'Líneas retenidas por la puerta de salida: 0',
    ].join('\n') + '\n')
  })
  it('lo del run 60 no pasa: descripciones con nombres, aunque vayan detrás de @@', () => {
    const fuga = [
      '- Descripción, patrones (5): `999/9999-OBRAS INVENTADAS SL` · `99/99-NOMBRE APELLIDO APELLIDO`',
      '@@ descripcion 999/9999-OBRAS INVENTADAS SL',
      '@@ descripcion OBRAS',
      '@@ OBRAS_INVENTADAS 1',
      '@@ proveedor nombre apellido',
    ]
    const r = filtrar(fuga.join('\n'))
    expect(r.filas).toEqual([])
    expect(r.retenidas).toBe(5)
  })
  it('importes, NIF, números de factura, IBAN y trazas de error, tampoco', () => {
    const r = filtrar([
      '@@ total 2.31', '@@ total 1.234,56', '@@ nif B00000011', '@@ numero F-2026/1022', '@@ numero FOLVY-D01-0001',
      '@@ iban ES9121000418450200051332', 'Error: no cuadra: base 100 ≠ 99', '    at file:///x.ts:10:3', 'ERROR:  duplicate key value violates unique constraint DETAIL: Key (invoice_number)=(F-1) already exists.',
    ].join('\n'))
    expect(r.filas).toEqual([])
    expect(r.retenidas).toBe(9)
  })
  it('una clave en mayúsculas, con espacios o larguísima no pasa', () => {
    expect(filtrar(`@@ Total 1\n@@ a b 1\n@@ ${'a'.repeat(49)} 1`).retenidas).toBe(3)
  })
})
