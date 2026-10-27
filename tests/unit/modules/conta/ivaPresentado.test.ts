// tests/unit/modules/conta/ivaPresentado.test.ts
//
// V04 · Respuesta 5 · El candado del IVA en las pantallas (lib/ivaPresentado.ts),
// contra la población real (regla 31): los tres 303 de Foodint de 2026 tal como
// están en producción (medido en solo lectura el 27/10):
//   1T filed 2026-04-20 10:06:28+00 · 2T 2026-07-20 10:51:15+00 · 3T 2026-10-20 06:57:01+00.
// Y los mismos textos que la base (conta_iva_presentado_mensaje y el aviso de
// _conta_iva_ajustar_propuesta, 1233), que la prueba de staging comprueba allí.

import { describe, expect, it } from 'vitest'
import {
  avisoTardia, candadoDelAsiento, diaPresentado, llevaIva, mensajePresentado, mesPresentado, presentadoDe, trimestrePresentado,
  type PeriodoPresentado,
} from '@/modules/conta/lib/ivaPresentado'
import { aPeriodo } from '@/modules/conta/services/ivaPresentadoService'

// Como los devuelve conta_iva_presentados (jsonb) para Foodint, 2026.
const FOODINT_2026: PeriodoPresentado[] = [
  { periodo: '1T', ejercicio: 2026, desde: '2026-01-01', hasta: '2026-03-31', presentado: '2026-04-20T10:06:28+00:00', nombre: '1T de 2026', siguiente: '4T' },
  { periodo: '2T', ejercicio: 2026, desde: '2026-04-01', hasta: '2026-06-30', presentado: '2026-07-20T10:51:15+00:00', nombre: '2T de 2026', siguiente: '4T' },
  { periodo: '3T', ejercicio: 2026, desde: '2026-07-01', hasta: '2026-09-30', presentado: '2026-10-20T06:57:01+00:00', nombre: '3T de 2026', siguiente: '4T' },
].map((x) => aPeriodo(x as unknown as Record<string, unknown>))

const iva = (cuenta: string, libro = '') => ({ cuenta, iva: libro ? { tipoId: 't', base: 100, libro, tipo: 21 } : null })

describe('el candado del IVA en las pantallas', () => {
  it('el periodo presentado de cada día, con los bordes', () => {
    expect(presentadoDe('2026-09-30', FOODINT_2026)?.periodo).toBe('3T')
    expect(presentadoDe('2026-10-01', FOODINT_2026)).toBeNull()
    expect(presentadoDe('2026-01-01', FOODINT_2026)?.periodo).toBe('1T')
    expect(presentadoDe(null, FOODINT_2026)).toBeNull()
    expect(mesPresentado('2026-08', FOODINT_2026)?.periodo).toBe('3T')
    expect(mesPresentado('2026-10', FOODINT_2026)).toBeNull()
    expect(trimestrePresentado(2026, 3, FOODINT_2026)?.periodo).toBe('3T')
    expect(trimestrePresentado(2026, 4, FOODINT_2026)).toBeNull()
  })

  it('el mensaje es el de la base: «El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar. Esta factura va al 4T.»', () => {
    const t3 = FOODINT_2026[2]
    // 06:57 UTC del 20/10 son las 07:57 de Madrid: el mismo día.
    expect(diaPresentado(t3)).toBe('20/10')
    expect(mensajePresentado(t3)).toBe('El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar. Esta factura va al 4T.')
    expect(mensajePresentado(t3, 'corregir')).toBe('El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar. Lo que haya que corregir va al 4T.')
  })

  it('mensual: «de agosto», «a octubre»', () => {
    const agosto: PeriodoPresentado = { periodo: '08', ejercicio: 2026, desde: '2026-08-01', hasta: '2026-08-31', presentado: '2026-09-18T09:00:00+00:00', nombre: 'agosto de 2026', siguiente: 'octubre' }
    expect(mensajePresentado(agosto)).toBe('El IVA de agosto de 2026 ya está presentado (18/09). No se puede cambiar. Esta factura va a octubre.')
    expect(avisoTardia('2026-08-12', '2026-10-01', [agosto])).toBe('Agosto ya está presentado. Esta factura se deduce en octubre.')
  })

  it('la recibida tardía: Carrefour (factura del 06/08, asentada el 01/10) dice «El 3T ya está presentado. Esta factura se deduce en el 4T.»', () => {
    expect(avisoTardia('2026-08-06', '2026-10-01', FOODINT_2026)).toBe('El 3T ya está presentado. Esta factura se deduce en el 4T.')
    // La de su periodo, o sin fecha de factura, no avisa.
    expect(avisoTardia('2026-10-02', '2026-10-02', FOODINT_2026)).toBeNull()
    expect(avisoTardia(null, '2026-10-02', FOODINT_2026)).toBeNull()
    // Si el asiento también cae en lo presentado, no es «tardía»: es el candado.
    expect(avisoTardia('2026-08-06', '2026-09-15', FOODINT_2026)).toBeNull()
    // Al año siguiente, con el año.
    expect(avisoTardia('2026-08-06', '2027-01-04', FOODINT_2026)).toBe('El 3T ya está presentado. Esta factura se deduce en el 1T de 2027.')
  })

  it('lleva IVA: un apunte con libro, o en una 472 o una 477 (como la base)', () => {
    expect(llevaIva([iva('62400000'), iva('47200021', 'received')])).toBe(true)
    expect(llevaIva([iva('43000000'), iva('47700010')])).toBe(true)
    expect(llevaIva([iva('62900000', 'received')])).toBe(true)
    expect(llevaIva([iva('41000850'), iva('57200001')])).toBe(false)
  })

  it('el candado de un asiento: solo con IVA, en un periodo presentado, y nunca lo traído ni la liquidación', () => {
    const recibida = { fecha: '2026-09-15', origen: 'supplier_invoice', apuntes: [iva('62400000'), iva('47200021', 'received'), iva('41000850')] }
    expect(candadoDelAsiento(recibida, FOODINT_2026)?.periodo).toBe('3T')
    expect(candadoDelAsiento({ ...recibida, fecha: '2026-10-01' }, FOODINT_2026)).toBeNull()
    expect(candadoDelAsiento({ ...recibida, origen: 'migrated' }, FOODINT_2026)).toBeNull()
    expect(candadoDelAsiento({ ...recibida, origen: 'vat_settlement' }, FOODINT_2026)).toBeNull()
    expect(candadoDelAsiento({ fecha: '2026-09-15', origen: 'bank', apuntes: [iva('41000850'), iva('57200001')] }, FOODINT_2026)).toBeNull()
  })
})
