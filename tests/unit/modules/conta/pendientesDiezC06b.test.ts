// C06b · Respuesta 7: lo que está en Diez sin su PDF, en palabras y en el zip.
// Importes y números INVENTADOS; la forma, la de un asiento de ventas de Uber.
import { describe, expect, it } from 'vitest'
import { fraseResumen, nombreEnZip, ordenPendientes, referenciaDiez, resumenPendientes } from '@/modules/conta/lib/pendientesDiez'
import { estadoDiez, textoResultado, type ConDiez } from '@/modules/conta/lib/conDiez'

const ddmmaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
const p = (fecha: string, documento: number) => ({ fecha, documento, ejercicio: fecha.slice(0, 4), serie: '1' })

describe('pendientes de adjuntar en Diez', () => {
  it('la referencia en Diez y el nombre del PDF en el zip son la misma, sin barras', () => {
    expect(referenciaDiez(p('2026-10-01', 1801))).toBe('1/1801 (2026)')
    expect(nombreEnZip(p('2026-10-01', 1801))).toBe('2026-1-1801.pdf')
    expect(nombreEnZip({ ejercicio: '2026', serie: 'A/B', documento: 7 })).toBe('2026-A_B-7.pdf')
  })
  it('cuántos y el más antiguo; con filas nunca dice «nada pendiente» (regla 7)', () => {
    const xs = [p('2026-10-03', 1803), p('2026-10-01', 1801), p('2026-10-02', 1802)]
    expect(resumenPendientes(xs)).toEqual({ n: 3, masAntiguo: '2026-10-01' })
    expect(fraseResumen(xs, ddmmaa)).toBe('3 facturas están en Diez sin su PDF. La más antigua, del 01/10/26.')
    expect(fraseResumen([xs[0]], ddmmaa)).toBe('1 factura está en Diez sin su PDF. La más antigua, del 03/10/26.')
    expect(fraseResumen([], ddmmaa)).toMatch(/^Nada pendiente/)
  })
  it('la más antigua primero', () => {
    expect(ordenPendientes([p('2026-10-03', 3), p('2026-10-01', 9), p('2026-10-01', 2)]).map((x) => x.documento)).toEqual([2, 9, 3])
  })
})

const con = (envio: ConDiez['envio'], documento = true): ConDiez => ({
  entryId: 'e1', canal: 'uber', nombreCanal: 'Uber Eats',
  documento: documento ? { ruta: 'a/e1/x.pdf', nombre: 'x.pdf', bytes: 1, creadoEn: '2026-10-14T10:00:00Z', creadoPor: null } : null, envio,
})
const envio = (o: Partial<NonNullable<ConDiez['envio']>> = {}): NonNullable<ConDiez['envio']> => ({ status: 'enviado', serie: '1', numero: 1801, factura: 'UBR-ALC-20261001', intentos: 1, error: null, documento: 'pendiente_diez', errorDocumento: null, ...o })

describe('el estado con Diez, en palabras', () => {
  it('en Diez sin su PDF: «En Diez · 1/1801 · PDF pendiente en Diez», azul y sin Reintentar', () => {
    expect(estadoDiez({ estado: 'validado' }, con(envio()))).toMatchObject({ texto: 'En Diez · 1/1801 · PDF pendiente en Diez', tono: 'azul', enDiez: true, reintentar: false })
  })
  it('con su PDF adjunto (por Diez o a mano): verde', () => {
    expect(estadoDiez({ estado: 'validado' }, con(envio({ documento: 'adjunto' })))).toMatchObject({ texto: 'En Diez · 1/1801', tono: 'verde' })
  })
  it('si adjuntarlo FALLÓ, sigue sin estar en Diez (el freno de R15)', () => {
    expect(estadoDiez({ estado: 'validado' }, con(envio({ documento: 'fallo' })))).toMatchObject({ texto: 'No ha llegado a Diez: falta el documento', enDiez: false })
  })
  it('anulado en Folvy y en Diez: lo dice, en ámbar (no «Anulado» a secas)', () => {
    expect(estadoDiez({ estado: 'anulado' }, con(envio()))).toMatchObject({ texto: expect.stringMatching(/^Anulado en .* · en Diez sigue 1\/1801: falta su contraasiento en Diez$/), tono: 'ambar' })
    expect(estadoDiez({ estado: 'anulado' }, con(null))).toMatchObject({ texto: 'Anulado', tono: 'neutro' })
  })
  it('R8: con su contraasiento ya en Diez, «Anulado en … y en Diez», sin ámbar; si el contraasiento no ha llegado, sigue en ámbar', () => {
    const anulado = { ...con(envio()), contraasiento: envio({ numero: 1802, factura: 'UBR-ALC-20261001-ANUL', documento: null }) }
    expect(estadoDiez({ estado: 'anulado' }, anulado)).toMatchObject({ texto: expect.stringMatching(/^Anulado en .* y en Diez · 1\/1801 anulada con 1\/1802$/), tono: 'neutro', enDiez: true })
    const sinLlegar = { ...con(envio()), contraasiento: envio({ status: 'pendiente', serie: null, numero: null, documento: null, error: 'Diez no ha aceptado el contraasiento' }) }
    expect(estadoDiez({ estado: 'anulado' }, sinLlegar)).toMatchObject({ texto: expect.stringMatching(/falta su contraasiento en Diez$/), tono: 'ambar' })
  })
  it('el resultado de «Validar y enviar» cuenta los que van con el PDF pendiente', () => {
    expect(textoResultado([
      { concepto: 'a', validado: true, documento: true, enDiez: true, pdfPendiente: true, texto: '' },
      { concepto: 'b', validado: true, documento: true, enDiez: true, pdfPendiente: false, texto: '' },
    ])).toBe('2 de 2 validados · 2 con su documento guardado · 2 en Diez (1 con el PDF pendiente de adjuntar allí).')
  })
})
