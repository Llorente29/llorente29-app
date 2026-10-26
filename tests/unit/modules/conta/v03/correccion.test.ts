// tests/unit/modules/conta/v03/correccion.test.ts
//
// V03 · E3 · Las palabras de «Comprobar con Hacienda» y la exportación de los
// registros. El resultado del cuadre tiene la forma que devuelve
// _verifactu_cuadrar (1750); la prueba de staging lo comprueba en la base.

import { describe, expect, it } from 'vitest'
import {
  COLUMNAS_EXPORTAR, type CuadreVisto, filasDescuadre, filasExportar, mesesParaComprobar, type RegistroExportar, type ResultadoCuadre, textoCuadre,
} from '@/modules/conta/lib/verifactu/correccion'

const ahora = new Date('2026-10-26T16:00:00Z')
const base: CuadreVisto = {
  id: 'c', entorno: 'real', ejercicio: 2026, periodo: '10', estado: 'pedido', pedido_at: '2026-10-26T15:58:30Z', pedido_por: 'Julio',
  empezado_at: null, terminado_at: null, paginas: 0, error: null, resultado: null,
}
const vacio: ResultadoCuadre = { hacienda: 0, cuadran: 0, en_camino: 0, rechazadas: 0, falta_en_hacienda: [], solo_en_hacienda: [], distintas: [], ok: true, mes: '2026-10', cuadrado_at: '' }

describe('V03 · E3 · los meses que se pueden comprobar', () => {
  it('del mes de Madrid hacia atrás y nunca antes de octubre de 2024', () => {
    const m = mesesParaComprobar(new Date('2026-10-31T23:30:00Z'), 3)
    expect(m).toEqual([{ valor: '2026-11-01', texto: 'Noviembre de 2026' }, { valor: '2026-10-01', texto: 'Octubre de 2026' }, { valor: '2026-09-01', texto: 'Septiembre de 2026' }])
    const corto = mesesParaComprobar(new Date('2024-12-10T10:00:00Z'))
    expect(corto.map((x) => x.valor)).toEqual(['2024-12-01', '2024-11-01', '2024-10-01'])
    expect(mesesParaComprobar(new Date('2027-01-15T10:00:00Z'), 2).map((x) => x.valor)).toEqual(['2027-01-01', '2026-12-01'])
  })
})

