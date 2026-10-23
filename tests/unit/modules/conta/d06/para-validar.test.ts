// tests/unit/modules/conta/d06/para-validar.test.ts
//
// D06 · Lo que decide si una recibida se valida: el PDF obligatorio, las
// duplicadas, el NIF (normalizado, su dígito de control y el leído mal en un
// carácter) y el pago con tarjeta. Con los casos reales del encargo:
// EUROPASTRY 2403975 (leyó A58696032; el bueno es A-58695032) y su cargo de
// 95,95 € del 07/10 con la tarjeta 6300.

import { describe, expect, it } from 'vitest'
import {
  AVISO_NIF_LEIDO_MAL, cargoDeLaTarjeta, casaNif, clavesNumero, duplicadas, faltaDocumento, nifValido, normaNif, normaNumero, pagadaConTarjeta, textoDuplicada, ultimos4, unCaracter,
} from '../../../../../src/modules/conta/documentos/paraValidar'
import { veredictoFactura, type DatosVeredicto } from '../../../../../src/modules/conta/documentos/veredicto'

describe('D06 · el número de factura, normalizado', () => {
  it('sin espacios, guiones, barras ni ceros a la izquierda', () => {
    expect(normaNumero('F-0012 / 26')).toBe('F1226')
    expect(normaNumero('000123')).toBe('123')
    expect(normaNumero('2403975')).toBe(normaNumero('02403975'))
    expect(normaNumero('ES I 32029 26 00124')).toBe('ESI3202926124')
    expect(normaNumero(null)).toBe('')
  })
  it('el mismo número escrito de dos formas: casa tramo a tramo o todo junto', () => {
    const casan = (a: string, b: string) => clavesNumero(a).some((k) => clavesNumero(b).includes(k))
    // Los ceros tras un separador, aunque el tramo de antes acabe en cifra (la e2e: «…3076 007» y «…3076-7»).
    expect(casan('PD06D3076 007', 'PD06D3076-7')).toBe(true)
    expect(casan('2026/000123', '2026-123')).toBe(true)
    // Y el mismo número con y sin espacios.
    expect(casan('26 00124', '2600124')).toBe(true)
    expect(casan('2403975', '02403975')).toBe(true)
    // Otro número, no.
    expect(casan('2026-123', '2026-124')).toBe(false)
    expect(clavesNumero(null)).toEqual([])
  })
})

describe('D06 · duplicadas', () => {
  const base = { proveedorId: 'p1', fecha: '2026-10-06', total: 95.95 }
  it('el mismo proveedor y el mismo número normalizado', () => {
    const d = duplicadas([{ id: 'a', ...base, numero: '2403975' }, { id: 'b', ...base, numero: '02403975', fecha: '2026-10-07', total: 10 }])
    expect(d.get('a')).toMatchObject({ otra: 'b', por: 'numero' })
    expect(d.get('b')).toMatchObject({ otra: 'a', por: 'numero' })
  })
  it('o el mismo proveedor, la misma fecha y el mismo total', () => {
    const d = duplicadas([{ id: 'a', ...base, numero: 'X1' }, { id: 'b', ...base, numero: 'X2' }])
    expect(d.get('a')).toMatchObject({ otra: 'b', por: 'fecha_total' })
    expect(textoDuplicada(d.get('a')!)).toMatch(/^Puede estar repetida: ya tienes otra de este proveedor del 06\/10\/2026/)
  })
  it('el número con sus ceros tras un espacio, y el mismo con un guion y sin ellos', () => {
    const d = duplicadas([{ id: 'a', ...base, numero: 'PD06D3076 007' }, { id: 'b', ...base, numero: 'PD06D3076-7', total: 10 }])
    expect(d.get('a')).toMatchObject({ otra: 'b', por: 'numero' })
  })
  it('otro proveedor, o una descartada, no la repiten', () => {
    expect(duplicadas([{ id: 'a', ...base, numero: '1' }, { id: 'b', ...base, proveedorId: 'p2', numero: '1' }]).size).toBe(0)
    expect(duplicadas([{ id: 'a', ...base, numero: '1' }, { id: 'b', ...base, numero: '1', descartada: true }]).get('a')).toBeUndefined()
  })
})

describe('D06 · el NIF', () => {
  it('normalizado: sin guiones, espacios ni ES', () => {
    expect(normaNif('A-58695032')).toBe('A58695032')
    expect(normaNif('ES A 58695032')).toBe('A58695032')
    expect(casaNif('A-58695032', 'ESA58695032')).toBe('igual')
  })
  it('con su dígito de control', () => {
    expect(nifValido('A-58695032')).toBe(true)
    expect(nifValido('A58696032')).toBe(false)
  })
  it('EUROPASTRY 2403975: leyó A58696032, un carácter distinto del de su ficha, que es válido: leído mal, no «otro proveedor»', () => {
    expect(unCaracter('A58695032', 'A58696032')).toBe(true)
    expect(casaNif('A-58695032', 'A58696032')).toBe('leido_mal')
    // Un NIF válido y distinto es otro proveedor.
    expect(casaNif('A-58695032', 'B12345674')).toBe('distinto')
  })
})

