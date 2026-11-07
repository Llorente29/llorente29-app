// G01c · Tarea 2 · El recuento de los contactos de Bitrix24: solo números y
// etiquetas. NIF de ceros, nombres de prueba y códigos UF_CRM_ inventados (T11).
import { describe, expect, it } from 'vitest'
import { camposDeContactos, candidatosDeContacto, contarContactos, esRif } from '../../../../../supabase/functions/conta-bitrix-leer/contactos'
import { leerParaRecuento } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'
import { esCampoSensible } from '../../../../../supabase/functions/conta-bitrix-leer/clientes'
import { gruposValidos } from '../../../../../supabase/functions/conta-bitrix-leer/recuento'

const MEDIDOS = {
  ID: { type: 'integer', title: 'ID' }, NAME: { type: 'string', title: 'Nombre' },
  COMPANY_IDS: { type: 'crm_company', title: 'Compañías', isMultiple: true },
  ADDRESS: { type: 'string', title: 'Dirección' },
  BANKING_DETAILS: { type: 'string', title: 'Detalles del pago' },
  UF_CRM_EJ_NIF: { type: 'string', formLabel: 'DNI / NIE' },
  UF_CRM_EJ_SIT: { type: 'enumeration', listLabel: 'Situación del Cliente', items: [{ ID: 1, VALUE: 'ACTIVO' }, { ID: 2, VALUE: 'BAJA DE AUTONOMO ❌' }, { ID: 3, VALUE: 'CLIENTE SOLO RENTA' }] },
  UF_CRM_EJ_CUOTA: { type: 'money', formLabel: 'Cuota Renta' },
  UF_CRM_EJ_DIR: { type: 'address', formLabel: 'Domicilio' },
  UF_CRM_EJ_CLAVE: { type: 'string', formLabel: 'Clave Cl@ve' },
  UF_CRM_EJ_IBAN: { type: 'string', formLabel: 'IBAN' },
  UF_CRM_EJ_DOC: { type: 'file', formLabel: 'DNI escaneado' },
}
const c = (ID: string, extra: Record<string, unknown> = {}) => ({ ID, ...extra })
const FILAS = [
  c('1', { UF_CRM_EJ_NIF: '00000000T', UF_CRM_EJ_SIT: '1' }),                                    // sin empresa, activo
  c('2', { UF_CRM_EJ_NIF: '00000000-t', UF_CRM_EJ_SIT: '3' }),                                   // sin empresa, el mismo NIF: repetido
  c('3', { UF_CRM_EJ_NIF: 'J000000000', UF_CRM_EJ_SIT: '2' }),                                   // sin empresa, RIF
  c('4', { UF_CRM_EJ_NIF: 'B00000001' }),                                                       // sin empresa, el NIF de una empresa
  c('5', { COMPANY_IDS: ['70'] }),                                                              // con empresa, sin datos: persona de contacto
  c('6', { COMPANY_IDS: ['70', '71'], UF_CRM_EJ_SIT: '1' }),                                    // con dos empresas y situación propia
  c('7', { COMPANY_IDS: ['72'], UF_CRM_EJ_CUOTA: '30|EUR' }),                                   // con empresa y cuota propia
  c('8', { COMPANY_IDS: ['0'] }),                                                               // «0» es sin empresa
]

