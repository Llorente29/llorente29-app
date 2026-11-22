// R15 · Contabilizar al subir, «Ayer» solo si es ayer, la ficha del día y los días en «Facturas emitidas».
// Lo que decide la pantalla, sin pantalla (lib/subirTpv.ts, lib/diaTpv.ts y lib/facturasVenta.ts). Datos inventados.
import { describe, expect, it } from 'vitest'
import { esperaPorCuenta, etiquetaUltimoDia, queHacerAlSubir, textoContabilizado } from '../../../../../src/modules/conta/lib/subirTpv'
import { avisoLimite, fraseDiaTpv, NOMBRE_ESTADO_DIA, textoSubida, tituloDiaTpv } from '../../../../../src/modules/conta/lib/diaTpv'
import { conDiasTpv, totalDelFiltro, type FacturaVenta, type FilaEmitidaTpv } from '../../../../../src/modules/conta/lib/facturasVenta'

describe('qué días se contabilizan al subir y cuáles quedan en espera', () => {
  const guardados = [
    { id: 'a', dia: '2026-11-09', estado: 'por_validar', motivo: null },
    { id: 'b', dia: '2026-11-10', estado: 'en_espera', motivo: 'Falta decir a qué cuenta va «Bizum».' },
    { id: 'c', dia: '2026-11-11', estado: 'por_validar', motivo: null },
    { id: 'viejo', dia: '2026-11-01', estado: 'por_validar', motivo: null },
    { id: 'hecho', dia: '2026-11-02', estado: 'validado', motivo: null },
  ]
  it('solo los de esta subida: los listos se contabilizan y el que espera por una cuenta lo dice', () => {
    const p = queHacerAlSubir(guardados, ['a', 'b', 'c'])
    expect(p.contabilizar.map((x) => x.dia)).toEqual(['2026-11-09', '2026-11-11'])
    expect(p.espera).toEqual([{ id: 'b', dia: '2026-11-10', motivo: 'Falta decir a qué cuenta va «Bizum».' }])
    expect(p.faltaCuenta).toBe(true)
  })
  it('un día ya guardado y sin validar que no se ha vuelto a subir no se toca (sigue en «Validar los N listos»)', () => {
    expect(queHacerAlSubir(guardados, ['a']).contabilizar.map((x) => x.id)).toEqual(['a'])
  })
  it('lo que espera por otra cosa no abre la ventana de las cuentas', () => {
    const p = queHacerAlSubir([{ id: 'x', dia: '2026-11-09', estado: 'en_espera', motivo: 'Esta empresa envía su contabilidad a Diez, y las ventas de un TPV de fuera todavía no se pueden enviar a Diez.' }], ['x'])
    expect(p.faltaCuenta).toBe(false)
    expect(esperaPorCuenta('Falta la cuenta de la factura del día: elígela en «A qué cuenta va cada forma de pago».')).toBe(true)
    expect(esperaPorCuenta(null)).toBe(false)
  })
})

