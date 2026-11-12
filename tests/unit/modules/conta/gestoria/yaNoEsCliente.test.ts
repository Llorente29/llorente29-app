// G01c · PR B · Un cliente de Sumied cuya ficha ya no entra como cliente en la
// lectura del CRM (lo del 08/11: un contacto que entró como cliente propio y,
// con la unión arreglada en el PR A, pasó a persona de contacto de su
// empresa). No se archiva solo: sale en «Pendiente de revisar». Ids y nombres
// inventados (T11).
import { describe, expect, it } from 'vitest'
import { agrupar, yaNoSonClientes, type FichaParaUnir } from '../../../../../supabase/functions/_shared/crm/clientes'

const ficha = (tipoFicha: 'empresa' | 'contacto', idExterno: string, nif: string | null = null): FichaParaUnir => ({ tipoFicha, idExterno, nif, situacion: 'activo' })

describe('G01c · ya no es cliente en tu CRM', () => {
  // En la lectura: dos empresas; el contacto 9 se une a la empresa 2 por NIF; el 8 ya no entra como cliente.
  const clientes = agrupar([ficha('empresa', '1'), ficha('empresa', '2', 'B00000000'), ficha('contacto', '9', 'B00000000')], true)
  const guardados = [
    { tipoFicha: 'empresa' as const, idExterno: '1', nombre: 'Empresa Uno de Prueba' },
    { tipoFicha: 'empresa' as const, idExterno: '3', nombre: 'Empresa Tres de Prueba' },   // ya no está entre las empresas
    { tipoFicha: 'contacto' as const, idExterno: '8', nombre: 'Contacto Ocho de Prueba' }, // ahora persona de contacto
    { tipoFicha: 'contacto' as const, idExterno: '9', nombre: 'Contacto Nueve de Prueba' }, // sigue: unido a la empresa 2
  ]

  it('salen los que ya no entran, con su ficha y su porqué', () => {
    const d = yaNoSonClientes(guardados, clientes, true, 'Bitrix24')
    expect(d.map((x) => [x.tipo, x.tipo_ficha, x.id_externo])).toEqual([['ya_no_es_cliente_en_crm', 'contacto', '8'], ['ya_no_es_cliente_en_crm', 'empresa', '3']])
    expect(d[0].porque).toContain('contacto 8 de Bitrix24')
    expect(d[0].porque).toContain('No se archiva solo')
    expect(d[0].datos).toEqual({ nombre: 'Contacto Ocho de Prueba' })
  })

  it('sin los contactos dentro (mapa sin confirmar), ningún contacto sale: no es que haya dejado de ser cliente', () => {
    const d = yaNoSonClientes(guardados, agrupar([ficha('empresa', '1'), ficha('empresa', '2')], true), false, 'Bitrix24')
    expect(d.map((x) => `${x.tipo_ficha}:${x.id_externo}`)).toEqual(['empresa:3'])
  })

  it('si todos siguen, no sale nada', () => {
    expect(yaNoSonClientes(guardados.filter((g) => ['1', '9'].includes(g.idExterno)), clientes, true, 'Bitrix24')).toEqual([])
  })
})
