// tests/unit/modules/conta/m01/diario.test.ts
//
// M01 · El libro diario en el marco: el número en Diez de cada asiento. Los
// casos son los estados que ya distingue estadoDiez (lib/conDiez.ts) y los
// asientos traídos de Diez tal como los lee diarioService (external_program
// «diez», external_series, external_number).

import { numeroEnDiez } from '@/modules/conta/lib/numeroEnDiez'
import type { ConDiez, EnvioDiez } from '@/modules/conta/lib/conDiez'

const envio = (o: Partial<EnvioDiez>): EnvioDiez => ({
  status: 'enviado', serie: '1', numero: 1803, factura: 'UBR-CAM-20261001', intentos: 1, error: null, documento: 'adjunto', errorDocumento: null, ...o,
})
const conDiez = (e: EnvioDiez | null): ConDiez => ({ entryId: 'x', canal: 'uber', nombreCanal: 'Uber Eats', documento: null, envio: e })
const validado = { estado: 'validado', traido: null }

describe('el número en Diez de un asiento', () => {
  it('lo que llegó a Diez: su número, con punto de miles; la serie solo si no es la 1', () => {
    expect(numeroEnDiez(validado, conDiez(envio({})))).toEqual({ texto: '1.803', explicacion: 'En Diez: serie 1, nº 1.803', valor: '1803' })
    expect(numeroEnDiez(validado, conDiez(envio({ serie: '2', numero: 45, status: 'enlazado' })))).toMatchObject({ texto: '2/45', valor: '2/45' })
  })
  it('lo traído de Diez: el número que tenía allí', () => {
    expect(numeroEnDiez({ estado: 'validado', traido: { programa: 'diez', serie: null, numero: '1287' } })).toMatchObject({ texto: '1.287', valor: '1287' })
    expect(numeroEnDiez({ estado: 'validado', traido: { programa: 'Diez', serie: '3', numero: 'A-12' } })).toMatchObject({ texto: '3/A-12', valor: '3/A-12' })
    expect(numeroEnDiez({ estado: 'validado', traido: { programa: 'diez', serie: null, numero: null } })).toMatchObject({ texto: '—', valor: null, explicacion: 'Traído de Diez sin su número de allí' })
  })
  it('lo traído de otro programa no tiene número en Diez', () => {
    expect(numeroEnDiez({ estado: 'validado', traido: { programa: 'a3', serie: null, numero: '77' } })).toMatchObject({ texto: '—', valor: null })
  })
  it('sin número, «—» y el porqué: sin validar, no llegado o no rechazado', () => {
    expect(numeroEnDiez({ estado: 'propuesto', traido: null }, conDiez(null)).explicacion).toBe('Aún sin validar: se manda a Diez al validarlo')
    expect(numeroEnDiez(validado, conDiez(envio({ status: 'pendiente', numero: null })))).toMatchObject({ texto: '—', explicacion: 'Aún no está en Diez' })
    expect(numeroEnDiez(validado, conDiez(envio({ status: 'rechazado' })))).toMatchObject({ texto: '—' })
    expect(numeroEnDiez(validado)).toMatchObject({ texto: '—', explicacion: 'No tiene número en Diez' })
  })
})
