// GBd · La RETIRADA del campo fijo del GBc (supabase/functions/conta-bitrix-pestana/campo.ts).
// Solo en el Bitrix24 de pruebas: en cualquier otro portal, ni una llamada.
// Primero el campo y después el tipo (si se borra solo el tipo, el campo vuelve al registrarlo).
import { describe, expect, it } from 'vitest'
import { campoFijoEnEstePortal, retirarCampoFijo } from '../../../../../supabase/functions/conta-bitrix-pestana/campo'
import { PORTAL_DE_PRUEBAS } from '../../../../../supabase/functions/conta-bitrix-pestana/puro'

function bitrix(contesta: Record<string, unknown> = {}) {
  const pedidas: { metodo: string; cuerpo: Record<string, unknown> }[] = []
  const llamar = async (metodo: string, cuerpo: Record<string, unknown>) => {
    pedidas.push({ metodo, cuerpo })
    return contesta[metodo] ?? { result: true }
  }
  return { llamar, pedidas }
}

describe('GBd · se retira el campo fijo del GBc', () => {
  it('en cualquier otro portal (el real de QBO incluido): ninguna llamada a Bitrix24', async () => {
    for (const portal of ['qbo.bitrix24.es', 'otro-portal.bitrix24.com', '', null]) {
      const { llamar, pedidas } = bitrix()
      expect(await retirarCampoFijo(portal, llamar)).toEqual([])
      expect(pedidas).toEqual([])
      expect(campoFijoEnEstePortal(portal)).toBe(false)
    }
  })

  it('en el de pruebas: primero el campo y después el tipo', async () => {
    const { llamar, pedidas } = bitrix({ 'crm.company.userfield.list': { result: [{ ID: '99', FIELD_NAME: 'UF_CRM_SUMIED_CUOTA' }] } })
    expect(await retirarCampoFijo(PORTAL_DE_PRUEBAS, llamar)).toEqual([])
    expect(pedidas).toEqual([
      { metodo: 'crm.company.userfield.list', cuerpo: { filter: { FIELD_NAME: 'UF_CRM_SUMIED_CUOTA' } } },
      { metodo: 'crm.company.userfield.delete', cuerpo: { id: '99' } },
      { metodo: 'userfieldtype.delete', cuerpo: { USER_TYPE_ID: 'sumied_fijo' } },
    ])
  })

  it('lo que ya no estaba, vale: reinstalar dos veces no falla', async () => {
    const { llamar, pedidas } = bitrix({
      'crm.company.userfield.list': { result: [] },
      'userfieldtype.delete': { error: 'ERROR_NOT_FOUND', error_description: 'Handler not found' },
    })
    expect(await retirarCampoFijo(PORTAL_DE_PRUEBAS, llamar)).toEqual([])
    expect(pedidas.map((p) => p.metodo)).toEqual(['crm.company.userfield.list', 'userfieldtype.delete'])
  })

  it('si Bitrix24 no deja (no es administrador): lo dice, en frases', async () => {
    const { llamar } = bitrix({
      'crm.company.userfield.list': { result: [{ ID: '99' }] },
      'crm.company.userfield.delete': { error: 'ACCESS_DENIED', error_description: 'Access denied' },
      'userfieldtype.delete': { error: 'ACCESS_DENIED', error_description: 'Access denied' },
    })
    expect(await retirarCampoFijo(PORTAL_DE_PRUEBAS, llamar)).toEqual(['campo «Cuota mensual (Sumied)»: Access denied', 'tipo de campo «Sumied»: Access denied'])
  })
})