describe('V03 · E3 · lo que dice la pantalla del cuadre (regla 8: siempre algo)', () => {
  it('esperando: cuánto lleva, y si tarda, que lo dice', () => {
    const t = textoCuadre(base, ahora)
    expect(t).toMatchObject({ tono: 'espera', esperando: true, titulo: 'Preguntado a Hacienda por octubre de 2026' })
    expect(t.frase).toMatch(/^Pedido hace 1 minuto\. Puedes cerrar esto/)
    const lento = textoCuadre({ ...base, estado: 'consultando', pedido_at: '2026-10-26T15:50:00Z', empezado_at: '2026-10-26T15:51:00Z', paginas: 2 }, ahora)
    expect(lento.tono).toBe('duda')
    expect(lento.frase).toMatch(/^Leyendo su respuesta \(2 páginas\), desde hace 9 minutos\. Está tardando/)
  })

  it('un fallo dice el motivo que dejó la función', () => {
    expect(textoCuadre({ ...base, estado: 'fallo', error: 'Hacienda ha rechazado la consulta (código 4112): …' }, ahora))
      .toMatchObject({ tono: 'falta', esperando: false, frase: 'Hacienda ha rechazado la consulta (código 4112): …' })
  })

  it('cuadra: con cuántos, y lo de camino y lo rechazado no se esconde (regla 7)', () => {
    const t = textoCuadre({ ...base, estado: 'hecho', entorno: 'pruebas', resultado: { ...vacio, hacienda: 12, cuadran: 12, en_camino: 1, rechazadas: 2 } }, ahora)
    expect(t.tono).toBe('ok')
    expect(t.titulo).toBe('Octubre de 2026 cuadra con Hacienda (entorno de pruebas de Hacienda)')
    expect(t.frase).toBe('Hacienda tiene 12 registros de octubre de 2026 y todos son los de Sumied, con la misma huella y el mismo importe. 1 registro está de camino y Hacienda aún no lo tiene. 2 facturas rechazadas sin subsanar: Hacienda no las tiene, como debe ser hasta que se corrija.')
    expect(textoCuadre({ ...base, estado: 'hecho', resultado: vacio }, ahora).frase).toBe('Ni Hacienda ni Sumied tienen registros de octubre de 2026.')
  })

  it('no cuadra: cuántas de cada, y cada una con qué hacer', () => {
    const r: ResultadoCuadre = {
      ...vacio, ok: false, hacienda: 3, cuadran: 2,
      falta_en_hacienda: [{ num_serie: 'F-1', fecha: '2026-10-02', invoice_id: 'i1', esperado: 'Correcto' }],
      solo_en_hacienda: [{ num_serie: 'TPV-1', fecha: '2026-10-03', estado: 'Correcto', importe: 10 }],
      distintas: [{ num_serie: 'F-2', fecha: '2026-10-04', invoice_id: 'i2', que: 'importe', sumied: { estado: 'Correcto', importe: 121, huella: 'A' }, hacienda: { estado: 'Correcto', importe: 120, huella: 'A', codigo: null, descripcion: null } }],
    }
    const t = textoCuadre({ ...base, estado: 'hecho', resultado: r }, ahora)
    expect(t.tono).toBe('falta')
    expect(t.frase).toBe('1 factura que Sumied dio por recibida no está en Hacienda; Hacienda tiene 1 registro que no es de Sumied; 1 factura no dice lo mismo en los dos sitios. 2 cuadran. Abajo, cuál y qué hacer.')
    const f = filasDescuadre(r)
    expect(f.map((x) => [x.numero, x.fecha, x.invoiceId])).toEqual([['F-1', '02/10/2026', 'i1'], ['F-2', '04/10/2026', 'i2'], ['TPV-1', '03/10/2026', null]])
    expect(f[1].que).toBe('Hacienda tiene otro importe: 120 €, y en Sumied 121 €.')
    expect(f[2].hacer).toMatch(/otro programa/)
  })
})

describe('V03 · E3 · exportar los registros', () => {
  const r = (o: Partial<RegistroExportar>): RegistroExportar => ({
    entorno: 'real', tipo: 'alta', subsanacion: false, rechazo_previo: null, sin_registro_previo: false, nif_emisor: 'B28000016', num_serie: 'F-1',
    fecha_expedicion: '2026-10-02', tipo_factura: 'F1', cuota_total: 21, importe_total: 121, primer_registro: true, anterior_num_serie: null, anterior_fecha: null,
    huella_anterior: null, fecha_hora_huso: '2026-10-02T10:00:00+02:00', generado_at: '2026-10-02T08:00:00Z', cadena_huella: 'IDEmisorFactura=B28000016&…', huella: 'ABC',
    estado: 'correcto', codigo_error: null, descripcion_error: null, csv: 'A-XYZ', respondido_at: '2026-10-02T08:01:00Z', ...o,
  })
  it('una fila por registro, en el orden de la cadena, con lo que entra en la huella', () => {
    const f = filasExportar([
      r({ num_serie: 'F-2', generado_at: '2026-10-03T08:00:00Z', tipo: 'anulacion', primer_registro: false, anterior_num_serie: 'F-1', anterior_fecha: '2026-10-02', huella_anterior: 'ABC', estado: 'incorrecto' }),
      r({}),
      r({ entorno: 'pruebas', num_serie: 'P-1', generado_at: '2026-09-01T08:00:00Z' }),
    ])
    expect(f.every((x) => x.length === COLUMNAS_EXPORTAR.length)).toBe(true)
    expect(f.map((x) => [x[0], x[6]])).toEqual([['Pruebas', 'P-1'], ['Real', 'F-1'], ['Real', 'F-2']])
    expect(f[2].slice(1, 3)).toEqual(['Anulación', 'N'])
    expect(f[2].slice(12, 15)).toEqual(['F-1', '02/10/2026', 'ABC'])
    expect(f[2][19]).toBe('Rechazado')
    expect(f[1][17]).toBe('IDEmisorFactura=B28000016&…')
  })
})
