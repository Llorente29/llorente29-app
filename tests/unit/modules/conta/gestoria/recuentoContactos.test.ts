// G01c · El recuento de los contactos de Bitrix24: solo números y etiquetas.
// Reproduce el «0 contactos con empresa» del recuento #4 (07/11): el enlace
// no viene en crm.contact.list (COMPANY_IDS), viene en crm.item.list
// (companyIds). NIF de ceros, nombres de prueba y códigos inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  camposDeContactos, candidatosDeContacto, contactosDeNegociaciones, contarContactos, empresasDeItems, esRif, estadosAPedir, paginaDeItems, type ExtrasContactos,
} from '../../../../../supabase/functions/conta-bitrix-leer/contactos'
import { leerContactos, leerParaRecuento } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'
import { repartirContactos, resumenDeContactos } from '../../../../../supabase/functions/_shared/crm/contactos'
import { esCampoSensible } from '../../../../../supabase/functions/conta-bitrix-leer/sensibles'
import { gruposValidos } from '../../../../../supabase/functions/conta-bitrix-leer/recuento'

const MEDIDOS = {
  ID: { type: 'integer', title: 'ID' }, NAME: { type: 'string', title: 'Nombre' },
  COMPANY_ID: { type: 'crm_company', title: 'Empresa' },
  COMPANY_IDS: { type: 'crm_company', title: 'COMPANY_IDS', isMultiple: true },
  EMAIL: { type: 'crm_multifield', title: 'E-mail' },
  TYPE_ID: { type: 'crm_status', title: 'Tipo de contacto', statusType: 'CONTACT_TYPE' },
  ADDRESS: { type: 'string', title: 'Dirección' },
  BANKING_DETAILS: { type: 'string', title: 'Detalles del pago' },
  UF_CRM_EJ_NIF: { type: 'string', formLabel: 'DNI / NIE' },
  UF_CRM_EJ_TIPO: { type: 'enumeration', listLabel: 'Tipo de cliente', items: [{ ID: 1, VALUE: 'Solo renta' }, { ID: 2, VALUE: 'Autónomo' }, { ID: 3, VALUE: 'Otros trámites' }] },
  UF_CRM_EJ_CAMP: { type: 'enumeration', listLabel: 'Campaña', items: [{ ID: 9, VALUE: 'Renta 2025' }] },
  UF_CRM_EJ_TARIFA: { type: 'money', formLabel: 'Tarifa Recurrente' },
  UF_CRM_EJ_CLAVE: { type: 'string', formLabel: 'Clave Cl@ve' },
  UF_CRM_EJ_IBAN: { type: 'string', formLabel: 'IBAN' },
}
const c = (ID: string, extra: Record<string, unknown> = {}) => ({ ID, ...extra })
// Como lo devuelve crm.contact.list: sin COMPANY_IDS, y COMPANY_ID a veces vacío.
const FILAS = [
  c('1', { UF_CRM_EJ_NIF: '00000000T', UF_CRM_EJ_TIPO: '1', TYPE_ID: 'CLIENT' }),                 // sin empresa, NIF de GoCardless
  c('2', { UF_CRM_EJ_NIF: '00000000-t', EMAIL: [{ VALUE: 'dos@prueba.test' }] }),                 // sin empresa, el mismo NIF; correo de GoCardless
  c('3', { UF_CRM_EJ_NIF: 'J000000000', UF_CRM_EJ_TIPO: '2', UF_CRM_EJ_TARIFA: '30|EUR' }),       // sin empresa, RIF y Tarifa Recurrente
  c('4', { UF_CRM_EJ_NIF: 'B00000001' }),                                                       // el NIF de la empresa 70 y enlazado a ella (companyIds)
  c('5', { UF_CRM_EJ_NIF: 'B00000002', COMPANY_ID: '72' }),                                     // el NIF de la empresa 71, enlazado a otra (COMPANY_ID)
  c('6', { UF_CRM_EJ_NIF: 'B00000002' }),                                                       // el NIF de la empresa 71, sin enlace
  c('7', { UF_CRM_EJ_TIPO: '3' }),                                                              // sin empresa y sin nada, con negociación
  c('8', { UF_CRM_EJ_TARIFA: '0' }),                                                            // sin empresa y sin nada (tarifa 0)
  c('9', { UF_CRM_EJ_TARIFA: '45' }),                                                           // con empresa (companyIds) y con tarifa propia
]
const EXTRAS: ExtrasContactos = {
  empresasDe: new Map([['4', ['70']], ['9', ['73', '74']]]),
  conNegociacion: new Set(['7', '4']),
  nifDeEmpresa: new Map([['70', 'B00000001'], ['71', 'B00000002']]),
  gocardless: { nifs: new Set(['00000000T']), correos: new Set(['dos@prueba.test']) },
  estados: { TYPE_ID: { CLIENT: 'Cliente', SUPPLIER: 'Proveedor' } },
}

