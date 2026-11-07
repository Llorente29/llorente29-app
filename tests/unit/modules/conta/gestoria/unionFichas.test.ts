// G01b · La unión de las fichas repetidas de Bitrix24 y los campos que no se
// leen nunca (Julio, 07/11). NIF de ceros, nombres de prueba y códigos
// UF_CRM_ inventados (T11); las etiquetas, como las del portal de QBO.
import { describe, expect, it } from 'vitest'
import {
  MAX_FICHAS_POR_NIF, agrupar, esCampoSensible, masViva, nifComoLaBase, resumenDeUnion, tipoDeNif, type FichaParaUnir,
} from '../../../../../supabase/functions/conta-bitrix-leer/clientes'
import { camposQueSePiden, proponerMapa, type MapaBitrix, type Situacion } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'
import { leerFichas, leerParaRecuento } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'
import { simularUnion } from '../../../../../supabase/functions/conta-bitrix-leer/recuento'

const f = (bitrixId: string, nif: string | null, situacion: Situacion | null): FichaParaUnir => ({ bitrixId, nif, situacion })

describe('G01b · la unión de las fichas por NIF', () => {
  const fichas = [
    f('10', '00000000T', 'baja'), f('11', '00000000-t', 'activo'), f('12', 'ES00000000T', 'moroso'), // un NIF en 3 fichas: queda activo
    f('20', 'B00000000', 'sin_clasificar'), f('21', 'b-00000000', 'solo_renta'),                       // queda solo renta
    f('30', 'X0000000T', null),                                                                        // sola, sin repetir
    f('40', '123', 'activo'), f('41', '123', 'baja'),                                                  // formato no válido: cada una sola y sin NIF
    f('50', null, 'activo'),                                                                           // sin NIF
    ...Array.from({ length: MAX_FICHAS_POR_NIF }, (_, i) => f(String(60 + i), 'Y0000000Z', 'activo')), // en 10 fichas: cada una sola y sin NIF
  ]

  it('mismo NIF = un cliente con todas sus fichas; su situación, la más viva; la principal, la de esa situación', () => {
    const c = agrupar(fichas, true)
    const uno = c.find((x) => x.clave === 'nif:00000000T')!
    expect(uno).toMatchObject({ nif: '00000000T', situacion: 'activo', motivo: 'repetidas', fichasConSuNif: 3 })
    expect(uno.principal.bitrixId).toBe('11')
    expect(uno.fichas.map((x) => x.bitrixId)).toEqual(['10', '11', '12'])
    expect(c.find((x) => x.clave === 'nif:B00000000')).toMatchObject({ situacion: 'solo_renta', motivo: 'repetidas' })
    expect(c.find((x) => x.clave === 'nif:X0000000T')).toMatchObject({ situacion: null, motivo: null, fichas: [{ bitrixId: '30' }] })
  })

  it('un NIF sin formato de DNI, NIE o CIF, o en 10 fichas o más, no se usa: cada ficha sola, sin NIF y a revisar', () => {
    const c = agrupar(fichas, true)
    expect(c.filter((x) => x.motivo === 'nif_no_valido').map((x) => [x.clave, x.nif])).toEqual([['ficha:40', null], ['ficha:41', null]])
    const muchas = c.filter((x) => x.motivo === 'nif_en_muchas')
    expect(muchas).toHaveLength(MAX_FICHAS_POR_NIF)
    expect(muchas.every((x) => x.nif === null && x.fichas.length === 1 && x.fichasConSuNif === MAX_FICHAS_POR_NIF)).toBe(true)
    expect(c.find((x) => x.clave === 'ficha:50')).toMatchObject({ nif: null, motivo: null })
    // 9 fichas con el mismo NIF sí se unen.
    expect(agrupar(Array.from({ length: MAX_FICHAS_POR_NIF - 1 }, (_, i) => f(String(i), 'Y0000000Z', 'baja')), true)).toHaveLength(1)
  })

  it('sin la unión aplicada, cada ficha va sola y con su NIF, como antes', () => {
    const c = agrupar(fichas, false)
    expect(c).toHaveLength(fichas.length)
    expect(c.every((x) => x.motivo === null && x.fichas.length === 1)).toBe(true)
    expect(c.find((x) => x.clave === 'ficha:11')?.nif).toBe('00000000T')
  })

  it('el resumen: clientes, fichas unidas, sin NIF y cada situación, de clientes y de fichas', () => {
    expect(resumenDeUnion(agrupar(fichas, true))).toEqual({
      fichas: 19, clientes: 16, clientesUnidos: 2, fichasUnidas: 5, sinNifPorFormato: 2, sinNifPorMuchas: 10,
      clientesPorSituacion: { activo: 13, moroso: 0, solo_renta: 1, sin_clasificar: 0, baja: 1, sin_situacion: 1 },
      fichasPorSituacion: { activo: 13, moroso: 1, solo_renta: 1, sin_clasificar: 1, baja: 2, sin_situacion: 1 },
    })
  })

  it('la más viva, el NIF como la base y su tipo', () => {
    expect([masViva(['baja', 'sin_clasificar']), masViva(['baja', null]), masViva([null]), masViva([]), masViva(['solo_renta', 'moroso'])])
      .toEqual(['sin_clasificar', 'baja', null, null, 'moroso'])
    expect([nifComoLaBase('es-b.00000000'), nifComoLaBase(['', ' 00000000-t ']), nifComoLaBase('  '), nifComoLaBase(null)]).toEqual(['B00000000', '00000000T', null, null])
    expect([tipoDeNif('00000000T'), tipoDeNif('X0000000T'), tipoDeNif('B00000000'), tipoDeNif('0')]).toEqual(['DNI', 'NIE', 'CIF', 'otro'])
  })

  it('el recuento simula la misma regla, con la situación del mapa confirmado', () => {
    const medidos = { UF_S: { items: [{ ID: 1, VALUE: 'ACTIVO' }, { ID: 2, VALUE: 'BAJA DE GESTORIA ❌' }] } }
    const filas = [{ ID: '1', UF_N: '00000000T', UF_S: '2' }, { ID: '2', UF_N: '00000000T', UF_S: '1' }, { ID: '3', UF_N: '0', UF_S: '' }]
    expect(simularUnion(filas, 'UF_N', 'UF_S', medidos, { '1': 'activo', '2': 'baja' })).toMatchObject({
      fichas: 3, clientes: 2, clientesUnidos: 1, fichasUnidas: 2, sinNifPorFormato: 1,
      clientesPorSituacion: { activo: 1, sin_situacion: 1 }, fichasPorSituacion: { activo: 1, baja: 1, sin_situacion: 1 },
    })
  })
})

