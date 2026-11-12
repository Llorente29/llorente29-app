// GBc · PRUEBA · El campo fijo «Cuota mensual (Sumied)» en la ficha de Bitrix24
// (supabase/functions/conta-bitrix-pestana/campo.ts y src/publicas/bitrixCampo.ts).
// Lo primero (nº 34): el tipo de campo y el campo SOLO se registran en el
// Bitrix24 de pruebas; en cualquier otro portal, ni una llamada. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  CAMPO_FIJO, campoFijoEnEstePortal, leerLlegadaDelCampo, NOMBRE_DEL_CAMPO, notaDeLaDevolucion, queHacerConElCampo, registrarCampoFijo, valorDelCampo,
} from '../../../../../supabase/functions/conta-bitrix-pestana/campo'
import { leerLlegada, PORTAL_DE_PRUEBAS } from '../../../../../supabase/functions/conta-bitrix-pestana/puro'
import { leerAlmohadillaCampo } from '@/publicas/bitrixCampo'

const AQUI = 'https://ejemplo.invalid/functions/v1/conta-bitrix-pestana'

function bitrix(contesta: Record<string, unknown> = {}) {
  const pedidas: { metodo: string; cuerpo: Record<string, unknown> }[] = []
  const llamar = async (metodo: string, cuerpo: Record<string, unknown>) => {
    pedidas.push({ metodo, cuerpo })
    return contesta[metodo] ?? { result: true }
  }
  return { llamar, pedidas }
}

describe('GBc · el campo fijo solo se registra en el Bitrix24 de pruebas', () => {
  it('en cualquier otro portal (el real de QBO incluido): ninguna llamada a Bitrix24', async () => {
    for (const portal of ['qbo.bitrix24.es', 'otro-portal.bitrix24.com', '', null]) {
      const { llamar, pedidas } = bitrix()
      expect(await registrarCampoFijo(portal, AQUI, llamar)).toEqual([])
      expect(pedidas).toEqual([])
      expect(campoFijoEnEstePortal(portal)).toBe(false)
    }
    expect(campoFijoEnEstePortal(PORTAL_DE_PRUEBAS)).toBe(true)
  })

  it('en el de pruebas: el tipo, el número de la aplicación y el campo, sin edición en la lista', async () => {
    const { llamar, pedidas } = bitrix({ 'app.info': { result: { ID: 7 } }, 'crm.company.userfield.list': { result: [] } })
    expect(await registrarCampoFijo(PORTAL_DE_PRUEBAS, AQUI, llamar)).toEqual([])
    expect(pedidas.map((p) => p.metodo)).toEqual(['userfieldtype.add', 'app.info', 'crm.company.userfield.list', 'crm.company.userfield.add'])
    expect(pedidas[0].cuerpo).toEqual({ USER_TYPE_ID: 'sumied_fijo', HANDLER: `${AQUI}?paso=campo`, TITLE: 'Sumied',
      DESCRIPTION: CAMPO_FIJO.descripcion, OPTIONS: { height: 36 } })
    expect(pedidas[2].cuerpo).toEqual({ filter: { FIELD_NAME: 'UF_CRM_SUMIED_CUOTA' } })
    expect(pedidas[3].cuerpo.fields).toMatchObject({ FIELD_NAME: 'SUMIED_CUOTA', USER_TYPE_ID: 'rest_7_sumied_fijo',
      EDIT_FORM_LABEL: 'Cuota mensual (Sumied)', EDIT_IN_LIST: 'N', MANDATORY: 'N' })
  })

  it('«ya estaba» vale: el tipo se pone al día y el campo no se crea dos veces', async () => {
    const { llamar, pedidas } = bitrix({
      'userfieldtype.add': { error: 'ERROR_CORE', error_description: 'Handler already binded' },
      'app.info': { result: { ID: '7' } }, 'crm.company.userfield.list': { result: [{ ID: '99', FIELD_NAME: NOMBRE_DEL_CAMPO }] },
    })
    expect(await registrarCampoFijo(PORTAL_DE_PRUEBAS, AQUI, llamar)).toEqual([])
    expect(pedidas.map((p) => p.metodo)).toEqual(['userfieldtype.add', 'userfieldtype.update', 'app.info', 'crm.company.userfield.list'])
  })

  it('si Bitrix24 no deja (no es administrador): lo dice, en frases', async () => {
    const { llamar } = bitrix({
      'userfieldtype.add': { error: 'ACCESS_DENIED', error_description: 'Access denied' },
      'app.info': { result: { ID: 7 } }, 'crm.company.userfield.list': { result: [] },
      'crm.company.userfield.add': { error: 'ACCESS_DENIED', error_description: 'Access denied' },
    })
    expect(await registrarCampoFijo(PORTAL_DE_PRUEBAS, AQUI, llamar)).toEqual(['tipo de campo: Access denied', 'campo «Cuota mensual (Sumied)»: Access denied'])
  })
})