describe('G01c · el recuento de los contactos', () => {
  it('reproduce el «0 con empresa» del recuento #4: sin el enlace de crm.item.list, nadie tenía empresa', () => {
    const sinEnlace = contarContactos(FILAS, MEDIDOS, { ...EXTRAS, empresasDe: new Map() })
    expect(sinEnlace.conEmpresa).toBe(1) // solo el del COMPANY_ID (a veces vacío en Bitrix24)
    const r = contarContactos(FILAS, MEDIDOS, EXTRAS)
    expect(r).toMatchObject({ total: 9, conEmpresa: 3, sinEmpresa: 6, conVariasEmpresas: 1, soloEmpresaPrincipal: 1, bloqueados: 3 })
  })

  it('los candidatos y las listas de cliente (también el tipo de contacto), nunca un campo sensible; lo que se pide', () => {
    const k = candidatosDeContacto(MEDIDOS)
    expect(k.listas).toEqual(['TYPE_ID', 'UF_CRM_EJ_TIPO', 'UF_CRM_EJ_CAMP'])
    expect(k.tarifa).toEqual(['UF_CRM_EJ_TARIFA'])
    expect(estadosAPedir(MEDIDOS)).toEqual([{ codigo: 'TYPE_ID', entidad: 'CONTACT_TYPE' }])
    const pide = camposDeContactos(MEDIDOS)
    expect(pide).toEqual(['ID', 'COMPANY_ID', 'EMAIL', 'UF_CRM_EJ_NIF', 'ADDRESS', 'UF_CRM_EJ_TARIFA', 'TYPE_ID', 'UF_CRM_EJ_TIPO', 'UF_CRM_EJ_CAMP'])
    for (const x of ['COMPANY_IDS', 'UF_CRM_EJ_CLAVE', 'UF_CRM_EJ_IBAN', 'BANKING_DETAILS']) expect(pide).not.toContain(x)
    expect(esCampoSensible(MEDIDOS.BANKING_DETAILS, 'BANKING_DETAILS')).toBe(true)
  })

  it('cada opción de las listas, sin empresa y con empresa', () => {
    const r = contarContactos(FILAS, MEDIDOS, EXTRAS)
    expect(r.listas.find((l) => l.codigo === 'UF_CRM_EJ_TIPO')).toEqual({ codigo: 'UF_CRM_EJ_TIPO', etiqueta: 'Tipo de cliente', vaciasSinEmpresa: 3, vaciasConEmpresa: 3,
      opciones: [{ texto: 'Solo renta', sinEmpresa: 1, conEmpresa: 0 }, { texto: 'Autónomo', sinEmpresa: 1, conEmpresa: 0 }, { texto: 'Otros trámites', sinEmpresa: 1, conEmpresa: 0 }] })
    expect(r.listas.find((l) => l.codigo === 'TYPE_ID')?.opciones).toEqual([{ texto: 'Cliente', sinEmpresa: 1, conEmpresa: 0 }, { texto: 'Proveedor', sinEmpresa: 0, conEmpresa: 0 }])
  })

  it('las señales de cliente de los contactos sin empresa: NIF, Tarifa Recurrente, negociación y GoCardless (por NIF o correo)', () => {
    const r = contarContactos(FILAS, MEDIDOS, EXTRAS)
    expect(r.senalesSinEmpresa).toEqual({ nif: 4, tarifaRecurrente: 1, negociacion: 1, gocardless: 2, alguna: 5, ninguna: 1 })
    expect(r.nif).toMatchObject({ sinEmpresaConNif: 4, porTipo: { DNI: 2, NIE: 0, CIF: 1, RIF: 1, otro: 0 }, repetidosEntreContactos: { nifs: 1, contactos: 2 } })
  })

  it('los que tienen el NIF de una empresa: enlazados a esa, a otra o a ninguna; y los de empresa con datos de cliente', () => {
    const r = contarContactos(FILAS, MEDIDOS, EXTRAS)
    expect(r.nifDeUnaEmpresa).toEqual({ contactos: 3, enlazadosAEsaEmpresa: 1, enlazadosAOtra: 1, sinEnlace: 1 })
    expect(r.conEmpresaYDatosDeCliente).toBe(1)
    // Solo números y etiquetas: ni un NIF ni un correo salen del recuento.
    expect(JSON.stringify(r)).not.toMatch(/00000000T|J000000000|B0000000|prueba\.test/)
  })

  it('crm.item.list: la página, las empresas de cada contacto y los contactos con negociación; los RIF de todas las letras', () => {
    expect(paginaDeItems({ result: { items: [{ id: 1 }] }, next: 50, total: 60 })).toEqual({ result: [{ id: 1 }], next: 50, total: 60 })
    expect(paginaDeItems({ error: 'X' })).toEqual({ error: 'X' })
    expect(empresasDeItems([{ id: 4, companyIds: [70] }, { id: 5, companyIds: [] }])).toEqual(new Map([['4', ['70']], ['5', []]]))
    expect(contactosDeNegociaciones([{ id: 1, contactIds: [4, 7] }, { id: 2, contactIds: [7] }])).toEqual(new Set(['4', '7']))
    expect(['J000000000', 'V000000000', 'E000000000', 'G000000000', 'P000000000'].every(esRif)).toBe(true)
    expect(['X0000000T', 'J00000000', 'A000000000'].some(esRif)).toBe(false)
  })

  it('el recuento pide: empresas, campos de contacto, contactos, sus empresas (crm.item.list), negociaciones y el tipo de contacto', async () => {
    const pedidas: { metodo: string; cuerpo: Record<string, unknown> }[] = []
    const EMPRESAS = { UF_N: { type: 'string', formLabel: 'CIF/NIF' }, UF_S: { type: 'enumeration', listLabel: 'Situación', items: [{ ID: 1, VALUE: 'ACTIVO' }] }, TITLE: { title: 'Nombre' } }
    const pedir = async (url: string, init: { body: string }) => {
      const metodo = url.split('/').pop()!.replace('.json', '')
      const cuerpo = JSON.parse(init.body) as Record<string, unknown>
      pedidas.push({ metodo, cuerpo })
      const res = metodo === 'crm.company.fields' ? { result: EMPRESAS } : metodo === 'crm.contact.fields' ? { result: MEDIDOS }
        : metodo === 'crm.company.list' ? { result: [{ ID: '70', UF_N: 'B00000001', UF_S: '1', TITLE: 'X' }], total: 1 }
        : metodo === 'crm.contact.list' ? { result: FILAS, total: FILAS.length }
        : metodo === 'crm.status.list' ? { result: [{ STATUS_ID: 'CLIENT', NAME: 'Cliente' }] }
        : cuerpo.entityTypeId === 3 ? { result: { items: [{ id: 4, companyIds: [70] }] }, total: 1 } : { result: { items: [{ id: 1, contactIds: [7] }] }, total: 1 }
      return { ok: true, status: 200, json: async () => res }
    }
    const grupos = { texto: { nif: ['UF_N'] }, situacion: 'UF_S', cuotas: [], repetidos: { nif: 'UF_N', nombre: 'TITLE' }, contactos: true }
    expect(gruposValidos(grupos)).toEqual(grupos)
    const r = await leerParaRecuento(pedir, 'https://portal.test/rest/1/abc/', grupos, async () => {}, null,
      { nifs: new Set(['00000000T']), correos: new Set() }) as { contactos: ReturnType<typeof contarContactos> }
    expect(pedidas.map((p) => p.metodo)).toEqual(['crm.company.fields', 'crm.company.list', 'crm.contact.fields', 'crm.contact.list', 'crm.item.list', 'crm.item.list', 'crm.status.list'])
    expect(pedidas[4].cuerpo).toMatchObject({ entityTypeId: 3, select: ['id', 'companyIds'] })
    expect(pedidas[5].cuerpo).toMatchObject({ entityTypeId: 2, select: ['id', 'contactIds'] })
    expect(pedidas[6].cuerpo).toEqual({ filter: { ENTITY_ID: 'CONTACT_TYPE' } })
    expect(r.contactos).toMatchObject({ conEmpresa: 2, nifDeUnaEmpresa: { contactos: 1, enlazadosAEsaEmpresa: 1 } })
    expect(r.contactos.senalesSinEmpresa).toMatchObject({ gocardless: 2, negociacion: 1 })
    // G01c (Julio, 07/11) · El reparto, con la regla de la lectura. Aquí crm.item.list solo enlaza el 4: 1, 2, 3, 6, 9 (tarifa) y 7 (solo
    // negociación, a revisar) son clientes; 4 se une a la empresa 70 por su NIF; 5 (COMPANY_ID 72) es persona de contacto; 8, fuera.
    const reparto = (r.contactos as unknown as { reparto: unknown }).reparto
    expect(reparto).toEqual({ contactos: 9, clientes: 6, seUnenAEmpresa: 1, personas: 1, fuera: 1, pendientes: 1 })
    // Y es lo mismo que cuenta la lectura con los mismos contactos (leerContactos + repartirContactos).
    const l = await leerContactos(pedir, 'https://portal.test/rest/1/abc/', null, async () => {}, { nifs: new Set(['00000000T']), correos: new Set() })
    const nifs = new Set(['B00000001'])
    expect(resumenDeContactos(l.contactos, repartirContactos(l.contactos, nifs, 'Bitrix24'), nifs)).toEqual(reparto)
  })
})