describe('G01b · los campos con contraseñas o certificados no se leen nunca', () => {
  // Las etiquetas, como las del portal de QBO (medidas el 07/11, solo lectura); los códigos, inventados.
  const MEDIDOS = {
    TITLE: { title: 'Nombre de la empresa', type: 'string' },
    UF_CRM_EJ_NIF: { formLabel: 'CIF/NIF', type: 'string' },
    UF_CRM_EJ_CLAVE: { formLabel: ' Clave Certificado Digital Administrador 1', type: 'string' },
    UF_CRM_EJ_CLAVE2: { formLabel: 'Clave Certificado Digital', type: 'string' },
    UF_CRM_EJ_USUARIO: { formLabel: 'Usuario vinculado', type: 'string' },
    UF_CRM_EJ_PIN: { formLabel: '¿Tiene usted clave pin?', type: 'enumeration' },
    UF_CRM_EJ_CERT: { formLabel: 'Certificado Electrónico Sociedad', type: 'file' },
    UF_CRM_EJ_PASS: { formLabel: 'Acceso', type: 'password' },
    UF_CRM_EJ_FECHA: { formLabel: 'Fecha vence Certificado', type: 'date' },
    UF_CRM_EJ_SIT: { listLabel: 'Situación del Cliente', type: 'enumeration', items: [{ ID: 1, VALUE: 'ACTIVO' }] },
  }

  it('por su etiqueta (clave, contraseña, PIN, usuario…) y por su tipo (fichero, contraseña)', () => {
    const sensibles = Object.entries(MEDIDOS).filter(([, c]) => esCampoSensible(c)).map(([k]) => k)
    expect(sensibles).toEqual(['UF_CRM_EJ_CLAVE', 'UF_CRM_EJ_CLAVE2', 'UF_CRM_EJ_USUARIO', 'UF_CRM_EJ_PIN', 'UF_CRM_EJ_CERT', 'UF_CRM_EJ_PASS'])
    expect(esCampoSensible({ formLabel: 'Contraseña de la sede' })).toBe(true)
    expect(esCampoSensible({ formLabel: 'Clasificación' })).toBe(false)
    expect(esCampoSensible(null)).toBe(false)
  })

  it('la propuesta del mapa no los usa nunca', () => {
    const p = proponerMapa('Prueba', MEDIDOS, [])
    const usados = p.mapa.campos.map((c) => c.codigo)
    expect(usados.some((c) => c && /CLAVE|USUARIO|PIN|CERT|PASS/.test(c))).toBe(false)
    expect(p.sinUsar.map((x) => x.codigo).some((c) => /CLAVE|USUARIO|PIN|CERT|PASS/.test(c))).toBe(false)
  })

  it('la lectura no los pide aunque estén en el mapa por error, y dice cuáles ha quitado', async () => {
    const pedidas: { metodo: string; select?: string[] }[] = []
    const pedir = async (url: string, init: { body: string }) => {
      const metodo = url.split('/').pop()!.replace('.json', '')
      const cuerpo = JSON.parse(init.body) as { select?: string[] }
      pedidas.push({ metodo, select: cuerpo.select })
      return { ok: true, status: 200, json: async () => (metodo === 'crm.company.fields' ? { result: MEDIDOS } : { result: [{ ID: '1', TITLE: 'CLIENTE PRUEBA' }], total: 1 }) }
    }
    const mapa: MapaBitrix = { nombre: 'Prueba', formaPagoAEmisor: {}, campos: [
      { codigo: 'TITLE', campo: 'nombre' }, { codigo: 'UF_CRM_EJ_CLAVE', campo: 'nif' }, { codigo: 'UF_CRM_EJ_CERT', campo: 'calle' }] }
    expect(camposQueSePiden(mapa)).toContain('UF_CRM_EJ_CLAVE')
    const r = await leerFichas(pedir, 'https://portal.test/rest/1/abc/', mapa, async () => {})
    const lista = pedidas.find((x) => x.metodo === 'crm.company.list')!
    expect(lista.select).toEqual(['ID', 'TITLE'])
    expect(r.bloqueados).toEqual(['Clave Certificado Digital Administrador 1', 'Certificado Electrónico Sociedad'])
    expect(r.fichas[0]).toMatchObject({ nif: null, calle: null })
  })

  it('el recuento para si se le pide uno', async () => {
    const pedir = async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith('crm.company.fields.json') ? { result: MEDIDOS } : { result: [], total: 0 }) })
    await expect(leerParaRecuento(pedir, 'https://portal.test/rest/1/abc/', { texto: { nif: ['UF_CRM_EJ_CLAVE'] }, situacion: 'UF_CRM_EJ_SIT', cuotas: [] }, async () => {}))
      .rejects.toThrow('Estos campos guardan contraseñas o certificados y no se leen nunca: UF_CRM_EJ_CLAVE.')
  })
})

