// tests/unit/modules/conta/erp10/salidaSola.test.ts — X10f · Lo que dice la pantalla de lo que sale solo a
// ERP10 (src/modules/conta/erp10/salidaSola.ts): la línea de la ficha en sus tres colores, el aviso al
// anular lo que ya está en ERP10, la lista de hoy (lo que no ha salido, arriba) y la frase de la barra.

import { describe, expect, it } from 'vitest'
import { aSalidoHoy, avisoYaEnErp10, fraseAtascados, lineaErp10, listaDeHoy, type DatosLinea, type EnvioDeUnAsiento } from '@/modules/conta/erp10/salidaSola'

const base: DatosLinea = { validado: true, fecha: '2026-11-20', envio: null, salida: { encendida: true, desde: '2026-11-01' }, conElExcel: null, pruebaHecha: true }
const envio = (o: Partial<EnvioDeUnAsiento>): EnvioDeUnAsiento => ({ estado: 'en_erp10', serie: '2', documento: 1234, motivo: null, intentos: 1, como: 'sola', ...o })

describe('X10f · la línea de la ficha', () => {
  it('verde en ERP10, con su número; también lo que salió con el Excel', () => {
    expect(lineaErp10({ ...base, envio: envio({}) })).toEqual({ tono: 'verde', texto: 'En ERP10 · asiento 1234', reintentar: false, vigilar: false })
    expect(lineaErp10({ ...base, conElExcel: { documento: null } })?.texto).toBe('En ERP10 · salió con el Excel')
  })
  it('gris mientras sale: validada y en la cola, o cogida', () => {
    expect(lineaErp10(base)).toMatchObject({ tono: 'gris', texto: 'Saliendo a ERP10…', vigilar: true })
    expect(lineaErp10({ ...base, envio: envio({ estado: 'enviando', documento: null }) })).toMatchObject({ tono: 'gris', texto: 'Saliendo a ERP10…' })
  })
  it('ámbar si no ha salido, con su motivo y «Volver a intentarlo»; si aún le quedan intentos, dice que se vuelve a intentar sola', () => {
    expect(lineaErp10({ ...base, envio: envio({ estado: 'no_pudo', documento: null, motivo: 'ERP10 no ha dado de alta la factura (500): Error al guardar la factura (inventado)', intentos: 1 }) }))
      .toEqual({ tono: 'ambar', texto: 'No ha salido a ERP10: ERP10 no ha dado de alta la factura (500): Error al guardar la factura (inventado). Se vuelve a intentar sola en unos minutos.', reintentar: true, vigilar: true })
    expect(lineaErp10({ ...base, envio: envio({ estado: 'no_pudo', documento: null, motivo: 'Lo que sea.', intentos: 3 }) }))
      .toEqual({ tono: 'ambar', texto: 'No ha salido a ERP10: Lo que sea.', reintentar: true, vigilar: false })
    expect(lineaErp10({ ...base, envio: envio({ estado: 'no_pudo', documento: null, motivo: 'No sale por la conexión (…): sale con el Excel.', intentos: 1, como: 'excel' }) })?.vigilar).toBe(false)
  })
  it('nada, si no está validada o la empresa no tiene salida (o es de antes de «desde»); y lo dice si la salida está apagada o falta la prueba', () => {
    expect(lineaErp10({ ...base, validado: false })).toBeNull()
    expect(lineaErp10({ ...base, salida: null })).toBeNull()
    expect(lineaErp10({ ...base, fecha: '2026-10-31' })).toBeNull()
    expect(lineaErp10({ ...base, salida: { encendida: false, desde: '2026-11-01' } })?.texto).toBe('La salida a ERP10 está apagada: sale cuando se encienda.')
    expect(lineaErp10({ ...base, pruebaHecha: false })?.texto).toBe('Por salir a ERP10: la primera de la empresa sale a mano, desde «Salida a ERP10», para probar.')
  })
})