describe('GBc · lo que llega, lo que se enseña y la red de seguridad', () => {
  it('lo que manda Bitrix24 a la página del campo: el modo, lo guardado y la empresa', () => {
    const f = (o: unknown) => new URLSearchParams({ PLACEMENT: 'USERFIELD_TYPE', PLACEMENT_OPTIONS: JSON.stringify(o) })
    expect(leerLlegadaDelCampo(f({ MODE: 'edit', VALUE: '150,00 €', ENTITY_VALUE_ID: '12' }))).toEqual({ modo: 'edit', guardado: '150,00 €', id: '12' })
    expect(leerLlegadaDelCampo(f({ MODE: 'view', VALUE: '', ENTITY_VALUE_ID: '0' }))).toEqual({ modo: 'view', guardado: '', id: null })
    expect(leerLlegadaDelCampo(new URLSearchParams({ PLACEMENT_OPTIONS: 'no es json' }))).toEqual({ modo: 'view', guardado: '', id: null })
  })
  it('«Cambiar en Sumied» abre la aplicación con la empresa: la pestaña sabe qué ficha es', () => {
    const l = leerLlegada(new URLSearchParams({ AUTH_ID: 'tokendeprueba00', PLACEMENT: 'DEFAULT', PLACEMENT_OPTIONS: JSON.stringify({ ID: '12', TIPO: 'empresa' }) }),
      new URLSearchParams({ DOMAIN: PORTAL_DE_PRUEBAS }))
    expect([l.tipo, l.id]).toEqual(['empresa', '12'])
    // Sin «TIPO», la aplicación abierta a mano sigue sin ficha.
    expect(leerLlegada(new URLSearchParams({ PLACEMENT: 'DEFAULT', PLACEMENT_OPTIONS: '{"ID":"12"}' }), new URLSearchParams()).tipo).toBeNull()
  })
  it('el importe como en la ficha, y qué hacer con lo guardado', () => {
    expect([valorDelCampo(15000), valorDelCampo(123456)]).toEqual(['150,00 €', '1.234,56 €'])
    expect(queHacerConElCampo('150,00 €', '150,00 €')).toEqual({ hacer: 'nada' })
    expect(queHacerConElCampo('', '150,00 €')).toEqual({ hacer: 'poner', valor: '150,00 €' })
    expect(queHacerConElCampo('99', '150,00 €')).toEqual({ hacer: 'devolver', valor: '150,00 €' })
    expect(queHacerConElCampo('99', null)).toEqual({ hacer: 'nada' })
    expect(notaDeLaDevolucion('99', 'Equipo Prueba', '150,00 €'))
      .toBe('Sumied · «Cuota mensual (Sumied)» estaba en 99 (lo cambió Equipo Prueba): vuelve a 150,00 €, que es lo que dice Sumied. Se cambia en Sumied.')
  })
  it('la página lee el «#»', () => {
    expect(leerAlmohadillaCampo('#m=edit&v=150%2C00+%E2%82%AC&a=tok&p=b24-s3mr2y.bitrix24.es&id=12'))
      .toEqual({ modo: 'edit', guardado: '150,00 €', a: 'tok', p: 'b24-s3mr2y.bitrix24.es', id: '12' })
    expect(leerAlmohadillaCampo('').modo).toBe('view')
  })
})