describe('G01c · el recuento de los contactos', () => {
  it('los candidatos salen de la etiqueta y el tipo; nunca uno de los que no se leen (contraseñas, ficheros, IBAN, detalles del pago)', () => {
    expect(candidatosDeContacto(MEDIDOS)).toEqual({ nif: ['UF_CRM_EJ_NIF'], situacion: ['UF_CRM_EJ_SIT'], direccion: ['ADDRESS', 'UF_CRM_EJ_DIR'], cuotas: ['UF_CRM_EJ_CUOTA'] })
    expect(camposDeContactos(MEDIDOS)).toEqual(['ID', 'COMPANY_IDS', 'UF_CRM_EJ_NIF', 'UF_CRM_EJ_SIT', 'ADDRESS', 'UF_CRM_EJ_DIR', 'UF_CRM_EJ_CUOTA'])
    for (const k of ['UF_CRM_EJ_CLAVE', 'UF_CRM_EJ_IBAN', 'UF_CRM_EJ_DOC', 'BANKING_DETAILS']) expect(esCampoSensible(MEDIDOS[k as keyof typeof MEDIDOS], k)).toBe(true)
  })

  it('cuenta con y sin empresa, la situación, el NIF (con el RIF aparte), los repetidos y los que tienen empresa y datos de cliente', () => {
    const r = contarContactos(FILAS, MEDIDOS, new Set(['B00000001']))
    expect(r).toMatchObject({ total: 8, conEmpresa: 3, sinEmpresa: 5, conVariasEmpresas: 1, enlace: 'COMPANY_IDS', bloqueados: 4, conEmpresaYDatosDeCliente: 2 })
    expect(r.situacion).toEqual({ codigo: 'UF_CRM_EJ_SIT', etiqueta: 'Situación del Cliente', vaciasSinEmpresa: 2, vaciasConEmpresa: 2, opciones: [
      { texto: 'ACTIVO', propuesta: 'activo', sinEmpresa: 1, conEmpresa: 1 },
      { texto: 'BAJA DE AUTONOMO ❌', propuesta: 'baja', sinEmpresa: 1, conEmpresa: 0 },
      { texto: 'CLIENTE SOLO RENTA', propuesta: 'solo_renta', sinEmpresa: 1, conEmpresa: 0 }] })
    expect(r.nif).toEqual({ codigo: 'UF_CRM_EJ_NIF', etiqueta: 'DNI / NIE', sinEmpresaConNif: 4, porTipo: { DNI: 2, NIE: 0, CIF: 1, RIF: 1, otro: 0 },
      repetidosEntreContactos: { nifs: 1, contactos: 2 }, conNifDeUnaEmpresa: { nifs: 1, contactos: 1 } })
    expect(r.candidatos.cuotas).toEqual([{ codigo: 'UF_CRM_EJ_CUOTA', etiqueta: 'Cuota Renta', tipo: 'money', conAlgo: 1, conAlgoSinEmpresa: 0 }])
    expect(r.campos.map((x) => x.codigo)).not.toContain('UF_CRM_EJ_CLAVE')
    // Solo números y etiquetas: ni un NIF sale del recuento.
    expect(JSON.stringify(r)).not.toMatch(/00000000T|J000000000|B00000001/)
  })

  it('sin COMPANY_IDS usa COMPANY_ID; los RIF de todas las letras', () => {
    const sinIds = Object.fromEntries(Object.entries(MEDIDOS).filter(([k]) => k !== 'COMPANY_IDS'))
    const r = contarContactos([c('1', { COMPANY_ID: '70' }), c('2', { COMPANY_ID: null })], { ...sinIds, COMPANY_ID: { type: 'crm_company', title: 'Compañía' } }, new Set())
    expect(r).toMatchObject({ enlace: 'COMPANY_ID', conEmpresa: 1, sinEmpresa: 1 })
    expect(['J000000000', 'V000000000', 'E000000000', 'G000000000', 'P000000000'].every(esRif)).toBe(true)
    expect(['X0000000T', 'J00000000', 'A000000000'].some(esRif)).toBe(false)
  })

  it('el recuento lee las empresas y, si se pide, los contactos (solo los candidatos)', async () => {
    const pedidas: { metodo: string; select?: string[] }[] = []
    const EMPRESAS = { UF_N: { type: 'string', formLabel: 'CIF/NIF' }, UF_S: { type: 'enumeration', listLabel: 'Situación', items: [{ ID: 1, VALUE: 'ACTIVO' }] }, TITLE: { title: 'Nombre' } }
    const pedir = async (url: string, init: { body: string }) => {
      const metodo = url.split('/').pop()!.replace('.json', '')
      const cuerpo = JSON.parse(init.body) as { select?: string[] }
      pedidas.push({ metodo, select: cuerpo.select })
      const res = metodo === 'crm.company.fields' ? { result: EMPRESAS } : metodo === 'crm.contact.fields' ? { result: MEDIDOS }
        : metodo === 'crm.company.list' ? { result: [{ ID: '70', UF_N: 'B00000001', UF_S: '1', TITLE: 'X' }], total: 1 } : { result: FILAS, total: FILAS.length }
      return { ok: true, status: 200, json: async () => res }
    }
    const grupos = { texto: { nif: ['UF_N'] }, situacion: 'UF_S', cuotas: [], repetidos: { nif: 'UF_N', nombre: 'TITLE' }, contactos: true }
    expect(gruposValidos(grupos)).toEqual(grupos)
    expect(gruposValidos({ ...grupos, contactos: 'si' })).toBeNull()
    const r = await leerParaRecuento(pedir, 'https://portal.test/rest/1/abc/', grupos, async () => {}) as { contactos?: { nif?: { conNifDeUnaEmpresa: unknown } } }
    expect(pedidas.map((p) => p.metodo)).toEqual(['crm.company.fields', 'crm.company.list', 'crm.contact.fields', 'crm.contact.list'])
    expect(pedidas[3].select).not.toContain('UF_CRM_EJ_IBAN')
    expect(r.contactos?.nif?.conNifDeUnaEmpresa).toEqual({ nifs: 1, contactos: 1 })
  })
})