import { diferenciasDeLectura, ensayoDeUnion } from '../../../../../supabase/functions/conta-bitrix-leer/clientes'

describe('G01b · lo que sale en «Pendiente de revisar» y el ensayo', () => {
  const ficha = (bitrixId: string, nif: string | null, situacion: Situacion | null) =>
    ({ bitrixId, nif, nifEnBitrix: nif ? ` ${nif} ` : null, situacion, situacionTexto: situacion ? situacion.toUpperCase() : null, nombre: `CLIENTE PRUEBA ${bitrixId}` })
  const fichas = [ficha('1', '00000000T', 'baja'), ficha('2', '00000000T', 'activo'), ficha('3', '123', 'activo'), ficha('4', null, 'activo')]

  it('con la unión: el cliente unido y la ficha sin NIF, con su porqué y sin el NIF en el texto', () => {
    const d = diferenciasDeLectura(agrupar(fichas, true), [], true)
    expect(d.map((x) => [x.tipo, x.porque_codigo, x.bitrix_id])).toEqual([['fichas_repetidas', 'mismo_nif_distinta_situacion', '2'], ['nif_no_valido', 'formato', '3']])
    expect(d[0].porque).toBe('Sale en 2 fichas de Bitrix24 con el mismo NIF (1, 2: de baja, activa). En Sumied es un solo cliente, «Activo».')
    expect(d[1].porque).toBe('Su NIF en Bitrix24 (ficha 3) no tiene formato de DNI, NIE ni CIF: entra sin NIF.')
    expect(JSON.stringify(d)).not.toContain('00000000T')
  })

  it('sin la unión: la ficha que choca no se guarda, sale con su porqué y dice que se unirá; la lectura sigue', () => {
    const errores = [{ bitrixIds: ['2'], nombre: 'CLIENTE PRUEBA 2', emisor: null, codigo: '23505', porque: 'su NIF ya es de otro cliente de Sumied' }]
    const d = diferenciasDeLectura(agrupar(fichas, false), errores, false)
    expect(d).toEqual([{ tipo: 'ficha_no_guardada', porque_codigo: 'nif_de_otro', bitrix_id: '2', datos: { bitrixIds: ['2'], nombre: 'CLIENTE PRUEBA 2', emisor: null },
      porque: '«CLIENTE PRUEBA 2» (ficha 2 de Bitrix24) no se ha guardado: su NIF ya es de otro cliente de Sumied. Se unirá a su cliente cuando se aplique la unión en Ajustes › Cobros › Bitrix24.' }])
  })

  it('el ensayo: el resumen, cada cliente unido con sus fichas y cada ficha sin NIF con el suyo tal cual y su motivo', () => {
    const e = ensayoDeUnion(fichas)
    expect(e.resumen).toMatchObject({ fichas: 4, clientes: 3, clientesUnidos: 1, fichasUnidas: 2, sinNifPorFormato: 1 })
    expect(e.unidos).toEqual([{ nif: '00000000T', situacion: 'activo', fichas: [
      { bitrixId: '1', nombre: 'CLIENTE PRUEBA 1', situacion: 'baja', situacionTexto: 'BAJA' }, { bitrixId: '2', nombre: 'CLIENTE PRUEBA 2', situacion: 'activo', situacionTexto: 'ACTIVO' }], clientesHoy: 0 }])
    expect(e.seJuntan).toBe(0)
    expect(e.sinNif).toEqual([{ bitrixId: '3', nombre: 'CLIENTE PRUEBA 3', nifEnBitrix: ' 123 ', motivo: 'nif_no_valido', fichasConSuNif: 1 }])
  })
})

describe('G01b · el ensayo dice qué clientes ya creados se juntan (producción, 07/11: 18 NIF que ya eran 2 clientes cada uno)', () => {
  it('cuenta los clientes de hoy de cada NIF y cuántos se retiran', () => {
    const f = (bitrixId: string, nif: string) => ({ bitrixId, nif, nifEnBitrix: nif, situacion: 'activo' as const, situacionTexto: 'ACTIVO', nombre: `CLIENTE PRUEBA ${bitrixId}` })
    const e = ensayoDeUnion([f('1', '00000000T'), f('2', '00000000T'), f('3', 'B00000000'), f('4', 'B00000000'), f('5', 'X0000000T'), f('6', 'X0000000T')],
      new Map([['1', 'P1'], ['2', 'P2'], ['3', 'P3'], ['4', 'P3']]))
    expect(e.unidos.map((u) => [u.nif, u.clientesHoy])).toEqual([['00000000T', 2], ['B00000000', 1], ['X0000000T', 0]])
    expect(e.seJuntan).toBe(1)
  })
})
