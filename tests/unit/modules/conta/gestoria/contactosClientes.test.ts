// G01c · Tarea 3 · Los contactos de Bitrix24: clientes, personas de contacto o
// fuera, y la unión con las empresas (la regla de Julio, 07/11, tras el
// recuento #5). NIF de ceros, nombres de prueba y códigos inventados (T11).
import { describe, expect, it } from 'vitest'
import { agrupar, claveDeFicha, idExtranjeroDe, nifComoLaBase, tipoDeNif } from '../../../../../supabase/functions/_shared/crm/clientes'
import { leerContacto, type FichaContacto, type MapaContactos } from '../../../../../supabase/functions/conta-bitrix-leer/contactosClientes'
import { destinoDe, repartirContactos, resumenDeContactos } from '../../../../../supabase/functions/_shared/crm/contactos'
import type { Situacion } from '../../../../../supabase/functions/_shared/crm/ficha'

const MAPA: MapaContactos = {
  nif: 'UF_CRM_EJ_NIF', direccion: { calle: 'ADDRESS', cp: 'ADDRESS_POSTAL_CODE', poblacion: 'ADDRESS_CITY', provincia: 'ADDRESS_PROVINCE' },
  cuota: 'UF_CRM_EJ_TARIFA', tipoCliente: 'UF_CRM_EJ_TIPO', textosTipo: { 1: 'Solo renta', 2: 'Autónomo' },
}
const SIN = { empresas: [], conNegociacion: false, gocardless: { nifs: new Set<string>(), correos: new Set<string>() } }
const con = (fila: Record<string, unknown>, extra: Partial<typeof SIN> = {}) => leerContacto(fila, MAPA, { ...SIN, ...extra })
const EMPRESAS_NIF = new Set(['B00000001'])

describe('G01c · un contacto, leído con su mapa', () => {
  it('nombre, NIF, dirección de ADDRESS, «Tipo de cliente» de referencia, Tarifa Recurrente y sin situación', () => {
    const c = con({ ID: '7', NAME: 'PERSONA', LAST_NAME: 'PRUEBA UNO', UF_CRM_EJ_NIF: '00000000-t', ADDRESS: 'Calle Inventada 1|;|9', ADDRESS_POSTAL_CODE: '28000',
      ADDRESS_CITY: 'Madrid', UF_CRM_EJ_TIPO: '1', UF_CRM_EJ_TARIFA: '30|EUR', EMAIL: [{ VALUE: 'Uno@Prueba.test' }], PHONE: [{ VALUE: '600000000' }] })
    expect(c).toMatchObject({ tipoFicha: 'contacto', idExterno: '7', nombre: 'PERSONA PRUEBA UNO', nif: '00000000T', nifEnCrm: '00000000-t', situacion: null,
      tipoCliente: 'Solo renta', calle: 'Calle Inventada 1', cp: '28000', poblacion: 'Madrid', correos: ['uno@prueba.test'], telefonos: ['600000000'],
      cuotasReferencia: [{ etiqueta: 'Tarifa recurrente', importeCent: 3000, texto: '30|EUR' }], datosDeCliente: true,
      senales: { nif: true, tarifa: true, negociacion: false, gocardless: false } })
    expect(claveDeFicha(c)).toBe('contacto:7')
    // La empresa principal (COMPANY_ID) también cuenta como empresa suya.
    expect(con({ ID: '8', COMPANY_ID: '55' }).empresas).toEqual(['55'])
  })

  it('GoCardless casado por NIF o por correo; una tarifa a 0 no es señal', () => {
    const gc = { nifs: new Set(['00000000T']), correos: new Set(['dos@prueba.test']) }
    expect(con({ ID: '1', UF_CRM_EJ_NIF: '00000000T' }, { gocardless: gc }).senales.gocardless).toBe(true)
    expect(con({ ID: '2', EMAIL: [{ VALUE: 'DOS@prueba.test' }] }, { gocardless: gc }).senales.gocardless).toBe(true)
    expect(con({ ID: '3', UF_CRM_EJ_TARIFA: '0' }).senales).toEqual({ nif: false, tarifa: false, negociacion: false, gocardless: false })
  })
})

