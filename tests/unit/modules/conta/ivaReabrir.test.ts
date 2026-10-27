// tests/unit/modules/conta/ivaReabrir.test.ts
//
// V04 · Respuesta 5, punto 3 · «Reabrir para corregir» en las pantallas
// (lib/ivaPresentado.ts): un periodo reabierto no lleva candado y sale en rojo;
// la marca del diario. Con el 3T real de Foodint (presentado el 20/10/2026,
// medido en solo lectura el 27/10) reabierto como lo devuelve conta_iva_presentados (1408).

import { describe, expect, it } from 'vitest'
import { candadoDelAsiento, diaMesMadrid, mesPresentado, mesReabierto, presentadoDe, textoMarcaReapertura, textoReabierto, trimestrePresentado } from '@/modules/conta/lib/ivaPresentado'
import { aPeriodo } from '@/modules/conta/services/ivaPresentadoService'

const T3 = { periodo: '3T', ejercicio: 2026, desde: '2026-07-01', hasta: '2026-09-30', presentado: '2026-10-20T06:57:01+00:00', nombre: '3T de 2026', siguiente: '4T' }
const reabierto = aPeriodo({ ...T3, reabierto: { id: 'r1', motivo: 'Falta una venta de septiembre', desde: '2026-10-28T09:00:00+00:00', por: 'Julio', tipo: 'complementary', secuencia: 2 } })
const cerrado = aPeriodo({ ...T3, reabierto: null })
const recibida = { fecha: '2026-09-15', origen: 'supplier_invoice', apuntes: [{ cuenta: '47200021', iva: { tipoId: 't', base: 100, libro: 'received', tipo: 21 } }] }

describe('reabierto para corregir, en las pantallas', () => {
  it('cerrado: candado; reabierto: sin candado y en rojo', () => {
    expect(presentadoDe('2026-09-15', [cerrado])?.periodo).toBe('3T')
    expect(candadoDelAsiento(recibida, [cerrado])?.periodo).toBe('3T')
    expect(presentadoDe('2026-09-15', [reabierto])).toBeNull()
    expect(mesPresentado('2026-08', [reabierto])).toBeNull()
    expect(trimestrePresentado(2026, 3, [reabierto])).toBeNull()
    expect(candadoDelAsiento(recibida, [reabierto])).toBeNull()
    expect(mesReabierto('2026-09', [reabierto])?.reabierto?.secuencia).toBe(2)
    expect(mesReabierto('2026-09', [cerrado])).toBeNull()
    expect(textoReabierto(reabierto.reabierto!)).toBe('Reabierto para corregir, sin presentar · complementaria nº 2')
  })

  it('el día y el mes, siempre con dos cifras (la e2e 980 vio «20/7» en el diálogo)', () => {
    expect(diaMesMadrid('2026-07-20T08:06:28+00:00')).toBe('20/07')
    expect(diaMesMadrid('2026-01-05T08:00:00+00:00')).toBe('05/01')
    // A las 23:30 UTC del 30/09 ya es el 01/10 en Madrid.
    expect(diaMesMadrid('2026-09-30T23:30:00Z')).toBe('01/10')
  })

  it('la marca del diario: quién, cuándo, el motivo y la nueva presentación', () => {
    const m = { motivo: 'Falta una venta de septiembre', periodo: '3T', ejercicio: 2026, tipo: 'complementary' as const, secuencia: 2, por: 'Julio' }
    expect(textoMarcaReapertura([{ ...m, accion: 'validado', en: '2026-10-28T10:15:00Z' }]))
      .toBe('Validado con el 3T de 2026 reabierto para corregir: Julio el 28/10 · «Falta una venta de septiembre» · va en la complementaria nº 2.')
    expect(textoMarcaReapertura([{ ...m, accion: 'creado', en: '2026-10-28T10:00:00Z' }, { ...m, accion: 'libro', en: '2026-10-28T10:16:00Z' }, { ...m, accion: 'validado', en: '2026-10-28T10:15:00Z' }]))
      .toBe('Su libro de IVA, cambiado con el 3T de 2026 reabierto para corregir: Julio el 28/10 · «Falta una venta de septiembre» · va en la complementaria nº 2. (creado, validado, su libro de IVA)')
    expect(textoMarcaReapertura([])).toBe('')
  })
})