describe('lo que dice el paso 3', () => {
  it('con contenido: cuántos días, cuántos asientos y del nº al nº', () => {
    const dias = Array.from({ length: 31 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, '0')}`, numeros: [12 + 2 * i, 13 + 2 * i] }))
    expect(textoContabilizado(dias, []).contabilizados).toBe('Contabilizados 31 días: 62 asientos, del nº 12 al nº 73.')
  })
  it('un día en dos asientos, y uno solo de antes del R07', () => {
    expect(textoContabilizado([{ dia: '2026-11-09', numeros: [40, 41] }], []).contabilizados).toBe('Contabilizado 1 día: 2 asientos, el nº 40 y el nº 41.')
    expect(textoContabilizado([{ dia: '2026-11-09', numeros: [7] }], []).contabilizados).toBe('Contabilizado 1 día: 1 asiento, el nº 7.')
  })
  it('si los números no van seguidos (otro asiento en medio), no dice «del … al …»', () => {
    expect(textoContabilizado([{ dia: '2026-11-09', numeros: [40, 41] }, { dia: '2026-11-10', numeros: [43, 44] }], []).contabilizados)
      .toBe('Contabilizados 2 días: 4 asientos, entre el nº 40 y el nº 44.')
  })
  it('los que esperan, cada uno con su motivo, por orden de día', () => {
    const t = textoContabilizado([], [
      { dia: '2026-10-05', motivo: 'Falta la cuenta de la factura del día.' },
      { dia: '2026-10-04', motivo: 'Falta decir a qué cuenta va «Bizum».' },
    ])
    expect(t.contabilizados).toBeNull()
    expect(t.enEspera).toBe('En espera 2: el 04/10 (falta decir a qué cuenta va «Bizum») y el 05/10 (falta la cuenta de la factura del día).')
  })
})

describe('«Ayer» solo si es ayer', () => {
  it('ayer de verdad', () => expect(etiquetaUltimoDia('2026-10-31', '2026-11-01')).toBe('Ayer · 31 oct'))
  it('si no, «Último día subido»', () => expect(etiquetaUltimoDia('2026-10-31', '2026-11-21')).toBe('Último día subido · 31 oct'))
  it('sin días del TPV (no se suben), «Último día»', () => expect(etiquetaUltimoDia('2026-10-31', '2026-11-21', false)).toBe('Último día · 31 oct'))
  it('hoy no es ayer', () => expect(etiquetaUltimoDia('2026-11-21', '2026-11-21')).toBe('Último día subido · 21 nov'))
})

describe('la ficha del día', () => {
  it('título, frase y estado', () => {
    expect(tituloDiaTpv('Revo', '2026-11-09')).toBe('Revo · 9 nov')
    expect(fraseDiaTpv({ dia: '2026-11-09', documentos: 48, primero: 5001, ultimo: 5048, total: 1234.56 })).toBe('Ventas del 09/11/2026 · 48 facturas · tickets 5001 a 5048 · 1.234,56 €')
    expect(NOMBRE_ESTADO_DIA.validado.texto).toBe('Contabilizado')
  })
  it('punto 4 · dice qué ticket pasa del límite de la simplificada', () => {
    expect(avisoLimite([], 3000)).toBeNull()
    expect(avisoLimite([{ numero: '5012', total: 3240 }], 3000))
      .toBe('La factura 5012 (3.240,00 €) pasa del límite de la factura simplificada (3.000 € en hostelería) y no lleva el NIF del cliente: tendría que ser una factura completa.')
    expect(avisoLimite([{ numero: '7', total: 450 }, { numero: '9', total: 401 }], 400))
      .toBe('Las facturas 7 (450,00 €) y 9 (401,00 €) pasan del límite de la factura simplificada (400 €) y no llevan el NIF del cliente: tendrían que ser facturas completas.')
  })
  it('quién lo subió, en hora de Madrid, y en una subida de cuántos días', () => {
    expect(textoSubida({ subido_por: null, subido_en: null, subida: { quien: 'Persona Inventada', cuando: '2026-11-10T08:12:00Z', dias: 3 } }))
      .toBe('Subido por Persona Inventada el 10/11 a las 09:12, en una subida de 3 días')
    expect(textoSubida({ subido_por: null, subido_en: null, subida: null })).toBeNull()
  })
})

describe('los días del TPV en «Facturas emitidas»', () => {
  const fila = (id: string, entryId: string | null, total: number): Omit<FacturaVenta, 'diez'> => ({
    id, fuente: 'libro', entryId, numero: null, serie: null, fecha: '2026-11-09', vence: null, cliente: 'VENTAS A CONSUMIDOR FINAL', nif: null,
    origen: 'a_mano', base: total, iva: 0, total, cobrado: 0, guardado: 'emitida', enviada: false, rectificativa: false, localId: null, estadoCobro: null,
  })
  const tpv: FilaEmitidaTpv[] = [
    { clase: 'dia', dia_id: 'd1', dia: '2026-11-09', programa_nombre: 'Revo', primero: 5001, ultimo: 5048, facturas: 48, base: 1000, cuota: 100, total: 1100, asiento_id: 'e1', pdf: 'cuenta/e1/x.pdf' },
    { clase: 'nif', dia_id: 'd1', dia: '2026-11-09', numero: '5007', contador: 'F', nif: '00000000T', cliente: 'Cliente Inventado, S.L.', base: 50, cuota: 5, total: 55, asiento_id: 'e1' },
  ]
  it('el día sustituye a sus líneas del libro (una por tipo) y sus facturas con NIF salen una a una', () => {
    const xs = conDiasTpv([fila('libro:1', 'e1', 1000), fila('libro:2', 'e1', 100), fila('libro:3', 'otro', 20)], tpv)
    expect(xs.map((x) => [x.id, x.numero, x.cliente, x.origen])).toEqual([
      ['libro:3', null, 'VENTAS A CONSUMIDOR FINAL', 'a_mano'],
      ['tpv:d1', '5001 a 5048', 'Día del TPV · Revo', 'dia_tpv'],
      ['tpv:d1:5007', '5007', 'Cliente Inventado, S.L.', 'dia_tpv'],
    ])
    expect(xs[1].tpv).toMatchObject({ clase: 'dia', diaId: 'd1', pdf: 'cuenta/e1/x.pdf' })
  })
  it('la factura con NIF va dentro de su día: no suma otra vez en el total', () => {
    const xs = conDiasTpv([fila('libro:3', 'otro', 20)], tpv).map((x) => ({ ...x, diez: null }) as FacturaVenta)
    expect(totalDelFiltro(xs)).toBe(1120)
  })
})