describe('G01c · qué es cada contacto', () => {
  it('contacto sin empresa con una señal: cliente', () => {
    expect(destinoDe(con({ ID: '1', UF_CRM_EJ_NIF: '00000000T' }), EMPRESAS_NIF)).toEqual({ es: 'cliente', motivo: null })
    expect(destinoDe(con({ ID: '2', UF_CRM_EJ_TARIFA: '45' }), EMPRESAS_NIF)).toEqual({ es: 'cliente', motivo: null })
  })

  it('contacto sin empresa con solo una negociación: cliente, y a «Pendiente de revisar»', () => {
    expect(destinoDe(con({ ID: '3' }, { conNegociacion: true }), EMPRESAS_NIF)).toEqual({ es: 'cliente', motivo: 'solo_negociacion' })
  })

  it('contacto con empresa: persona de contacto de todas sus empresas; con datos de cliente, además a revisar', () => {
    expect(destinoDe(con({ ID: '4' }, { empresas: ['70', '71'] }), EMPRESAS_NIF)).toEqual({ es: 'persona_de_contacto', empresas: ['70', '71'], motivo: null })
    expect(destinoDe(con({ ID: '5', UF_CRM_EJ_TARIFA: '30' }, { empresas: ['72'] }), EMPRESAS_NIF)).toEqual({ es: 'persona_de_contacto', empresas: ['72'], motivo: 'empresa_con_datos' })
  })

  it('contacto con el NIF de una empresa: cliente (se une a ella), aunque esté enlazado a otra o a ninguna', () => {
    expect(destinoDe(con({ ID: '6', UF_CRM_EJ_NIF: 'B-00000001' }, { empresas: ['99'] }), EMPRESAS_NIF)).toEqual({ es: 'cliente', motivo: null })
    expect(destinoDe(con({ ID: '7', UF_CRM_EJ_NIF: 'B00000001' }), EMPRESAS_NIF)).toEqual({ es: 'cliente', motivo: null })
  })

  it('contacto sin empresa y sin nada: fuera', () => {
    expect(destinoDe(con({ ID: '8', NAME: 'PERSONA PRUEBA' }), EMPRESAS_NIF)).toEqual({ es: 'fuera' })
  })

  it('el reparto: clientes, personas de contacto por empresa, cuántos fuera y lo que sale a revisar', () => {
    const r = repartirContactos([
      con({ ID: '1', UF_CRM_EJ_NIF: '00000000T' }), con({ ID: '3' }, { conNegociacion: true }), con({ ID: '4' }, { empresas: ['70', '71'] }),
      con({ ID: '5', UF_CRM_EJ_TARIFA: '30' }, { empresas: ['70'] }), con({ ID: '8' }), con({ ID: '9' }),
    ], EMPRESAS_NIF, 'Bitrix24')
    expect(r.clientes.map((c) => c.idExterno)).toEqual(['1', '3'])
    expect([...r.personas].map(([e, cs]) => [e, cs.map((c) => c.idExterno)])).toEqual([['70', ['4', '5']], ['71', ['4']]])
    expect(r.fuera.map((c) => c.idExterno)).toEqual(['8', '9'])
    expect(r.fuera[0].porque).toMatch(/^Sin empresa, sin NIF/)
    expect(r.pendientes.map((p) => [p.tipo, p.idExterno])).toEqual([['contacto_solo_negociacion', '3'], ['contacto_empresa_con_datos', '5']])
    expect(r.pendientes[0].porque).toMatch(/^Contacto con solo una negociación: ¿es cliente\?/)
    expect(r.pendientes[1].porque).toMatch(/^Contacto con empresa y con datos de cliente/)
    expect(r.pendientes[0].porque).toContain('de Bitrix24')
  })

  it('cuántos hay de cada: los que se unen a una empresa, aparte de los clientes', () => {
    const cs = [con({ ID: '1', UF_CRM_EJ_NIF: '00000000T' }), con({ ID: '2', UF_CRM_EJ_NIF: 'B00000001' }), con({ ID: '4' }, { empresas: ['70', '71'] }), con({ ID: '8' })]
    const r = repartirContactos(cs, EMPRESAS_NIF, 'Bitrix24')
    expect(resumenDeContactos(cs, r, EMPRESAS_NIF)).toEqual({ contactos: 4, clientes: 1, seUnenAEmpresa: 1, personas: 1, fuera: 1, pendientes: 0 })
  })
})

describe('G01c · la unión de contactos y empresas', () => {
  const empresa = (idExterno: string, nif: string | null, situacion: Situacion | null) => ({ idExterno, nif, situacion, tipoFicha: 'empresa' as const })

  it('NIF repetido entre contacto y empresa: un solo cliente, la empresa como principal (aunque el contacto vaya antes por id)', () => {
    const fichas = [empresa('700', 'B00000001', 'activo'), con({ ID: '6', UF_CRM_EJ_NIF: 'B00000001' }) as FichaContacto]
    const [c] = agrupar(fichas, true)
    expect(c).toMatchObject({ clave: 'nif:B00000001', motivo: 'repetidas', situacion: 'activo', idExtranjero: null })
    expect(c.principal.tipoFicha).toBe('empresa')
    expect(c.fichas.map((f) => claveDeFicha(f))).toEqual(['empresa:700', 'contacto:6'])
    // Si empatan en situación (ninguna), manda la empresa.
    expect(agrupar([con({ ID: '1', UF_CRM_EJ_NIF: 'B00000001' }) as FichaContacto, empresa('900', 'B00000001', null)], true)[0].principal.tipoFicha).toBe('empresa')
  })

  it('una empresa y un contacto con el mismo id externo no se confunden', () => {
    const c = agrupar([empresa('7', null, 'activo'), con({ ID: '7', UF_CRM_EJ_TARIFA: '10' }) as FichaContacto], true)
    expect(c.map((x) => x.clave)).toEqual(['ficha:empresa:7', 'ficha:contacto:7'])
  })

  it('RIF J y V: identificador fiscal extranjero de Venezuela, se unen y no entran «sin NIF»', () => {
    expect([tipoDeNif('J000000000'), tipoDeNif('V000000000'), tipoDeNif('E000000000'), tipoDeNif('G000000000'), tipoDeNif('P000000000'), tipoDeNif('J0000000')])
      .toEqual(['RIF', 'RIF', 'RIF', 'RIF', 'RIF', 'otro'])
    expect(nifComoLaBase('J-00000000-0')).toBe('J000000000')
    expect(idExtranjeroDe('V000000000')).toEqual({ tipo: 'foreign', pais: 'VE' })
    expect(idExtranjeroDe('B00000001')).toBeNull()
    const c = agrupar([empresa('1', 'J-00000000-0', 'activo'), con({ ID: '2', UF_CRM_EJ_NIF: 'j000000000' }) as FichaContacto, empresa('3', 'V000000000', 'baja')], true)
    expect(c.map((x) => [x.clave, x.motivo, x.idExtranjero])).toEqual([
      ['nif:J000000000', 'repetidas', { tipo: 'foreign', pais: 'VE' }], ['nif:V000000000', null, { tipo: 'foreign', pais: 'VE' }]])
  })
})