const DATOS: DatosVeredicto = {
  validada: false, numeroAsiento: null, descartada: false, motivoDescarte: null,
  proveedor: { nombre: 'EUROPASTRY, S.A.', nif: 'A-58695032' }, nifFactura: 'A-58695032', fecha: '2026-10-06',
  comprobaciones: [{ id: 'suma', ok: true, texto: 'Cuadra' }],
  propuesta: { confianza: 'seguro', avisos: [], razones: [] }, porqueSinPropuesta: null, origenGasto: 'su ficha', pagada: null, cuadraConElPdf: true,
}

describe('D06 · el veredicto', () => {
  it('el NIF leído mal: ámbar, con el de su ficha, y el asiento se propone (no «No encaja»)', () => {
    const v = veredictoFactura({ ...DATOS, nifFactura: 'A58696032' })
    expect(v.tipo).toBe('revisa')
    expect(v.porque).toContain(AVISO_NIF_LEIDO_MAL)
  })
  it('sin PDF no se valida; con «Sin PDF» y su motivo, sí; una liquidación del correo de Uber, como hoy', () => {
    const falta = faltaDocumento({ tieneDocumento: false, sinPdf: false, fuente: 'ocr' })
    expect(falta).toMatch(/Falta su PDF/)
    expect(veredictoFactura({ ...DATOS, faltaDocumento: falta }).tipo).toBe('revisa')
    expect(faltaDocumento({ tieneDocumento: false, sinPdf: true, fuente: 'manual' })).toBeNull()
    expect(faltaDocumento({ tieneDocumento: false, sinPdf: false, fuente: 'liquidacion' })).toBeNull()
    expect(veredictoFactura(DATOS).tipo).toBe('lista')
  })
  it('una posible duplicada se avisa antes de validar', () => {
    expect(veredictoFactura({ ...DATOS, duplicada: 'Puede estar repetida: ya tienes otra' })).toMatchObject({ tipo: 'revisa', porque: 'Puede estar repetida: ya tienes otra.' })
  })
})

describe('D06 · pagada con tarjeta', () => {
  it('lo dice el texto de la forma de pago, y sus cuatro últimos', () => {
    expect(pagadaConTarjeta('Pagado con tarjeta VISA ****6300')).toBe(true)
    expect(pagadaConTarjeta('Transferencia a 30 días')).toBe(false)
    expect(ultimos4('Pagado con tarjeta VISA ****6300')).toBe('6300')
  })
  it('EUROPASTRY 2403975 casa con el cargo de 95,95 € del 07/10 (tarjeta 6300), y no con otro importe o fuera de los 5 días', () => {
    const cargos = [
      { id: 'bueno', fecha: '2026-10-07', importe: -95.95, concepto: 'COMPRA TARJ. 6300 EUROPASTRY SA' },
      { id: 'otro-importe', fecha: '2026-10-07', importe: -95.5, concepto: 'COMPRA TARJ. 6300 EUROPASTRY SA' },
      { id: 'tarde', fecha: '2026-10-15', importe: -95.95, concepto: 'COMPRA TARJ. 6300 EUROPASTRY SA' },
    ]
    expect(cargoDeLaTarjeta({ fecha: '2026-10-06', total: 95.95, proveedor: 'EUROPASTRY, S.A.', tarjeta: '6300' }, cargos)?.id).toBe('bueno')
    // Dos igual de buenos: ninguno (se elige a mano).
    expect(cargoDeLaTarjeta({ fecha: '2026-10-06', total: 95.95, proveedor: 'EUROPASTRY, S.A.', tarjeta: null }, [...cargos, { ...cargos[0], id: 'gemelo' }])).toBeNull()
  })
})

import { historialDe } from '../../../../../src/modules/conta/documentos/fichaRecibida'

describe('D06 · la foto sustituida por el PDF bueno, en el historial de la ficha', () => {
  const base = {
    fuente: 'ocr', canal: 'correo', recepcion: null, lectura: { cuando: '2026-10-06T08:00:00+00:00', archivo: '01-foto.jpg' },
    creada: { cuando: '2026-10-06T08:00:05+00:00', quien: 'Folvy' }, marca: 'Sumied', aprobada: null, venceCambiado: null, pagos: [], asiento: null, descartada: null,
  }
  it('la foto queda como documento anterior, con su nombre; no es «Puso el PDF» de una persona', () => {
    const h = historialDe({ ...base, cambios: [{ cuando: '2026-10-07T09:00:00+00:00', quien: 'Folvy', que: 'papel', campos: ['documento'],
      anterior: '51ad1792-6629-4ef7-833a-b57b09a86710/_correo/x/01-foto.jpg', pdfSustituye: true }] })
    expect(h.at(-1)?.texto).toBe('Llegó su PDF: sustituye a la foto «01-foto.jpg», que queda como documento anterior')
  })
  it('poner el PDF a mano sigue diciéndose como antes', () => {
    const h = historialDe({ ...base, cambios: [{ cuando: '2026-10-07T09:00:00+00:00', quien: 'Julio', que: 'papel', campos: ['documento'], anterior: null, pdfSustituye: false }] })
    expect(h.at(-1)?.texto).toBe('Puso el PDF (Julio)')
  })
})