describe('X10f · al anular lo que ya está en ERP10, se dice', () => {
  it('con su número, y nada si no está', () => {
    expect(avisoYaEnErp10({ envio: envio({}), conElExcel: null })).toBe('Ya está en ERP10 (asiento 1234). Lo que cambies o anules aquí no cambia ERP10: allí sigue el de antes, y hay que corregirlo a mano.')
    expect(avisoYaEnErp10({ envio: null, conElExcel: { documento: null } })).toBe('Ya está en ERP10. Lo que cambies o anules aquí no cambia ERP10: allí sigue el de antes, y hay que corregirlo a mano.')
    expect(avisoYaEnErp10({ envio: envio({ estado: 'no_pudo', documento: null }), conElExcel: null })).toBeNull()
  })
})

describe('X10f · la lista de hoy y la barra', () => {
  it('lo que no ha salido, arriba; después lo de hoy, lo más reciente primero, con «Cómo salió»', () => {
    const f = listaDeHoy([
      { entryId: 'a', numero: '2/1', concepto: '', estado: 'en_erp10', documento: 10, motivo: null, intentos: 1, como: 'sola', cuando: '2026-11-20T09:00:00Z' },
      { entryId: 'b', numero: '2/2', concepto: '', estado: 'en_erp10', documento: 11, motivo: null, intentos: 1, como: 'a_mano', cuando: '2026-11-20T10:00:00Z' },
      { entryId: 'c', numero: '2/3', concepto: '', estado: 'no_pudo', documento: null, motivo: 'Falla.', intentos: 3, como: 'sola', cuando: '2026-11-19T10:00:00Z' },
    ])
    expect(f.map((x) => [x.numero, x.hora, x.estado, x.como])).toEqual([
      ['2/3', '11:00', 'No ha salido: Falla', 'Sola'], ['2/2', '11:00', 'En ERP10 · asiento 11', 'A mano'], ['2/1', '10:00', 'En ERP10 · asiento 10', 'Sola'],
    ])
  })
  it('la fila tal como la da la base (con su asiento embebido por entry_id) enseña la serie y el número del asiento', () => {
    // La forma de PostgREST para «select=entry_id, estado, …, journal_entry(series, number, concept)»: el asiento, un objeto.
    const deLaBase = { entry_id: 'e-6', estado: 'en_erp10', erp10_documento: 1001, motivo: null, intentos: 1, como: 'sola', cambiado_en: '2026-11-20T18:46:00.123456+00:00',
      journal_entry: { series: 2, number: 6, concept: 'E2E X10 · recibida X10F-E2E-1' } }
    expect(listaDeHoy([aSalidoHoy(deLaBase)])).toEqual([
      { entryId: 'e-6', hora: '19:46', numero: '2/6', concepto: 'E2E X10 · recibida X10F-E2E-1', tono: 'verde', estado: 'En ERP10 · asiento 1001', como: 'Sola' },
    ])
    // Sin su asiento (no debería pasar: entry_id es su clave ajena), «—», no un hueco.
    expect(aSalidoHoy({ ...deLaBase, journal_entry: null }).numero).toBe('—')
  })
  it('una fila sin hora no tumba la pantalla: «—»', () => {
    expect(listaDeHoy([{ entryId: 'x', numero: '2/9', concepto: '', estado: 'en_erp10', documento: 9, motivo: null, intentos: 1, como: null, cuando: '' }]).map((x) => [x.hora, x.como])).toEqual([['—', '—']])
  })
  it('la barra: el número en ámbar, y nada con cero', () => {
    expect(fraseAtascados(0)).toBeNull()
    expect(fraseAtascados(1)).toEqual({ fuerte: '1 asiento', resto: 'lleva más de una hora sin salir a ERP10' })
    expect(fraseAtascados(4)).toEqual({ fuerte: '4 asientos', resto: 'llevan más de una hora sin salir a ERP10' })
  })
})
