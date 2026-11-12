// GB · nº 13, punto 4 · Lo puro de las tareas en Bitrix24
// (supabase/functions/conta-bitrix-pestana-avisos/avisos.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { jefeDeLaboral, plazoDe, responsableDe, tareaDe, webhookDePruebas, type PorAbrir } from '../../../../../supabase/functions/conta-bitrix-pestana-avisos/avisos'

const devuelto: PorAbrir = { cuenta: 'c', cliente: 'p', tipo: 'devuelto', ref: 'e:PM1', titulo: 'Recibo devuelto · 04/11/2026 · 225,00 €',
  texto: 'GoCardless lo ha devuelto.', laboral: false, tipo_ficha: 'empresa', id_externo: '99001' }

describe('GB (nº 13, punto 4) · las tareas en Bitrix24', () => {
  it('el plazo: N días laborables, a las 13:00 de Madrid, con su desfase', () => {
    // Martes 10/11/2026 → jueves 12/11 (invierno, +01:00).
    expect(plazoDe(new Date('2026-11-10T00:30:00Z'), 2)).toBe('2026-11-12T13:00:00+01:00')
    // Viernes → martes (se salta el fin de semana).
    expect(plazoDe(new Date('2026-11-13T10:00:00Z'), 2)).toBe('2026-11-17T13:00:00+01:00')
    // En verano, +02:00.
    expect(plazoDe(new Date('2026-07-01T10:00:00Z'), 1)).toBe('2026-07-02T13:00:00+02:00')
  })
  it('la tarea: en la ficha (empresa 4, contacto 3), con «Sumied ·» delante y su responsable', () => {
    expect(tareaDe(devuelto, 7, new Date('2026-11-10T00:30:00Z'))).toEqual({
      ownerTypeId: 4, ownerId: 99001, deadline: '2026-11-12T13:00:00+01:00', title: 'Sumied · Recibo devuelto · 04/11/2026 · 225,00 €',
      description: 'GoCardless lo ha devuelto.', responsibleId: 7 })
    const deContacto = tareaDe({ ...devuelto, tipo_ficha: 'contacto', id_externo: '501' }, null, new Date('2026-11-10T00:30:00Z'))
    expect([deContacto.ownerTypeId, deContacto.ownerId, 'responsibleId' in deContacto]).toEqual([3, 501, false])
  })
  it('la puerta: solo el webhook del Bitrix24 de pruebas', () => {
    expect(webhookDePruebas('pruebas', 'https://b24-s3mr2y.bitrix24.es/rest/1/abc123')).toEqual({ ok: true, url: 'https://b24-s3mr2y.bitrix24.es/rest/1/abc123/' })
    expect(webhookDePruebas('real', 'https://b24-s3mr2y.bitrix24.es/rest/1/abc123/')).toEqual({ ok: false, porque: 'La conexión no es de pruebas: no se toca.' })
    const otro = webhookDePruebas('pruebas', 'https://otro-portal.bitrix24.es/rest/1/abc123/')
    expect(otro.ok).toBe(false)
    expect(webhookDePruebas('pruebas', 'no es una dirección').ok).toBe(false)
  })
  it('a quién: el responsable de la ficha; lo pedido en el portal, al jefe de Laboral', () => {
    expect(responsableDe({ result: { ID: '99001', ASSIGNED_BY_ID: '7' } })).toBe(7)
    expect([responsableDe({ result: {} }), responsableDe(null), responsableDe({ error: 'NOT_FOUND' })]).toEqual([null, null, null])
    expect(jefeDeLaboral({ result: [{ ID: '1', NAME: 'Gestoría Demo', UF_HEAD: '1' }, { ID: '5', NAME: 'Dpto. Laboral', UF_HEAD: '12' }] })).toBe(12)
    expect(jefeDeLaboral({ result: [{ ID: '5', NAME: 'Laboral', UF_HEAD: '0' }] })).toBeNull()
    expect(jefeDeLaboral({ error: 'insufficient_scope' })).toBeNull()
  })
})
